import {join,basename} from 'node:path';
import {mediaTargetDocument} from '../core/src/map-media-target.js';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {jsonStore,failure,identity} from '../official/store.mjs';
import {compileDoubaoContentRequest,doubaoAspectRatio,doubaoImageCount} from './doubao-content-request.mjs';
import {validateGenerationReferences} from '../official/generation-reference-contract.mjs';
import {createMediaRejectionLog} from '../official/media-rejection-log.mjs';
import {doubaoModel} from './doubao.mjs';
import {canRetryDoubaoPreparation,canReadDoubaoOriginalResult,canRecoverPreparedDoubaoResult} from './doubao-tasks.mjs';
import {queueAbandonRefusal,mediaNeedsAutomaticRelease,mediaRecallable} from '../ui/media-task-policy.js';
import {doubaoTaskAccountDetails} from './doubao-account-policy.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const date=()=>new Date().toISOString();
const matches=(r,f)=>Object.entries(f).every(([k,v])=>v===undefined||r[k]===v||k==='accountId'&&r.executionAccountId===v);
const exhausted=t=>t?.status==='quota_waiting'&&['DOUBAO_ALL_QUOTAS_EXHAUSTED','DOUBAO_NO_READY_ACCOUNT'].includes(t.code)&&t.remoteMayBeRunning===false&&!t.submittedAt;
export function createDoubaoMedia({service,models,doubao,requirePlugin,budget,automatic=true}){
 const db=jsonStore(join(service.dataRoot,'plugins','doubao-media.json'),{}),controllers=new Map(),applications=new Map(),advances=new Map(),checks=new Map(),recoveries=new Map(),confirmationInspections=new Set();let closed=false;
 const rejectionLog=createMediaRejectionLog(service,{fileName:'doubao-submit-rejections.json'});
 const pluginOf=b=>{const p=b.pluginId||'official.whiteboard-generation';if(!['official.whiteboard-generation','official.document-chat'].includes(p))throw failure('无效媒体来源');return p;};
 const patch=(id,data)=>db.update(s=>{Object.assign(s[id],data,{updatedAt:date()});return s;});
 const queueFields=r=>({notebookId:r.id,recallArchivedAt:r.recallArchivedAt,recallRequestedAt:r.recallRequestedAt,userAbandonedAt:r.userAbandonedAt,abandonPendingAt:r.abandonPendingAt,queueDismissedAt:r.queueDismissedAt,autoFailedAt:r.autoFailedAt,autoFailureReason:r.autoFailureReason});
 const owned=async id=>{const r=(await db.read())[identity(id)];if(!r)throw failure('此豆包媒体任务不属于当前软件','MEDIA_JOB_NOT_OWNED');return r;};
 // One projection for background persistence and immediate read-only snapshots.
 // Reading the queue must never wait for a download or operate a browser.
 const taskState=(r,task)=>{
  if(exhausted(task))return {status:'failed',failedAt:task.pausedAt||task.updatedAt||r.updatedAt||date(),error:task.message||'豆包可用账号额度已耗尽，本次生成已停止',code:task.code,message:task.message,pausedAt:null,queueBlocked:false,blockedByTaskId:'',retryPreparation:false,suspended:false,confirmation:null};
  const confirming=task.status==='confirmation_required'&&task.confirmationExecuting===true;
  const status=task.queueBlocked?'queued':confirming?'polling':{queued:'queued',preparing:'submitting',submit_intent:'submitting',waiting:'polling',blocked:'retry_required',quota_waiting:'retry_required',unknown_submission:'retry_required',confirmation_required:'retry_required',failed:'failed',stopped:'cancelled'}[task.status]||'polling';
  const pausedAt=status==='retry_required'?((r.status===status&&r.code===(task.code||'')&&r.blockedByTaskId===(task.blockedByTaskId||'')?r.pausedAt:'')||task.pausedAt||task.updatedAt||date()):null;
  return {status,pausedAt,confirmationWaiting:task.status==='confirmation_required'&&!confirming,updatedAt:task.updatedAt||r.updatedAt,queueBlocked:!!task.queueBlocked,blockedByTaskId:task.blockedByTaskId||'',retryPreparation:canRetryDoubaoPreparation(task),
   ...(status==='failed'?{failedAt:task.failedAt||task.updatedAt||date(),error:task.message||'豆包任务失败',code:task.code||''}:status==='retry_required'?{error:task.status==='confirmation_required'?'':task.message||'',code:task.code||''}:{error:'',code:''}),
   confirmation:task.status==='confirmation_required'&&!confirming&&task.confirmationDetails?{...task.confirmationDetails,id:task.confirmationId}:null,message:task.message||'账号排队中'};
 };
 const rawJob=(r,task)=>{
  if(task&&task.status!=='complete'&&!r.stoppedAt&&!r.appliedAt&&(!r.suspended||task.status==='failed'||exhausted(task))&&!hasResult(r))r={...r,...taskState(r,task),...(task.status==='failed'?{suspended:false}: {})};
  r={...r,...doubaoTaskAccountDetails(task||{...r,accountId:r.executionAccountId||r.accountId})};
  const accountError=text=>text&&!text.startsWith('账号「'+r.accountLabel+'」')?'账号「'+r.accountLabel+'」：'+text:text;
  if(r.error||r.autoFailureReason||r.applyError)r={...r,error:accountError(r.error),autoFailureReason:accountError(r.autoFailureReason),applyError:accountError(r.applyError)};
  return {imageCount:r.imageCount,resultNotice:r.resultNotice,accountId:task?.accountId||r.executionAccountId||r.accountId,generationState:task?.generationState||r.generationState,generationStartedAt:task?.generationStartedAt||r.generationStartedAt,accountName:r.accountName,accountRemark:r.accountRemark,accountLabel:r.accountLabel,remoteMayBeRunning:!!task?.remoteMayBeRunning,accountSlotReleasedAt:task?.accountSlotReleasedAt,id:r.jobId,submissionId:r.submissionId,status:r.autoFailedAt?'failed':r.stoppedAt?'cancelled':r.status,channel:r.channel,profileId:r.profileId,createdAt:r.createdAt,updatedAt:r.updatedAt,completedAt:r.completedAt,sourceCompletedAt:r.sourceCompletedAt,failedAt:r.failedAt||r.autoFailedAt,stoppedAt:r.stoppedAt,appliedAt:r.appliedAt,pausedAt:r.pausedAt,autoFailedAt:r.autoFailedAt,autoFailureReason:r.autoFailureReason,confirmationWaiting:r.confirmationWaiting,queueBlocked:!!r.queueBlocked,blockedByTaskId:r.blockedByTaskId||'',error:r.error||'',failureReason:r.autoFailureReason||(r.status==='failed'?r.error||r.message:''),providerErrorCode:r.code||task?.code||'',message:r.autoFailedAt?r.autoFailureReason+'；本次本地生成已结束并自动释放，原记录保留。':r.message||'',providerTaskId:r.taskId||'',confirmation:r.confirmation||null,runtimeNeedsAttention:!r.stoppedAt&&!r.appliedAt&&(!!r.suspended||r.status==='retry_required'),deliveryStage:r.deliveryStage||'',availableActions:{stop:!r.stoppedAt&&!r.appliedAt&&r.status!=='failed',confirmParameters:!r.stoppedAt&&!r.appliedAt&&r.status==='retry_required'&&!!r.confirmation,resumeOriginal:!r.stoppedAt&&!r.appliedAt&&r.status==='retry_required'&&!r.queueBlocked},target:{documentId:r.documentId,nodeId:r.nodeId,conversationId:r.conversationId},request:{prompt:r.displayPrompt,settings:{name:'豆包 · '+r.accountLabel,provider:'豆包网页账号',profileId:r.profileId,model:doubaoModel(r.channel)}},result:r.channel==='text'&&typeof r.text==='string'?{text:r.text}:r.attachments?{attachments:r.attachments}:undefined,cardApplyError:r.applyError,source:'doubao-browser',resultSuppressed:!!r.stoppedAt};
 };
 const job=(r,task)=>{const value=rawJob(r,task),ended=r.autoFailedAt||r.suspended||['failed','retry_required','complete'].includes(r.status)||task?.autoFailedAt||['failed','stopped'].includes(task?.status),canRecoverOriginal=!r.userStoppedAt&&!r.appliedAt&&!!ended&&!!(task&&canReadDoubaoOriginalResult(task)||task&&canRecoverPreparedDoubaoResult(task));return {...value,userStoppedAt:r.userStoppedAt,canRecoverOriginal,recoveryState:r.recoveryState,recoveryError:r.recoveryError,recalledAt:r.recalledAt,...(canRecoverOriginal&&r.autoFailedAt?{stoppedAt:'',userAbandonedAt:'',queueDismissedAt:'',resultSuppressed:false}: {})};};
 const hasResult=r=>r.attachments?.length>0||typeof r.text==='string'&&!!r.text.trim();
 const clearDeliveryError={error:'',code:'',applyError:'',failedAt:null,deliveryFailedAt:null,suspended:false,confirmation:null,retryPreparation:false,pausedAt:null,queueBlocked:false,blockedByTaskId:''};
 async function deliveryFailure(jobId,error){
  await db.update(s=>{const r=s[jobId];if(closed||!r||r.stoppedAt||r.appliedAt)return s;
   const saved=hasResult(r),message=error.message||'豆包结果回传失败';
   if(error.definitelyUnsubmitted&&!r.taskId&&!r.sourceCompletedAt&&!saved){Object.assign(r,{status:'failed',failedAt:date(),updatedAt:date(),error:'本次未发送：'+message,message:'本次未发送：'+message,code:error.code||'DOUBAO_PRE_SUBMIT_FAILED',suspended:true});return s;}
   Object.assign(r,{error:message,code:error.code||'DOUBAO_DELIVERY_FAILED',status:saved?'complete':'retry_required',pausedAt:r.pausedAt||date(),suspended:true,deliveryStage:saved?'writeback':r.sourceCompletedAt?'download':'observe',deliveryFailedAt:date(),updatedAt:date(),message:saved?'成品已保留，回写原卡片需要处理：'+message:message,...(saved?{applyError:message}:{})});return s;});
 }
 async function submit(body,verification=false){
  let creationStarted=false,selectedAccount;
  try{
  if(closed||body.signal?.aborted)throw failure('插件已停止');const pluginId=pluginOf(body);await requirePlugin(pluginId);await doubao.tasks.settleFailures?.();
  const channel=body.channel||body.kind;if(!['text','image','video'].includes(channel))throw failure('豆包网页内容仅支持文本、图片或视频');
  const settings=verification?{externalRef:{accountId:body.accountId},channel,model:doubaoModel(channel)}:await models.resolve(body.profileId,channel);
  const a=verification?await doubao.assertAccount(body.accountId):await doubao.assertBinding(settings,channel);
  selectedAccount=a;
  if(body.model&&body.model!==settings.model)throw failure('所选模型不属于此豆包网页能力');
  const imageCount=doubaoImageCount(body.imageCount);if(channel!=='image'&&imageCount!==1||Number(body.videoCount??1)!==1)throw failure('此豆包通道每次只提交一个生成请求，视频数量尚未开放');
  // Unsupported controls cannot silently become fabricated provider parameters.
  const durationSeconds=Number(body.durationSeconds||0);if(![0,15].includes(durationSeconds)||channel!=='video'&&durationSeconds)throw failure('豆包视频时长仅支持网页默认或 15 秒','DOUBAO_PARAMETER_UNVERIFIED');
  if(['resolution','quality','generationMode'].some(k=>body[k]&&body[k]!=='auto'))throw failure('此网页能力尚未核验这些参数，请在原账号窗口设置或使用网页默认值','DOUBAO_PARAMETER_UNVERIFIED');
  const aspectRatio=doubaoAspectRatio(channel,body.aspectRatio||'auto');
  const id=identity(body.id),documentId=identity(body.documentId),loaded=await service.load(id),doc=mediaTargetDocument(loaded.state,documentId);if(!doc)throw failure('原文档不存在');
  const node=doc.canvas?doc.canvas.nodes.find(n=>n.id===body.nodeId):null;if(doc.canvas&&!node)throw failure('请选择真实目标卡片');if(!doc.canvas&&pluginId!=='official.document-chat')throw failure('文档媒体必须由文档对话承载');
  if(channel==='text'&&(!node||pluginId!=='official.whiteboard-generation'))throw failure('网页文本内容任务必须由白板卡片承载');
  const references=body.references||[];if(!Array.isArray(references)||new Set(references).size!==references.length)throw failure('参考顺序无效');if(!doc.canvas&&references.length)throw failure('文档媒体请使用明确附件引用');
  validateGenerationReferences({settings,channel,referenceCount:references.length});
  const refNodes=references.map(ref=>{const n=doc.canvas.nodes.find(n=>n.id===ref);if(!n)throw failure('参考卡片已不存在');return n;}),contentReferences=[],attachments=[];
  for(const n of refNodes){if(n.file){attachments.push({notebookId:id,documentId,relativePath:n.file,name:n.name||basename(n.file)});contentReferences.push({...n,attachment:true});}else if(n.reference?.documentId){const source=(await service.load(n.reference.notebookId||id)).state.documents[n.reference.documentId];if(!source)throw failure('引用源已不存在');contentReferences.push({...n,text:source.markdown||''});}else contentReferences.push({...n,text:n.text||n.webSnapshot?.content||''});}
  for(const item of body.attachments||[]){attachments.push(item);contentReferences.push({attachment:true});}
  validateGenerationReferences({settings,channel,referenceCount:references.length+(body.attachments?.length||0),referenceMedia:attachments});
  const submissionId=identity(body.submissionId||body.requestId),jobId='doubao-media-'+hash(submissionId).slice(0,48),existing=(await db.read())[jobId];
  // New calls default to exactly one image; replaying an older submission
  // without a quantity must retain its original content and identity.
  const outputCount=channel==='image'&&(!existing||existing.imageCount!==undefined||body.imageCount!==undefined)?imageCount:undefined;
  const {prompt}=compileDoubaoContentRequest({channel,prompt:body.prompt,references:contentReferences,mentions:body.promptMentions,sequence:body.promptReferenceSequence,durationSeconds,aspectRatio,imageCount:outputCount}),files=await doubao.filesFor(attachments);
  const fingerprint=hash([id,documentId,node?.id,body.profileId||null,a.id,channel,prompt,files,pluginId,body.conversationId||null,body.aspectRatio||'']);
  if(existing){if(existing.fingerprint!==fingerprint&&!(settings.externalRef?.accountPool===true&&existing.profileId===body.profileId&&existing.id===id&&existing.documentId===documentId&&existing.nodeId===node?.id&&existing.channel===channel&&existing.prompt===prompt&&JSON.stringify(existing.files)===JSON.stringify(files)&&existing.pluginId===pluginId&&existing.conversationId===body.conversationId))throw failure('同一媒体编号不能改变原目标和配置','MEDIA_SUBMISSION_ID_CONFLICT');if(existing.stoppedAt)throw failure('原任务已停止，未重新提交');return {job:job(existing)};}
  body.signal?.throwIfAborted();await budget?.reserveMedia({...body,pluginId,channel,submissionId,fingerprint,imageCount});
  creationStarted=true;
  const record={jobId,submissionId,fingerprint,id,documentId,...(node?{nodeId:node.id,baseNode:structuredClone(node)}:{baseDocument:{markdown:doc.markdown,html:doc.html},anchorId:'anchor-'+hash(submissionId).slice(0,40),artifactId:'artifact-'+hash(submissionId).slice(0,40)}),accountId:a.id,...doubaoTaskAccountDetails({accountId:a.id},[a]),profileId:body.profileId,profileVersion:settings.updatedAt,pluginId,conversationId:body.conversationId,runnerProfileId:body.runnerProfileId,requestId:body.requestId,channel,prompt,displayPrompt:String(body.prompt||''),files,verification,durationSeconds,aspectRatio,allowAccountRotation:!verification,status:'queued',createdAt:date(),updatedAt:date()};
  if(outputCount!==undefined)Object.assign(record,{imageCount:outputCount});
  await db.update(s=>{body.signal?.throwIfAborted();if(!s[jobId])s[jobId]=record;else if(s[jobId].fingerprint!==fingerprint)throw failure('提交内容已冲突');return s;});
  if(body.signal?.aborted){await action('stop',{...body,jobId});body.signal.throwIfAborted();}
  void tick(jobId).catch(()=>{});return {job:job(await owned(jobId))};
  }catch(error){if(selectedAccount){const label=doubaoTaskAccountDetails({accountId:selectedAccount.id},[selectedAccount]).accountLabel;if(!error.message.startsWith('账号「'+label+'」'))error.message='账号「'+label+'」：'+error.message;}if(!creationStarted){error.submissionOutcomeKnown=false;try{const submissionId=body.submissionId||body.requestId,existing=submissionId&&(await db.read())['doubao-media-'+hash(submissionId).slice(0,48)];if(!existing){error.submissionOutcomeKnown=true;await rejectionLog.record({...body,submissionId,channel:body.channel||body.kind},error);}}catch{/* Unreadable journal is uncertain; do not release the submit guard. */}}throw error;}
 }
 function apply(jobId){
  if(applications.has(jobId))return applications.get(jobId);
  const work=applyOnce(jobId);applications.set(jobId,work);work.finally(()=>applications.delete(jobId)).catch(()=>{});return work;
 }
 async function applyOnce(jobId){
  const r=await owned(jobId);if(r.stoppedAt||r.userStoppedAt||closed||r.appliedAt||r.status!=='complete'||r.recallArchivedAt&&!r.recallRequestedAt)return null;
  const controller=new AbortController();controllers.set(jobId,controller);
  try{await requirePlugin(r.pluginId);
   controller.signal.throwIfAborted();const live=await owned(jobId);if(live.stoppedAt||live.userStoppedAt||closed||live.appliedAt)return null;
   if(r.recallArchivedAt){const result=await service.saveMediaRecall(r.id,{...r,result:job(r).result,recallState:'recalled',signal:controller.signal});await patch(jobId,{...clearDeliveryError,suspended:true,recallRequestedAt:'',recalledAt:date()});return result;}
   const result=await service[r.channel==='text'?'applyGeneratedTextResult':r.nodeId?'applyMediaResult':'applyDocumentMediaResult'](r.id,{...r,attachments:r.attachments,channel:r.channel,signal:controller.signal});controller.signal.throwIfAborted();const resultNotice=r.channel==='image'&&r.imageCount!==undefined&&r.attachments.length!==r.imageCount?'数量不符：请求 '+r.imageCount+' 张，豆包实际返回 '+r.attachments.length+' 张，已全部保留到历史版本；未自动补发任务。':'';await patch(jobId,{...clearDeliveryError,appliedAt:date(),deliveryStage:'applied',resultNotice,message:resultNotice||'生成内容持久化回读通过'});if(r.verification)await doubao.recordVerified(r.accountId,r.channel,r.taskId);return result;}
  catch(error){if(r.recallRequestedAt&&r.nodeId&&['MEDIA_CARD_CONFLICT','MEDIA_CARD_MISSING'].includes(error.code)){const result=await service.saveMediaRecall(r.id,{...r,result:job(r).result,recallState:'recalled',signal:controller.signal});await patch(jobId,{...clearDeliveryError,recallArchivedAt:r.recallArchivedAt||date(),recalledAt:date(),recallRequestedAt:'',suspended:true});return result;}await deliveryFailure(jobId,error);throw error;}finally{controllers.delete(jobId);}
 }
 async function advance(record){
  let r=await owned(record.jobId);if(r.stoppedAt||r.userStoppedAt||closed||r.appliedAt||r.suspended||r.status==='failed'||r.recallArchivedAt&&!r.recallRequestedAt)return;
  if(r.taskId&&(await doubao.tasks.find(r.taskId)).status==='stopped')return; // Reconcile below, outside this advance promise.
  await requirePlugin(r.pluginId);
  // Once a validated result is durable, delivery no longer needs the webpage
  // worker. Retrying a card conflict must never prepare/send the original job.
  if(r.status==='complete'&&hasResult(r)){await apply(r.jobId);return;}
  await doubao.assertAccount(r.accountId);if(!r.verification)await models.assertAvailable(r.profileId);
  if((await owned(r.jobId)).stoppedAt||closed)return;
  // A known all-account rejection ends this card attempt. Keep the original
  // quota notice/inputs for explicit user action, but never wake it in tick().
  if(r.taskId){const prior=await doubao.tasks.find(r.taskId);if(exhausted(prior)){await patch(r.jobId,taskState(r,prior));return;}}
  let task=r.recallRequestedAt?await doubao.tasks.find(r.taskId):await doubao.tasks.start({requestId:r.jobId,accountId:r.accountId,kind:r.channel,prompt:r.prompt,files:r.files,profileId:r.profileId,profileVersion:r.profileVersion,verification:r.verification,...(r.imageCount!==undefined?{imageCount:r.imageCount}:{}),...(r.aspectRatio&&r.aspectRatio!=='auto'?{aspectRatio:r.aspectRatio}:{}),...(r.allowAccountRotation?{allowAccountRotation:true}:{}),...(r.durationSeconds?{durationSeconds:r.durationSeconds}:{}),target:{id:r.id,documentId:r.documentId,nodeId:r.nodeId,jobId:r.jobId}});
  if(r.recallRequestedAt&&task.status!=='complete')throw failure('原任务没有可取回的成品，未重新生成','MEDIA_RESULT_NOT_READY');
  if(r.executionAccountId!==task.accountId)await patch(r.jobId,{executionAccountId:task.accountId});
  if(!r.taskId)await patch(r.jobId,{taskId:task.id});
  if((await owned(r.jobId)).stoppedAt){await doubao.tasks.stop(task.id);return;}
  // Older pending tasks did not persist the parameter summary. Inspect the
  // same message once without sending or confirming; explicit resume retries.
  if(task.status==='confirmation_required'&&!task.confirmationDetails&&!task.confirmationIntentAt&&!confirmationInspections.has(task.id)){
   confirmationInspections.add(task.id);try{task=await doubao.tasks.confirmation(task.id);}catch{/* Keep the original pending task and its account window. */}
  }
  if(task.status!=='confirmation_required')confirmationInspections.delete(task.id);
  if(task.status!=='complete'){await patch(r.jobId,taskState(r,task));return;}
  if(closed)return;
  if(!r.sourceCompletedAt)await patch(r.jobId,{sourceCompletedAt:task.completedAt||date()});
  if(r.channel==='text'){
   if(typeof task.result?.text!=='string'||!task.result.text.trim())throw failure('豆包原任务没有有效文本成品','TEXT_RESULT_EMPTY');
   await patch(r.jobId,{...clearDeliveryError,text:task.result.text,status:'complete',deliveryStage:'writeback',completedAt:r.completedAt||task.completedAt||date()});
   if(!(await owned(r.jobId)).stoppedAt&&!closed)await apply(r.jobId);return;
  }
  if(!r.attachments){
   const controller=new AbortController();controllers.set(r.jobId,controller);const signal=controller.signal;
   try{await patch(r.jobId,{status:'downloading',deliveryStage:'download',confirmation:null,message:'正在通过原账号会话下载并校验媒体'});const attachments=[];
    for(const [index,artifact] of (task.result.artifacts||[]).entries()){
     const key=hash([task.id,task.userId,artifact.messageId,artifact.kind,index]),checkpoint=(await owned(r.jobId)).downloadCheckpoints?.find(v=>v.key===key);if(checkpoint&&await validAttachment(r,checkpoint.attachment)){attachments.push(checkpoint.attachment);continue;}
     signal.throwIfAborted();const output=await doubao.driver.download(task,artifact,{signal});signal.throwIfAborted();
     const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'})[output.mimeType];if(!extension)throw failure('尚未核验的媒体格式，不会冒充成功');
     const attachment=await service.assetMediaStream(r.id,{stream:Readable.from(output.bytes),expectedBytes:output.bytes.length,mimeType:output.mimeType,name:'豆包-'+index+'.'+extension,stableName:true,mediaBatchId:r.jobId,whiteboardDocumentId:r.nodeId?r.documentId:'',whiteboardMediaKind:r.channel,signal});attachments.push(attachment);await db.update(s=>{const live=s[r.jobId];if(live.stoppedAt||closed)throw failure('任务已停止找回','MEDIA_RECALL_CANCELLED');live.downloadCheckpoints=[...(live.downloadCheckpoints||[]).filter(v=>v.key!==key),{key,attachment}];return s;});
    }
    if(!attachments.length)throw failure('没有有效媒体，不会回写');signal.throwIfAborted();await patch(r.jobId,{...clearDeliveryError,attachments,status:'complete',deliveryStage:'writeback',completedAt:date()});
   }finally{controllers.delete(r.jobId);await doubao.driver?.releaseTask?.(task);}
  }else await patch(r.jobId,{status:'complete',completedAt:r.completedAt||task.completedAt||date()});
  r=await owned(r.jobId);if(!r.stoppedAt&&!closed)await apply(r.jobId);
 }
 function runAdvance(r){
  if(closed)return Promise.resolve();
  if(advances.has(r.jobId))return advances.get(r.jobId);
  const work=Promise.resolve().then(()=>advance(r)).catch(async error=>{await deliveryFailure(r.jobId,error);throw error;}).finally(()=>{if(advances.get(r.jobId)===work)advances.delete(r.jobId);});
  advances.set(r.jobId,work);return work;
 }
 async function validAttachment(r,a){try{const info=await service.assetInfo(r.id,a.relativePath,r.documentId),bytes=await readFile(info.absolutePath);return bytes.length===a.size&&createHash('sha256').update(bytes).digest('hex')===a.sha256;}catch{return false;}}
 async function recoverResult(jobId){
  if(recoveries.has(jobId))return recoveries.get(jobId);
  const work=(async()=>{
   await Promise.allSettled([advances.get(jobId),applications.get(jobId)].filter(Boolean));let r=await owned(jobId);if(r.appliedAt)return {job:job(r),delivered:true};
   let original=r.taskId&&await doubao.tasks.find(r.taskId);if(r.userStoppedAt||r.stoppedAt&&(!r.autoFailedAt||!canReadDoubaoOriginalResult(original)&&!canRecoverPreparedDoubaoResult(original)))throw failure('此任务已明确停止或放弃，未恢复','MEDIA_RECALL_CANCELLED');
   await requirePlugin(r.pluginId);await patch(jobId,{recoveryState:'running',recoveryError:''});
   try{
    if(r.stoppedAt)await db.update(s=>{const live=s[jobId];if(live.userStoppedAt||closed)throw failure('此任务已明确停止找回','MEDIA_RECALL_CANCELLED');Object.assign(live,{stoppedAt:'',userAbandonedAt:'',queueDismissedAt:'',abandonPendingAt:'',autoFailedAt:'',autoFailureReason:''});return s;});
    if(r.attachments?.length&&!(await Promise.all(r.attachments.map(a=>validAttachment(r,a)))).every(Boolean))await patch(jobId,{attachments:null});
    r=await owned(jobId);await patch(jobId,{...clearDeliveryError,recallRequestedAt:date(),status:hasResult(r)?'complete':'downloading'});
    if(!hasResult(r)){
     // A failed download can hold expired URLs. Refresh the SAME owned reply,
     // never start/resume/confirm a generation or select another account.
     if(doubao.tasks.readOriginalResult&&canReadDoubaoOriginalResult(original))original=await doubao.tasks.readOriginalResult(r.taskId);
     else if(doubao.tasks.recoverPreparedResult&&canRecoverPreparedDoubaoResult(original))original=await doubao.tasks.recoverPreparedResult(r.taskId);
     if(original?.status!=='complete')throw failure('原会话没有可下载成品；未重新生成，请打开原网页核对','MEDIA_RESULT_NOT_READY');
     await runAdvance(await owned(jobId));
    }else await apply(jobId);
    r=await owned(jobId);if(!r.appliedAt&&!r.recalledAt)throw failure('成品尚未完成回写，请查看具体错误或打开原网页','MEDIA_RESULT_NOT_READY');
    await patch(jobId,{recoveryState:'complete',recoveryError:''});return {job:job(await owned(jobId)),delivered:true,destination:r.recalledAt?'history':'card'};
   }catch(error){await deliveryFailure(jobId,error);await patch(jobId,{recoveryState:'failed',recoveryError:error.message});throw error;}
   finally{await patch(jobId,{recallRequestedAt:''});}
  })();recoveries.set(jobId,work);try{return await work;}finally{recoveries.delete(jobId);}
 }
 function tickOne(jobId){
  if(closed)return Promise.resolve();
  if(checks.has(jobId))return checks.get(jobId);
  if(advances.has(jobId))return advances.get(jobId);
  // Only this task owns its progress. A slow download cannot hold another
  // account's dispatch; stopping still waits for this task's advance only.
  const check=Promise.resolve().then(async()=>{
   const original=await owned(jobId),task=original.taskId?await doubao.tasks.find(original.taskId).catch(()=>null):null;
   const r=await settleStopped(original,task);
   if(closed||r.stoppedAt||r.appliedAt||r.suspended)return;
   return runAdvance(r);
  }).finally(()=>{if(checks.get(jobId)===check)checks.delete(jobId);});
  checks.set(jobId,check);return check;
 }
 async function tick(jobId){if(closed)return;const ids=jobId?[jobId]:Object.values(await db.read()).filter(r=>!r.appliedAt&&!r.queueDismissedAt).map(r=>r.jobId);await Promise.allSettled(ids.map(tickOne));}
 async function settleStopped(r,task){
  if(task?.explicitStopAt&&!r.userStoppedAt&&!r.appliedAt&&!r.recalledAt){await patch(r.jobId,{userStoppedAt:task.explicitStopAt});r=await owned(r.jobId);}
  if(r.queueDismissedAt||r.appliedAt||r.recalledAt||task?.status==='complete')return r;
  if(recoveries.has(r.jobId)&&!task?.explicitStopAt&&!r.userStoppedAt)return r;
  const automatic=!!task?.autoFailedAt||!r.stoppedAt&&task?.status!=='stopped'&&mediaNeedsAutomaticRelease(job(r,task));
  if(!r.stoppedAt&&task?.status!=='stopped'&&!automatic)return r;
  // A stop from the account records must end its card delivery too. This is
  // outside advance(), which stop waits for, so it cannot wait on itself.
  if(automatic&&!r.autoFailedAt)await patch(r.jobId,{autoFailedAt:task?.autoFailedAt||date(),autoFailureReason:task?.autoFailureReason||r.error||task?.message||r.message||'未取得明确生成结果'});
  await action('stop',{id:r.id,documentId:r.documentId,pluginId:r.pluginId,jobId:r.jobId,automaticFailure:automatic}).catch(()=>{});
  return owned(r.jobId);
 }
 async function list(body={}){const pluginId=pluginOf(body);await requirePlugin(pluginId);
  const snapshot=await doubao.tasks.snapshot?.(),accounts=snapshot?.accounts||[];
  const records=Object.values(await db.read()).filter(r=>r.pluginId===pluginId&&matches(r,{id:body.id,documentId:body.documentId,conversationId:body.conversationId}));
  const jobs=await Promise.all(records.map(async r=>{const task=r.taskId?await doubao.tasks.find(r.taskId,snapshot).catch(error=>({status:'blocked',code:error.code||'DOUBAO_TASK_READ_FAILED',updatedAt:r.updatedAt,message:'原任务状态读取失败：'+error.message+'；等待已暂停，未重新发送。',remoteMayBeRunning:true})):null;r=await settleStopped(r,task);r={...r,...doubaoTaskAccountDetails({...r,accountId:task?.accountId||r.executionAccountId||r.accountId},accounts)};const value=job(r,task);
   if(!r.stoppedAt&&!r.appliedAt&&value.status==='failed'&&r.taskId){if(canRetryDoubaoPreparation(task))Object.assign(value.availableActions,{resumeOriginal:true,retryPreparation:true});}
   return {...value,...queueFields(r)};
  }));return {jobs:[...jobs,...await rejectionLog.list(body)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};}
 async function stopAll(profileIds,filter={}){
  let selected=[];await db.update(s=>{selected=Object.values(s).filter(r=>!r.appliedAt&&!r.queueDismissedAt&&(!profileIds||profileIds.includes(r.profileId)||profileIds.includes(r.runnerProfileId))&&matches(r,filter));for(const r of selected)r.stoppedAt||=date();return s;});
  for(const r of selected)controllers.get(r.jobId)?.abort();
  const jobIds=new Set(selected.map(r=>r.jobId)),taskIds=new Set(selected.map(r=>r.taskId).filter(Boolean));
  await doubao.tasks.stopAll(t=>taskIds.has(t.id)||jobIds.has(t.target?.jobId));
  const outcomes=[];for(const r of selected){await action('stop',{id:r.id,pluginId:r.pluginId,jobId:r.jobId});outcomes.push({jobId:r.jobId,status:'cancelled'});}return {outcomes,pending:false};
 }
 async function action(action,body={}){
  if(action==='submit')return submit(body);if(action==='list'){const result=await list(body);void tick().catch(()=>{});return result;}
  if(action==='abandon'&&body.jobId?.startsWith('validation-')){const result=await rejectionLog.dismiss(body);if(!result)throw failure('校验记录不存在','MEDIA_JOB_NOT_OWNED');return result;}
  const r=await owned(body.jobId);if(pluginOf(body)!==r.pluginId||!matches(r,{id:body.id,conversationId:body.conversationId}))throw failure('媒体任务与当前对话不匹配','MEDIA_JOB_NOT_OWNED');
  if(action==='open-original'){
   if(body.documentId!==r.documentId||body.nodeId&&body.nodeId!==r.nodeId)throw failure('任务目标不匹配','MEDIA_JOB_NOT_OWNED');
   if(!r.taskId)throw failure('原任务没有网页记录，请到供应商账号中手动检查','MEDIA_ORIGINAL_PAGE_MISSING');
   const original=await doubao.tasks.find(r.taskId);return doubao.handle('open',{taskId:original.id,accountId:original.accountId});
  }
  if(action==='recover'){
   if(body.documentId!==r.documentId||body.nodeId&&body.nodeId!==r.nodeId||r.recallArchivedAt)throw failure('原任务目标不匹配或已移入历史','MEDIA_RECALL_CANCELLED');
   return recoverResult(r.jobId);
  }
  if(action==='detach'||action==='recall'){
   if(body.documentId!==r.documentId||body.nodeId&&body.nodeId!==r.nodeId||!mediaRecallable(job(r)))throw failure('此任务已停止或不可召回','MEDIA_RECALL_CANCELLED');
   await patch(r.jobId,{recallArchivedAt:r.recallArchivedAt||date(),suspended:true});controllers.get(r.jobId)?.abort();
   await Promise.allSettled([advances.get(r.jobId),applications.get(r.jobId)].filter(Boolean));
   const live=await owned(r.jobId);if(live.stoppedAt)throw failure('此任务已停止召回','MEDIA_RECALL_CANCELLED');
   if(action==='recall')return recoverResult(r.jobId);
   return {job:{...job(live),...queueFields(live)}};
  }
  if(action==='abandon'||action==='stop'){
   if(r.queueDismissedAt){if(!body.automaticFailure){await patch(r.jobId,{userStoppedAt:date()});if(r.taskId)await doubao.tasks.abandon(r.taskId,{immediateRelease:true});}const live=await owned(r.jobId);return {job:{...job(live),...queueFields(live)},localStopped:true};}
   if(body.documentId&&body.documentId!==r.documentId)throw failure('任务目标不匹配','MEDIA_JOB_NOT_OWNED');
   const task=r.taskId?await doubao.tasks.find(r.taskId):null;
   await db.update(s=>{const current=s[r.jobId],reason=action==='stop'?'':queueAbandonRefusal({...job(current,task),...queueFields(current)},body);if(reason)throw failure(reason,'MEDIA_QUEUE_CHANGED');if(!current.queueDismissedAt)Object.assign(current,{...(!body.automaticFailure?{userStoppedAt:date()}:{}),abandonOriginal:current.abandonOriginal||{status:current.status,error:current.error,applyError:current.applyError,message:current.message},stoppedAt:current.stoppedAt||date(),userAbandonedAt:current.userAbandonedAt||date(),abandonPendingAt:date(),updatedAt:date()});});
   controllers.get(r.jobId)?.abort();
   let live=await owned(r.jobId);if(live.taskId)await doubao.tasks.abandon(live.taskId,{automaticFailure:!!live.autoFailedAt&&body.automaticFailure===true,immediateRelease:action==='stop'});
   if(action==='stop'){await patch(r.jobId,{abandonPendingAt:'',queueDismissedAt:date()});void Promise.allSettled([advances.get(r.jobId),applications.get(r.jobId)].filter(Boolean));live=await owned(r.jobId);return {job:{...job(live,task),...queueFields(live)},localStopped:true};}
   const pending=advances.get(r.jobId)||applications.get(r.jobId);if(pending){let timeout;try{await Promise.race([pending.catch(()=>{}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(failure('本地结果处理尚未停止，请稍后重试','STOP_PENDING')),5000);})]);}finally{clearTimeout(timeout);}}
   live=await owned(r.jobId);if(live.taskId)await doubao.tasks.abandon(live.taskId,{automaticFailure:!!live.autoFailedAt&&body.automaticFailure===true});
   await patch(r.jobId,{abandonPendingAt:'',queueDismissedAt:date()});live=await owned(r.jobId);
   return {job:{...job(live),...queueFields(live)},localStopped:true,warning:'已停止本地跟踪并解除本地账号占用；原网页任务可能仍在生成或扣费。'};
  }
  if(action==='apply')return {result:await apply(r.jobId)};
  if(action==='resume'){if(!r.taskId)throw failure('原任务尚未开始');await assertResumeAllowed(r.taskId);const t=await doubao.tasks.find(r.taskId);if(t.status!=='complete')await doubao.tasks.resume(r.taskId);await resumeDelivery(r.taskId);return {job:job(await owned(r.jobId))};}
  throw failure('豆包媒体不支持此操作');
 }
 const verify=async body=>{
  if(!['image','video'].includes(body.kind))throw failure('请选择图片或视频试用');
  const loaded=await service.load(body.id),doc=loaded.state.documents[body.documentId];if(!doc)throw failure('请先打开承载试用结果的文档或白板');
  let nodeId=body.nodeId;
  if(doc.canvas&&!nodeId)throw failure('请先选择承载试用的普通卡片');
  return submit({...body,nodeId,channel:body.kind,pluginId:doc.canvas?'official.whiteboard-generation':'official.document-chat',submissionId:body.requestId},true);
 };
 const timer=automatic?setInterval(()=>void tick().catch(()=>{}),1000):null;timer?.unref();
 async function delivery(){return Object.values(await db.read()).filter(r=>r.taskId).map(r=>({taskId:r.taskId,status:r.status,appliedAt:r.appliedAt,error:r.error||r.applyError||'',message:r.message,suspended:r.suspended,stopped:!!r.stoppedAt}));}
 async function recoverOriginalTask(taskId){const r=Object.values(await db.read()).find(r=>r.taskId===taskId);if(!r)throw failure('原媒体任务不存在','MEDIA_JOB_NOT_OWNED');return recoverResult(r.jobId);}
 async function assertResumeAllowed(taskId){const r=Object.values(await db.read()).find(r=>r.taskId===taskId);if(!r||r.stoppedAt)throw failure('原媒体任务不存在或已停止');await requirePlugin(r.pluginId);if(!r.verification)await models.assertAvailable(r.profileId);}
 async function resumeDelivery(taskId){const r=Object.values(await db.read()).find(r=>r.taskId===taskId);if(!r||r.stoppedAt||closed)throw failure('原媒体任务不存在或已停止');if(r.appliedAt)return;await requirePlugin(r.pluginId);const t=await doubao.tasks.find(taskId);if(t.status==='failed'||t.status==='stopped')throw failure('原任务仍未恢复，未重新提交');await patch(r.jobId,{...clearDeliveryError,...(t.status==='complete'?{status:hasResult(r)?'complete':'downloading',deliveryStage:hasResult(r)?'writeback':'download',message:hasResult(r)?'正在重试回写已保存成品，不重新生成':'正在继续取回原成品，不重新生成'}:r.status==='failed'?{status:'queued',message:'已恢复原任务，正在等待原结果'}:{})});void tick(r.jobId);}
 return {action,list,tick,verify,delivery,recoverOriginalTask,resumeDelivery,assertResumeAllowed,stopAll,stopScope:filter=>stopAll(null,filter),stopProfiles:ids=>stopAll(ids),close:async()=>{closed=true;clearInterval(timer);for(const controller of controllers.values())controller.abort();await Promise.allSettled([...checks.values(),...advances.values(),...applications.values(),...recoveries.values()]);}};
}
