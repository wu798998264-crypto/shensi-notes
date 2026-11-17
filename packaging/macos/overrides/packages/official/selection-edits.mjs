import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {jsonStore,identity,failure} from './store.mjs';
import {appendPublicActivity} from './public-activity.mjs';

const pluginId='official.document-chat';
const content=doc=>JSON.stringify([doc?.markdown??'',doc?.html??'',doc?.canvas??null]);
const label=mode=>({replace:'局部修改',insert_before:'在选区前补写',insert_after:'在选区后补写',insert_at_caret:'从此处补写'})[mode];
export function createSelectionEdits({service,agent,chat,models,requirePlugin,doubao}){
 const stores=new Map(),running=new Map();
 const store=id=>{identity(id);if(!stores.has(id))stores.set(id,jsonStore(join(service.dataRoot,'plugins',pluginId,id,'selection-edits.json'),{jobs:[]}));return stores.get(id);};
 async function read(body){await requirePlugin(pluginId);const loaded=await service.load(body.id),value=await store(body.id).read();for(const job of value.jobs){if(loaded.state.coreTextOperations?.[job.id]?.documentId===job.documentId)job.status='applied';else if(job.status==='running'&&!running.has(job.id)){job.status='interrupted';job.error='上次局部修改已中断，未自动重发。';}}return value;}
 async function start(body){
  const plugin=await requirePlugin(pluginId),loaded=await service.load(body.id),doc=loaded.state.documents[body.documentId];
  if(!doc||doc.canvas)throw failure('请选择可编辑文档');
  if(loaded.stateStamp!==body.expectedStateStamp)throw failure('正文已变化，请重新选择','WORKSPACE_STATE_CONFLICT');
  const {start,end,selectedText='',documentText='',instruction='',format='rich',mode='replace'}=body;
  if(!label(mode)||!['rich','markdown'].includes(format)||typeof instruction!=='string'||!instruction.trim()||instruction.length>10000||typeof documentText!=='string'||documentText.length>4000000||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>documentText.length||documentText.slice(start,end)!==selectedText||(mode!=='insert_at_caret'&&!selectedText.trim()))throw failure('局部修改选区或指令无效');
  if(format==='markdown'&&documentText!==doc.markdown)throw failure('Markdown 选区基线已变化');
  const state=await chat.handle('read',{id:body.id,pluginId}),conversation=state.conversations.find(c=>c.id===state.activeId),profileId=conversation?.profileId||plugin.settings.textProfileId||(await models.list()).profiles.find(p=>p.enabled!==false&&(p.channel==='text'||p.channels?.includes('text')))?.id;
  if(!profileId)throw failure('请先在对话控制中选择文字模型配置');
  const config=await models.resolve(profileId,'text',{model:conversation?.model,reasoningEffort:conversation?.reasoningEffort,speedMode:conversation?.speedMode}),jobId=identity(body.requestId||'selection-'+randomUUID()),db=store(body.id);
  if((await db.read()).jobs.some(j=>j.id===jobId))return read(body);
  const job={id:jobId,documentId:body.documentId,format,mode,start,end,selectedText,documentText,instruction:instruction.trim(),document:structuredClone(doc),profileId,model:config.model,reasoningEffort:config.reasoningEffort||'',speedMode:config.speedMode||'default',status:'running',candidate:'',events:[],createdAt:new Date().toISOString()};
  const controller=new AbortController(),entry={controller,profileId,notebookId:body.id};running.set(jobId,entry);
  try{await db.update(value=>{value.jobs.push(job);return value;});}catch(error){running.delete(jobId);throw error;}
  entry.task=(async()=>{try{
   await requirePlugin(pluginId);if(controller.signal.aborted)throw failure('任务已停止');
   const prompt=[label(mode)+'任务。只生成'+(mode==='replace'?'替换选区':'补写')+'的正式文本候选，不直接写文件。',`文档：${doc.title}`,`前文：\n${documentText.slice(Math.max(0,start-1600),start)}`,`选中文字（补写时必须逐字保留）：\n${selectedText}`,`后文：\n${documentText.slice(end,end+1600)}`,`要求：${instruction}`,mode==='replace'?'不要重写选区以外内容。':'只输出新增片段，不重复选区和上下文。','不附加说明、问答、标题或代码围栏。'].join('\n\n');
   const references=Object.fromEntries(['skillRefs','routeRefs','documentRefs','novelRefs','attachments'].filter(key=>conversation?.[key]!==undefined).map(key=>[key,conversation[key]]));
   const response=await agent.run({body:{...references,id:body.id,pluginId,documentId:body.documentId,requestId:jobId,profileId,model:job.model,reasoningEffort:job.reasoningEffort,speedMode:job.speedMode,webSearchEnabled:conversation?.webSearchEnabled===true,text:prompt,outputMode:'draft',contentOnly:true},conversationId:conversation?.id||jobId,messages:[...(conversation?.messages||[]).map(m=>({role:m.role,content:m.text})),{role:'user',content:prompt}],system:'这是原生选区编辑器的只读候选任务。只返回需要的正式片段，编辑器负责预览和确认；禁止执行任何写入或生成媒体。',signal:controller.signal,onEvent:async event=>{if(!controller.signal.aborted)await db.update(value=>{const j=value.jobs.find(j=>j.id===jobId);j.events=appendPublicActivity(j.events,event);return value;});},requestApproval:async()=>{throw failure('局部候选任务不需要外部写入权限');}});
   if(controller.signal.aborted)throw failure('任务已停止');const candidate=String(typeof response==='string'?response:response.text??response.content??'').trim();if(!candidate)throw failure('模型未返回局部修改候选');
   await requirePlugin(pluginId);await db.update(value=>{const j=value.jobs.find(j=>j.id===jobId);if(j.status==='running')Object.assign(j,{status:'ready',candidate,completedAt:new Date().toISOString()});return value;});
  }catch(error){await db.update(value=>{const j=value.jobs.find(j=>j.id===jobId);if(j.status==='running')Object.assign(j,{status:controller.signal.aborted?'stopped':'failed',error:String(error.message).replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]').replace(/\b(?:sk|ds|api)[-_][A-Za-z0-9_-]{12,}\b/gi,'[已隐藏]')});return value;});}finally{running.delete(jobId);}})();
  return read(body);
 }
 async function handle(action,body){
  if(action==='start')return start(body);if(action==='read')return read(body);await requirePlugin(pluginId);
  const db=store(body.id),job=(await db.read()).jobs.find(j=>j.id===body.jobId);if(!job)throw failure('局部修改候选不存在');
  if(action==='cancel'){running.get(job.id)?.controller.abort();await doubao?.stopScope({pluginId,id:body.id,requestId:job.id});await db.update(value=>{const j=value.jobs.find(j=>j.id===job.id);if(j.status!=='applied')j.status='cancelled';return value;});return read(body);}
  if(action!=='apply')throw failure('未知局部修改操作');
  if(job.status==='applied')return service.load(body.id);if(job.status!=='ready')throw failure('候选尚未完成或已取消');
  const loaded=await service.load(body.id),doc=loaded.state.documents[job.documentId];
  if(loaded.state.coreTextOperations?.[job.id]?.documentId===job.documentId){await db.update(value=>{value.jobs.find(j=>j.id===job.id).status='applied';return value;});return loaded;}
  if(content(doc)!==content(job.document))throw failure('原文位置已变化，候选已保留，请重新选择位置','SELECTION_ANCHOR_CONFLICT');
  if(loaded.stateStamp!==body.expectedStateStamp)throw failure('文档已变化，请重新检查','WORKSPACE_STATE_CONFLICT');
  let from=job.start,to=job.end;if(job.mode==='insert_before')to=from;else if(job.mode==='insert_after')from=to;
  const result=await service.applyTextEdit(body.id,{documentId:job.documentId,operationId:job.id,expectedStateStamp:loaded.stateStamp,expectedDocument:job.document,scope:job.format==='rich'?'rich-partial':'partial',start:from,end:to,expectedText:job.mode==='replace'?job.selectedText:'',text:job.candidate,...(job.format==='rich'?{richText:{...body.richText,expectedHtml:doc.html}}:{})});
  await db.update(value=>{Object.assign(value.jobs.find(j=>j.id===job.id),{status:'applied',appliedAt:new Date().toISOString()});return value;});return result;
 }
 async function stop(predicate){const tasks=[];for(const entry of running.values())if(predicate(entry)){entry.controller.abort();tasks.push(entry.task);}await Promise.allSettled(tasks);}
 return {handle,stopAll:()=>stop(()=>true),abortProfiles:ids=>stop(entry=>ids.includes(entry.profileId))};
}
