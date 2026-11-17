import {uiGlyph} from './ui-glyph.js';
import {createCanvasActivity} from './canvas-activity.js';
import {doubaoQuestionForm,doubaoQuestionReply} from './doubao-question.js';
import {readNotebookMediaQueue,mediaQueueTaskScope} from './media-queue-navigation.js';
import {currentMediaCardJobs,mediaCardCanStop,mediaCardHidden,mediaCardOutcome,mediaCardFailureReason} from './media-card-job.js';
import {folderSegments} from './directory-paths.js';
import {accountCreditRows,knownAccountCredit,selectedAccountCreditLabel,readSelectedAccountCredits,mergeAccountCreditSnapshots} from './account-credit-view.js';
import {profileSupports,profileHasMedia} from './model-capabilities.js';
import {mountGenerationControls} from './generation-controls.js';
import {mountGenerationMentions} from './generation-mentions.js';
import {mountGenerationSources} from './generation-sources.js';
import {mountGenerationLayout} from './generation-layout.js';
import {generationIntent,generationStoredDraft,generationCardRatio,mediaRatioPreset,inheritedMediaRatio} from './generation-intent.js';
import {openAttachmentPreview} from './attachment-preview.js';
import {escapeHtml as h} from './editor.js';
import {mediaDialog} from './media-dialog.js';
import {mountReferenceHover} from './reference-hover.js';
import {audioReferenceMarkup,replaceReferenceMarkup,disposeReferenceAudio} from './reference-audio.js';
import {visibleMediaTask,visibleMediaQueueTask,clearableMediaQueueTask,mediaQueueCanReorder,mediaQueueGroup,sortMediaQueue,mediaWaitingParameters,mediaResultNeedsAttention,mediaStopNeedsConfirmation,mediaOriginalResultPending} from './media-task-policy.js';
import {openModelVerification,needsCredentialVerification,remindModelVerification} from './model-verification.js';
import {mediaCardTime} from './media-card-time.js';
import {translate} from './localization.js';
import {generationJobBlocksSubmit,generationJobNotice,generationSubmissionRejected,readPendingSubmissions} from './generation-submit-state.js';
import {openVideoRetryFromCurrent} from './generation-video-retry.js';
import {retryMediaCardFromCurrent} from './generation-card-retry.js';
import {createGenerationSaveFeedback,generationDraftContent as draftContent} from './generation-save-feedback.js';
import {cardModelProfile} from './card-model-defaults.js';
import {reconcileConnectedReferences} from './generation-references.js';
const labels={queued:'排队中',submitting:'提交中',running:'生成中',polling:'生成中',downloading:'下载中',complete:'生成完成',cancel_requested:'正在停止',cancelled:'已停止',failed:'生成失败',retry_required:'需要处理',waiting_credentials:'等待凭据',waiting_storage:'等待存储',superseded:'已替代'};
export function createMediaUI({context,api,panel,options,profiles,plugin,currentTextProfile,refreshProfiles}){
 const activity=createCanvasActivity({api,context,enabled:()=>plugin()?.enabled});
 let timer,lastApplied='',credits=[],officialCredit=null,inFlight=false,session,openTimer,creditRequest='',creditEpoch=0,paintFrame,draftRequest=0,outsideCardClick='';const jobCache=new Map(),creditPending=new Map(),creditChecked=new Map(),creditErrors=new Map();let queueSnapshot,taskEpoch=0;
 function selectedProfile(){const doc=context.current(),node=context.selectedNode();if(!node)return undefined;const draft=generationStoredDraft(doc,node),form=session?.form.isConnected&&session.nodeId===node?.id&&session.documentId===doc?.id?session.form:null,channel=form?.querySelector('[name=channel]').value||draft?.channel||'image',id=form?form.querySelector('[name=profileId]').value:cardModelProfile(doc,node,channel);return profiles().find(p=>p.id===id&&p.enabled!==false);}
 function controlsMarkup(){return plugin()?.enabled?'<button data-action="official-credits" title="查看全部已获取积分" aria-label="查看全部积分">—</button><button data-action="official-queue" title="任务队列">任务队列</button>':'';}
 const taskPath=j=>{const current=!j.notebookId||j.notebookId===context.libraryId(),state=current?context.state():{},doc=state.documents?.[j.target?.documentId],language=document.documentElement.lang==='en'?'en-US':'zh-CN';if(j.source==='doubao-account-blocker')return translate('豆包插件 / 账号占用',language);return [context.notebookName?.(j.notebookId)||translate('其他笔记本',language),...folderSegments(state.coreFolders||[],doc?.coreFolderId).map(f=>f.name),doc?.title||j.target?.documentTitle||j.target?.documentId||translate('白板',language)].join(' / ');};
 const scope=()=>({id:context.libraryId(),documentId:context.current()?.id});
 const storedArray=key=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value:[];}catch{return [];}};
 const acknowledged=new Set(storedArray('core-media-ack')),frozenEnds=new Map(storedArray('core-media-finished-times').filter(v=>Array.isArray(v)&&typeof v[0]==='string'&&Number.isFinite(v[1]))),cardJobs=new Map();
 const remember=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value.slice(-500)));}catch{/* A storage limit must not interrupt card interactions. */}};
 const pendingStorage='core-media-pending-submissions',checkedScopes=new Set(),watchedJobs=new Set(storedArray('core-media-watched-jobs')),seenNotices=new Set(storedArray('core-media-error-notices'));
 const readPending=()=>{try{return readPendingSubmissions(localStorage.getItem(pendingStorage)).map(([key,p])=>[key,p.cancelled?{...p,stopError:p.stopError||'停止确认尚未返回，请再次停止'}:p]);}catch{return [];}};
 let pendingSubmissions=new Map(readPending());const submittingCards=new Set(),submissionAttempts=new Map();
 const pendingKey=(target,nodeId)=>JSON.stringify([target.id,target.documentId,nodeId]);
 const rememberPending=()=>{try{localStorage.setItem(pendingStorage,JSON.stringify([...pendingSubmissions]));}catch{/* The in-memory guard still protects this window. */}};
 const localSubmissionJobs=()=>[...pendingSubmissions.values()].filter(p=>p.createdAt&&!p.jobId).map(p=>({id:'pending-'+p.submissionId,submissionId:p.submissionId,notebookId:p.scope.id,target:{documentId:p.scope.documentId,nodeId:p.nodeId,nodeName:p.nodeName},source:'local-submission',status:p.cancelled&&!p.stopError?'cancelled':'queued',...(p.cancelled&&!p.stopError?{cardDismissedAt:p.createdAt,queueDismissedAt:p.createdAt}:{}),queueStage:p.stopError?'停止未完成，请再次停止':'正在准备提交',error:p.stopError,createdAt:p.createdAt,channel:p.channel,profileId:p.profileId,availableActions:{stop:!p.cancelled||!!p.stopError}}));
 const mergeLocalSubmissions=jobs=>[...jobs,...localSubmissionJobs().filter(local=>!jobs.some(j=>j.submissionId===local.submissionId||j.submissionIds?.includes(local.submissionId)))];
 const cancelPending=async p=>{
  const key=pendingKey(p.scope,p.nodeId),attempt=submissionAttempts.get(p.submissionId);if(attempt)attempt.cancelled=true;p.cancelled=true;delete p.stopError;rememberPending();paintCards();
  let result;try{result=await api('/media/cancel-submission',{...p.scope,nodeId:p.nodeId,submissionId:p.submissionId,createdAt:p.createdAt,channel:p.channel});}catch(error){p.stopError=error.message;rememberPending();paintCards();session?.syncSubmit?.();throw error;}
  if(result.job){const scopeKey=JSON.stringify(p.scope),rows=jobCache.get(scopeKey)||[];acceptTaskSnapshot(scopeKey,[result.job,...rows.filter(j=>j.id!==result.job.id)]);}
  if(pendingSubmissions.get(key)?.submissionId===p.submissionId)pendingSubmissions.delete(key);rememberPending();if(attempt){submittingCards.delete(key);attempt.cancelled=true;}
  if(result.job)updateQueueJob(result.job);paintCards();session?.syncSubmit?.();if(result.warning)context.toast(result.warning);return result;
 };
 const showGenerationNotice=(message,{key='',profileId,credentialRequired=false,failureAt,accountId}={})=>{if(!message||key&&seenNotices.has(key))return;if(key){seenNotices.add(key);remember('core-media-error-notices',[...seenNotices]);}if(credentialRequired&&profileId){void remindModelVerification(context,{profileId,message,failureAt,accountId}).catch(error=>context.toast(error.message));return;}context.toast(message);};
 const syncPending=()=>{pendingSubmissions=new Map(readPending());checkedScopes.delete(JSON.stringify(scope()));session?.syncSubmit?.();void observe();};
 const storageChanged=event=>{if(event.key===pendingStorage)syncPending();};window.addEventListener('storage',storageChanged);
 function acceptTaskSnapshot(key,jobs){
  const previous=new Map((jobCache.get(key)||[]).map(job=>[job.id,job])),byId=new Map(),bySubmission=new Map();for(const job of jobs){byId.set(job.id,job);for(const id of [job.submissionId,...(job.submissionIds||[])])if(id&&!bySubmission.has(id))bySubmission.set(id,job);}jobCache.set(key,jobs);checkedScopes.add(key);
  if(jobCache.size>20){const evicted=jobCache.keys().next().value;jobCache.delete(evicted);checkedScopes.delete(evicted);}
  let watchedChanged=false,pendingChanged=false;for(const [pendingId,pending]of pendingSubmissions){if(JSON.stringify(pending.scope)!==key)continue;const job=byId.get(pending.jobId)||bySubmission.get(pending.submissionId);if(job){if(!watchedJobs.has(job.id)){watchedJobs.add(job.id);watchedChanged=true;}if(!generationJobBlocksSubmit(job)){pendingSubmissions.delete(pendingId);pendingChanged=true;}}}if(watchedChanged)remember('core-media-watched-jobs',[...watchedJobs]);if(pendingChanged)rememberPending();
  const currentJobs=new Set([...currentMediaCardJobs(jobs,context.current()?.canvas?.nodes||[]).values()].map(j=>j.id));
  for(const job of jobs){if(job.providerErrorCode==='DOUBAO_ALL_QUOTAS_EXHAUSTED'&&!job.autoFailedAt)continue;const message=generationJobNotice(job),old=previous.get(job.id);if(message&&(watchedJobs.has(job.id)||old&&generationJobNotice(old)!==message||job.preSubmitRejectedAt&&currentJobs.has(job.id)))showGenerationNotice(message,{title:job.status==='failed'?'生成失败':'生成需要处理',profileId:job.profileId,credentialRequired:needsCredentialVerification(job),failureAt:job.failedAt||job.preSubmitRejectedAt||job.createdAt,accountId:job.accountId,key:job.id+':'+(job.preSubmitRejectedAt||'')+':'+message});}
  session?.syncSubmit?.();
 }
 const caption=j=>j.source==='local-submission'?j.queueStage:mediaWaitingParameters(j)?'等待参数确认':j.recoveryState==='running'?'正在找回原成品':j.recoveryError&&!j.appliedAt?'找回失败':mediaResultNeedsAttention(j)?'成品待取回 · 不占生成位置':j.observationPausedAt?'状态读取失败':j.status==='complete'&&!j.appliedAt?'等待落板':labels[j.status]||j.status;
 async function draft({channel:initialChannel}={}){
  const request=++draftRequest;
  if(!plugin()?.enabled)throw Error('白板生成插件已停用');
  if(session?.closing)await session.closing;
  const doc=context.current(),node=context.selectedNode();if(!node){context.toast('请先选中一张卡片');return;}
  if(session?.form.isConnected&&session.nodeId===node.id&&session.documentId===doc.id&&session.notebookId===context.libraryId()&&(!initialChannel||session.channel()===initialChannel))return session;
  if(session&&!await session.dismiss())return;
  // Loaded profiles are sufficient to open the controls. A slow directory must
  // never block card interaction or replace a form the user is already editing.
  void refreshProfiles?.().catch(error=>context.toast('模型目录刷新失败，保留已加载配置：'+error.message));
  if(request!==draftRequest||!plugin()?.enabled||context.current()?.id!==doc.id||context.selectedNode()?.id!==node.id)return;
  const old=document.querySelector('.whiteboard-generation-popover');if(old)old.remove();
  const stored=generationStoredDraft(doc,node),channelAtOpen=initialChannel||stored.channel||'image',defaults={aspectRatio:mediaRatioPreset(node)||inheritedMediaRatio(doc.canvas,node,channelAtOpen)||'16:9'},saved={...defaults,...(!stored.channel||stored.channel===channelAtOpen?stored:{}),...stored.channels?.[channelAtOpen]};delete saved.channels;let referenceState=reconcileConnectedReferences(doc.canvas,node.id,saved);const references=referenceState.references,scopeAtOpen=scope();
  saved.profileId??=cardModelProfile(doc,node,channelAtOpen);saved.channel=channelAtOpen;
  const form=document.createElement('form');form.className='whiteboard-generation-popover';form.setAttribute('aria-label','卡片生成操作栏');

  form.innerHTML=`<header class="generation-deck-header"><label class="generation-type-picker"><select name="channel" id="generation-channel" aria-label="生成类型">${[['text','文本'],['image','图片'],['video','视频'],['audio','音频']].map(([key,label])=>`<option value="${key}" ${key===channelAtOpen?'selected':''}>生成${label}</option>`).join('')}</select></label><div class="spacer"></div><button type="button" data-generation-clear class="generation-clear-text">清空参考</button><button type="button" data-generation-expand aria-label="居中展开生成窗口" title="居中展开生成窗口" aria-expanded="false"><span class="original-icon" aria-hidden="true">&#xE740;</span></button></header><label class="generation-profile-slot">模型配置<select name="profileId" id="generation-profile" aria-label="模型配置">${options(channelAtOpen,saved.profileId,{manual:true})}</select></label><section class="generation-reference-strip"><label class="generation-reference-picker"><span>有序参考</span><select data-generation-add-reference aria-label="添加参考卡片"><option value="">添加白板参考…</option>${doc.canvas.nodes.filter(n=>n.id!==node.id).map(n=>`<option value="${n.id}">${h(n.name||n.id)} · ${n.file?'媒体':'文本'}</option>`).join('')}</select></label><div class="generation-reference-list" data-generation-references></div></section><label class="generation-prompt-field"><span>提示词 <output data-generation-prompt-count></output></span><textarea name="prompt" aria-label="生成完整提示词" rows="6" placeholder="描述你想生成的内容，输入 @ 引用参考卡片…">${h(saved.prompt??node.text??'')}</textarea></label><div class="model-form"><label>比例<select name="aspectRatio">${['16:9','9:16','1:1','4:3','3:4','21:9','3:2','2:3'].map(r=>`<option ${r===(saved.aspectRatio||'16:9')?'selected':''}>${r}</option>`).join('')}</select></label><label>分辨率<input name="resolution" value="${h(saved.resolution||'')}"></label><label>时长（秒）<input name="durationSeconds" type="number" min="1" value="${h(saved.durationSeconds||'')}"></label><label>生成模式<input name="generationMode" value="${h(saved.generationMode||'smart_params')}"></label></div><footer class="generation-deck-footer"><span class="generation-popover-status" role="status">草稿自动保存</span><div class="generation-footer-actions"><button type="button" data-generation-close>关闭</button><button type="submit">生成</button></div></footer>`;
  form.dataset.documentId=doc.id;form.dataset.notebookId=scopeAtOpen.id;form.dataset.nodeId=node.id;document.body.append(form);
  const status=form.querySelector('[role=status]'),channel=form.querySelector('[name=channel]');let submitting=false,controls,mentions,sources;
  status.textContent='';
  const saveFeedback=createGenerationSaveFeedback({status,notebookId:scopeAtOpen.id,documentId:doc.id,nodeId:node.id});
  const referenceNodes=()=>{const byId=new Map(doc.canvas.nodes.map(n=>[n.id,n]));return references.map(id=>byId.get(id));};
  const scopeKey=JSON.stringify(scopeAtOpen),pendingId=pendingKey(scopeAtOpen,node.id);
  const activeJob=()=>{let latest;for(const job of jobCache.get(scopeKey)||[])if(job.target?.nodeId===node.id&&generationJobBlocksSubmit(job)&&(!latest||String(job.createdAt)>String(latest.createdAt)))latest=job;return latest;};
  const syncSubmit=()=>{const job=activeJob(),sending=submittingCards.has(pendingId),pending=pendingSubmissions.has(pendingId),checking=!checkedScopes.has(scopeKey),locked=sending||pending||checking||!!job;form.dataset.generationLocked=String(locked);form.dataset.generationLockLabel=sending?'正在提交…':checking?'正在核对…':job?(job.status==='complete'?'等待落板':labels[job.status]||'等待核对'):pending?'等待核对':'生成';controls?.refreshAvailability();return locked;};
  syncSubmit();
  const capture=()=>{if(JSON.stringify(scopeAtOpen)!==JSON.stringify(scope())){form.remove();throw Error('当前白板已切换，生成栏已关闭');}const parameters=controls?.snapshot()||{},value={...saved,...parameters,...Object.fromEntries(new FormData(form)),...mentions?.snapshot(),includeTargetReference:false,webSearchEnabled:parameters.webSearchEnabled===true,multiframeTransitions:parameters.multiframeTransitions||[],references:[...references],referenceEdgeIds:referenceState.referenceEdgeIds,referenceExcludedIds:referenceState.referenceExcludedIds},canvas=context.current().canvas,previous=generationStoredDraft(context.current(),node);if(draftContent(value)===draftContent(previous))return {...value,updatedAt:previous.updatedAt};value.updatedAt=new Date().toISOString();canvas.coreGenerationDrafts??={};canvas.coreGenerationDrafts[node.id]={...value,channels:{...previous?.channels,[value.channel]:value}};context.markDirty();saveFeedback.changed(value);return value;};
  controls=mountGenerationControls(form,{profiles,saved,loadAudioVoices:async profileId=>{await api('/models/catalog',{profileId,refresh:true});await refreshProfiles?.();},references:referenceNodes,currentNodeId:node.id,libTvSources:()=>doc.canvas.nodes.filter(n=>n.kind==='video'&&n.coreMediaJobId),libTvDocuments:()=>doc.canvas.nodes.filter(n=>n.file&&!['image','video','audio'].includes(n.kind)),changed:()=>{mentions?.refresh();const value=capture();if(['image','video'].includes(value.channel)&&value.aspectRatio!=='auto'){const before={...node};if(generationCardRatio(before,value.channel,value.aspectRatio)){context.recordBoardUndo?.();generationCardRatio(node,value.channel,value.aspectRatio);doc.canvas.coreLastMediaAspectRatio=value.aspectRatio;context.refreshBoard?.();}}}});
  const renderRefs=()=>{form.classList.toggle('has-references',references.length>0);replaceReferenceMarkup(form.querySelector('[data-generation-references]'),references.map((id,i)=>{const n=doc.canvas.nodes.find(n=>n.id===id);return `<div class="generation-reference-tile" draggable="true" data-reference-id="${h(id)}" tabindex="0" aria-label="参考 ${i+1}，拖拽排序，双击预览" title="${h((i+1)+'. '+(n?.name||id))}">${n?.file&&n.kind==='image'?`<img src="${h(context.assetUrl(n.file,doc.id))}" alt="${h(n.name||'参考图片')}">`:n?.file&&n.kind==='video'?`<video class="generation-reference-video" src="${h(context.assetUrl(n.file,doc.id))}" preload="metadata" muted playsinline aria-label="${h(n.name||'参考视频')}"></video><span class="generation-reference-video-mark" aria-hidden="true">▶</span>`:n?.file&&n.kind==='audio'?audioReferenceMarkup(context.assetUrl(n.file,doc.id),n.name||'参考音频'):`<span class="generation-reference-caption">${h(n?.text||n?.name||id)}</span>`}<span class="generation-reference-number">${i+1}</span><button type="button" class="generation-reference-remove" data-reference-remove="${i}" aria-label="移除参考">×</button></div>`;}).join(''),context.toast);controls.refreshReferences();mentions?.refresh();sources?.refresh();updateCount();};
  const persist=async()=>{capture();return context.flush();};
  let draggingReference='';
  const previewReference=async id=>{const ref=doc.canvas.nodes.find(n=>n.id===id);if(!ref)throw Error('参考卡片已不存在');let text=ref.text||'';if(ref.reference?.documentId){const source=await context.api('/api/state?id='+encodeURIComponent(ref.reference.notebookId||scopeAtOpen.id));text=source.state.documents[ref.reference.documentId]?.markdown||text;}openAttachmentPreview({...ref,text},{assetUrl:path=>context.assetUrl(path,doc.id),toast:context.toast});};
  const tray=form.querySelector('[data-generation-references]');
  tray.ondblclick=e=>{const tile=e.target.closest('[data-reference-id]');if(tile&&!e.target.closest('button'))void previewReference(tile.dataset.referenceId).catch(error=>context.toast(error.message));};
  tray.ondragstart=e=>{const tile=e.target.closest('[data-reference-id]');if(!tile||e.target.closest('button')){e.preventDefault();return;}draggingReference=tile.dataset.referenceId;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-shensi-reference',draggingReference);tile.classList.add('dragging');};
  tray.ondragover=e=>{if(!draggingReference)return;e.preventDefault();e.dataTransfer.dropEffect='move';const tile=e.target.closest('[data-reference-id]');for(const el of tray.children)el.classList.toggle('drop-target',el===tile);};
  tray.ondrop=e=>{if(!draggingReference)return;e.preventDefault();const tile=e.target.closest('[data-reference-id]'),from=references.indexOf(draggingReference),to=tile?references.indexOf(tile.dataset.referenceId):references.length-1;if(from>=0&&to>=0&&from!==to){references.splice(to,0,references.splice(from,1)[0]);renderRefs();capture();}draggingReference='';};
  tray.ondragend=()=>{draggingReference='';for(const el of tray.children)el.classList.remove('dragging','drop-target');};
  const savedStatus=e=>{if(form.isConnected&&JSON.stringify(scopeAtOpen)===JSON.stringify(scope())&&e.detail?.error)saveFeedback.failed();};
  const committed=e=>{if(form.isConnected&&JSON.stringify(scopeAtOpen)===JSON.stringify(scope()))saveFeedback.committed(e.detail);};
  document.addEventListener('shensi:save-status',savedStatus);
  document.addEventListener('shensi:workspace-committed',committed);
  const saveObserver=new MutationObserver(()=>{if(!form.isConnected){disposeReferenceAudio(form);saveFeedback.dispose();document.removeEventListener('shensi:workspace-committed',committed);document.removeEventListener('shensi:save-status',savedStatus);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);saveObserver.disconnect();}});saveObserver.observe(document.body,{childList:true});
  const updateCount=()=>{const input=form.querySelector('[name=prompt]');form.querySelector('[data-generation-prompt-count]').textContent='已选 '+Math.abs(input.selectionEnd-input.selectionStart)+' 字 · 共 '+input.value.length+' 字';};form.querySelector('[name=prompt]').onselect=updateCount;mentions=mountGenerationMentions(form,{assetUrl:path=>context.assetUrl(path,doc.id),saved,nodes:()=>referenceNodes().filter(Boolean),changed:()=>{updateCount();capture();}});sources=mountGenerationSources(form,{context,doc,target:node,references,scope:scopeAtOpen,removed:ids=>{referenceState.referenceExcludedIds=[...new Set([...referenceState.referenceExcludedIds,...ids])];},changed:()=>{referenceState.referenceExcludedIds=referenceState.referenceExcludedIds.filter(id=>!references.includes(id));renderRefs();capture();}});renderRefs();
  form.oninput=event=>{if(event.target===channel)return;try{updateCount();capture();}catch(error){context.toast(error.message);}};
  channel.onchange=event=>{event.stopPropagation();const nextChannel=channel.value;channel.value=channelAtOpen;capture();disposeReferenceAudio(form);form.remove();layout.dispose();session=null;void draft({channel:nextChannel}).catch(error=>context.toast(error.message));};
  form.querySelector('[name=profileId]').onchange=()=>{controls.refresh();capture();creditHeader();};
  form.querySelector('[data-generation-add-reference]').onchange=e=>{if(e.target.value&&!references.includes(e.target.value))references.push(e.target.value);referenceState.referenceExcludedIds=referenceState.referenceExcludedIds.filter(id=>!references.includes(id));e.target.value='';renderRefs();capture();};
  form.onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{
   if(b.hasAttribute('data-generation-close')){node.coreGenerationAutoOpenDisabled=true;context.markDirty();dismiss();return;}
   if(submitting)return;
   if(b.dataset.referenceMention){mentions.insert(b.dataset.referenceMention);return;}
   if(b.hasAttribute('data-generation-expand')){const expanded=form.classList.toggle('generation-expanded'),label=expanded?'退出居中展开':'居中展开生成窗口';b.setAttribute('aria-expanded',String(expanded));b.setAttribute('aria-label',label);b.title=label;b.innerHTML=`${uiGlyph(expanded?'E73F':'E740','original-icon')}`;layout.position();return;}
   if(b.dataset.referencePreview){const ref=doc.canvas.nodes.find(n=>n.id===b.dataset.referencePreview);if(!ref)throw Error('参考卡片已不存在');let text=ref.text||'';if(ref.reference?.documentId){const source=await context.api('/api/state?id='+encodeURIComponent(ref.reference.notebookId||scopeAtOpen.id));text=source.state.documents[ref.reference.documentId]?.markdown||text;}openAttachmentPreview({...ref,text},{assetUrl:path=>context.assetUrl(path,doc.id),toast:context.toast});return;}
   if(b.hasAttribute('data-generation-save')){await persist();return;}
   if(b.dataset.referenceRemove!==undefined){const [removed]=references.splice(Number(b.dataset.referenceRemove),1);if(removed)referenceState.referenceExcludedIds=[...new Set([...referenceState.referenceExcludedIds,removed])];}
   else if(b.dataset.referenceUp!==undefined||b.dataset.referenceDown!==undefined){const i=Number(b.dataset.referenceUp??b.dataset.referenceDown),j=i+(b.dataset.referenceUp!==undefined?-1:1);[references[i],references[j]]=[references[j],references[i]];}else return;
   renderRefs();capture();
  }catch(error){status.textContent=error.message;}};
  form.onsubmit=async e=>{e.preventDefault();if(!form.isConnected||syncSubmit())return;if(sources.busy){showGenerationNotice('参考文件仍在上传，请等待上传完成后生成。');return;}submitting=true;submittingCards.add(pendingId);
   const submissionId='submit-'+crypto.randomUUID(),attempt={scope:scopeAtOpen,nodeId:node.id,nodeName:node.name,submissionId,createdAt:new Date().toISOString(),channel:channel.value,profileId:form.querySelector('[name=profileId]').value,dispatched:false,cancelled:false};submissionAttempts.set(submissionId,attempt);pendingSubmissions.set(pendingId,attempt);rememberPending();paintCards();syncSubmit();let dispatched=false;try{
   await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));if(attempt.cancelled)return;
   const value=capture();if(!value.profileId)throw Error('请先选择模型配置');const invalid=controls.validationMessage();if(invalid)throw Error(invalid);if(!(await context.flush()))throw Error('白板保存失败，本次生成未提交。请先解决保存问题后重试。');
   if(attempt.cancelled)return;
   if(JSON.stringify(scopeAtOpen)!==JSON.stringify(scope()))throw Error('当前白板已切换，草稿保留但未提交');
   dispatched=attempt.dispatched=true;rememberPending();const result=await api('/media/submit',{...scopeAtOpen,nodeId:node.id,...value,submissionId});if(attempt.cancelled){if(result.job?.id)await api('/media/stop',{...scopeAtOpen,jobId:result.job.id});return;}if(!result.job?.id)throw Error('提交回执缺少任务编号');pendingSubmissions.set(pendingId,{...attempt,jobId:result.job.id});rememberPending();watchedJobs.add(result.job.id);remember('core-media-watched-jobs',[...watchedJobs]);acceptTaskSnapshot(scopeKey,[result.job,...(jobCache.get(scopeKey)||[]).filter(j=>j.id!==result.job.id)]);paintCards();status.textContent=result.job.reused?'已关联原任务':'任务已保存并开始运行';await observe();
  }catch(error){
   if(attempt.cancelled)return;if(!dispatched&&pendingSubmissions.get(pendingId)?.submissionId===submissionId){pendingSubmissions.delete(pendingId);rememberPending();}
   if(dispatched){if(generationSubmissionRejected(error)){pendingSubmissions.delete(pendingId);rememberPending();}try{const result=await api('/media/list',scopeAtOpen);acceptTaskSnapshot(scopeKey,result.jobs);}catch{/* Unreadable is not failed: retain any uncertain submission ID and lock. */}}
   status.textContent='草稿已保留';showGenerationNotice(error.message+(pendingSubmissions.has(pendingId)?'\n提交结果尚未明确，生成按钮保持冻结；正在只读核对原任务，不会重新发送。':''),{title:'生成提醒',profileId:form.querySelector('[name=profileId]').value,credentialRequired:needsCredentialVerification(error)});
  }finally{submissionAttempts.delete(submissionId);submitting=false;if(!pendingSubmissions.has(pendingId)||pendingSubmissions.get(pendingId)?.submissionId===submissionId)submittingCards.delete(pendingId);paintCards();if(form.isConnected)syncSubmit();session?.syncSubmit?.();}};
  mountReferenceHover(form,{node:id=>doc.canvas.nodes.find(n=>n.id===id),assetUrl:path=>context.assetUrl(path,doc.id)});
  const layout=mountGenerationLayout(form,{context,doc,node,scope:scopeAtOpen});
  const intentChanged=node.generationIntent?.channel!==channelAtOpen||node.coreGenerationAutoOpenDisabled===true;node.generationIntent={...node.generationIntent,channel:channelAtOpen};delete node.coreGenerationAutoOpenDisabled;if(intentChanged)context.markDirty();const initial=capture();if(!stored.channel&&!node.file&&generationCardRatio(node,channelAtOpen,initial.aspectRatio)){context.refreshBoard?.();}creditHeader();
  // Closing a view never cancels a submission. Its guard belongs to the card,
  // including the save-before-submit interval, not to this disposable form.
  const dismiss=()=>{if(form.isConnected&&JSON.stringify(scopeAtOpen)===JSON.stringify(scope()))capture();disposeReferenceAudio(form);form.remove();layout.dispose();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);if(session?.form===form)session=null;return true;};
  const outside=event=>{if(!form.isConnected){dismiss();return;}if(form.contains(event.target)||event.target.closest('dialog,[popover]:popover-open,.context-menu'))return;clearTimeout(openTimer);if(event.target.closest('[data-node]')?.dataset.node===node.id){outsideCardClick=node.id;document.addEventListener('click',()=>setTimeout(()=>outsideCardClick='',0),{once:true,capture:true});}dismiss();};
  const escape=event=>{if(event.key==='Escape'&&form.isConnected&&!event.target.closest('dialog')){event.preventDefault();dismiss();}};
  session={form,nodeId:node.id,documentId:doc.id,notebookId:scopeAtOpen.id,channel:()=>channel.value,dismiss,syncSubmit,submit:async()=>{await observe();if(syncSubmit())throw Error('当前卡片正在核对或已有任务，未重复提交。');return form.onsubmit({preventDefault(){}});}};syncSubmit();void observe();
  let lastEdges=doc.canvas.edges,lastEdgeCount=lastEdges.length;
  const syncReferences=event=>{if(!form.isConnected){document.removeEventListener('shensi:board-layout',syncReferences);document.removeEventListener('shensi:workspace-committed',syncReferences);return;}if(JSON.stringify(scopeAtOpen)!==JSON.stringify(scope()))return;const canvas=context.current().canvas;if(event?.type!=='shensi:workspace-committed'&&canvas.edges===lastEdges&&canvas.edges.length===lastEdgeCount)return;doc.canvas=canvas;lastEdges=canvas.edges;lastEdgeCount=lastEdges.length;const next=reconcileConnectedReferences(canvas,node.id,{...referenceState,references});if(JSON.stringify(next)===JSON.stringify({...referenceState,references}))return;referenceState=next;references.splice(0,references.length,...next.references);renderRefs();capture();};
  document.addEventListener('shensi:board-layout',syncReferences);document.addEventListener('shensi:workspace-committed',syncReferences);
  const cleanupReferences=new MutationObserver(()=>{if(!form.isConnected){document.removeEventListener('shensi:board-layout',syncReferences);document.removeEventListener('shensi:workspace-committed',syncReferences);cleanupReferences.disconnect();}});cleanupReferences.observe(document.body,{childList:true});
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
  return session;
 }
 const selection=event=>{clearTimeout(openTimer);creditHeader();const id=event.detail?.nodeId,doc=context.current(),node=doc?.canvas?.nodes.find(n=>n.id===id);if(outsideCardClick&&outsideCardClick===id){outsideCardClick='';return;}if(!node){void session?.dismiss();return;}const channel=generationIntent(doc.canvas,node,doc.coreLegacyGenerationDrafts?.[id]);if(!channel){void session?.dismiss();return;}const selectedScope=JSON.stringify(scope());openTimer=setTimeout(()=>{if(selectedScope!==JSON.stringify(scope())||context.selectedNode()?.id!==id||!plugin()?.enabled)return;void draft({channel}).catch(error=>context.toast(error.message));},120);};
 document.addEventListener('shensi:board-selection',selection);
 const repaintBoard=()=>{cancelAnimationFrame(paintFrame);paintFrame=requestAnimationFrame(paintCards);};
 document.addEventListener('shensi:board-layout',repaintBoard);
 async function confirmParameters(j){const originalScope=JSON.stringify(scope()),{task}=await api('/doubao/confirmation',{taskId:j.providerTaskId});if(originalScope!==JSON.stringify(scope())||!plugin()?.enabled)return;if(task?.target?.jobId!==j.id||task.target.id!==scope().id||task.target.documentId!==j.target.documentId||task.target.nodeId!==j.target.nodeId)throw Error('原任务与当前卡片不匹配，未确认');const form=doubaoQuestionForm(task),answer=await context.modal(form.title,form.html,form.buttons,true);if(answer.value==='ok'&&originalScope===JSON.stringify(scope())&&plugin()?.enabled)await api('/doubao/confirm',doubaoQuestionReply(task,answer));}
 const canInspectOriginal=j=>j.source==='doubao-browser'&&!!j.providerTaskId&&j.status==='retry_required'&&!j.availableActions?.confirmParameters;
 async function inspectOriginal(j){
  const openedScope=JSON.stringify(scope()),{task}=await api('/doubao/task',{taskId:j.providerTaskId});
  if(openedScope!==JSON.stringify(scope())||!plugin()?.enabled)return;
  if(task?.id!==j.providerTaskId||task.target?.id!==scope().id||task.target?.jobId!==j.id||task.target?.documentId!==j.target.documentId||task.target?.nodeId!==j.target.nodeId)throw Error('原任务与当前卡片不匹配，未打开其他任务');
  const summary=task.confirmationDetails?.summary;
  const answer=await context.modal('查看豆包原任务',`${summary?'<pre style="white-space:pre-wrap">'+h(summary)+'</pre>':'<p>'+h(task.message||'请打开原任务查看网页状态')+'</p>'}<p>此前操作尚未收到网页回执。这里仅查看原参数，不会再次确认或重新发送。</p><p>点击“打开原任务”会显示独立的豆包账号窗口，请在原网页检查并手动完成待确认参数。</p>`,[['关闭','cancel'],['打开原任务','open']],true);
  if(answer.value==='open'&&openedScope===JSON.stringify(scope())&&plugin()?.enabled){await api('/doubao/open',{taskId:task.id,accountId:task.accountId});context.toast('已打开独立的豆包原任务窗口；此操作未发送或确认生成');}
 }
 function buttons(j){const id=h(j.id),button=(action,text,extra='')=>'<button data-media-action="'+action+'" data-job="'+id+'" '+extra+'>'+text+'</button>';if(j.source==='doubao-account-blocker')return mediaWaitingParameters(j)?button('open-account-confirmation','打开原任务确认')+button('stop','停止'):'';if(j.abandonPendingAt||j.forceReleasePendingAt&&!j.forceReleaseCompletedAt)return '';return button('locate','↗ 跳转任务','title="打开所属白板或对话"')+
  (mediaCardOutcome(j).startsWith('recover')?button('recover',j.recoveryState==='running'?'正在找回…':'找回',j.recoveryState==='running'?'disabled':''):'')+
  (j.availableActions?.confirmParameters?button('confirm-parameters',j.confirmation?.kind==='reference_authorization'?'确认素材声明':'确认生成参数'):'')+
  (canInspectOriginal(j)?button('inspect-original','查看待核对参数'):'')+
  (!mediaCardOutcome(j).startsWith('recover')&&j.availableActions?.resumeOriginal?button('resume',j.availableActions.retryPreparation?'重试发送前准备':'续查原任务'):'')+
  button(mediaCardOutcome(j).startsWith('recover')?'abandon':'stop',mediaCardOutcome(j).startsWith('recover')?'放弃':'停止','class="media-queue-abandon"');}
 async function confirmAbandon(jobs,bulk=false){const answer=await context.modal(bulk?'清除失败任务':'放弃任务',
  '<p>'+ (bulk?'确认清除这 '+jobs.length+' 个失败或阻塞项？正常运行和排队任务不会被批量清除。':'确认放弃此任务？会停止本地执行和回写，结束本地阻塞。')+'</p>'+
  '<p>保留卡片、提示词、参考、原错误和已生成结果，不重发旧单。已提交的远端任务可能继续生成或扣费；释放后其他已排队任务可按原顺序继续。</p>',
  [['取消','cancel'],[bulk?'清除失败任务':'放弃任务','abandon']],true);return answer.value==='abandon';}
 async function stopJob(j,targetScope){if(mediaStopNeedsConfirmation(j)){const answer=await context.modal('停止正在生成的任务？','<p>供应商已进入生成阶段，停止后可能仍产生费用。确认后立即停止本地任务并解除占用。</p>',[['继续生成','cancel'],['确认停止','stop']],true);if(answer.value!=='stop')return {cancelledByUser:true};}if(j.source==='local-submission'){const p=[...pendingSubmissions.values()].find(p=>p.submissionId===j.submissionId);return p?cancelPending(p):{localStopped:true};}const result=await api('/media/stop',{...targetScope,jobId:j.id});if(result.job)updateQueueJob(result.job);if(result.warning)context.toast(result.warning);return result;}
 function updateQueueJob(job){if(!job)return;for(const [key,rows]of jobCache)if(rows.some(j=>j.id===job.id))acceptTaskSnapshot(key,rows.map(j=>j.id===job.id?{...j,...job}:j));paintCards();}
 async function queue(){if(!plugin()?.enabled)return;const body=mediaDialog('任务队列');body.dataset.mediaQueue='true';const cached=queueSnapshot||{jobs:[...new Map([...jobCache.values()].flat().map(j=>[j.id,j])).values()],errors:[]};await renderQueue(body,cached);void renderQueue(body).catch(error=>context.toast(error.message));}
 async function renderQueue(body,data){
  if(body.dataset.queueBusy==='true'||body.dataset.queueDragging)return;
  const renderId=body.queueRenderEpoch=(body.queueRenderEpoch||0)+1;
  const epoch=taskEpoch,queueScope=body.dataset.queueScope?JSON.parse(body.dataset.queueScope):{id:context.libraryId()};body.dataset.queueScope=JSON.stringify(queueScope);
  const result=data||await readNotebookMediaQueue(api,queueScope.id,context.includeDocumentTasks?.(),true);
  if(epoch!==taskEpoch)return;if(!data)queueSnapshot=result;
  if(!body.isConnected||renderId!==body.queueRenderEpoch||body.dataset.queueBusy==='true'||body.dataset.queueDragging)return;
  const jobs=sortMediaQueue(mergeLocalSubmissions(result.jobs).filter(visibleMediaQueueTask)),candidates=result.jobs.filter(clearableMediaQueueTask),scroll=body.scrollTop;
  const row=j=>{const group=mediaQueueGroup(j),tone=group==='attention'?'red':group==='queued'?'blue':'green';
   return '<section class="setting-block media-job" data-queue-job="'+h(j.id)+'" data-tone="'+tone+'"><header>'+(mediaQueueCanReorder(j)?'<button class="media-queue-drag" data-queue-drag="'+h(j.id)+'" draggable="true" aria-label="调整排队顺序" title="拖拽调整排队顺序（键盘：Alt+↑/↓）">⠿</button>':'')+'<b '+(j.source!=='doubao-account-blocker'&&(j.target?.nodeName||j.target?.documentTitle)?'data-user-content':'')+'>'+(j.queuePosition?'#'+j.queuePosition+' ':'')+h(j.target?.nodeName||j.target?.documentTitle||'卡片')+'</b><span>'+h(j.abandonPendingAt?'正在停止 · 等待本地释放':j.queueStage||caption(j))+'</span></header>'+
   '<p class="media-job-path" data-user-content title="'+h(taskPath(j))+'">'+h(taskPath(j))+'</p><small data-user-content>'+h(j.queueProfileName||j.request?.settings?.name||j.profileId)+' · '+h(j.request?.settings?.model)+'</small>'+
   (Number.isFinite(j.progressPercent)?'<progress aria-label="任务进度" max="100" value="'+Math.max(0,Math.min(100,j.progressPercent))+'"></progress>':'')+
   (j.message?'<p>'+h(j.message)+'</p>':'')+(j.failureReason?'<p class="error">'+h(j.failureReason)+'</p>':'')+
   (j.providerErrorCode?'<p class="media-job-error-code"><small>错误代码：'+h(j.providerErrorCode)+'</small></p>':'')+
   (j.validationRejectedAt?'<p><small>本地前检未通过，未创建厂商生成任务。</small></p>':'')+
   (j.providerRawError?'<details><summary>源错误</summary><p>'+h(j.providerRawError)+'</p></details>':'')+
   (j.error||j.cardApplyError?'<p class="error">'+h(j.cardApplyError||j.error)+'</p>':'')+
   (j.recoveryError?'<p class="error">'+h('找回失败：'+j.recoveryError)+'</p>':'')+
   (j.webResultError?'<p class="error">'+h('原图读取：'+j.webResultError)+'</p>':'')+
   (j.billingRisk?'<p>远端状态或费用待核对；不会自动重新提交。</p>':'')+
   '<div class="setting-inline media-job-actions">'+(needsCredentialVerification(j)?'<button data-media-verify="'+h(j.profileId)+'">一键核验</button>':'')+buttons(j)+'</div></section>';};
  body.innerHTML=(result.errors||[]).map(error=>'<p class="error">'+h(error)+'</p>').join('')+
   '<div class="setting-inline media-queue-header"><p>全部笔记本 · '+jobs.length+' 个任务</p><button data-media-clear-failed '+(!candidates.length||result.errors?.length?'disabled':'')+'>清除失败任务'+(candidates.length?'（'+candidates.length+'）':'')+'</button><button data-media-refresh>刷新</button></div>'+
   '<p class="media-queue-legend">绿色：正在生成 · 蓝色：等待执行或确认 · 红色：成品待取回（不占生成位置）</p><output class="media-queue-result" aria-live="polite">'+h(body.dataset.queueMessage||'')+'</output>'+
   ['running','queued','attention'].map(group=>{const items=jobs.filter(j=>mediaQueueGroup(j)===group);return items.length?'<section class="media-queue-group" data-media-task-group="'+group+'"><h3>'+({running:'正在生成',queued:'等待执行',attention:'需要处理'})[group]+'（'+items.length+'）</h3>'+items.map(row).join('')+'</section>':'';}).join('')+
   (!jobs.length?'<div class="plugin-empty">暂无生成任务</div>':'');
  body.scrollTop=scroll;
  const queueJob=element=>jobs.find(j=>j.id===element?.closest('[data-queue-job]')?.dataset.queueJob);
  const clearDrop=()=>body.querySelectorAll('[data-queue-drop]').forEach(el=>delete el.dataset.queueDrop);
  const clearDrag=()=>{delete body.dataset.queueDragging;clearDrop();body.querySelectorAll('.media-job-dragging').forEach(el=>el.classList.remove('media-job-dragging'));};
  const moveQueued=async(job,target,placement)=>{
   if(body.dataset.queueBusy==='true'||!mediaQueueCanReorder(job)||!mediaQueueCanReorder(target)||job.id===target.id)return;
   body.dataset.queueBusy='true';
   try{await api('/media/reorder',{...mediaQueueTaskScope(job,queueScope),jobId:job.id,targetJobId:target.id,placement});body.dataset.queueMessage='排队顺序已保存';}
   catch(error){body.dataset.queueMessage=error.message;context.toast(error.message);}
   finally{body.dataset.queueBusy='false';if(body.isConnected)await renderQueue(body).catch(error=>context.toast(error.message));}
  };
  body.ondragstart=e=>{
   const handle=e.target.closest('[data-queue-drag]'),job=queueJob(handle);
   if(!handle||body.dataset.queueBusy==='true'||!job||!mediaQueueCanReorder(job)){e.preventDefault();return;}
   body.dataset.queueDragging=job.id;handle.closest('[data-queue-job]').classList.add('media-job-dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',job.id);
  };
  body.ondragover=e=>{
   const target=queueJob(e.target);clearDrop();
   if(!body.dataset.queueDragging||body.dataset.queueBusy==='true'||!target||!mediaQueueCanReorder(target)||target.id===body.dataset.queueDragging)return;
   e.preventDefault();e.dataTransfer.dropEffect='move';const row=e.target.closest('[data-queue-job]'),rect=row.getBoundingClientRect();row.dataset.queueDrop=e.clientY<rect.top+rect.height/2?'before':'after';
   const bounds=body.getBoundingClientRect();if(e.clientY<bounds.top+32)body.scrollTop-=20;else if(e.clientY>bounds.bottom-32)body.scrollTop+=20;
  };
  body.ondrop=e=>{
   if(!body.dataset.queueDragging)return;e.preventDefault();const job=jobs.find(j=>j.id===body.dataset.queueDragging),target=queueJob(e.target),placement=e.target.closest('[data-queue-drop]')?.dataset.queueDrop;clearDrag();
   if(job&&target&&placement)void moveQueued(job,target,placement);
  };
  body.ondragend=()=>{clearDrag();if(body.isConnected&&body.dataset.queueBusy!=='true')void renderQueue(body).catch(error=>context.toast(error.message));};
  body.onkeydown=e=>{
   if(!e.target.closest('[data-queue-drag]')||!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
   const job=queueJob(e.target),pending=jobs.filter(mediaQueueCanReorder),target=pending[pending.indexOf(job)+(e.key==='ArrowUp'?-1:1)];
   if(job&&target)void moveQueued(job,target,e.key==='ArrowUp'?'before':'after').then(()=>[...body.querySelectorAll('[data-queue-drag]')].find(el=>el.dataset.queueDrag===job.id)?.focus({preventScroll:true}));
  };
  body.onclick=async e=>{
   const b=e.target.closest('button');if(!b||b.disabled||b.hasAttribute('data-queue-drag')||body.dataset.queueBusy==='true'||body.dataset.queueDragging)return;
   const targetJob=jobs.find(j=>j.id===b.dataset.job),targetScope=targetJob?mediaQueueTaskScope(targetJob,queueScope):queueScope;
   body.dataset.queueBusy='true';b.disabled=true;
   try{
    if(b.dataset.mediaAction==='recover'){await recoverCard(targetJob,targetScope);return;}
    if(b.dataset.mediaAction==='stop'){await stopJob(targetJob,targetScope);await observe();return;}
    if(b.dataset.mediaAction==='open-account-confirmation'){await api('/doubao/open',{taskId:targetJob.providerTaskId,accountId:targetJob.accountId});return;}
    if(b.dataset.mediaVerify){await openModelVerification(context,b.dataset.mediaVerify,{accountId:queueJob(b)?.accountId});return;}
    if(b.dataset.mediaAction==='retry-current'){await openVideoRetryFromCurrent({job:targetJob,targetScope,api,context,openDraft:draft,closeQueue:()=>{body.closest('dialog')?.close();body.closest('dialog')?.remove();}});return;}
    if(b.dataset.mediaAction==='locate'){await context.locateMediaTask(targetJob,targetScope);body.closest('dialog')?.close();body.closest('dialog')?.remove();return;}
    if(b.hasAttribute('data-media-clear-failed')){
     if(!await confirmAbandon(candidates,true))return;
     const grouped=new Map();for(const j of candidates){const s=mediaQueueTaskScope(j,queueScope),key=JSON.stringify({id:s.id,pluginId:s.pluginId});if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(j);}
     const totals={cleared:0,skipped:0,pending:0,error:0};
     // Cancel selected blocked dependents before freeing their orphan account owner.
     const batches=[...grouped].sort(([a],[b])=>Number(JSON.parse(a).pluginId==='thirdparty.doubao')-Number(JSON.parse(b).pluginId==='thirdparty.doubao'));
     const failures=[];for(const [key,items]of batches)for(let i=0;i<items.length;i+=50){const batch=items.slice(i,i+50);try{const out=await api('/media/clear-failed',{...JSON.parse(key),confirmed:true,items:batch.map(j=>({jobId:j.id,updatedAt:j.updatedAt}))});for(const result of out.outcomes){totals[result.status]++;updateQueueJob(result.job);if(result.status==='error')failures.push(result.message);}}catch(error){totals.error+=batch.length;failures.push(error.message);}}
     const message='已清除 '+totals.cleared+' 个，状态变化跳过 '+totals.skipped+' 个，等待停止 '+totals.pending+' 个，未完成 '+totals.error+' 个。原记录与结果保留。'+[...new Set(failures)].join('；');body.dataset.queueMessage=message;context.toast(message);
    }else if(b.dataset.mediaAction==='abandon'){
     const outcome=await api('/media/abandon',{...targetScope,jobId:targetJob.id,expectedUpdatedAt:targetJob.updatedAt,confirmed:true});updateQueueJob(outcome.job);
     body.dataset.queueMessage=outcome.warning||'已放弃任务，本地阻塞已结束，原记录与结果保留。';context.toast(body.dataset.queueMessage);
    }else if(['confirm-parameters','inspect-original'].includes(b.dataset.mediaAction)){
     if(targetScope.id!==context.libraryId()||targetJob.target?.documentId!==context.current()?.id){await context.locateMediaTask(targetJob,targetScope);body.closest('dialog')?.close();body.closest('dialog')?.remove();context.toast('已定位原任务，请在原白板核对参数');return;}
     if(b.dataset.mediaAction==='inspect-original')await inspectOriginal(targetJob);else await confirmParameters(targetJob);
    }else if(b.dataset.mediaAction){
     const outcome=await api('/media/'+b.dataset.mediaAction,{...targetScope,jobId:targetJob.id});
     if(outcome.result&&targetScope.id===context.libraryId()&&!context.isDirty())context.applyResult(outcome.result);
    }
   }catch(error){body.dataset.queueMessage=error.message;context.toast(error.message);}
   finally{body.dataset.queueBusy='false';b.disabled=false;if(body.isConnected)await renderQueue(body).catch(error=>context.toast(error.message));}
  };
 }
 let warmedCreditEpoch=-1;
 async function warmCredits(){
  if(!plugin()?.enabled||warmedCreditEpoch===creditEpoch)return;const epoch=creditEpoch;warmedCreditEpoch=epoch;
  try{const result=await api('/media/credits',{refresh:false});if(epoch!==creditEpoch)return;credits=mergeAccountCreditSnapshots(credits,result.profiles||[]);officialCredit=result.official||officialCredit;creditHeader();}catch{/* Cached balance is optional; opening the dialog can retry. */}
 }
 async function showCredits(){
  if(!plugin()?.enabled){context.toast('请启用白板生成插件后查询账号积分');return;}
  const body=mediaDialog('账号积分');body.dataset.mediaCredits='true';let busy=false,error='';
  const paint=()=>{
   if(!body.isConnected)return;
   const rows=accountCreditRows([...credits,...(officialCredit?[{...officialCredit,profileId:'official-compute',accountId:'official-compute',provider:'官方算力'}]:[])]);
   body.innerHTML=rows.map(p=>'<section class="setting-block"><h3>'+h(p.accountName||p.names.join(' / '))+'</h3><strong>'+h(p.credit)+' 积分</strong><p>'+h(p.error||p.state||'')+'</p><small>'+(p.liveVerified?'实时读取':'保存的快照')+' '+h(p.creditUpdatedAt)+'</small></section>').join('')+(!rows.length?'<p>暂无已获取的积分快照</p>':'')+'<p class="muted">只显示已获取的余额；同一真实账号合并显示，余额不相加。刷新只查询余额，不切换账号或生成内容。</p><output role="status">'+h(error||(busy?'正在后台刷新积分…':''))+'</output><button data-credit-refresh '+(busy?'disabled':'')+'>刷新全部账号积分</button>';
   const unavailable=[...new Set(credits.filter(p=>p.creditQuerySupported===false&&p.error).map(p=>p.error))];
   for(const reason of unavailable){const note=document.createElement('p');note.className='muted';note.dataset.creditUnavailable='true';note.textContent=reason;body.querySelector('[data-credit-refresh]').before(note);}
   body.querySelector('[data-credit-refresh]').onclick=()=>void refresh(true);
  };
  const refresh=async live=>{if(busy)return;busy=true;error='';paint();try{const epoch=creditEpoch,result=await api('/media/credits',{refresh:live});if(epoch!==creditEpoch){error='账号或配置已变化，请重新打开积分页面。';return;}credits=mergeAccountCreditSnapshots(credits,result.profiles||[]);officialCredit=result.official||officialCredit;creditHeader();}catch(e){error=e.message;}finally{busy=false;paint();}};
  paint();await refresh(false);if(body.isConnected&&!error)void refresh(true);
 }
 function creditHeader(){
  if(!context.current()?.canvas)return;
  const controls=document.querySelector('.whiteboard-account-controls');if(!controls)return;
  const profile=selectedProfile();
  let b=controls.querySelector('[data-action="official-credits"]');
  if(!b){b=document.createElement('button');b.dataset.action='official-credits';controls.prepend(b);}
  const id=profile?.id||'official-compute',key=creditEpoch+':'+id+':'+(profile?.updatedAt||''),epoch=creditEpoch;
  const shown=profile?(profile.memberRef?officialCredit:credits.find(row=>row.profileId===id)):officialCredit;
  b.title=creditErrors.get(key)||(knownAccountCredit(shown)?(shown.liveVerified?'实时读取':'保存的积分快照')+(shown.creditUpdatedAt?' · '+shown.creditUpdatedAt:'')+'；点击查看全部已获取积分':'点击查看全部已获取积分');b.setAttribute('aria-label','查看全部积分');b.hidden=false;
  const text=selectedAccountCreditLabel(profile,credits,officialCredit);if(b.textContent!==text)b.textContent=text;
  if(!plugin()?.enabled)return;
  const supports=!profile||profile.memberRef||['即梦','LibTV'].includes(profile.provider);if(!supports)return;
  if(creditPending.has(key)||Date.now()-(creditChecked.get(key)||0)<(creditErrors.has(key)?15000:60000))return;
  creditRequest=key;creditPending.set(key,true);b.setAttribute('aria-busy','true');
  void readSelectedAccountCredits(api,id,!!profile,result=>{
   if(epoch!==creditEpoch)return;
   credits=mergeAccountCreditSnapshots(credits,result.profiles||[]);officialCredit=result.official||null;
   const row=profile?.memberRef?officialCredit:credits.find(p=>p.profileId===id);if(profile&&(row?.error||!knownAccountCredit(row)))creditErrors.set(key,row?.error||'暂未取得此配置的积分，点击查看或刷新');else creditErrors.delete(key);creditHeader();
  }).catch(error=>{if(epoch===creditEpoch)creditErrors.set(key,'积分查询失败：'+error.message+'；点击后可重试');}).finally(()=>{
   creditPending.delete(key);if(epoch===creditEpoch){creditChecked.set(key,Date.now());b.removeAttribute('aria-busy');creditHeader();}
  });
 }
 const cardActionsPending=new Set();
 async function recoverCard(job,targetScope){
  const result=await api('/media/recover',{...targetScope,jobId:job.id,nodeId:job.target.nodeId});updateQueueJob(result.job);await observe();
 }
 function paintCardActions(card,job,outcome){
  let actions=card.querySelector('.media-card-actions');
  if(!outcome){actions?.remove();return;}
  if(!actions){actions=document.createElement('div');actions.className='media-card-actions';card.append(actions);actions.onpointerdown=e=>e.stopPropagation();}
  const state=job.id+':'+outcome+':'+cardActionsPending.has(job.id);
  if(actions.dataset.state===state)return;actions.dataset.state=state;
  const busy=cardActionsPending.has(job.id),recover=outcome!=='failed',doubaoOriginal=job.source==='doubao-browser'&&!!job.providerTaskId;
  const originalButton=doubaoOriginal?'<button data-card-action="original" '+(busy?'disabled':'')+'>打开原网页</button>':'';
  const pageResultButton=doubaoOriginal&&outcome==='failed'?'<button data-card-action="recover" '+(busy?'disabled':'')+'>找回</button>':'';
  actions.innerHTML='<div class="media-card-action-buttons"><button data-card-action="'+(recover?'recover':'retry')+'" '+(busy||outcome==='recovering'?'disabled':'')+'>'+(outcome==='recovering'?'正在找回…':recover?'找回':'重试')+'</button>'+((outcome==='recovery-failed'||outcome==='failed')?originalButton+pageResultButton:'')+'<button data-card-action="abandon" '+(busy?'disabled':'')+'>放弃</button></div><output class="media-card-action-error" role="status"></output>';
  const targetScope={...scope()};
  actions.onclick=async e=>{e.stopPropagation();const button=e.target.closest('[data-card-action]');if(!button||button.disabled||cardActionsPending.has(job.id))return;cardActionsPending.add(job.id);for(const b of actions.querySelectorAll('button'))b.disabled=true;
   try{
    if(button.dataset.cardAction==='retry')await retryMediaCardFromCurrent({job,targetScope,api,context,openDraft:draft});
    else if(button.dataset.cardAction==='recover')await recoverCard(job,targetScope);
    else if(button.dataset.cardAction==='original'){const result=await api('/media/open-original',{...targetScope,jobId:job.id,nodeId:job.target.nodeId});if(result.url&&!result.opened)await context.api('/api/open-link',{url:result.url});}
    else {const {jobs}=await api('/media/list',targetScope),fresh=jobs.find(j=>j.id===job.id);if(!fresh)throw Error('原任务不存在');const result=await api('/media/abandon',{...targetScope,jobId:fresh.id,nodeId:fresh.target.nodeId,expectedUpdatedAt:fresh.updatedAt,confirmed:true});updateQueueJob(result.job);}
    await observe();
   }catch(error){context.toast(error.message);const output=actions.querySelector('output');if(output)output.textContent=error.message;
   }finally{cardActionsPending.delete(job.id);for(const b of actions.querySelectorAll('button'))b.disabled=b.dataset.cardAction==='recover'&&outcome==='recovering';delete actions.dataset.state;}
  };
 }
 const definitiveTerminal=job=>{
  if(!job)return false;
  if(['cancelled','stopped','superseded'].includes(job.status))return !!(job.stoppedAt||job.userStoppedAt||job.userAbandonedAt||job.queueDismissedAt||job.accountSlotReleasedAt);
  if(job.status==='failed')return !!(job.failedAt||job.autoFailedAt||job.failureReason||job.error||job.providerErrorCode||job.providerRawError);
  return job.status==='complete'&&!!job.appliedAt;
 };
 const cardDisplayJobs=new Map();
 function paintCards(){
  if(!plugin()?.enabled||!context.current()?.canvas)return;const latest=currentMediaCardJobs(mergeLocalSubmissions(jobCache.get(JSON.stringify(scope()))||[]).filter(j=>(!j.notebookId||j.notebookId===context.libraryId())&&j.target?.documentId===context.current()?.id),context.current().canvas.nodes);
  for(const node of context.current().canvas.nodes){
   const currentJob=latest.get(node.id),previous=cardDisplayJobs.get(node.id);
   if(currentJob&&['failed','cancelled','stopped','superseded'].includes(currentJob.status)&&!definitiveTerminal(currentJob)&&previous&&previous.id===currentJob.id&&!definitiveTerminal(previous))latest.set(node.id,previous);
   else if(currentJob)cardDisplayJobs.set(node.id,currentJob);
   else if(previous&&!definitiveTerminal(previous))latest.set(node.id,previous);
  }
  const cards=new Map([...document.querySelectorAll('[data-node]')].map(card=>[card.dataset.node,card]));
  cardJobs.clear();
  for(const badge of document.querySelectorAll('.media-card-status')){const card=badge.closest('[data-node]'),j=latest.get(card?.dataset.node);if(!j||mediaCardHidden(j)||acknowledged.has(j.id)&&j.appliedAt)card?.querySelectorAll('.media-card-status,.media-card-stop,.media-card-confirm,.media-card-actions').forEach(el=>el.remove());}
  for(const [nodeId,j] of latest){const card=cards.get(nodeId);if(!card||mediaCardHidden(j)||acknowledged.has(j.id)&&j.appliedAt)continue;
   const ensure=(cls,tag='button')=>{let el=card.querySelector('.'+cls);if(el&&el.tagName!==tag.toUpperCase()){el.remove();el=null;}if(!el){el=document.createElement(tag);el.className=cls;card.append(el);}return el;};
   const badge=ensure('media-card-status','div');badge.dataset.job=j.id;badge.dataset.complete=String(!!j.appliedAt);badge.setAttribute('role','status');badge.setAttribute('aria-live','off');badge.title=[j.cardApplyError,j.failureReason,j.providerRawError,j.error,j.message].filter(Boolean).join('；')||caption(j);cardJobs.set(j.id,j);
   const outcome=mediaCardOutcome(j),reason=outcome&&outcome!=='recovering'?mediaCardFailureReason(j):j.observationPausedAt?j.observationError:'';
   badge.dataset.failed=String(outcome==='failed'||outcome==='recovery-failed');badge.dataset.outcome=outcome;
   const title={failed:'生成失败',recoverable:mediaOriginalResultPending(j)?'原任务结果待找回':'生成成功 · 成品待找回',recovering:'正在找回原成品', 'recovery-failed':'找回失败'}[outcome]||caption(j);
   const summary=j.appliedAt?j.resultNotice||'':title+(reason?'：'+reason:(!outcome&&!['failed','cancelled','stopped','superseded'].includes(j.status)&&Number.isFinite(j.progressPercent)?' · '+Math.max(0,Math.min(100,j.progressPercent))+'%':''));
   let stateLabel=badge.querySelector('.media-card-state'),clock=badge.querySelector('.media-card-clock');
   if(!stateLabel||!clock){stateLabel=document.createElement('span');stateLabel.className='media-card-state';clock=document.createElement('span');clock.className='media-card-clock';badge.replaceChildren(stateLabel,clock);}
   if(stateLabel.textContent!==summary)stateLabel.textContent=summary;stateLabel.hidden=!summary;
   if(!outcome&&(j.availableActions?.confirmParameters||canInspectOriginal(j))){const confirm=ensure('media-card-confirm'),inspect=canInspectOriginal(j);confirm.textContent=inspect?'查看待核对参数':j.confirmation?.kind==='reference_authorization'?'确认素材声明':'确认生成参数';confirm.title=inspect?'查看原参数并打开豆包原任务，不会再次确认或发送':j.confirmation?.summary||'核对后开始生成';confirm.onclick=async e=>{e.stopPropagation();confirm.disabled=true;try{if(inspect)await inspectOriginal(j);else await confirmParameters(j);await observe();}catch(error){context.toast(error.message);}finally{if(confirm.isConnected)confirm.disabled=false;}};}else card.querySelector('.media-card-confirm')?.remove();
   if(!outcome&&mediaCardCanStop(j)&&visibleMediaTask(j)){const stop=ensure('media-card-stop');stop.textContent='■ 停止';stop.setAttribute('aria-label','停止此卡片生成');const targetScope={...scope()};stop.onclick=async e=>{e.stopPropagation();stop.disabled=true;try{await stopJob(j,targetScope);await observe();}catch(error){context.toast(error.message);}finally{if(stop.isConnected)stop.disabled=false;}};}else card.querySelector('.media-card-stop')?.remove();
   paintCardActions(card,j,outcome);
  }paintTimes();creditHeader();session?.syncSubmit?.();
 }
 function paintTimes(){
  if(!plugin()?.enabled||!context.current()?.canvas)return;let changed=false;
  for(const badge of document.querySelectorAll('.media-card-status')){const job=cardJobs.get(badge.dataset.job),clock=badge.querySelector('.media-card-clock');if(!job||!clock)continue;const time=mediaCardTime(job,Date.now(),frozenEnds.get(job.id));if(time.end!==undefined&&!frozenEnds.has(job.id)){frozenEnds.set(job.id,time.end);changed=true;}if(clock.textContent!==time.text)clock.textContent=time.text;}
  if(changed)remember('core-media-finished-times',[...frozenEnds]);
 }
 const acknowledgeCard=event=>{const badge=event.target.closest?.('[data-node]')?.querySelector('.media-card-status[data-complete="true"]');if(!badge)return;acknowledged.add(badge.dataset.job);remember('core-media-ack',[...acknowledged]);badge.remove();};
 document.addEventListener('click',acknowledgeCard,true);
 const clockTimer=setInterval(paintTimes,1000);
 const cardObserver=new MutationObserver(records=>{const selectors='.media-card-status,.media-card-stop,.media-card-confirm,.media-card-actions',decoration=n=>n.nodeType===1&&n.matches(selectors);if(records.some(r=>!r.target.closest?.(selectors)&&[...r.addedNodes,...r.removedNodes].some(n=>!decoration(n))&&(r.target.closest?.('[data-node]')||[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches('[data-node],.board')||n.querySelector('[data-node]')))))){cancelAnimationFrame(paintFrame);paintFrame=requestAnimationFrame(paintCards);}});cardObserver.observe(document.body,{childList:true,subtree:true});
 async function observe(){void warmCredits();creditHeader();const popup=document.querySelector('.whiteboard-generation-popover');if(popup&&(!plugin()?.enabled||popup.dataset.documentId!==context.current()?.id||popup.dataset.notebookId!==context.libraryId()))popup.remove();if(inFlight||!context.current()?.canvas||!plugin()?.enabled)return;inFlight=true;const epoch=taskEpoch,key=JSON.stringify(scope());try{const result=await api('/media/list',scope());if(epoch!==taskEpoch||key!==JSON.stringify(scope())||!plugin()?.enabled)return;const previous=new Map((jobCache.get(key)||[]).map(job=>[job.id,job]));result.jobs=result.jobs.map(j=>{const old=previous.get(j.id),{observationPausedAt,observationError,...current}=old&&Date.parse(old.updatedAt)>Date.parse(j.updatedAt)?old:j;return current;});acceptTaskSnapshot(key,result.jobs);if(jobCache.size>20)jobCache.delete(jobCache.keys().next().value);const applied=result.jobs.filter(j=>j.appliedAt||j.recallArchivedAt).map(j=>j.id+':'+(j.appliedAt||j.recallArchivedAt)).sort().join('|');if(applied&&applied!==lastApplied&&context.refreshWorkspace){if(await context.refreshWorkspace())lastApplied=applied;}else if(applied&&applied!==lastApplied&&!context.isDirty()){const loaded=await context.api('/api/state?id='+encodeURIComponent(context.libraryId()),undefined,false);if(key===JSON.stringify(scope())&&!context.isDirty()){lastApplied=applied;if(loaded.stateStamp!==context.stamp())context.applyResult(loaded);}}
  paintCards();for(const body of document.querySelectorAll('[data-media-queue]'))if(body.dataset.queueBusy!=='true')await renderQueue(body);
 }catch(error){if(epoch!==taskEpoch||key!==JSON.stringify(scope()))return;jobCache.set(key,(jobCache.get(key)||[]).map(j=>visibleMediaTask(j)&&!['complete','failed'].includes(j.status)?{...j,observationPausedAt:j.observationPausedAt||new Date().toISOString(),observationError:'任务状态读取失败：'+error.message+'；本地计时已暂停，保留原任务继续核对，不会重发。'}:j));paintCards();/* Transport loss is unknown, not provider failure or permission to resubmit. */}finally{inFlight=false;if(epoch!==taskEpoch)void observe();}}
 async function suspend(){draftRequest++;clearTimeout(openTimer);await session?.dismiss();document.querySelectorAll('.media-card-status,.media-card-stop,.media-card-confirm,.media-card-actions').forEach(el=>el.remove());for(const content of document.querySelectorAll('[data-media-queue],[data-media-credits]')){const dialog=content.closest('dialog');dialog?.close();dialog?.remove();}}
 const resetCredits=()=>{creditEpoch++;credits=[];officialCredit=null;creditRequest='';creditPending.clear();creditChecked.clear();creditErrors.clear();document.querySelector('[data-action="official-credits"]')?.replaceChildren(document.createTextNode('—'));creditHeader();};const resetAccount=()=>{taskEpoch++;queueSnapshot=undefined;jobCache.clear();checkedScopes.clear();cardJobs.clear();cardDisplayJobs.clear();for(const body of document.querySelectorAll('[data-media-queue],[data-media-credits]'))body.closest('dialog')?.remove();resetCredits();void observe();};document.addEventListener('shensi:account-changed',resetAccount);document.addEventListener('shensi:model-sources-changed',resetCredits);timer=setInterval(()=>void observe(),2000);return {draft,queue,showCredits,observe,paintCards,controlsMarkup,suspend,dispose:()=>{activity.dispose();window.removeEventListener('storage',storageChanged);document.removeEventListener('shensi:account-changed',resetAccount);document.removeEventListener('shensi:model-sources-changed',resetCredits);clearInterval(timer);clearInterval(clockTimer);clearTimeout(openTimer);cardObserver.disconnect();cancelAnimationFrame(paintFrame);document.removeEventListener('shensi:board-selection',selection);document.removeEventListener('shensi:board-layout',repaintBoard);document.removeEventListener('click',acknowledgeCard,true);}};
}
