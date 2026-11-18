import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {failure,identity} from '../official/store.mjs';
import {doubaoQuotaDay,doubaoQuotaResetAt,doubaoExhaustionRecord,doubaoWaitingState,doubaoQuotaNotices,selectDoubaoAccount,canTransferDoubaoQuota,matchesDoubaoDuration,doubaoTaskAccountDetails} from './doubao-account-policy.mjs';
import {confirmationKey,confirmationRounds,unresolvedConfirmation,handledConfirmation,confirmationReply,acknowledgeConfirmations,safeAutomaticConfirmation,canRequestStatusInquiry,matchesDoubaoImageCount} from './doubao-confirmations.mjs';
const terminal=new Set(['complete','failed','stopped']);
const blocked=new Set(['submit_intent','unknown_submission','blocked','confirmation_required']);
const holdsAccount=t=>blocked.has(t.status)||t.status==='stopped'&&(t.remoteMayBeRunning||t.abandonPendingAt)&&!t.accountSlotReleasedAt;
// Read-only queue dependency: do not mark the unsent task "blocked" (which
// would itself hold the account), release an unknown send, or resubmit it.
function queueState(t,tasks){
 if(t.isolatedPage)return t;
 if(!['queued','preparing'].includes(t.status)||t.submittedAt||t.remoteMayBeRunning)return t;
 const blocker=tasks.find(v=>v.id!==t.id&&v.accountId===t.accountId&&holdsAccount(v));
 if(!blocker)return t;
 const reason=blocker.status==='confirmation_required'?'有旧任务待确认生成参数':blocker.status==='stopped'?'有已停止跟踪、但远端状态未确认的旧任务':blocker.status==='submit_intent'?'正在核对旧任务是否已发送':'有旧任务需要核对';
 return {...t,queueBlocked:true,blockedByTaskId:blocker.id,blockedByStatus:blocker.status,pausedAt:[t.createdAt,blocker.pausedAt||blocker.updatedAt||blocker.createdAt].filter(Boolean).sort().at(-1),code:'DOUBAO_ACCOUNT_QUEUE_BLOCKED',message:'本次请求尚未发送：同账号'+reason+'，排队已暂停。请在任务队列处理原任务；不会重发旧任务。'};
}
const now=()=>new Date().toISOString();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// A persisted send intent is enough to forbid a preparation retry, even if
// the page never acknowledged it. Historical account attempts also forbid it.
export const canRetryDoubaoPreparation=t=>!!t&&t.status==='failed'&&!t.submittedAt&&!t.userId&&!t.remoteMayBeRunning&&!t.completedAt&&!t.result&&!t.confirmationIntentAt&&!t.confirmationSentAt&&!t.confirmationDetails&&!t.confirmationId&&!t.confirmationRounds?.length&&!t.attempts?.length;
export const canRecoverPreparedDoubaoResult=t=>canRetryDoubaoPreparation(t?.autoFailedAt&&!t.explicitStopAt&&t.abandonOriginal?.status==='failed'?{...t,status:'failed'}:t)&&['image','video'].includes(t.kind)&&!t.files?.length;
const originalResultUrl=t=>/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(t.url||'')?t.url:t.observedPageUrl;
export const canReadDoubaoOriginalResult=t=>!!t&&['image','video'].includes(t.kind)&&!!t.submittedAt&&!!t.userId&&/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(originalResultUrl(t)||'')&&!t.explicitStopAt&&(!t.userAbandonedAt&&!t.accountSlotReleasedAt||!!t.autoFailedAt);
export function publicDoubaoTask(t,tasks){if(!t)return t;if(tasks)t=queueState(t,tasks);return {...Object.fromEntries(['id','accountId','accountName','accountRemark','accountLabel','generationState','generationStartedAt','kind','status','phase','message','code','url','observedPageUrl','createdAt','updatedAt','submittedAt','completedAt','failedAt','pausedAt','queueBlocked','blockedByTaskId','blockedByStatus','profileId','verification','target','remoteMayBeRunning','accountSlotReleasedAt','userAbandonedAt','explicitStopAt','abandonPendingAt','autoFailedAt','autoFailureReason','confirmationDetails','confirmationId','confirmationIntentAt','confirmationSentAt','confirmationFailureCode','durationSeconds','attempts','confirmationRounds'].filter(k=>t[k]!==undefined).map(k=>[k,t[k]])),...(t.autoFailedAt?{status:'failed',message:t.autoFailureReason+'；本次本地生成已结束并自动释放，原记录保留。'}:{}),confirmationPending:unresolvedConfirmation(t),canRetryPreparation:!t.autoFailedAt&&canRetryDoubaoPreparation(t),canRecoverPageResult:canRecoverPreparedDoubaoResult(t)};}
export function createDoubaoTasks({db,failureStore,driver,assertAccount,pollMs=1000,stableMs=2500,timeoutMs=1800000,textAcknowledgementMs=60000,mediaAcknowledgementMs=60000,mediaTransportAcknowledgementMs=180000,statusInquiryAfterMs=300000,isAutoConfirm=async()=>false}){
 // If the account journal is locked, persist the terminal/uncertain state in
 // a separate journal. Read and recovery use it too, never rerun a stuck task.
 const originalDb=db,failures=new Map();let hydrated;
 const hydrate=()=>hydrated??=(async()=>{for(const [id,value] of Object.entries(await failureStore?.read()||{}))failures.set(id,value);})();
 const overlay=s=>{for(const t of s.tasks){const f=failures.get(t.id);if(f&&t.failureReceipt!==f.failureReceipt)Object.assign(t,f);}return s;};
 db={read:async()=>{await hydrate();return overlay(await originalDb.read());},update:async fn=>{await hydrate();return originalDb.update(s=>fn(overlay(s)));}};
 async function recordFailure(id,fields){try{await patch(id,fields);}catch(error){const value={...fields,updatedAt:now(),pausedAt:now(),failureReceipt:digest([id,now(),Math.random()]),persistenceErrorCode:error.code||'DOUBAO_JOURNAL_WRITE_FAILED'};failures.set(id,value);try{await failureStore?.update(s=>({...s,[id]:value}));}catch{/* Still expose the error in this process; never continue submission. */}}}
 const running=new Map(),executions=new Map(),controllers=new Map(),recoveries=new Map(),confirmations=new Map(),abandonments=new Map();let closed=false;
 const parallel=driver?.taskScoped===true?Math.min(2,Math.max(1,Number(driver.parallelPerAccount)||1)):1;
 const find=async(id,snapshot)=>{const {tasks,accounts}=snapshot||await db.read(),t=tasks.find(t=>t.id===identity(id));if(!t)throw failure('豆包原任务不存在');return queueState({...t,...doubaoTaskAccountDetails(t,accounts),...(t.recoveredResult&&!t.explicitStopAt?{status:'complete',result:t.recoveredResult,completedAt:t.resultRecoveredAt}: {})},tasks);};
 const patch=async(id,fields)=>{await db.update(s=>{const t=s.tasks.find(t=>t.id===id);if(t.status==='stopped'&&fields.status&&fields.status!=='stopped')return s;const at=now(),priorPause=t.pausedAt;if(fields.status){if(blocked.has(fields.status)||fields.status==='quota_waiting')t.pausedAt||=at;else delete t.pausedAt;}const next={...fields,...doubaoTaskAccountDetails({...t,...fields},s.accounts)};if(priorPause===t.pausedAt&&Object.entries(next).every(([key,value])=>JSON.stringify(t[key])===JSON.stringify(value)))return s;Object.assign(t,next,{updatedAt:at});return s;});return find(id);};
 async function receiptDiagnostics(t){
  if(!driver?.diagnostics||closed||(await find(t.id)).status==='stopped')return {};
  try{const d=await driver.diagnostics(t);return {submissionDiagnostics:{capturedAt:now(),url:d.url||'',gate:d.gate||'',composer:!!d.composer,mode:{ready:!!d.mode?.ready,kind:d.mode?.kind||'',chip:!!d.mode?.chip},messageCount:Number(d.messageCount)||0,messageSignals:(d.messageSignals||[]).slice(-20).map(m=>({assistant:m.assistant===true,characters:Number(m.characters)||0,exact:!!m.exact,contains:!!m.contains,prefix:!!m.prefix})),exactPromptNodes:d.promptMatches?.length||0,newConversationReady:!!d.newConversation?.ready}};}
  catch{return {submissionDiagnostics:{capturedAt:now(),captureFailed:true}};}
 }
 async function reconcile(t,seen){if(seen.ack&&seen.userId===t.userId&&seen.confirmationAcknowledgements?.length){await db.update(s=>{const live=s.tasks.find(v=>v.id===t.id);if(live)acknowledgeConfirmations(live,seen,now());return s;});return find(t.id);}return t;}
 async function confirmation(id){
  let t=await find(id);await assertAccount(t.accountId);if(!t.submittedAt||terminal.has(t.status))throw failure('此任务没有待回复的追问或参数');
  const seen=await driver.observe(t);t=await reconcile(t,seen);if(unresolvedConfirmation(t))throw failure('参数确认结果待核对，请继续观察原任务');
  const restorable=t.status==='confirmation_required'&&t.confirmationDetails?.kind==='reference_authorization'&&!t.referenceAuthorizationAcceptedAt&&!t.confirmationSentAt&&!t.observedPageUrl&&seen.referenceAuthorizationDraftReady===true;
  const authorization=t.confirmationDetails?.kind==='reference_authorization'&&(seen.gate==='reference_authorization_required'&&seen.referenceAuthorization?.kind==='reference_authorization'||restorable)&&!seen.ack&&!t.userId&&seen.url===t.url;
  if(t.status==='confirmation_required'&&t.confirmationDetails?.kind==='reference_authorization'&&!authorization&&!seen.gate&&!seen.ack&&!t.userId&&!t.observedPageUrl&&!t.referenceAuthorizationAcceptedAt&&!t.confirmationSentAt&&seen.url===t.url){
   const message='原参考草稿已变化或在网页关闭、重开后失效，本次未继续生成；请使用卡片重试，重新载入当前提示词和参考素材';
   await patch(id,{status:'failed',code:'DOUBAO_REFERENCE_AUTHORIZATION_EXPIRED',failedAt:now(),remoteMayBeRunning:false,message});await settleFailure(id);
   throw failure(message,'DOUBAO_REFERENCE_AUTHORIZATION_EXPIRED');
  }
  if(!authorization&&(seen.gate||!seen.ack||seen.userId!==t.userId||typeof seen.confirmation!=='object'||!seen.confirmation))throw failure('原任务没有可透传的生成参数，请打开账号后台核对');
  const details=authorization?seen.referenceAuthorization||t.confirmationDetails:seen.confirmation,confirmationId=confirmationKey(t,details);if(handledConfirmation(t,details))throw failure('本轮参数确认已发送，请继续观察原任务');
  await db.update(s=>{const live=s.tasks.find(v=>v.id===id);if(!live||terminal.has(live.status)||unresolvedConfirmation(live)||handledConfirmation(live,details))throw failure('任务已停止或参数确认已处理，请刷新原任务');Object.assign(live,{confirmationRounds:confirmationRounds(live),status:'confirmation_required',confirmationDetails:details,confirmationId,message:authorization?'参考素材尚待用户确认授权声明，未开始生成':'请在画布核对原任务追问并回复',updatedAt:now()});return s;});return find(id);
 }
 async function confirmOriginal(t,{confirmationId,confirmed,automatic=false,reply}={}){
  if(!automatic&&confirmed!==true)throw failure('请先确认本次生成参数');
  if(reply!==undefined&&(automatic||typeof reply!=='string'||!reply.trim()||reply.length>6000||/data:[^\s,;]+;base64,/i.test(reply)))throw failure('回复须为1至6000字的文字，不能包含内嵌文件','DOUBAO_INVALID_REPLY');
  if(unresolvedConfirmation(t))throw failure('本次参数确认结果待核对，只能继续观察，不重复确认');
  if(t.confirmationDetails&&handledConfirmation(t,t.confirmationDetails))throw failure('本轮参数确认已发送，请继续观察原任务');
  if(t.status!=='confirmation_required'||!driver.confirm)throw failure('当前任务没有可确认的参数');
  // Reference consent is validated against the exact owned draft by confirm().
  // A dismissed pre-submit declaration may be restored there, only after this
  // explicit consent intent is durable. Read-only confirmation never resends.
  const checked=t.confirmationDetails?.kind==='reference_authorization'?await find(t.id):await confirmation(t.id);if(confirmationId!==checked.confirmationId)throw failure('生成参数已变化，请重新查看后确认');
  const authorization=checked.confirmationDetails?.kind==='reference_authorization';
  if(authorization&&(automatic||reply!==undefined))throw failure('素材声明须由用户明确同意，不能以自动确认或文字回复代替','DOUBAO_MANUAL_CONFIRMATION_REQUIRED');
  if(checked.kind==='text'&&reply===undefined)throw failure('请填写对原任务追问的回复','DOUBAO_REPLY_REQUIRED');
  if(!authorization&&!checked.confirmationDetails?.statusOnly&&!matchesDoubaoImageCount(checked,checked.confirmationDetails))throw failure('网页确认的图片数量与所选 '+checked.imageCount+' 张不符；未确认生成，请调整原任务参数后重新查看','DOUBAO_IMAGE_COUNT_MISMATCH');
  if(automatic&&!safeAutomaticConfirmation(checked,checked.confirmationDetails))throw failure('该请求不属于可自动确认的生成参数，请手动核对','DOUBAO_MANUAL_CONFIRMATION_REQUIRED');
  if(!authorization&&!checked.confirmationDetails?.statusOnly&&!matchesDoubaoDuration(checked,checked.confirmationDetails)&&!(automatic&&checked.kind==='video'))throw failure('网页生成参数未明确匹配所选 15 秒，请在原账号调整后重新查看；未确认生成','DOUBAO_DURATION_MISMATCH');
  const replyText=reply===undefined?confirmationReply(checked,checked.confirmationDetails):reply.trim();
  await assertAccount(t.accountId);await db.update(s=>{const live=s.tasks.find(v=>v.id===t.id);if(!live||live.status!=='confirmation_required'||unresolvedConfirmation(live)||handledConfirmation(live,checked.confirmationDetails)||live.confirmationId!==confirmationId)throw failure('参数确认已处理、任务已停止或参数已变化');const at=now();live.confirmationRounds=[...confirmationRounds(live),{id:confirmationId,details:checked.confirmationDetails,reply:replyText,intentAt:at}];if(!automatic&&['image','video'].includes(live.kind))live.manualGenerationConfirmedAt||=at;Object.assign(live,{confirmationIntentAt:live.confirmationIntentAt||at,confirmation:replyText,confirmationReplyOnly:reply!==undefined||replyText!=='确认生成',message:'正在处理原任务生成追问；同一轮中断后不自动重发',updatedAt:at});return s;});
  // Preserve the scheduler's confirmation lock until this ONE operation ends.
  // The media projection keeps its running UI instead of asking the user again.
  const intent=await patch(t.id,{confirmationExecuting:true,...(authorization?{referenceAuthorizationIntentAt:now()}: {})});if(intent.status==='stopped')throw failure('任务已停止，未确认参数');
  try{
   const result=await driver.confirm(intent,{assertActive:async()=>{const live=await find(t.id);if(closed||live.status==='stopped')throw failure('任务已停止，未确认参数');await assertAccount(live.accountId);}});
   if(result?.confirmed!==true)throw failure('网页未确认参数操作，请打开原任务检查');
   const at=now();await db.update(s=>{const live=s.tasks.find(v=>v.id===t.id),round=live.confirmationRounds.find(r=>r.id===confirmationId);delete live.confirmationExecuting;round.sentAt=at;live.confirmationSentAt||=at;if(!automatic&&['image','video'].includes(live.kind))live.manualGenerationConfirmedAt||=at;if(live.status!=='stopped')Object.assign(live,authorization?{status:'waiting',referenceAuthorizationAcceptedAt:at,remoteMayBeRunning:true,message:'已确认本次素材声明，等待网页受理原请求',updatedAt:at}:{status:'waiting',message:'已处理本轮生成追问，等待原任务成品',updatedAt:at});return s;});return find(t.id);
  }catch(e){const expired=authorization&&['DOUBAO_REFERENCE_AUTHORIZATION_EXPIRED','DOUBAO_REFERENCE_AUTHORIZATION_CHANGED'].includes(e.code);await patch(t.id,{confirmationExecuting:false,status:expired?'failed':'blocked',message:expired?e.message:'参数确认结果待核对，请打开原任务；不会重复确认',...(expired?{code:e.code,remoteMayBeRunning:false}:{}),confirmationFailureCode:/^[A-Za-z0-9_]+$/.test(e.code||'')?e.code:'DOUBAO_CONFIRMATION_NOT_ACKNOWLEDGED'});throw e;}
 }
 async function confirm(id,body){if(confirmations.has(id))throw failure('本次参数确认正在处理，请勿重复发送','DOUBAO_CONFIRMATION_PENDING');const work=(async()=>{await controllers.get(id)?.done;const t=await find(id);const result=await confirmOriginal(t,body);void drain(t.accountId).catch(()=>{});return result;})();confirmations.set(id,work);try{return await work;}finally{confirmations.delete(id);await settleFailure(id);}}
 async function execute(id){
  let task=await find(id);const controller=new AbortController();let settled;controller.done=new Promise(r=>settled=r);controllers.set(id,controller);const signal=controller.signal;
  try{
   task=await find(id);if(terminal.has(task.status)||task.abandonPendingAt)return;
   await assertAccount(task.accountId);if(!driver)throw failure('需要桌面版网页执行器','DESKTOP_REQUIRED');
   if(task.recoverOriginal){if(!task.url||!/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(task.url))throw failure('重开后缺少可确认的原任务地址，未重新投单');await driver.open({accountId:task.accountId,taskId:task.id,url:task.url,visible:false});task=await patch(id,{recoverOriginal:false});}
   if(['queued','preparing'].includes(task.status)){
    const assigned=task.accountId;await db.update(s=>{const live=s.tasks.find(v=>v.id===id);if(live.status==='stopped')return s;const day=doubaoQuotaDay(),next=selectDoubaoAccount(s,live.retryPreparation?{...live,allowAccountRotation:false}:live,day);Object.assign(live,next?{accountId:next,usageDay:day,reservedAt:now(),code:''}:doubaoWaitingState(s,live));return s;});task=await find(id);
    if(task.status==='stopped'||task.status==='quota_waiting')return;
    if(task.accountId!==assigned){queueMicrotask(()=>void drain(task.accountId).catch(()=>{}));return;}
    task=await patch(id,{status:'preparing',message:'正在准备独立新对话'});signal.throwIfAborted();if(task.status==='stopped')return;
    // A creation page may have no New button after its first result. Supply
    // only the most recent durably completed receipt, not another live task.
    const previousCompleted=(await db.read()).tasks.filter(t=>t.id!==task.id&&t.accountId===task.accountId&&t.status==='complete'&&t.completedAt&&!t.remoteMayBeRunning).sort((a,b)=>Date.parse(b.completedAt)-Date.parse(a.completedAt))[0];
    const prepared=await driver.prepare(task,{signal,files:task.files||[],previousCompleted});signal.throwIfAborted();await assertAccount(task.accountId);
    // Fsync journal BEFORE the only send. An interrupted send is never retried.
    task=await patch(id,{...prepared,retryPreparation:false,status:'submit_intent',message:'已记录发送意图，正在等待网页确认',submittedAt:now(),remoteMayBeRunning:true});
    signal.throwIfAborted();await driver.send(task,{signal});signal.throwIfAborted();
   }
   let previous='',stableSince=Date.now(),ack=false,attentionGate='',missingSince=0,statusSignature='',statusSince=0,confirmationSignature='',confirmationSince=0,noticeSignature='',noticeSince=0,lastObservation;const observationStarted=Date.now(),end=observationStarted+timeoutMs;
   while(Date.now()<end){
    signal.throwIfAborted();await assertAccount(task.accountId);
    let seen=await driver.observe(task);signal.throwIfAborted();task=await reconcile(task,seen);
    if(seen.gate==='reference_authorization_required'&&!seen.ack&&!task.userId&&!task.observedPageUrl&&seen.url===task.url&&seen.referenceAuthorization?.kind==='reference_authorization'&&task.files?.length){
     const details=seen.referenceAuthorization;if(handledConfirmation(task,details))throw failure('素材声明已处理但网页未继续，未重复确认','DOUBAO_REFERENCE_AUTHORIZATION_NOT_ACKNOWLEDGED');
     await patch(id,{status:'confirmation_required',generationState:'waiting_parameters',remoteMayBeRunning:false,confirmationDetails:details,confirmationId:confirmationKey(task,details),message:'豆包要求确认参考素材已获授权；尚未开始生成，请查看素材声明后选择是否继续。'});return;
    }
    // Some creation replies mount the footer before their streamed text is
    // finished. A generic prose notice is not a definitive supplier rejection.
    // Require the same owned, idle reply to settle, just as for confirmations.
    // A finished prose bubble can precede the asynchronous image tool. Only an
    // explicit service refusal may end observation early; other prose retains
    // the original deadline and must never trigger a second send.
    const explicitNotice=/^(?:抱歉[，,。\s]*)?(?:(?:服务|系统|功能)(?:暂时|暂)?(?:不可用|无法使用)|(?:暂时|当前)(?:无法|不能)(?:生成|制作)|请稍后(?:再试|重试))/.test(String(seen.notice||'').trim());
    const noticeEligible=explicitNotice&&task.kind!=='text'&&seen.ack&&seen.notice&&seen.completed&&!seen.waiting&&!seen.stopping&&!seen.pendingMedia&&!seen.confirmation&&!seen.gate&&!seen.artifacts?.length;
    if(!noticeEligible){noticeSignature='';noticeSince=0;}
    if(canTransferDoubaoQuota(task,seen)){
     const rejected={...task,url:seen.url||task.url,userId:seen.userId},day=doubaoQuotaDay();await db.update(s=>{const live=s.tasks.find(v=>v.id===id);if(live.status==='stopped')return s;
      const a=s.accounts?.find(v=>v.id===live.accountId),at=now(),resetAt=doubaoQuotaResetAt(seen.failure?.message||seen.providerMessage,at);if(a)(a.exhausted??={})[live.kind]=doubaoExhaustionRecord(at,resetAt);
      (live.attempts??=[]).push({accountId:live.accountId,url:seen.url||live.url,userId:seen.userId,submittedAt:live.submittedAt,day,rejectedAt:now(),reason:'quota_exhausted',providerMessage:String(seen.failure?.message||seen.providerMessage||'').slice(0,2000),acceptedGeneration:false,confirmationRounds:structuredClone(confirmationRounds(live))});
      const next=selectDoubaoAccount(s,live,day);for(const key of ['url','observedPageUrl','observedPageAt','userId','submittedAt','reservedAt','usageDay','confirmation','confirmationDetails','confirmationId','confirmationIntentAt','confirmationSentAt','confirmationReplyOnly','confirmationFailureCode','confirmationRounds','statusInquiryRequestedAt'])delete live[key];
      Object.assign(live,next?{status:'queued',code:'',remoteMayBeRunning:false,message:'原账号明确额度耗尽，正在转交下一可用账号',accountId:next,usageDay:day,reservedAt:now()}:doubaoWaitingState(s,live),{updatedAt:now()});return s;});
     // Release the rejected attempt's hidden page using its ORIGINAL account
     // identity. Cleanup is not a generation failure on the receiving account;
     // visible user pages are retained by releaseTask. Never resend the old job.
     try{await driver.releaseTask?.(rejected);}catch{/* Cleanup cannot invalidate the durable quota handoff. */}
     task=await find(id);if(task.status==='queued')queueMicrotask(()=>void drain(task.accountId).catch(()=>{}));return;
    }
    if(seen.failure?.definitive===true&&seen.ack&&seen.userId&&(!task.userId||task.userId===seen.userId)&&seen.completed&&!seen.waiting&&!seen.stopping&&!seen.confirmation&&!seen.artifacts?.length&&(!seen.gate||seen.gate==='quota_or_rate_limit')&&/^DOUBAO_(?:CONTENT_REJECTED|REFERENCE_UNAVAILABLE|MEMBERSHIP_EXPIRED|UPSTREAM_FAILED|QUOTA_EXHAUSTED|GENERATION_NOT_SUBMITTED)$/.test(seen.failure.code)){
     await db.update(s=>{const live=s.tasks.find(v=>v.id===id);if(live.status==='stopped')return s;const at=now(),message=String(seen.failure.message||'上游已明确拒绝本次生成').slice(0,2000),resetAt=seen.failure.code==='DOUBAO_QUOTA_EXHAUSTED'?doubaoQuotaResetAt(message,at):'';
      Object.assign(live,{status:'failed',code:seen.failure.code,message,failedAt:at,updatedAt:at,remoteMayBeRunning:false,userId:seen.userId,url:seen.url||task.url,...resetAt?{quotaResetAt:resetAt}:{}});
      if(seen.failure.code==='DOUBAO_QUOTA_EXHAUSTED'){const a=s.accounts?.find(v=>v.id===live.accountId);if(a)(a.exhausted??={})[live.kind]=doubaoExhaustionRecord(at,resetAt);}return s;});return;
    }
    if(seen.gate){await patch(id,{status:'blocked',code:'DOUBAO_'+String(seen.gate).toUpperCase(),message:((seen.providerMessage||'')+'\n账号需要核验：'+seen.gate+'；本次生成结束，核验后可新建任务，不会重发旧单').trim(),url:seen.url||task.url});return;}attentionGate='';
    if(!seen.ack){
     if(!task.observedPageUrl&&/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(seen.url||''))task=await patch(id,{observedPageUrl:seen.url,observedPageAt:now()});
     // The first read can consume most of the ACK budget while the page
     // navigates. Give only that first pinned route time to render; later
     // observations cannot reset the clock or adopt a different conversation.
     // An explicitly resumed original page may still be hydrating. Its old
     // submit time must not expire the ACK window before the first read. This
     // bounded observation budget never authorizes another preparation/send.
     missingSince||=Date.now();
     const ackStart=ack||task.userId?missingSince:Math.max(Date.parse(task.submittedAt||now()),Date.parse(task.observedPageAt||'')||0,observationStarted);
     const transport=seen.submissionTransport?.owned===true?seen.submissionTransport:null;
     const transportPending=transport?.state==='pending'&&!ack&&!task.userId;
     let ackBudget=15000;
     if(!ack&&!task.userId){
      const initialBudget=task.kind==='text'?textAcknowledgementMs:mediaAcknowledgementMs;
      ackBudget=transportPending?Math.max(initialBudget,mediaTransportAcknowledgementMs):initialBudget;
     }
     if(transportPending&&Date.now()-ackStart>mediaAcknowledgementMs&&task.message!=='豆包已发起原请求，正在等待官网响应；不会重复发送')task=await patch(id,{message:'豆包已发起原请求，正在等待官网响应；不会重复发送'});
     if(Date.now()-ackStart>ackBudget){const diagnostic=await receiptDiagnostics(task);await patch(id,{...diagnostic,...(transport?{submissionTransport:transport}:{}),...(ack||task.userId?{status:'blocked',code:'DOUBAO_ORIGINAL_MESSAGE_NOT_VISIBLE',message:'原任务已确认发送，但网页暂时无法完整显示原消息；保留原任务，可继续观察，不会补发'}:{status:'unknown_submission',code:transport?.state==='failed'?'DOUBAO_SUBMISSION_TRANSPORT_FAILED':transportPending?'DOUBAO_SUBMISSION_RESPONSE_TIMEOUT':'DOUBAO_SUBMISSION_UNCONFIRMED',message:(transport?.state==='failed'?transport.reason:transportPending?'豆包原请求在限定时间内仍未返回正式会话':'网页未确认本次发送')+'；远端是否受理尚不确定，原任务保留，不会补发'})});return;}
     await delay(pollMs,undefined,{signal});continue;
    }
    ack=true;missingSince=0;
    if(task.userId&&task.userId!==seen.userId)throw failure('原任务的消息身份已改变，未读取其他回复','DOUBAO_MESSAGE_MISMATCH');
    const firstAcknowledgement=task.status==='submit_intent';
    task=await patch(id,{status:'waiting',code:'',userId:seen.userId,url:seen.url,generationState:seen.generationState||'unknown',...(seen.generationState==='generating'&&!task.generationStartedAt?{generationStartedAt:now()}:{}),phase:task.kind==='text'?'text':'media',message:task.kind==='text'?'正在等待本次回答':'正在等待本次真实媒体成品'});
    if(firstAcknowledgement)void drain(task.accountId).catch(()=>{});
    lastObservation={at:now(),completed:seen.completed===true,waiting:seen.waiting===true,stopping:seen.stopping===true,pendingMedia:seen.pendingMedia===true,artifactCount:seen.artifacts?.length||0,providerMessage:String(seen.providerMessage||'').slice(0,2000)};
    // A finished prose-only promise is not a rendering receipt. After five
    // unchanged minutes, opt-in tasks may ask about this original job through
    // the existing journaled confirmation path. Never extend the observation
    // deadline, query live players, or resend an unacknowledged inquiry.
    const statusEligible=task.kind!=='text'&&seen.completed&&seen.waiting&&!seen.stopping&&!seen.confirmation&&!seen.pendingMedia&&!seen.artifacts?.length&&seen.providerMessage&&canRequestStatusInquiry(task);
    if(!statusEligible){statusSignature='';statusSince=0;}
    else{
     const signature=digest([task.url,task.userId,seen.providerMessage]);
     if(signature!==statusSignature){statusSignature=signature;statusSince=Date.now();}
     else if(Date.now()-statusSince>=statusInquiryAfterMs){
      statusSince=Date.now();
      if(task.manualGenerationConfirmedAt||await isAutoConfirm(task)){
       const query=await driver.observe(task,{readOnly:true,inquireStatus:true});signal.throwIfAborted();
       if(query.ack&&!query.gate&&query.userId===task.userId&&query.url===task.url&&query.completed&&!query.stopping&&!query.pendingMedia&&!query.artifacts?.length&&query.confirmation?.statusOnly&&query.confirmation.summary===seen.providerMessage&&!handledConfirmation(task,query.confirmation)){
        await db.update(s=>{const live=s.tasks.find(t=>t.id===id);if(closed||signal.aborted||live.status!=='waiting'||live.updatedAt!==task.updatedAt||!canRequestStatusInquiry(live))throw failure('原任务已变化，未发送状态询问','DOUBAO_STATUS_INQUIRY_UNSAFE');live.statusInquiryRequestedAt=now();return s;});
        task=await find(id);seen=query;
       }
      }
     }
    }
    if(task.kind!=='text'&&seen.generationNotStarted&&!seen.confirmation&&seen.completed&&!seen.waiting&&!seen.stopping&&!seen.artifacts?.length){await patch(id,{status:'blocked',code:'DOUBAO_GENERATION_NOT_STARTED',message:((seen.providerMessage||'')+'\n豆包只返回了脚本、提示词或参考素材，尚未取得本次生成成品；未再次发送或确认').trim()});return;}
    if(!seen.confirmation){confirmationSignature='';confirmationSince=0;}
    if(seen.confirmation){if(unresolvedConfirmation(task)){await patch(id,{status:'blocked',message:'本轮生成确认结果待核对；只观察原任务，不重复发送'});return;}
     const details=typeof seen.confirmation==='object'?seen.confirmation:null;
     if(details&&handledConfirmation(task,details)){await delay(pollMs,undefined,{signal});continue;}
     // A visible footer can precede the final streamed parameter text. Reuse
     // the existing stability window before journaling/confirming any summary;
     // later exact reply matching must never accept a truncated parameter set.
     if(details){const signature=digest([task.url,task.userId,details]);if(signature!==confirmationSignature){confirmationSignature=signature;confirmationSince=Date.now();}if(seen.stopping||Date.now()-confirmationSince<stableMs){if(seen.stopping)confirmationSince=Date.now();await delay(pollMs,undefined,{signal});continue;}}
     if(details&&!details.statusOnly&&!matchesDoubaoImageCount(task,details)){await patch(id,{status:'blocked',code:'DOUBAO_IMAGE_COUNT_MISMATCH',message:'豆包网页确认的图片数量与所选 '+task.imageCount+' 张不符，未确认生成；原网页提示：\n'+String(details.summary).slice(0,2000)});return;}
     if(details&&task.kind!=='text'&&!safeAutomaticConfirmation(task,details)){await patch(id,{status:'blocked',code:'DOUBAO_UNSAFE_CONFIRMATION',message:'豆包返回非生成参数提示，未自动操作：\n'+details.summary.slice(0,2000)});return;}
     const automatic=!!(details&&driver.confirm&&safeAutomaticConfirmation(task,details)&&(task.manualGenerationConfirmedAt||await isAutoConfirm(task)));
     task=await patch(id,{confirmationRounds:confirmationRounds(task),status:'confirmation_required',confirmationExecuting:automatic,...(details?{confirmationDetails:details,confirmationId:confirmationKey(task,details)}:{}),message:automatic?'正在核对并处理原任务生成参数':'请在画布核对生成参数并确认，也可打开原账号处理'});
     if(automatic){task=await confirmOriginal(task,{confirmationId:task.confirmationId,automatic:true});continue;}
     return;
    }
    if(noticeEligible){const signature=digest([task.url,task.userId,seen.notice]);if(signature!==noticeSignature){noticeSignature=signature;noticeSince=Date.now();}else if(Date.now()-noticeSince>=stableMs){await patch(id,{status:'blocked',code:'DOUBAO_UPSTREAM_NOTICE',message:'豆包已回复，但尚未返回本次成品，等待已暂停：\n'+String(seen.notice).slice(0,2000)});return;}}
    if(task.kind!=='text'){
     // Web pages can reveal multiple images progressively. A first thumbnail
     // is not proof that this request's whole result has finished arriving.
     if(seen.artifacts?.length&&!seen.waiting&&!seen.stopping){
      const signature=digest(seen.artifacts);
      if(previous!==signature){previous=signature;stableSince=Date.now();}
      else if(Date.now()-stableSince>=stableMs){await patch(id,{status:'complete',result:{artifacts:seen.artifacts,answer:seen.answer},completedAt:now(),message:'原任务媒体已就绪，等待文件校验和落盘',remoteMayBeRunning:false});return;}
     }else {previous='';stableSince=Date.now();}
    }
    if(task.kind==='text'&&seen.answer&&seen.completed&&!seen.stopping&&!seen.waiting){
     if(previous!==seen.answer){previous=seen.answer;stableSince=Date.now();}
     else if(Date.now()-stableSince>=stableMs){await patch(id,{status:'complete',result:{text:seen.answer},completedAt:now(),message:'本次网页回答已完成',remoteMayBeRunning:false});return;}
    }else if(task.kind==='text'){previous='';stableSince=Date.now();}
    await delay(pollMs,undefined,{signal});
   }
   await patch(id,{...(!ack?await receiptDiagnostics(task):{}),status:ack?'blocked':'unknown_submission',code:'DOUBAO_OBSERVATION_TIMEOUT',message:'等待超过时限，尚未取得成品；本次本地生成已结束，远端状态未确认，不会重新投单。'+(lastObservation?.providerMessage?'\n豆包最后回复：\n'+lastObservation.providerMessage:''),...(lastObservation?{lastObservation}:{})});
  }catch(error){
   const current=await find(id).catch(()=>task);if(!closed&&current.status!=='stopped'){const submitted=!!current.submittedAt||!!current.remoteMayBeRunning,detail=String(error.message||'网页执行器异常').slice(0,1500),storage=['EPERM','EACCES','EBUSY','ENOSPC','EIO'].includes(error.code);await recordFailure(id,{status:submitted?'blocked':'failed',...(submitted?{pausedAt:now()}:{failedAt:now(),remoteMayBeRunning:false}),...(error.navigation?{navigation:error.navigation}:{}),message:(storage?'本机任务记录保存失败（'+error.code+'）：':'')+detail+(submitted?'；远端状态未确认，本地等待已暂停，未补发':'；本次未发送，已停止'),code:error.code||'DOUBAO_EXECUTION_FAILED'});}
  }finally{controllers.delete(id);settled();if(!closed)await settleFailure(id);}
 }
 async function drain(accountId){if(closed||running.has(accountId))return;const work=(async()=>{
  while(!closed){const tasks=(await db.read()).tasks.filter(t=>t.accountId===accountId),active=tasks.filter(t=>executions.has(t.id));
   const held=tasks.filter(t=>!executions.has(t.id)&&holdsAccount(t));
   if(active.length+held.length>=parallel||parallel===1&&held.length)return;
   // The website shares draft/creation state within one account partition.
   // Serialize only entry through the first owned receipt; already accepted
   // generations continue concurrently in their independent task pages.
   if(active.some(t=>['queued','preparing','submit_intent'].includes(t.status)))return;
   const next=tasks.find(t=>!executions.has(t.id)&&['queued','preparing','waiting'].includes(t.status));if(!next)return;
   const pending=execute(next.id);executions.set(next.id,pending);
   void pending.catch(()=>{}).finally(async()=>{executions.delete(next.id);if(!closed){const latest=await find(next.id);queueMicrotask(()=>{void drain(accountId).catch(()=>{});if(latest.accountId!==accountId)void drain(latest.accountId).catch(()=>{});});}}).catch(()=>{});
  }
 })();running.set(accountId,work);try{await work;}finally{running.delete(accountId);}}
 async function start(input){
  if(closed)throw failure('豆包执行器已停止');await assertAccount(input.accountId);
  await settleFailures();
  if(!['text','image','video'].includes(input.kind)||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>200000)throw failure('豆包任务内容或类型无效');
  const fields=[input.accountId,input.kind,input.prompt,input.files||[],input.target||null,input.profileId||null];if(input.allowAccountRotation||input.durationSeconds)fields.push({allowAccountRotation:input.allowAccountRotation===true,durationSeconds:Number(input.durationSeconds)||0});
  if(input.aspectRatio&&input.aspectRatio!=='auto')fields.push({aspectRatio:input.aspectRatio});
  const id='doubao-task-'+digest([identity(input.requestId),input.accountId,input.kind]).slice(0,48),fingerprint=digest(fields);
  let existingTask=true;
  try{await db.update(s=>{const old=s.tasks.find(t=>t.id===id);existingTask=!!old;if(old&&old.fingerprint!==fingerprint)throw failure('同一任务编号不能改变账号、提示词或目标','DOUBAO_REQUEST_CONFLICT');
   const t=old||{...input,id,fingerprint,isolatedPage:driver?.taskScoped===true,status:'queued',createdAt:now(),updatedAt:now()};
   if(!old||old.status==='quota_waiting'&&!old.submittedAt&&!old.remoteMayBeRunning){const day=doubaoQuotaDay(),selected=selectDoubaoAccount(s,t,day);Object.assign(t,selected?{accountId:selected,status:'queued',code:'',usageDay:day,reservedAt:now()}:doubaoWaitingState(s,t));}
   if(!old)s.tasks.push(t);return s;});}catch(error){if(!existingTask)error.definitelyUnsubmitted=true;throw error;}
  await settleFailure(id);const current=await find(id);void drain(current.accountId).catch(()=>{});return current;
 }
 async function wait(id,{signal,onEvent,pendingOnBlock=false}={}){
  let last='';while(true){signal?.throwIfAborted();const t=await find(id),state=[t.status,t.code,t.blockedByTaskId].join(':');if(state!==last){last=state;await onEvent?.({phase:'progress',text:t.message||'豆包账号任务排队中',taskId:t.id});}
   if(t.status==='complete')return t;
   const keepWaiting=pendingOnBlock===true||pendingOnBlock==='confirmation'&&t.status==='confirmation_required'||t.confirmationExecuting===true&&(controllers.has(t.id)||confirmations.has(t.id));
   if(terminal.has(t.status)||!keepWaiting&&(blocked.has(t.status)||t.status==='quota_waiting')&&t.status!=='submit_intent'&&!(t.status==='blocked'&&controllers.has(t.id)))throw Object.assign(failure(t.message||'原任务需要处理','DOUBAO_TASK_'+t.status.toUpperCase()),{taskId:t.id});
   if(closed)throw failure('执行器已停止');await delay(Math.max(20,pollMs),undefined,{signal});
  }
 }
 async function readOriginalResult(id){
  if(recoveries.has(id))return recoveries.get(id);
  const work=(async()=>{
   const t=await find(id),url=originalResultUrl(t);if(closed||!canReadDoubaoOriginalResult(t))throw failure('原任务缺少可核对的账号、会话或消息凭据，或已被明确停止；未重新生成','DOUBAO_RESULT_RECOVERY_UNSAFE');
   if(!driver?.open||!driver?.observe)throw failure('豆包网页执行器未就绪，请重开神思后重试找回','DESKTOP_REQUIRED');
   const assertActive=async()=>{const live=await find(id);if(closed||!canReadDoubaoOriginalResult(live)||live.accountId!==t.accountId||live.userId!==t.userId||originalResultUrl(live)!==url)throw failure('原任务已停止或归属发生变化，未继续找回','MEDIA_RECALL_CANCELLED');if(driver.taskScoped!==true&&(await db.read()).tasks.some(v=>v.id!==id&&v.accountId===t.accountId&&(!terminal.has(v.status)||v.remoteMayBeRunning&&!v.accountSlotReleasedAt)))throw failure('原账号还有其他任务，当前执行器不支持独立任务页，未切换网页','DOUBAO_ACCOUNT_BUSY');await assertAccount(t.accountId);};
   await assertActive();await driver.open({accountId:t.accountId,taskId:t.id,url,visible:false});
   let signature='',since=0,last,recovered=false;const end=Date.now()+Math.max(15000,stableMs*3);
   try{while(Date.now()<end){
    await assertActive();const seen=await driver.observe({...t,url,observedPageUrl:url},{readOnly:true});await assertActive();last=seen;
    if(seen.gate)throw failure('豆包原账号需要处理登录或验证：'+seen.gate+'；请打开原网页检查','DOUBAO_ORIGINAL_PAGE_GATED');
    if(seen.ack&&(seen.userId!==t.userId||seen.url!==url))throw failure('原会话或消息不匹配，未接收其他任务的成品','DOUBAO_RESULT_OWNERSHIP_MISMATCH');
    if(seen.ack&&seen.userId===t.userId&&seen.url===url&&seen.failure?.definitive)throw failure(seen.failure.message,seen.failure.code);
    if(seen.ack&&seen.userId===t.userId&&seen.url===url&&!seen.waiting&&!seen.stopping&&!seen.confirmation&&seen.artifacts?.length&&seen.artifacts.every(a=>a.kind===t.kind&&a.url&&a.messageId)){
     const next=digest(seen.artifacts);if(next!==signature){signature=next;since=Date.now();}
     else if(Date.now()-since>=stableMs){const at=now();await db.update(s=>{const live=s.tasks.find(v=>v.id===id);if(closed||!canReadDoubaoOriginalResult(live)||live.userId!==t.userId||originalResultUrl(live)!==url)throw failure('原任务已停止找回','MEDIA_RECALL_CANCELLED');Object.assign(live,{recoveredResult:{artifacts:seen.artifacts,answer:seen.answer},resultRecoveredAt:at});return s;});recovered=true;return find(id);}
    }else {signature='';since=0;}
    await delay(pollMs);
   }
   throw failure('原会话尚未找到稳定的生成成品'+(last?.providerMessage?'：'+String(last.providerMessage).slice(0,800):'')+'；未重新生成，可打开原网页检查','MEDIA_RESULT_NOT_READY');
   }finally{if(!recovered)await driver.releaseTask?.(t);}
  })();recoveries.set(id,work);try{return await work;}finally{recoveries.delete(id);}
 }
 async function recoverPreparedResult(id){
  if(recoveries.has(id))return recoveries.get(id);
  const work=(async()=>{
   const before=(await db.read()).tasks.find(v=>v.id===id),t=await find(id);if(t.status==='complete'&&t.externalResultRecovery)return t;
   if(closed||!canRecoverPreparedDoubaoResult(t)||!driver?.recoverPreparedResult)throw failure('只能取回未发送且无附件的原失败任务成品；不会重发','DOUBAO_RESULT_RECOVERY_UNSAFE');
   const assertIdle=s=>{const live=s.tasks.find(v=>v.id===id);if(!canRecoverPreparedDoubaoResult(live)||digest(live)!==digest(before))throw failure('原任务已变化，未接收网页结果','DOUBAO_RESULT_RECOVERY_UNSAFE');if(s.tasks.some(v=>v.id!==id&&v.accountId===t.accountId&&v.kind===t.kind&&v.prompt===t.prompt))throw failure('此账号存在相同要求的其他任务，不能唯一确定成品归属','DOUBAO_RESULT_AMBIGUOUS');if(s.tasks.some(v=>v.id!==id&&v.accountId===t.accountId&&(!terminal.has(v.status)||v.remoteMayBeRunning)))throw failure('原账号有其他未决任务，未取回结果','DOUBAO_ACCOUNT_BUSY');};
   await assertAccount(t.accountId);assertIdle(await db.read());
   const checked=seen=>{if(seen?.gate||!seen?.ack||!seen.userId||!/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(seen.url||'')||seen.completed!==true||seen.waiting||seen.stopping||seen.confirmation||!seen.artifacts?.length||seen.artifacts.some(a=>a.kind!==t.kind||!a.url||!a.messageId))throw failure('当前网页没有唯一匹配原提示词的已完成成品；未发送、未确认','DOUBAO_RESULT_NOT_READY');return digest([seen.url,seen.userId,seen.artifacts]);};
   const first=await driver.recoverPreparedResult(t),signature=checked(first);
   await delay(stableMs);if(closed)throw failure('插件已停止，未接收结果');
   const seen=await driver.recoverPreparedResult(t);if(checked(seen)!==signature)throw failure('网页成品仍在变化，请稍后取回；未发送','DOUBAO_RESULT_CHANGED');
   await assertAccount(t.accountId);
   await db.update(s=>{if(closed)throw failure('插件已停止');assertIdle(s);const live=s.tasks.find(v=>v.id===id),at=now();(live.preparationFailures??=[]).push({at:live.updatedAt,code:live.code,message:live.message});for(const key of ['failedAt','code','autoFailedAt','autoFailureReason','userAbandonedAt','abandonPendingAt'])delete live[key];Object.assign(live,{status:'complete',url:seen.url,userId:seen.userId,result:{artifacts:seen.artifacts,answer:seen.answer},completedAt:at,remoteMayBeRunning:false,externalResultRecovery:{observedAt:at,signature,source:'explicit-prepared-page-result'},message:'已只读取回原网页成品，未重发或确认；等待文件校验和落盘',updatedAt:at});return s;});return find(id);
  })();recoveries.set(id,work);try{return await work;}finally{recoveries.delete(id);}
 }
 async function resume(id,{originalUrl}={}){let t=await find(id);
  if(t.status==='quota_waiting'){
   await controllers.get(id)?.done;if(closed)throw failure('豆包执行器已停止');
   await db.update(s=>{const live=s.tasks.find(v=>v.id===id);if(live.status!=='quota_waiting'||live.submittedAt||live.remoteMayBeRunning)throw failure('原任务状态已变化，未重新发送','DOUBAO_ORIGINAL_TASK_REQUIRED');
    const next=selectDoubaoAccount(s,live);Object.assign(live,next?{status:'queued',accountId:next,code:'',message:'正在由可用账号继续原任务',usageDay:doubaoQuotaDay(),reservedAt:now()}:doubaoWaitingState(s,live),{updatedAt:now()});return s;});
   t=await find(id);void (running.get(t.accountId)||Promise.resolve()).then(()=>drain(t.accountId)).catch(()=>{});return t;
  }
  if(originalUrl!==undefined){
   // Explicitly recover a diagnostic-observed route after an interrupted first
   // ACK. This never sends: two stable, unique full-prompt reads are required.
   const formal=url=>/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(url||'');
   if(!formal(originalUrl)||!t.submittedAt||t.userId||formal(t.url)||t.observedPageUrl||t.files?.length||!['blocked','unknown_submission'].includes(t.status))throw failure('当前任务不允许重新认领会话地址；原记录保留','DOUBAO_ORIGINAL_TASK_REQUIRED');
   const assertOwned=s=>{const live=s.tasks.find(v=>v.id===id);if(JSON.stringify(live)!==JSON.stringify(t))throw failure('原任务已变化，未重新绑定','DOUBAO_ORIGINAL_TASK_REQUIRED');if(s.tasks.some(v=>v.id!==id&&v.accountId===t.accountId&&(!terminal.has(v.status)||v.remoteMayBeRunning&&!v.accountSlotReleasedAt)))throw failure('原账号还有其他未决任务，未切换网页','DOUBAO_ACCOUNT_BUSY');};
   await assertAccount(t.accountId);assertOwned(await db.read());
   await driver.open({accountId:t.accountId,taskId:t.id,url:originalUrl,visible:false});
   let signature='',matches=0;const readyUntil=Date.now()+15000;
   while(matches<2){
    const seen=await driver.observe({...t,observedPageUrl:originalUrl});
    if(closed||seen?.gate||seen?.url!==originalUrl||Date.now()>=readyUntil||seen.ack&&(!seen.userId||signature&&signature!==seen.userId))throw failure('原会话未两次唯一匹配完整提示词；未绑定或发送','DOUBAO_ORIGINAL_TASK_REQUIRED');
    if(!seen.ack){matches=0;await delay(pollMs);continue;}
    signature=seen.userId;matches++;if(matches<2)await delay(pollMs);
   }
   await db.update(s=>{assertOwned(s);Object.assign(s.tasks.find(v=>v.id===id),{url:originalUrl,observedPageUrl:originalUrl,userId:signature,routeRecoveredAt:now()});return s;});t=await find(id);
  }
  if(canRetryDoubaoPreparation(t)){
   await controllers.get(id)?.done;if(closed)throw failure('豆包执行器已停止');await assertAccount(t.accountId);
   await db.update(s=>{const live=s.tasks.find(v=>v.id===id);if(!canRetryDoubaoPreparation(live))throw failure('任务状态已变化，未重复准备','DOUBAO_PREPARATION_RETRY_UNSAFE');
    if(s.tasks.some(v=>v.id!==id&&v.accountId===live.accountId&&(!terminal.has(v.status)||v.remoteMayBeRunning)))throw failure('原账号仍有其他未决任务，未重新准备','DOUBAO_ACCOUNT_BUSY');
    (live.preparationFailures??=[]).push({at:live.updatedAt,code:live.code,message:live.message});
    for(const key of ['failedAt','code','recoverOriginal'])delete live[key];
    Object.assign(live,{status:'queued',retryPreparation:true,message:'正在恢复原任务的发送前准备；尚未提交',updatedAt:now()});return s;
   });void (running.get(t.accountId)||Promise.resolve()).then(()=>drain(t.accountId)).catch(()=>{});return find(id);
  }
  if(!['waiting','blocked','confirmation_required','unknown_submission'].includes(t.status))throw failure('此任务不需要继续观察');
  if(!t.url||!/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(t.url)){
   // The first send may navigate from /chat/ before ACK. Bind only when the
   // original account's current page uniquely contains this exact sent prompt.
   // This performs no navigation, filling or sending and never guesses a URL.
   let seen=t.submittedAt&&await driver.observe(t);
   // An interrupted first navigation may leave only the provisional URL in
   // the journal. A stable read can establish a candidate route; re-read that
   // same route with full rendered-prompt matching, never adopt by URL alone.
   if(seen&&!seen.ack&&!seen.gate&&!t.userId&&!t.observedPageUrl&&/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(seen.url||'')){
    seen=await driver.observe({...t,observedPageUrl:seen.url});
   }
   if(!seen?.ack||seen.gate||!seen.userId||!/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(seen.url))throw failure('缺少可确认的原会话地址，请打开账号后台核对，禁止重新发送','DOUBAO_ORIGINAL_TASK_REQUIRED');
   t=await patch(id,{url:seen.url,userId:seen.userId});
  }
  await driver.open({accountId:t.accountId,taskId:t.id,url:t.url,visible:false});await patch(id,{status:'waiting'});void drain(t.accountId).catch(()=>{});return find(id);
 }
 async function inquire(id){
  const t=await find(id);await assertAccount(t.accountId);
  if(closed||controllers.has(id)||!t.submittedAt||!t.userId||!['waiting','blocked'].includes(t.status)||!['image','video'].includes(t.kind)||!canRequestStatusInquiry(t))throw failure('原状态查询仍未确认、间隔不足30分钟或已达3次；未重复发送','DOUBAO_STATUS_INQUIRY_UNSAFE');
  const seen=await driver.observe(t,{readOnly:true,inquireStatus:true});
  if(!seen.ack||seen.gate||seen.userId!==t.userId||seen.url!==t.url||!seen.confirmation?.statusOnly||handledConfirmation(t,seen.confirmation))throw failure('原任务没有新的可查询等待回复，未发送','DOUBAO_STATUS_INQUIRY_UNSAFE');
  await db.update(s=>{const live=s.tasks.find(v=>v.id===id);if(live.status!==t.status||live.updatedAt!==t.updatedAt||live.statusInquiryRequestedAt!==t.statusInquiryRequestedAt||!canRequestStatusInquiry(live))throw failure('原任务已变化，未查询');live.statusInquiryRequestedAt=now();return s;});return find(id);
 }
 function markStopped(t){
  if(t.userAbandonedAt&&t.accountSlotReleasedAt)return;
  t.abandonOriginal??={status:t.status,message:t.message,code:t.code};
  Object.assign(t,{status:'stopped',abandonPendingAt:t.abandonPendingAt||now(),updatedAt:now(),message:'正在停止本地执行并解除占用；原记录保留',remoteMayBeRunning:t.remoteMayBeRunning===false?false:!!t.submittedAt&&!t.completedAt});
 }
 const stop=id=>abandon(id,{immediateRelease:true});
 async function cancelQuota(id,key){
  await db.update(s=>{const notice=doubaoQuotaNotices(s).find(n=>n.taskId===id&&n.key===key);if(!notice)throw failure('账号额度或原任务状态已变化，请刷新后操作','DOUBAO_QUOTA_NOTICE_CHANGED');
   Object.assign(s.tasks.find(t=>t.id===id),{status:'stopped',remoteMayBeRunning:false,message:'已取消额度等待；原任务内容与记录保留，未重新发送',updatedAt:now()});return s;});return find(id);
 }
 async function release(id){const t=await find(id);if(t.status!=='stopped')throw failure('请先停止本地任务');await patch(id,{remoteMayBeRunning:false,message:'用户已检查原任务并解除账号占用；未重发旧任务'});void drain(t.accountId).catch(()=>{});}
 async function abandon(id,{expectedUpdatedAt,automaticFailure=false,immediateRelease=false}={}){
  if(abandonments.has(id))return abandonments.get(id);
  const work=(async()=>{
   const original=await find(id);if(!automaticFailure)await db.update(s=>{const live=s.tasks.find(t=>t.id===id);live.explicitStopAt||=now();return s;});if(original.userAbandonedAt&&original.accountSlotReleasedAt)return find(id);
   // Commit every stop intent before aborting: restart must finish release, not resubmit.
   await db.update(s=>{const live=s.tasks.find(t=>t.id===id);if(expectedUpdatedAt&&!live.abandonPendingAt&&(live.updatedAt||live.createdAt||'1970-01-01T00:00:00.000Z')!==expectedUpdatedAt)throw failure('任务状态已变化，请刷新后再操作。','MEDIA_QUEUE_CHANGED');if(automaticFailure){live.autoFailedAt||=now();live.autoFailureReason||=live.message||'未取得明确生成结果';}markStopped(live);return s;});
   controllers.get(id)?.abort();
   const pending=[controllers.get(id)?.done,confirmations.get(id),recoveries.get(id)].filter(Boolean);
   if(immediateRelease){
    const live=await find(id),releasedAt=now();
    await patch(id,{abandonPendingAt:'',accountSlotReleasedAt:releasedAt,userAbandonedAt:original.userAbandonedAt||releasedAt,message:live.remoteMayBeRunning?'已停止本地任务并立即解除本地账号占用；远端可能仍在运行或扣费，原记录及结果保留。':'已停止本地任务并立即解除本地账号占用；原记录及结果保留。'});
    void Promise.allSettled(pending).then(()=>driver?.releaseTask?.(original)).catch(()=>{});
    void (running.get(original.accountId)||Promise.resolve()).then(()=>drain(original.accountId)).catch(()=>{});
    return find(id);
   }
   if(pending.length){let timer;const settled=Promise.allSettled(pending);try{await Promise.race([settled,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('本地执行正在退出，结束后将自动解除占用','STOP_PENDING')),5000);})]);}catch(error){void settled.then(()=>{if(!closed)return abandon(id);}).catch(()=>{});throw error;}finally{clearTimeout(timer);}}
   const live=await find(id);
   await patch(id,{abandonPendingAt:'',accountSlotReleasedAt:now(),userAbandonedAt:original.userAbandonedAt||now(),message:live.remoteMayBeRunning?'已停止本地任务并解除本地账号占用；远端可能仍在运行或扣费，原记录及结果保留。':'已停止本地任务并解除本地账号占用；原记录及结果保留。'});
   await driver?.releaseTask?.(original);
   // Only already queued work may proceed. Never re-send the abandoned task.
   void (running.get(original.accountId)||Promise.resolve()).then(()=>drain(original.accountId)).catch(()=>{});return find(id);
  })();abandonments.set(id,work);try{return await work;}finally{abandonments.delete(id);}
 }
 async function stopAll(filter=()=>true){
  let selected=[];await db.update(s=>{selected=s.tasks.filter(t=>(!terminal.has(t.status)||t.status==='stopped'&&!t.accountSlotReleasedAt)&&filter(t)).map(t=>t.id);for(const id of selected)markStopped(s.tasks.find(t=>t.id===id));return s;});
  // Mark the whole batch first, so releasing its first account cannot send another selected task.
  for(const id of selected)controllers.get(id)?.abort();
  const outcomes=await Promise.allSettled(selected.map(abandon)),error=outcomes.find(r=>r.status==='rejected');if(error)throw error.reason;
 }
 async function recover(){await db.update(s=>{for(const t of s.tasks){if(t.confirmationExecuting){delete t.confirmationExecuting;if(t.status==='confirmation_required')Object.assign(t,{status:'blocked',message:'上次参数确认中断，保留原任务且不会重复确认'});}if(t.status==='submit_intent')Object.assign(t,{status:'unknown_submission',message:'上次发送未确认，保留原任务且不会重发'});if(t.status==='preparing')t.status='queued';if(t.status==='waiting')t.recoverOriginal=true;}return s;});
  // Old explicit stops used no release receipt. Finish their local release,
  // retaining remote uncertainty; unknown/blocked (not stopped) jobs stay held.
  for(const t of (await db.read()).tasks)if(t.status==='stopped'&&(t.abandonPendingAt||t.remoteMayBeRunning)&&!t.accountSlotReleasedAt)await abandon(t.id,{automaticFailure:!!t.autoFailedAt});
  await settleFailures();
  for(const id of new Set((await db.read()).tasks.map(t=>t.accountId)))void drain(id).catch(()=>{});}
 const needsFailureSettlement=t=>!t.accountSlotReleasedAt&&!controllers.has(t.id)&&!confirmations.has(t.id)&&!recoveries.has(t.id)&&['blocked','unknown_submission','failed','quota_waiting','stopped'].includes(t.status)&&(!t.result||t.status==='stopped');
 async function settleFailure(id){const t=await find(id);if(needsFailureSettlement(t))await abandon(id,{expectedUpdatedAt:t.updatedAt,automaticFailure:!!t.autoFailedAt||t.status!=='stopped'});}
 async function settleFailures(){for(const t of (await db.read()).tasks)if(needsFailureSettlement(t))await settleFailure(t.id);}
 return {start,find,snapshot:()=>db.read(),settleFailures,wait,resume,inquire,readOriginalResult,recoverPreparedResult,confirm,confirmation,stop,cancelQuota,release,abandon,patch,stopAll,recover,close:async()=>{closed=true;for(const controller of controllers.values())controller.abort();await Promise.allSettled([...running.values(),...executions.values(),...recoveries.values()]);}};
}
