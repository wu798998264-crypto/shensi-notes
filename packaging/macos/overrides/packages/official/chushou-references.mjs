import {referenceAliases,readPromptMentions} from '../ui/generation-references.js';
import {failure} from './store.mjs';

// Read shot headings only. Source timecodes embedded in the action or dialogue
// do not describe the length of this card.
function shotTimelineDuration(prompt){
 const body=prompt.split(/[\[【]画面内容[\]】]\s*[:：]?/).at(-1);
 const ranges=/(\d{1,3}(?:[:：]\d{2})?(?:\.\d{1,3})?)(?:[ \t]*(?:秒|s))?[ \t]*[-–—~～至][ \t]*(\d{1,3}(?:[:：]\d{2})?(?:\.\d{1,3})?)[ \t]*(?:秒|s|(?=[）)]))/gi;
 const seconds=value=>value.split(/[:：]/).reduce((total,part)=>total*60+Number(part),0);
 let end=0;
 for(const line of body.split(/\r?\n/)){
  for(const m of line.matchAll(ranges)){
   if(!/^\s*(?:镜头\s*\d+[ \t:：、.]*)?[（(]?\s*$/.test(line.slice(0,m.index)))return;
   const start=seconds(m[1]),next=seconds(m[2]);
   if(start!==end||next<=start)return;
   end=next;
  }
 }
 if(end>=0.5)return Math.round(end);
}

// Compile the skill's neutral asset markers through the same alias contract as
// the native editor. No provider request or reference auto-discovery occurs here.
export async function compileChushouDrafts(service,{id,documentId},patch,{validateReferences=false}={}){
 const live=await service.load(id),canvas=live.state.documents[documentId]?.canvas;
 if(!canvas)throw failure('目标不是白板');
 const drafts=structuredClone(patch.drafts||{}),nodes=[...new Map([...canvas.nodes,...(patch.nodes||[])].map(n=>[n.id,n])).values()],edges=[...new Map([...canvas.edges,...(patch.edges||[])].map(e=>[e.id,e])).values()];
 for(const [nodeId,draft] of Object.entries(drafts)){
  if(typeof draft.prompt!=='string'||!Array.isArray(draft.references))throw failure('草稿需要提示词和明确参考列表');
  if(draft.channel==='video'&&draft.durationSeconds==null&&patch.nodes?.some(n=>n.id===nodeId&&n.type==='text')&&!canvas.nodes.some(n=>n.id===nodeId)&&!['smart_multiframe','smart_edit','smart_extend'].includes(draft.generationMode)){
   const duration=draft.channels?.video?.durationSeconds??shotTimelineDuration(draft.prompt);
   if(duration!=null)draft.durationSeconds=duration;
  }
  if(!draft.prompt.includes('{{asset:')&&!validateReferences)continue; // Keep existing callers unchanged.
  if(new Set(draft.references).size!==draft.references.length)throw failure('参考列表不能重复；文内可以多次引用同一素材');
  const selected=draft.references.map(ref=>nodes.find(n=>n.id===ref));
  if(selected.some(n=>!n||n.id===nodeId))throw failure('参考卡片不存在或引用了自身');
  for(const n of selected){
   if(['image','video','audio'].includes(n.kind)){
    if(!n.file)throw failure('参考媒体尚未就绪：'+n.id);
    const info=await service.assetInfo(id,n.file,documentId);
    if(!String(info.mimeType).startsWith(n.kind+'/'))throw failure('参考媒体类型不匹配：'+n.id);
   }
  }
  const aliases=referenceAliases(selected),mentions=[];
  const prompt=draft.prompt.replace(/\{\{asset:([^{}]+)\}\}/g,(token,ref,offset)=>{
   if(!aliases.has(ref))throw failure('提示词引用不在真实参考列表中：'+ref);
   const native='@「'+aliases.get(ref)+'」';mentions.push({originalStart:offset,originalLength:token.length,token:native,nodeId:ref});return native;
  });
  if(prompt.includes('{{asset:'))throw failure('参考标记不完整');
  const retained=(draft.promptMentions||[]).filter(m=>draft.prompt.slice(m.start,m.end)===m.token&&!mentions.some(r=>r.originalStart<m.end&&r.originalStart+r.originalLength>m.start)).map(m=>{
   const delta=mentions.filter(r=>r.originalStart+r.originalLength<=m.start).reduce((sum,r)=>sum+r.token.length-r.originalLength,0);
   return {...m,start:m.start+delta,end:m.end+delta};
  });
  let delta=0;for(const m of mentions){m.start=m.originalStart+delta;m.end=m.start+m.token.length;delta+=m.token.length-m.originalLength;delete m.originalStart;delete m.originalLength;}
  // Existing native tokens may coexist with newly compiled markers.
  const all=readPromptMentions(prompt,selected,{mentions:[...retained,...mentions]});
  if(all.some(m=>!aliases.has(m.nodeId)))throw failure('提示词包含无法定位的原生引用，请重新读取参考');
  const incoming=edges.filter(e=>e.toNode===nodeId);
  Object.assign(draft,{prompt,promptMentions:all,promptReferenceSequence:all.map(m=>m.nodeId),referenceEdgeIds:incoming.map(e=>e.id),referenceExcludedIds:[...new Set(incoming.map(e=>e.fromNode).filter(ref=>!draft.references.includes(ref)))]});
  if(draft.channel){draft.channels??={};draft.channels[draft.channel]={...draft.channels[draft.channel],...(draft.channel==='video'&&draft.durationSeconds!=null?{durationSeconds:draft.durationSeconds}:{}),prompt,references:[...draft.references],promptMentions:all,promptReferenceSequence:[...draft.promptReferenceSequence],referenceEdgeIds:[...draft.referenceEdgeIds],referenceExcludedIds:[...draft.referenceExcludedIds]};}
 }
 return {...patch,drafts};
}
