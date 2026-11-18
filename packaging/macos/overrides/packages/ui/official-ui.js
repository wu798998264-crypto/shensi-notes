import {mountNutstoreSettings} from './nutstore-settings.js';
import {createNutstoreNotice,watchNutstoreStatus,openNutstoreConflicts} from './nutstore-feedback.js';
import {openNutstoreProgress} from './nutstore-progress.js';
import {openBookPicker} from './book-picker.js';
import {openReferencePicker,referenceIdentity,skillFolderTree} from './reference-picker.js';
import {defaultTextProfile} from './text-model-selection.js';
import {profileSupports,profileHasMedia} from './model-capabilities.js';
import {escapeHtml as h} from './editor.js';
import {openConsoleEditor} from './console-editor.js';
import {createWritingEditor,writingPlaceholder} from './writing-editor.js';
import {mountGraph} from './orbit-graph.js';
import {createMediaUI} from './media-ui.js';
import {mediaTaskDestination} from './media-task-destination.js';
import {updateCardModelDefaults} from './card-model-defaults.js';
import {mountGenerationSettings} from './generation-settings.js';
import {mountLocalH3Settings} from './local-h3-settings.js';
import {mountDoubaoSettings} from './doubao-settings.js';
import {watchDoubaoQuota} from './doubao-quota-notice.js';
import {mountBrowserSettings} from './browser-profile-controls.js';
import {createTextReaderUI} from './text-reader.js';
import {pickerProfileId} from './model-capabilities.js';
import {MODEL_SOURCES,modelSource,profileVisibleInPicker,profileAvailabilityLabel} from './model-sources.js';
import {chatIcon,chatButton,chatHistoryMarkup,chatSurfaceMarkup,modelFieldsMarkup,bindChatPresentation} from './chat-layout.js';
import {chatAttachmentTarget} from './chat-links.js';
import {chatQueueMarkup,bindChatQueue} from './chat-queue.js';
import {captureChatScroll,restoreChatScroll,patchChatRuntime,captureChatQueueScroll,restoreChatQueueScroll} from './chat-scroll.js';
import {textModelSummary} from './text-model-selection.js';
import {activityMarkup,savedDocumentsMarkup,turnActivityMarkup,chatAttachmentsMarkup} from './agent-activity.js';
import {shortcutFromEvent,DEFAULT_PREFERENCES} from './preferences.js';
import {contextMenu} from './context-menu.js';
import {prepareMapReferences} from './map-render.js';
import {chooseStorageLocation} from './storage-location-picker.js';
import {openChushouMusicPicker} from './chushou-music-picker.js';
const names={text:'文本',image:'图片',video:'视频',audio:'音频'};
export function createOfficialUI(context){
 let fixedTarget=null;const windowParams=new URLSearchParams(location.search);
 if(windowParams.get('plugin')==='official.conversation-control'&&windowParams.get('detached')==='plugin'){
  try{const raw=windowParams.get('controlTarget')||'';if(raw.length>4000)throw Error('窗口目标过大');fixedTarget=raw?JSON.parse(raw):{kind:'none',notebookId:windowParams.get('notebook'),title:'未指定页面对象'};}catch{fixedTarget={kind:'none',notebookId:windowParams.get('notebook'),title:'窗口上下文无效，请明确任务对象'};}
 }
 let conversationContext={},controlMode=false,historySources=[];
 const controlId='official.conversation-control';
 const targetKey=t=>JSON.stringify([t?.kind,t?.notebookId,t?.documentId||t?.mapId||t?.scriptId||t?.pluginId||t?.tabId||'']);
 const conversationTarget=()=>{const target=conversationContext.target?.();return {...(fixedTarget?(fixedTarget.notebookId===context.libraryId()?fixedTarget:{kind:'none',title:'原窗口目标不属于此笔记本'}):target||{kind:'none',title:'未指定页面对象'}),notebookId:context.libraryId()};};
 let stopSyncWatch,stopDoubaoWatch;
 const syncApi=(action,body={})=>context.api('/api/official/sync/'+action,body);
 const syncFeedback=()=>({api:syncApi,historyEnabled:true,changed:()=>refreshWorkspace(context.libraryId()),canResolve:()=>context.flush()});
 function updateSyncWatch(){
  if(enabled('nutstore')&&!stopSyncWatch)stopSyncWatch=watchNutstoreStatus({api:syncApi,notice:createNutstoreNotice({onDetails:()=>openNutstoreProgress(syncFeedback()),onConflicts:()=>openNutstoreConflicts(syncFeedback())})});
  else if(!enabled('nutstore')&&stopSyncWatch){stopSyncWatch();stopSyncWatch=null;}
  if(enabled('thirdparty.doubao')&&!stopDoubaoWatch)stopDoubaoWatch=watchDoubaoQuota({api:(action,body)=>context.api('/api/official/doubao/'+action,body||{}),toast:context.toast});
  else if(!enabled('thirdparty.doubao')&&stopDoubaoWatch){stopDoubaoWatch();stopDoubaoWatch=null;}
 }
 window.addEventListener('pagehide',()=>{stopSyncWatch?.();stopSyncWatch=null;stopDoubaoWatch?.();stopDoubaoWatch=null;});
 const reader=createTextReaderUI(context);let readerOpen=false;
 let plugins=[],profiles=[],drawer=null,chatState=null,chatScope=null,chatId='',draftTimer,chatPollTimer,chatHistoryOpen=false,chatHistoryEntry='toolbar',consoleState=null,consoleId='',graphCleanup,graphRoot=null,graphGeneration=0,chatPresentationCleanup,modelChangePromise=Promise.resolve();
 const submissions=new Map(),writingEditors=new Map(),chatRefreshes=new Map();let consoleLoadRevision=0;
 const savedDrafts=new WeakMap(),draftWrites=new Map();let panelRevision=0;
 let musicPicker=null,musicApprovalId='';
 function syncMusicPicker(c){
  const pending=c?.pendingApproval;if(pending?.kind!=='chushou-music-choice'){musicPicker?.close();musicPicker=null;musicApprovalId='';return;}
  if(musicApprovalId===pending.id)return;musicPicker?.close();musicApprovalId=pending.id;const snapshot={...chatBody(),approvalId:pending.id};
  musicPicker=openChushouMusicPicker({initial:pending.music,call:(action,payload={})=>api('/chat/music-choice',{...snapshot,...payload,action}),answer:async(answer,selection)=>{await api('/chat/answer',{...snapshot,answer,...(selection?{selection}:{})});void refreshChat().catch(e=>context.toast(e.message));},audioUrl:selection=>{const url=new URL(context.assetUrl('',snapshot.documentId||'',snapshot.id),location.href),token=url.searchParams.get('token');url.pathname='/api/official/chat/music-audio';url.search=new URLSearchParams({...snapshot,...selection,token}).toString();return url.href;}});
 }
 const flushWriting=()=>Promise.all([...writingEditors.values()].map(editor=>editor.flush()));
 function releaseWriting(){for(const editor of writingEditors.values())void editor.dispose().catch(error=>context.toast(error.message));writingEditors.clear();}
 async function applyWriting(snapshot,payload){
  if(!await context.flush())throw Error('请先保存当前编辑');
  const preview=await api('/chat/console/apply-preview',{...snapshot,...payload}),requestId='adopt-'+crypto.randomUUID();
  const location=await chooseStorageLocation({api:context.api,notebookId:snapshot.id,title:'写作笔记',preview:preview.text});if(!location)return;
  const destinationId=location.id,live=await context.api('/api/state?id='+encodeURIComponent(destinationId)),options={mode:'note',destinationId,folderId:location.folderId,title:location.title,expectedStateStamp:live.stateStamp};
  await api('/chat/console/apply',{...snapshot,...payload,...options,requestId});await refreshWorkspace(destinationId);context.toast('稿件已保存，原稿和历史版本保留');
 }
 function reviewAvailable(){return controlMode?['whiteboard','map','glyph','plugin','browser'].includes(conversationTarget().kind):chatScope?.pluginId==='official.whiteboard-generation'&&!!context.current()?.canvas;}
 function mountWriting(body){if(!reviewAvailable()){for(const editor of writingEditors.values())editor.detach({hideExpanded:true});return;}const scopeKey=JSON.stringify([chatScope,chatId]);for(const [key,editor]of writingEditors)if(!key.startsWith(scopeKey+'|')){void editor.dispose().catch(error=>context.toast(error.message));writingEditors.delete(key);}for(const element of body.querySelectorAll('[data-writing-id]')){const item=consoleState?.consoles?.find(c=>c.id===element.dataset.writingId);if(!item)continue;const snapshot={...chatBody(),...(item._target?{target:item._target,documentId:item._target.documentId||''}:{})},key=scopeKey+'|'+item.id;let editor=writingEditors.get(key);if(!editor){editor=createWritingEditor({item,scopeKey:key,modal:context.modal,toast:context.toast,...(snapshot.target?{apply:payload=>applyWriting(snapshot,payload)}:{}),call:(action,payload)=>api('/chat/console/'+action,{...snapshot,...payload})});writingEditors.set(key,editor);}else editor.refresh(item);editor.attach(element);}}
 let renderedChatKey='',scrollChatToEnd=false,modelSelectionRevision=0,modelSelectionListener;
 const submissionKey=()=>chatScope?JSON.stringify([chatScope.pluginId,chatScope.id,chatId]):'';
  function updateSubmission(){const pending=submissions.get(submissionKey())?.pending,body=drawer?.querySelector('.shensi-chat'),button=body?.querySelector('.chat-compose button[type=submit]');if(!button)return;button.disabled=!!pending||!!currentChat()?.archived;button.setAttribute('aria-busy',String(!!pending));button.title=pending?'正在提交…':'发送';body.querySelector('[data-chat-submission-status]')?.remove();}
 async function submitChat(event){
   event.preventDefault();const key=submissionKey(),input=drawer?.querySelector('[data-chat-draft]'),text=input?.value||'',initialProfileId=drawer?.querySelector('[data-chat-profile]')?.value;
  if(!key||submissions.get(key)?.pending||!text.trim())return;if(!initialProfileId){context.toast('请先选择对话模型配置');return;}
  const pending=currentChat()?.pendingApproval;
  if(pending?.options?.length){
   const snapshot=chatBody();input.value='';const active=currentChat();if(active)active.draft='';clearTimeout(draftTimer);draftTimer=null;updateSubmission();
   try{await api('/chat/answer',{...snapshot,approvalId:pending.id,answer:text});if(chatScope.id===snapshot.id&&chatScope.pluginId===snapshot.pluginId&&chatId===snapshot.conversationId){chatState=await api('/chat/read',chatScope);renderChat();}}catch(error){if(input.isConnected){input.value=text;const live=currentChat();if(live)live.draft=text;void persistDraft(snapshot,text).catch(()=>{});}context.toast('方案未发送：'+error.message);}finally{if(submissionKey()===key)updateSubmission();}return;
  }
   const requestId=submissions.get(key)?.text===text?submissions.get(key).requestId:'request-'+crypto.randomUUID(),request={...chatBody(),text,nodeId:!controlMode||conversationTarget().kind==='whiteboard'?context.selectedNode()?.id||'':'',requestId};
   submissions.set(key,{text,requestId,pending:true});savedDrafts.delete(input);input.value='';const active=currentChat();if(active)active.draft='';updateSubmission();clearTimeout(draftTimer);draftTimer=null;
  try{
    await modelChangePromise;await flushWriting();if(submissionKey()!==key||!drawer)throw Error('对话已切换，任务未提交');const profileId=drawer.querySelector('[data-chat-profile]')?.value,model=drawer.querySelector('[data-chat-model]')?.value||'',reasoningEffort=drawer.querySelector('[data-chat-reasoning]')?.value||'',speedMode=drawer.querySelector('[data-chat-speed]')?.value||'default';if(!profileId)throw Error('请先选择对话模型配置');Object.assign(request,{profileId,model,reasoningEffort,speedMode});if(!(await context.flush())||controlMode&&!(await conversationContext.flush?.(request.target)))throw Error('当前目标尚未保存，任务未提交');if(controlMode&&targetKey(request.target)!==targetKey(conversationTarget()))throw Error('处理目标已切换，未发送到新页面');await persistDraft(request,'');
   const previousEditors=[...writingEditors.values()],result=await api('/chat/submit',request);
    if(submissionKey()===key&&drawer){for(const editor of previousEditors)editor.collapseLongContent();const composer=drawer.querySelector('[data-chat-draft]'),nextDraft=composer?.value||'';chatState=result;const conversation=currentChat();if(conversation)conversation.draft=nextDraft;scrollChatToEnd=true;renderChat();void refreshChat().catch(error=>context.toast(error.message));}
   submissions.delete(key);
   }catch(error){const composer=submissionKey()===key?drawer?.querySelector('[data-chat-draft]'):null;let message='提交未确认';if(composer&&!composer.value){composer.value=text;const live=currentChat();if(live)live.draft=text;void persistDraft(request,text).catch(()=>{});message+='，输入已恢复';}else if(composer)message+='，已保留当前新草稿';context.toast(message+'：'+error.message);}
  finally{const entry=submissions.get(key);if(entry)entry.pending=false;if(submissionKey()===key)updateSubmission();}
 }
 const api=(path,body)=>context.api('/api/official'+path,body);
 // Background reads advance the save baseline only when applyResult adopts them.
 async function refreshWorkspace(id){if(id===context.libraryId()&&context.refreshWorkspace){await context.refreshWorkspace();return;}if(id!==context.libraryId())return;const live=await context.api('/api/state?id='+encodeURIComponent(id),undefined,false);if(id!==context.libraryId()||live.stateStamp===context.stamp())return;if(context.isDirty()){context.toast('新内容已保存；当前人工草稿仍保留，请重新读取并合并后再保存');return;}context.applyResult(live);}
 const enabled=id=>plugins.some(p=>p.id===(id.includes('.')?id:'official.'+id)&&p.enabled&&p.installed!==false);
 const optionCaption=(p,items)=>{if(p.provider!=='LibTV')return p.name;const peers=items.filter(v=>v.name===p.name&&v.adapter===p.adapter);return p.name+' · '+(p.adapter==='cli'?'CLI 本地登录':'API 接口')+(peers.length>1?' · 配置 '+(peers.findIndex(v=>v.id===p.id)+1):'');};
 const options=(channel,value='',{manual=false}={})=> {value=pickerProfileId(profiles,value);if(channel==='text'&&!manual)value=defaultTextProfile(profiles,value)?.id||'';return (manual?'<option value="" '+(!value?'selected':'')+'>请选择配置</option>'+(value&&!profiles.some(p=>p.id===value&&profileSupports(p,channel)&&p.enabled!==false)?'<option selected disabled value="'+h(value)+'">原配置不可用，请手动选择</option>':''):'')+(profiles.some(p=>profileSupports(p,channel)&&p.enabled!==false)?'':'<option value="" disabled>暂无可用配置</option>')+MODEL_SOURCES.map(([source,label])=>{const items=profiles.filter(p=>profileSupports(p,channel)&&(profileVisibleInPicker(p)||p.preserveLegacySettings&&p.id===value)&&modelSource(p)===source);return items.length?`<optgroup label="${label}">`+items.map(p=>`<option data-user-content value="${p.id}" ${p.enabled===false?'disabled':''} ${p.id===value&&p.enabled!==false?'selected':''}>${h(optionCaption(p,items))}${profileAvailabilityLabel(p,context.preferences?.().uiLanguage)?' · '+h(profileAvailabilityLabel(p,context.preferences?.().uiLanguage)):''}</option>`).join('')+'</optgroup>':'';}).join('');};
 let catalogFlight,catalogAt=0,catalogRevision=0;
 async function refresh({ifStale=false}={}){
  if(ifStale){if(catalogFlight)return catalogFlight;if(catalogAt&&Date.now()-catalogAt<30000)return;}
  const revision=++catalogRevision;
  const pending=(async()=>{const [result,models]=await Promise.all([context.api('/api/plugins?summary=1'),api('/models')]);if(revision!==catalogRevision)return;
   const before=JSON.stringify([plugins,profiles]);plugins=result.plugins;profiles=models.profiles;updateCardModelDefaults(models);catalogAt=profileRefreshedAt=Date.now();updateSyncWatch();
   if(before===JSON.stringify([plugins,profiles]))return;if(!enabled('whiteboard-generation'))await media.suspend();context.render?.();
  })();catalogFlight=pending;try{await pending;}finally{if(catalogFlight===pending)catalogFlight=null;}
 }
 document.addEventListener('shensi:model-sources-changed',()=>{void refresh().catch(error=>context.toast(error.message));});
 const rail=()=>`${enabled('works')?'<button class="official-works-rail" data-action="official-works" title="作品模式" aria-label="作品模式"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5zm0 13A2.5 2.5 0 0 1 6.5 16H20"/></svg></button>':''}${enabled(controlId)?'<button data-action="official-control" title="对话控制" aria-label="对话控制">'+chatIcon('\uE8F2')+'</button>':''}${enabled('graph')?'<button data-action="official-graph" title="知识图谱" aria-label="知识图谱">⌘</button>':''}`;
 function header(){return context.current()?.canvas?media.controlsMarkup():'';}
 function mountCanvas(board){const markup=header();if(!markup)return;const controls=document.createElement('div');controls.className='whiteboard-account-controls';controls.setAttribute('aria-label','画布积分与任务队列');controls.innerHTML=markup;controls.onclick=event=>{const target=event.target.closest('[data-action]');if(!target)return;event.stopPropagation();void action(target.dataset.action).catch(error=>context.toast(error.message));};(board.querySelector('[data-canvas-model-controls]')||board).append(controls);}
 function dockEntries(){const doc=context.current();return [...(enabled('thirdparty.text-reader')?[{id:'text-reader',pluginId:'thirdparty.text-reader',windowCapabilities:{detached:true},title:'文档朗读',symbol:'reader',action:'official-reader',scope:context.libraryId()}]:[]),...(enabled(controlId)?[{id:'conversation-control',pluginId:controlId,title:'对话控制',symbol:'chat',action:'official-control',scope:'control',windowCapabilities:{detached:true},conversationTarget:conversationTarget()}]:[]),...(doc&&enabled('graph')?[{id:'backlinks',title:'双向链接',symbol:'links',action:'official-links',scope:doc.id}]:[])];}
 function close(){musicPicker?.close();musicPicker=null;musicApprovalId='';panelRevision++;consoleLoadRevision++;releaseWriting();reader.close();readerOpen=false;chatPresentationCleanup?.();chatPresentationCleanup=null;clearTimeout(draftTimer);clearInterval(chatPollTimer);chatPollTimer=null;if(drawer?.querySelector('[data-chat-draft]'))void saveDraft();drawer?.remove();drawer=null;chatScope=null;consoleState=null;consoleId='';}
 async function openReader(selection=''){if(!enabled('thirdparty.text-reader'))throw Error('请先启用文档朗读插件');if(!(await context.flush()))return;context.beforePanel?.();close();drawer=document.createElement('section');drawer.className='official-panel plugin-native-copy';drawer.setAttribute('aria-label','文档朗读');drawer.innerHTML='<header class="official-panel-head"><h2>文档朗读</h2><button data-reader-close aria-label="关闭文档朗读">×</button></header><div class="official-panel-body"></div>';context.mountPanel(drawer,'text-reader',{action:'official-reader',scope:context.libraryId()});readerOpen=true;drawer.querySelector('[data-reader-close]').onclick=()=>{close();context.hidePanel?.();};await reader.mount(drawer.querySelector('.official-panel-body'),{selection});}
 function panel(title,wide=false){context.beforePanel?.();close();if(wide)context.hidePanel?.();drawer=document.createElement('section');drawer.className='official-panel'+(wide?' official-wide':'');drawer.setAttribute('aria-label',title);drawer.innerHTML=`<header class="official-panel-head"><h2>${title}</h2><button data-official-close aria-label="关闭${title}">×</button></header><div class="official-panel-body"></div>`;if(!wide&&context.mountPanel)context.mountPanel(drawer,title==='对话控制'?'conversation-control':title==='双向链接'?'backlinks':title==='文档对话'?'document-chat':['白板生成','任务队列','即梦积分'].includes(title)?'whiteboard-generation':title,{action:title==='对话控制'?'official-control':title==='双向链接'?'official-links':title==='文档对话'?'official-chat':'official-board',scope:title==='对话控制'?'control':title==='双向链接'?context.current()?.id:title==='文档对话'?'document':'board'});else document.body.append(drawer);drawer.querySelector('[data-official-close]').onclick=()=>{if(!wide&&context.hidePanel)context.hidePanel();else close();};return drawer.querySelector('.official-panel-body');}
 async function works(){
  if(!(await context.flush()))return;const state=context.state(),active=!!state.coreWork?.enabled,currentType=state.coreWork?.type||'novel';
  const body='<p>'+(active?'选择作品类型，或关闭作品模式恢复笔记目录。已有文档和历史会保留。':'使用索引、正文、大纲、设定、记忆与资料库分区管理作品，原有文件和历史保留。')+'</p><label>作品类型<select name="type"><option value="novel" '+(currentType==='novel'?'selected':'')+'>长篇小说 · 卷 / 章</option><option value="screenplay" '+(currentType==='screenplay'?'selected':'')+'>剧本 · 按集管理</option></select></label>';
  const answer=await context.modal(active?'作品模式':'切换为作品模式？',body,active?[['取消','cancel'],['关闭作品模式','disable'],['切换作品类型','enable']]:[['取消','cancel'],['切换作品模式','enable']]);
  if(!['disable','enable'].includes(answer.value))return;
  try{const result=await api(answer.value==='disable'?'/works/deactivate':'/works/activate',{id:context.libraryId(),expectedStateStamp:context.stamp(),...(answer.value==='disable'?{}:{type:answer.type||currentType})});close();context.applyResult(result);context.toast(answer.value==='disable'?'已恢复笔记模式，文档和历史保留':'作品类型已更新');}catch(error){context.toast(error.message);}
 }
 async function graph(){if(!readerOpen)close();return context.openGraphTab?.();}
 async function updateGraphRelationship(action,sourceId,targetId,index){
  const operation=async()=>{if(!(await context.flush()))throw Error('请先保存当前编辑');return api('/graph/'+action,{id:context.libraryId(),sourceId,targetId,...(action==='connect'?{reciprocal:true}:{}),expectedStateStamps:{...index.stateStamps,[context.libraryId()]:context.stamp()}});};
  const result=context.mutateGraph?await context.mutateGraph(operation):await operation();
  if(!context.mutateGraph)context.applyResult(result);
  Object.assign(index,result.index);context.toast(action==='connect'?'双向链接已保存':'双向链接已解除');return result.index;
 }
 async function renderGraph(){const host=context.graphTabHost?.();if(host===graphRoot)return;graphCleanup?.();graphCleanup=null;graphRoot=host||null;const generation=++graphGeneration;if(!host)return;try{const index=await api('/graph',{id:context.libraryId(),scope:'global'});if(generation!==graphGeneration||host!==graphRoot||!host.isConnected)return;const nodeFor=id=>index.nodes.find(node=>node.id===id);graphCleanup=mountGraph(host,index,id=>{const node=nodeFor(id);if(node)void context.openSavedDocument(node.notebookId,node.documentId);},{layoutKey:'global',onNodeMenu:async(id,event,actions)=>{const node=nodeFor(id);if(!node)return;if(node.notebookId===context.libraryId())return context.documentMenu?.(node.documentId,event,{graph:true,link:actions.beginLink});const answer=await contextMenu([{value:'open',label:'打开文档'},{value:'link',label:'链接'}],event);if(answer.value==='open')await context.openSavedDocument(node.notebookId,node.documentId);if(answer.value==='link')actions.beginLink();},onConnect:(sourceId,targetId)=>updateGraphRelationship('connect',sourceId,targetId,index),onDisconnect:(sourceId,targetId)=>updateGraphRelationship('disconnect',sourceId,targetId,index)});const closeButton=host.querySelector('[data-graph-close]');if(closeButton)closeButton.onclick=()=>context.closeGraphTab?.();}catch(error){if(host.isConnected)host.innerHTML=`<p class="graph-tab-error">${h(error.message)}</p>`;}}
 async function links(){if(!(await context.flush()))return;const index=await api('/graph',{id:context.libraryId()}),id=context.current().id,body=panel('双向链接');body.innerHTML=`<p>当前文档：${h(context.current().title)}</p><button data-insert-link>插入文档链接</button>${[['指向当前文档',index.edges.filter(e=>e.target===id).map(e=>e.source)],['当前文档引用',index.edges.filter(e=>e.source===id).map(e=>e.target)]].map(([title,ids])=>`<h3>${title}</h3>${ids.length?ids.map(target=>`<button class="link-result" data-link-doc="${target}">${h(index.nodes.find(n=>n.id===target)?.title)}</button>`).join(''):'<p class="muted">暂无链接</p>'}`).join('')}`;body.onclick=async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.linkDoc){close();await context.openDocument(b.dataset.linkDoc);}else if(b.hasAttribute('data-insert-link')){const answer=await context.modal('插入文档链接',`<select name="target">${index.nodes.filter(n=>n.id!==id).map(n=>`<option value="${n.id}">${h(n.title)}</option>`).join('')}</select>`);if(answer.value==='ok'&&answer.target){close();context.insertLink(answer.target,index.nodes.find(n=>n.id===answer.target)?.title);}}};}
 async function sync(target){return mountNutstoreSettings(target||panel('坚果云同步',true),{...syncFeedback(),notebookApi:(action,body={})=>api('/sync-notebooks/'+action,body),modal:context.modal,toast:context.toast});}
  const chatBody=()=>{const target=controlMode?conversationTarget():null;return {...chatScope,documentId:target?target.documentId||'':context.current()?.id||'',conversationId:chatId,...(target?{target}:{})};};

  const referenceGroups=[['skillRefs','Skill'],['documentRefs','文档'],['novelRefs','小说']];
  let referenceCandidates=[],skillCandidates=[];
  const referenceKey=ref=>ref.referenceType==='skill'?'skill:'+ref.rootId+':'+ref.skillId:ref.referenceType==='book'?'book:'+ref.notebookId+':'+ref.referenceId:ref.notebookId+':'+ref.documentId;
  const effectiveRefs=(conversation,key)=>conversation[key]??[];
  async function loadReferenceIndex(){const [skills,index]=await Promise.all([context.api('/api/skills'),context.api('/api/references')]);skillCandidates=skills.skills;referenceCandidates=index;}
  function updateContextChips(){
   const body=drawer?.querySelector('.shensi-chat'),chips=body?.querySelector('[data-chat-context-chips]'),c=currentChat();if(!chips||!c)return;
   const doc=controlMode?conversationTarget():context.current();chips.innerHTML=`<span class="context-chip bound" data-chat-current-document title="默认优先读取或修改此对象，是否读取由任务决定；Agent仍可处理其他对象，切换页面不改变已提交任务的目标">${chatIcon(doc?.canvas||doc?.kind==='whiteboard'?'\uE70A':'\uE8A5')}<span ${doc?.title?'data-user-content':'data-core-copy'}>${h(doc?.title||'未指定页面对象')}</span></span>`;
   for(const [key,label] of [...referenceGroups,['routeRefs','旧路由引用']])effectiveRefs(c,key).forEach((ref,index)=>{const entry=referenceCandidates.find(d=>referenceKey(d)===referenceKey(ref)),title=ref.title||entry?.title||label+' '+(index+1);chips.insertAdjacentHTML('beforeend',`<span class="context-chip" title="${h(label+' · '+title)}">${chatIcon(key==='skillRefs'?'\uE8A5':key==='routeRefs'?'\uE71B':'\uE8F2')}<span>${h(title)}</span><button type="button" data-chat-remove-ref="${key}" data-ref-index="${index}" aria-label="移除引用：${h(title)}" ${c.status==='running'?'disabled':''}>×</button></span>`);});
   (c.attachments||[]).forEach((item,index)=>{const url=context.assetUrl?.(item.relativePath,item.documentId,item.notebookId);chips.insertAdjacentHTML('beforeend',`<span class="context-chip" title="${h(item.name)}">${item.mimeType?.startsWith('image/')&&url?'<img src="'+h(url)+'" alt="">':chatIcon('\uE723')}<span>${h(item.name)}</span><button type="button" data-chat-remove-attachment="${index}" aria-label="移除附件：${h(item.name)}" ${c.status==='running'?'disabled':''}>×</button></span>`);});
  }
  function setChatHistory(entry='toolbar',open=!chatHistoryOpen||entry!==chatHistoryEntry,focus=true){
   chatHistoryEntry=entry;chatHistoryOpen=open;const body=drawer?.querySelector('.shensi-chat'),history=body?.querySelector('.chat-history');if(!history)return;history.hidden=!open;history.classList.toggle('chat-notebook-picker',entry==='composer');const anchor=body.querySelector(entry==='composer'?'.chat-composer-context':'.chat-main-area');if(history.parentElement!==anchor)anchor.prepend(history);history.querySelector('[data-chat-history-title]').textContent=entry==='composer'?'当前笔记本对话':'历史对话';
   body.querySelector('[data-chat-history]').setAttribute('aria-expanded',String(open&&entry==='toolbar'));body.querySelector('[data-chat-workspace-history]').setAttribute('aria-expanded',String(open&&entry==='composer'));if(open&&focus)history.querySelector('input').focus();
  }
  function refreshHistoryList(){const old=drawer?.querySelector('.chat-history');if(!old)return;const query=old.querySelector('input').value,holder=document.createElement('div');holder.innerHTML=historyMarkup();old.replaceWith(holder.firstElementChild);const input=drawer.querySelector('[data-chat-history-search]');input.value=query;input.dispatchEvent(new Event('input',{bubbles:true}));setChatHistory(chatHistoryEntry,chatHistoryOpen,false);}
  function exportChat(){const c=currentChat();if(!c)return;const text='# '+c.title+'\n\n'+c.messages.map(m=>'## '+(m.role==='user'?'你':'神思')+'\n\n'+m.text).join('\n\n'),url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download=(c.title||'对话').replace(/[\\/:*?"<>|]/g,'_')+'.md';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function references(){
   const body=drawer?.querySelector('.shensi-chat'),picker=body?.querySelector('[data-chat-reference-panel]'),c=currentChat();if(!picker||!c)return;
   if(!picker.hidden){picker.hidden=true;body.querySelector('[data-chat-references]').setAttribute('aria-expanded','false');return;}
   await saveDraft();const snapshot=chatBody();await loadReferenceIndex();if(!picker.isConnected||chatId!==snapshot.conversationId||chatScope.id!==snapshot.id)return;
   const entries=[...referenceCandidates,...skillCandidates],groups=[['skillRefs','Skill',skillCandidates],['documentRefs','文档',referenceCandidates],['novelRefs','小说',entries.filter(d=>d.work)]],fields=[],pending=Object.fromEntries(referenceGroups.map(([key])=>[key,[...effectiveRefs(c,key)]]));let attachments=[...(c.attachments||[])];
   picker.hidden=false;body.querySelector('[data-chat-references]').setAttribute('aria-expanded','true');
   picker.innerHTML='<header><strong>引用文档或 Skill</strong>'+chatButton('data-reference-close','关闭引用选择','\uE711')+'</header><input type="search" data-reference-search aria-label="搜索可引用内容" placeholder="搜索文档或 Skill…"><nav class="chat-reference-tabs" role="tablist" aria-label="引用类型">'+groups.map(([key,label],index)=>'<button type="button" role="tab" data-reference-tab="'+key+'" aria-selected="'+(index===0)+'">'+label+'</button>').join('')+'</nav><div class="chat-reference-lists">'+groups.map(([key,label,items],index)=>'<fieldset data-reference-group="'+key+'" '+(index?'hidden':'')+'><legend>'+label+'</legend>'+(key==='novelRefs'?'<button type="button" data-reference-book-search>搜索小说与选择章节</button><div data-book-references>'+pending.novelRefs.filter(r=>r.referenceType==='book').map(r=>'<p>'+h(r.title)+'<button type="button" data-book-remove="'+h(r.referenceId)+'">移除</button></p>').join('')+'</div>':'<button type="button" data-reference-tree="'+key+'">按目录选择'+label+'</button>')+'<div data-selected-group="'+key+'">'+(pending[key].filter(ref=>ref.referenceType!=='book').map(ref=>entries.find(item=>referenceKey(item)===referenceKey(ref))||{...ref,library:'引用',title:ref.title||ref.documentId}).map(item=>{const field=fields.length;fields.push({key,item});return '<label data-reference-name="'+h((item.library+' / '+item.title).toLowerCase())+'"><input type="checkbox" data-reference-field="'+field+'" '+(pending[key].some(ref=>referenceKey(ref)===referenceKey(item))?'checked':'')+'>'+h(item.library)+' / '+h(item.title)+'</label>';}).join('')||'<p class="chat-panel-empty">尚未选择'+label+'</p>')+'</div></fieldset>').join('')+'</div><footer><button type="button" data-reference-close>取消</button><button type="button" data-reference-save class="primary">应用引用</button></footer>';
   pending.skillRefs=pending.skillRefs.filter(ref=>skillCandidates.some(item=>referenceKey(item)===referenceKey(ref)));
   picker.querySelector('[data-selected-group="skillRefs"]').innerHTML=skillFolderTree(skillCandidates,item=>{const field=fields.length;fields.push({key:'skillRefs',item});return '<label title="'+h(item.description||'')+'" data-reference-name="'+h([item.library,item.title,item.description].join(' / ').toLowerCase())+'"><input type="checkbox" data-reference-field="'+field+'" '+(pending.skillRefs.some(ref=>referenceKey(ref)===referenceKey(item))?'checked':'')+'>'+h(item.title)+'</label>';});
   picker.oninput=e=>{if(e.target.hasAttribute('data-reference-search')){const query=e.target.value.toLowerCase();picker.querySelectorAll('[data-reference-name]').forEach(row=>row.hidden=!row.dataset.referenceName.includes(query));picker.querySelectorAll('[data-skill-folder]').forEach(folder=>{folder.hidden=![...folder.querySelectorAll('[data-reference-name]')].some(row=>!row.hidden);folder.open=!!query;});}};
   picker.onchange=e=>{if(e.target.hasAttribute('data-reference-field')){const {key,item}=fields[Number(e.target.dataset.referenceField)],value=referenceIdentity(item);pending[key]=pending[key].filter(ref=>referenceKey(ref)!==referenceKey(item));if(e.target.checked)pending[key].push(value);}else if(e.target.hasAttribute('data-reference-attachment')){const item=c.attachments[Number(e.target.dataset.referenceAttachment)];attachments=attachments.filter(a=>a.relativePath!==item.relativePath);if(e.target.checked)attachments.push(item);}};
   picker.onclick=async e=>{const button=e.target.closest('button');if(!button)return;e.stopPropagation();if(button.dataset.referenceTree){try{const key=button.dataset.referenceTree,group=groups.find(g=>g[0]===key),item=await openReferencePicker({api:context.api,notebookId:snapshot.id,kind:key==='skillRefs'?'skill':key==='routeRefs'?'route':'document',candidates:group[2]});if(!item||!picker.isConnected||chatId!==snapshot.conversationId||chatScope.id!==snapshot.id||pending[key].some(ref=>referenceKey(ref)===referenceKey(item)))return;pending[key].push(referenceIdentity(item));const field=fields.length;fields.push({key,item});const selected=picker.querySelector('[data-selected-group="'+key+'"]');selected.querySelector('.chat-panel-empty')?.remove();selected.insertAdjacentHTML('beforeend','<label data-reference-name="'+h((item.library+' / '+item.title).toLowerCase())+'"><input type="checkbox" data-reference-field="'+field+'" checked>'+h([item.library,...(item.folderPath||[]).map(f=>f.name),item.title].join(' / '))+'</label>');}catch(error){context.toast(error.message);}return;}if(button.hasAttribute('data-reference-book-search')){const ref=await openBookPicker({api,notebookId:snapshot.id});if(ref&&picker.isConnected){if(!pending.novelRefs.some(r=>referenceKey(r)===referenceKey(ref)))pending.novelRefs.push(ref);picker.querySelector('[data-book-references]').insertAdjacentHTML('beforeend','<p>'+h(ref.title)+'<button type="button" data-book-remove="'+h(ref.referenceId)+'">移除</button></p>');}return;}if(button.dataset.bookRemove){pending.novelRefs=pending.novelRefs.filter(r=>r.referenceId!==button.dataset.bookRemove);button.closest('p').remove();return;}if(button.hasAttribute('data-reference-close')){picker.hidden=true;body.querySelector('[data-chat-references]').setAttribute('aria-expanded','false');return;}if(button.dataset.referenceTab){picker.querySelectorAll('[data-reference-tab]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));picker.querySelectorAll('[data-reference-group]').forEach(group=>group.hidden=group.dataset.referenceGroup!==button.dataset.referenceTab);return;}if(button.hasAttribute('data-reference-save')){button.disabled=true;try{const state=await api('/chat/configure',{...snapshot,...pending,attachments});if(chatScope.id===snapshot.id&&chatId===snapshot.conversationId){chatState=state;updateContextChips();picker.hidden=true;body.querySelector('[data-chat-references]').setAttribute('aria-expanded','false');}}catch(error){context.toast(error.message);}finally{button.disabled=false;}}};
  }
  async function uploadChatFiles(files){
   // Attachments belong to the captured conversation, including workshop targets.
   const snapshot=chatBody(),c=currentChat();if(!c||c.status==='running')return;await saveDraft();const attachments=[...(c.attachments||[])];
   for(const file of files){if(file.size>32*1024*1024)throw Error('对话附件上限为 32 MB');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const saved=controlMode?await api('/chat/attachment',{...snapshot,name:file.name,mimeType:file.type||'application/octet-stream',base64}):await context.api('/api/attachment',{id:snapshot.id,name:file.name,mimeType:file.type||'application/octet-stream',base64});attachments.push(saved.attachment||{notebookId:snapshot.id,documentId:snapshot.documentId,relativePath:saved.relativePath,name:file.name});}
   const state=await api('/chat/configure',{...snapshot,attachments});if(chatScope?.id===snapshot.id&&chatId===snapshot.conversationId){chatState=state;updateContextChips();}
  }

  const consoleCall=(action,payload={})=>api('/chat/console/'+action,{...chatBody(),...payload});
  function currentChat(){return chatState?.conversations?.find(entry=>entry.id===chatId);}
  function persistDraft(snapshot,text,el){
   const key=JSON.stringify([snapshot.pluginId,snapshot.id,snapshot.conversationId]),previous=draftWrites.get(key);let write=previous;
   // Only this input's acknowledged write may be skipped. New panels and explicit
   // submit/restore writes stay fresh; all writes to one conversation stay ordered.
   if(!el||!write||write.failed||write.text!==text||write.settled&&savedDrafts.get(el)!==write){
    write={text};write.promise=(previous?.promise.catch(()=>{})||Promise.resolve()).then(()=>api('/chat/draft',{...snapshot,text})).then(()=>{write.settled=true;},error=>{write.failed=true;throw error;});draftWrites.set(key,write);
   }
   return write.promise.then(()=>{if(el)savedDrafts.set(el,write);});
  }
  async function saveDraft(required=false){
   const el=drawer?.querySelector('[data-chat-draft]');if(!el||!chatId)return;
   const snapshot=chatBody(),text=el.value,c=currentChat();if(c)c.draft=text;
   try{await persistDraft(snapshot,text,el);}catch(error){savedDrafts.delete(el);context.toast(error.message);if(required)throw error;}
  }
  async function refreshChat(){
   if(!chatScope||!drawer||drawer.querySelector('.chat-task-queue[data-dragging]'))return;
   const key=submissionKey();if(chatRefreshes.has(key))return chatRefreshes.get(key);
   // Slow workspace reads must not accumulate another full read every second.
   const pending=(async()=>{
    const panel=panelRevision,state=chatState,old=currentChat(),count=old?.messages.length||0,next=await api('/chat/read',chatScope);
    // A confirmed send/edit/remove may already have installed a newer snapshot.
    if(chatState!==state||submissionKey()!==key||panelRevision!==panel||!drawer||drawer.querySelector('.chat-task-queue[data-dragging]'))return;
    const draft=drawer.querySelector('[data-chat-draft]')?.value;chatState=next;const live=currentChat();if(live&&draft!==undefined)live.draft=draft;
    const queueUnchanged=JSON.stringify([old?.queue,old?.queuePaused,old?.queueError,old?.canSupplement])===JSON.stringify([live?.queue,live?.queuePaused,live?.queueError,live?.canSupplement]);
    if(live?.status==='running'&&live.messages.length===count&&queueUnchanged){updateChatRuntime(live);updateSubmission();return;}
    if(live?.status!=='running'&&(!live?.queue?.length||live.queuePaused)){clearInterval(chatPollTimer);chatPollTimer=null;}
    if(controlMode||chatScope.pluginId==='official.whiteboard-generation'&&context.current()?.canvas)await loadConsoles();
    if(chatState!==next||submissionKey()!==key||panelRevision!==panel||!drawer)return;
    renderChat();if(old?.status==='running'&&live?.status!=='running'){await refreshWorkspace(chatScope.id);if(controlMode&&live.lastTarget)await conversationContext.refresh?.(live.lastTarget);}
   })();chatRefreshes.set(key,pending);
   try{return await pending;}finally{if(chatRefreshes.get(key)===pending)chatRefreshes.delete(key);}
  }
  async function loadConsoles(){
   const loadRevision=++consoleLoadRevision,snapshot=chatBody(),key=submissionKey();
   if(!reviewAvailable()){consoleState=null;consoleId='';return;}
   const next=await api('/chat/console/list',snapshot);
   if(submissionKey()!==key||loadRevision!==consoleLoadRevision||controlMode&&targetKey(snapshot.target)!==targetKey(conversationTarget())||!controlMode&&context.current()?.id!==snapshot.documentId)return;
   consoleState={...next,consoles:next.consoles.map(item=>({...item,...(controlMode?{_target:snapshot.target}:{})}))};consoleId=consoleState.consoles.find(item=>item.id===consoleId)?.id||consoleState.consoles[0]?.id||'';
  }
  async function chat(board=false,revision=++panelRevision){if(!(await context.flush())||revision!==panelRevision)return;await refresh({ifStale:true});if(revision!==panelRevision)return;const doc=context.current();if(!doc)return;const scope={pluginId:board?'official.whiteboard-generation':'official.document-chat',id:context.libraryId()};let data=await api('/chat/read',scope);const stillCurrent=()=>revision===panelRevision&&scope.id===context.libraryId()&&context.current()?.id===doc.id;if(!stillCurrent())return;let nextId=data.activeId||data.conversations.find(entry=>!entry.archived)?.id||'';if(!nextId){data=await api('/chat/new',{...scope,documentId:doc.id});nextId=data.activeId;}if(!stillCurrent())return;panel(board?'白板生成':'文档对话');chatScope=scope;chatHistoryOpen=false;chatState=data;chatId=nextId;if(board&&doc.canvas)await loadConsoles();if(chatScope!==scope)return;renderChat();void loadReferenceIndex().then(()=>{if(drawer&&chatScope?.id===scope.id&&chatScope?.pluginId===scope.pluginId)updateContextChips();}).catch(error=>context.toast(error.message));}
  async function openControl(revision=++panelRevision,sourcePluginId,selectedId){
   if(!enabled(controlId))throw Error('请先启用对话控制');if(!await context.flush()||revision!==panelRevision)return;
   await flushWriting();await saveDraft(true);controlMode=true;const target=conversationTarget(),id=context.libraryId();
   const preferred=controlId;
   let remembered;try{remembered=localStorage.getItem('shensi-control-source:'+id);}catch{}
   if(![controlId,'official.whiteboard-generation','official.document-chat'].includes(remembered)||!enabled(remembered))remembered=null;
   const scope={pluginId:sourcePluginId||remembered||(enabled(preferred)?preferred:controlId),id};
   let data=await api('/chat/read',scope);if(revision!==panelRevision||id!==context.libraryId())return;
   let nextId=selectedId||data.activeId||data.conversations.find(c=>!c.archived)?.id;
   if(!nextId){data=await api('/chat/new',{...scope,documentId:target.documentId||'',target});nextId=data.activeId;}
   else if(selectedId)data=await api('/chat/activate',{...scope,conversationId:selectedId});
   if(revision!==panelRevision||id!==context.libraryId())return;
   panel('对话控制');controlMode=true;chatScope=scope;chatState=data;chatId=nextId;historySources=[];chatHistoryOpen=false;
   // The current conversation can open while the other history sources load.
   // Update only the history list, preserving the live composer and its draft.
   void api('/chat/history',{id}).then(value=>{if(chatScope===scope&&id===context.libraryId()){historySources=value.conversations;refreshHistoryList();}}).catch(error=>{if(chatScope===scope)context.toast(error.message);});
   await loadConsoles();if(chatScope!==scope)return;renderChat();void loadReferenceIndex().then(updateContextChips).catch(error=>context.toast(error.message));
  }
  const historyMarkup=()=>chatHistoryMarkup({conversations:chatState.conversations,activeId:chatId,notebookName:context.notebookName?.()||'当前笔记本',open:chatHistoryOpen,entry:chatHistoryEntry}).replace('<div class="chat-history-list">','<div class="chat-history-list">'+(controlMode?historySources.filter(c=>c.sourcePluginId!==chatScope.pluginId).map(c=>'<article class="chat-history-item" data-history-title="'+h((c.title||'新对话').toLowerCase())+'"><button type="button" class="chat-history-open" data-control-history="'+h(c.id)+'" data-control-source="'+h(c.sourcePluginId)+'"><span><strong>'+h(c.title||'新对话')+'</strong><small>'+h(c.sourcePluginId===controlId?'工坊／插件':c.sourcePluginId==='official.document-chat'?'原文档对话':'原白板对话')+(c.archived?' · 已归档':'')+'</small></span></button></article>').join(''):''));
  function consolePreview(message){if(!reviewAvailable())return '';return (consoleState?.consoles||[]).filter(item=>message?.receipts?.some(r=>String(r.tool||'').startsWith('console.')&&r.consoleId===item.id)&&[...(currentChat()?.messages||[])].reverse().find(m=>m.receipts?.some(r=>r.consoleId===item.id))?.id===message.id).map(writingPlaceholder).join('');}

  async function conversationAction(button,body){
   if(button.dataset.chatAnswer){
    const snapshot=chatBody(),pending=currentChat()?.pendingApproval;if(!pending||pending.id!==button.dataset.approvalId)throw Error('操作确认已过期');
    button.disabled=true;try{const prepared=button.dataset.chatAnswer==='allow'&&pending.kind==='map-generation'?await prepareMapReferences(pending.mapPreparation,a=>context.assetUrl(a.path,a.documentId,a.notebookId)):undefined;
     await api('/chat/answer',{...snapshot,approvalId:pending.id,answer:button.dataset.chatAnswer,...(pending.kind==='share-access-code'&&button.dataset.chatAnswer==='allow'?{secretValue:body.querySelector('[data-chat-secret]')?.value||''}:{}),...(prepared?{prepared}:{})});
     if(chatScope.id===snapshot.id&&chatScope.pluginId===snapshot.pluginId&&chatId===snapshot.conversationId){chatState=await api('/chat/read',chatScope);renderChat();}
    }finally{button.disabled=false;}return true;
   }
   if(controlMode&&button.dataset.controlHistory){await openControl(++panelRevision,button.dataset.controlSource,button.dataset.controlHistory);return true;}
   if(button.hasAttribute('data-chat-recover-original')){chatState=await api('/chat/recover-original',{...chatBody(),requestId:button.dataset.chatRecoverOriginal});await refreshWorkspace(chatScope.id);renderChat();return true;}
   const c=currentChat(),messageId=button.dataset.chatRewind||button.dataset.chatEditUser;
   if(button.hasAttribute('data-chat-web')){await saveDraft();chatState=await api('/chat/configure',{...chatBody(),webSearchEnabled:!c.webSearchEnabled});button.setAttribute('aria-pressed',String(!c.webSearchEnabled));const label=!c.webSearchEnabled?'关闭联网搜索':'开启联网搜索';button.title=label;button.setAttribute('aria-label',label);return true;}
   if(messageId){const message=c.messages.find(m=>m.id===messageId);if(button.dataset.chatRewind){await saveDraft();const answer=await context.modal('退回到输入框','<p>该条用户指令及之后的对话和排队任务会退出当前上下文，指令将放回输入框；原记录保留在本地归档。</p>',[['取消','cancel'],['退回','ok']]);if(answer.value==='ok'){chatState=await api('/chat/rewind',{...chatBody(),messageId});renderChat({preserveComposer:false});}}else{const form=body.querySelector('[data-chat-edit-form="'+CSS.escape(messageId)+'"]'),bubble=body.querySelector('[data-chat-user-bubble="'+CSS.escape(messageId)+'"]');if(form&&bubble){form.hidden=false;bubble.hidden=true;form.querySelector('textarea').focus();form.querySelector('textarea').setSelectionRange(message.text.length,message.text.length);}}return true;}
   const queueId=button.dataset.chatQueueEdit||button.dataset.chatQueueRemove||button.dataset.chatQueueSupplement;
   if(queueId||button.hasAttribute('data-chat-queue-resume')){const snapshot=chatBody();button.disabled=true;try{await saveDraft();let action=button.hasAttribute('data-chat-queue-resume')?'queue-resume':button.dataset.chatQueueSupplement?'queue-supplement':button.dataset.chatQueueEdit?'queue-edit':'queue-remove',text;if(action==='queue-edit'){const item=c.queue.find(t=>t.requestId===queueId),answer=await context.modal('编辑排队任务','<textarea name="text" aria-label="排队指令" rows="7">'+h(item.text)+'</textarea>');if(answer.value!=='ok')return true;text=answer.text;}const next=await api('/chat/'+action,{...snapshot,queueId,...(text!==undefined?{text}:{})});if(chatScope?.id===snapshot.id&&chatId===snapshot.conversationId){chatState=next;if(action==='queue-supplement')scrollChatToEnd=true;renderChat();}return true;}finally{button.disabled=false;}}
   return false;
  }

  function queueMarkup(c){return chatQueueMarkup(c,context.assetUrl);}
  function eventMarkup(c){const pending=c.pendingApproval,scoped=c.messages.some(m=>m.role==='user'&&m.requestId===c.requestId&&m.run),hasChoices=Array.isArray(pending?.options)&&pending.options.length>0;return '<div class="chat-live-state">'+(pending&&!hasChoices&&!['share-access-code','chushou-music-choice'].includes(pending.kind)?'<section class="chat-approval"><b>'+h(pending.title||pending.capability||'Agent 请求确认')+'</b><p>'+h(pending.description||pending.message||pending.question||'Agent 请求本次操作确认')+'</p><button data-chat-answer="allow" data-approval-id="'+h(pending.id)+'" class="primary">允许本次操作</button><button data-chat-answer="deny" data-approval-id="'+h(pending.id)+'">拒绝</button></section>':'')+(scoped?'':activityMarkup(c.events,c.status==='running')+savedDocumentsMarkup((c.events||[]).filter(e=>e.phase==='document_saved').map(e=>e.receipt))+(c.error?'<p class="error">'+h(c.error)+'</p>':''))+'</div>';}
  function updateChatRuntime(c){syncMusicPicker(c);const live=drawer?.querySelector('.chat-live-state'),feed=live?.closest('.chat-messages'),snapshot=captureChatScroll(feed);if(live)patchChatRuntime(live,eventMarkup(c));const m=c.messages.find(m=>m.run&&m.requestId===c.requestId),el=m&&feed?.querySelector('[data-turn-runtime="'+CSS.escape(m.requestId)+'"]');if(el)patchChatRuntime(el,turnActivityMarkup(m,c));if(feed)restoreChatScroll(feed,snapshot);}
  function renderChat({preserveComposer=true}={}){if(!drawer||!chatScope)return;syncMusicPicker(currentChat());const body=drawer.querySelector('.official-panel-body'),c=currentChat(),board=controlMode?conversationTarget().kind==='whiteboard':chatScope.pluginId==='official.whiteboard-generation',plugin=plugins.find(item=>item.id===chatScope.pluginId);if(!c){body.innerHTML='<p class="error">对话记录不存在，请重新打开。</p>';return;}const preferredProfile=pickerProfileId(profiles,c.profileId||plugin?.settings.textProfileId),currentProfile=profiles.find(p=>p.id===preferredProfile&&p.enabled!==false&&profileSupports(p,'text'))?.id||defaultTextProfile(profiles)?.id||'',archived=!!c.archived;
   const key=submissionKey(),existing=body.querySelector('[data-chat-draft]'),oldFeed=body.querySelector('.chat-messages'),scrollSnapshot=renderedChatKey===key?captureChatScroll(oldFeed):null,queueScroll=renderedChatKey===key?captureChatQueueScroll(body.querySelector('.chat-task-queue')):null,follow=scrollChatToEnd||renderedChatKey!==key||!oldFeed||(scrollSnapshot?.follow??true);if(preserveComposer&&existing&&renderedChatKey===key)c.draft=existing.value;renderedChatKey=key;scrollChatToEnd=false;
   for(const editor of writingEditors.values())editor.detach();
   const priorSecret=body.querySelector('[data-chat-secret]'),secretDraft=priorSecret&&priorSecret.dataset.chatSecret===c.pendingApproval?.id?{value:priorSecret.value,focused:document.activeElement===priorSecret}:null;drawer.classList.add('legacy-chat-panel');body.className='official-panel-body chat-body shensi-chat';body.innerHTML=chatSurfaceMarkup({conversation:c,profiles,profileId:currentProfile,board,currentDocument:context.current(),documents:context.state().documents,history:historyMarkup(),events:eventMarkup(c),queue:queueMarkup(c),consoleForMessage:consolePreview,assetUrl:context.assetUrl});
   if(secretDraft){const input=body.querySelector('[data-chat-secret]');if(input){input.value=secretDraft.value;if(secretDraft.focused)input.focus();}}
   if(controlMode){
    // Persist only the chosen history source, not the task target. Reloading a
    // board must not hide a running control conversation behind an empty one.
    try{localStorage.setItem('shensi-control-source:'+chatScope.id,chatScope.pluginId);}catch{}
    body.querySelector('.chat-visually-hidden').textContent='对话控制';
    // Old unlinked drafts remain reachable, but are never appended as a
    // permanent editor to ordinary replies. Opening this list creates nothing.
    const represented=new Set([...body.querySelectorAll('[data-writing-id]')].map(el=>el.dataset.writingId)),older=(consoleState?.consoles||[]).filter(item=>!represented.has(item.id));
    if(reviewAvailable()&&older.length){const history=document.createElement('details');history.className='writing-review-history';history.innerHTML='<summary>历史核对稿 · '+older.length+'</summary><div></div>';history.ontoggle=()=>{if(history.open&&!history.querySelector('[data-writing-id]')){history.querySelector('div').innerHTML=older.map(writingPlaceholder).join('');mountWriting(history);}};body.querySelector('.chat-messages').append(history);}
   }
   mountWriting(body);
   restoreChatQueueScroll(body.querySelector('.chat-task-queue'),queueScroll);
   bindChatQueue(body,{onError:error=>context.toast(error.message),reorder:async order=>{const snapshot=chatBody();await saveDraft();const next=await api('/chat/queue-reorder',{...snapshot,order});if(chatScope?.id===snapshot.id&&chatId===snapshot.conversationId){chatState=next;renderChat();}}});
   if((c.status==='running'||c.queue?.length&&!c.queuePaused)&&!chatPollTimer)chatPollTimer=setInterval(()=>void refreshChat().catch(()=>{}),1000);
   updateContextChips();setChatHistory(chatHistoryEntry,chatHistoryOpen,false);
   const linkNotebookId=chatScope.id;
   chatPresentationCleanup?.();chatPresentationCleanup=bindChatPresentation(body,{api:context.api,localLink:(href,messageId)=>{const target=chatAttachmentTarget(href,c.messages.find(m=>m.id===messageId),linkNotebookId);return target?{url:context.assetUrl(target.path,target.documentId,target.notebookId),filename:target.filename}:null;},onLink:async url=>{try{if(url.startsWith('#doc:'))return context.openDocument(url.slice(5));if(/^(https?:|mailto:)/i.test(url)){const result=await context.api('/api/open-link',{url});if(!result.opened)window.open(result.url,'_blank','noopener');}}catch(error){context.toast(error.message);}}});
   body.querySelector('.chat-compose').onsubmit=submitChat;updateSubmission();
   const feed=body.querySelector('.chat-messages');restoreChatScroll(feed,scrollSnapshot,{follow,reuse:true});
   body.querySelector('[data-chat-draft]').addEventListener('keydown',event=>{if(event.isComposing||event.keyCode===229)return;const command=board?'sendWhiteboardChat':'sendDocumentChat',binding=(context.preferences?.()||DEFAULT_PREFERENCES).shortcuts?.[command];if(binding&&shortcutFromEvent(event).toLowerCase()===binding.toLowerCase()){event.preventDefault();event.stopPropagation();if(!event.repeat)body.querySelector('.chat-compose').requestSubmit();}});
   body.querySelector('[data-chat-draft]').oninput=()=>{clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,300);};
   body.querySelector('.chat-compose').addEventListener('submit',()=>{clearTimeout(draftTimer);draftTimer=null;},true);
    for(const form of body.querySelectorAll('[data-chat-edit-form]'))form.onsubmit=async event=>{event.preventDefault();const messageId=form.dataset.chatEditForm,text=form.elements.text.value;if(!text.trim())return;try{await saveDraft();chatState=await api('/chat/branch',{...chatBody(),messageId,text});chatId=chatState.activeId;renderChat();drawer.querySelector('.chat-compose').requestSubmit();}catch(error){context.toast(error.message);}};
    const configureModel=event=>{
     event.stopPropagation();
     const revision=++modelSelectionRevision,live=drawer.querySelector('.shensi-chat'),profileSelect=live.querySelector('[data-chat-profile]'),mapping=live.querySelector('[data-chat-model-mapping]'),profileId=profileSelect?.value||'',profile=profiles.find(p=>p.id===profileId);
     if(event.target===profileSelect)mapping.innerHTML=modelFieldsMarkup(profile,{},archived||c.status==='running');
     else if(event.target.matches('[data-chat-model]'))mapping.innerHTML=modelFieldsMarkup(profile,{model:event.target.value},archived||c.status==='running');
     const selection={profileId,model:mapping.querySelector('[data-chat-model]')?.value||'',reasoningEffort:mapping.querySelector('[data-chat-reasoning]')?.value||'',speedMode:mapping.querySelector('[data-chat-speed]')?.value||'default'},scopeSnapshot={...chatScope,conversationId:chatId},scopeKey=JSON.stringify(chatScope),conversationId=chatId,draftSaved=saveDraft();
     live.querySelector('[data-chat-model-label]').textContent=textModelSummary(profile,selection);
     modelChangePromise=modelChangePromise.then(()=>draftSaved).then(()=>api('/chat/configure',{...scopeSnapshot,...selection})).then(state=>{
      if(revision!==modelSelectionRevision||JSON.stringify(chatScope)!==scopeKey||chatId!==conversationId||!drawer)return;
      chatState=state;
      const selected=currentChat(),fresh=drawer.querySelector('.shensi-chat'),selectedProfile=profiles.find(p=>p.id===selected.profileId);
      fresh.querySelector('[data-chat-model-label]').textContent=textModelSummary(selectedProfile,selected);
      fresh.querySelector('[data-chat-model-mapping]').innerHTML=modelFieldsMarkup(selectedProfile,selected,selected.archived||selected.status==='running');
     }).catch(error=>{context.toast(error.message);if(revision===modelSelectionRevision&&JSON.stringify(chatScope)===scopeKey&&chatId===conversationId)renderChat();});
    };
    if(modelSelectionListener)body.removeEventListener('change',modelSelectionListener,true);
    modelSelectionListener=event=>{if(event.target.matches('[data-chat-profile],[data-chat-model],[data-chat-reasoning],[data-chat-speed]'))configureModel(event);};
    body.addEventListener('change',modelSelectionListener,true);
   body.querySelector('[data-chat-references]').onclick=()=>void references().catch(error=>context.toast(error.message));
   body.querySelector('[data-chat-upload]').onclick=()=>body.querySelector('[data-chat-files]').click();
   body.querySelector('[data-chat-files]').onchange=event=>void uploadChatFiles(event.target.files).catch(error=>context.toast(error.message));
   body.oninput=event=>{if(event.target.matches('[data-chat-history-search]')){const query=event.target.value.toLowerCase();body.querySelectorAll('.chat-history-item').forEach(item=>item.hidden=!(item.dataset.historyTitle||item.textContent.toLowerCase()).includes(query));}};
   if(!body.dataset.chatSavedLinksBound){body.dataset.chatSavedLinksBound='true';body.addEventListener('click',event=>{const link=event.target.closest('[data-chat-saved-document]');if(!link||!context.openSavedDocument)return;event.preventDefault();void Promise.resolve(context.openSavedDocument(link.dataset.notebook,link.dataset.chatSavedDocument)).catch(error=>context.toast(error.message));});}
   body.onchange=async event=>{
    const control=event.target,handled=control.dataset.versionSelect||control.matches('[data-console-select],[data-console-version]');if(!handled)return;
    control.disabled=true;
    try{
     await saveDraft();
     if(control.dataset.versionSelect){chatState=await api('/chat/select',{...chatBody(),messageId:control.dataset.versionSelect,index:Number(control.value)});renderChat();}
     else if(control.matches('[data-console-select]')){consoleId=control.value;renderChat();}
     else{const selected=consoleState.consoles.find(item=>item.id===consoleId);await consoleCall('select',{consoleId,versionId:control.value,expectedRevision:selected.revision,requestId:'console-select-'+crypto.randomUUID()});await loadConsoles();renderChat();}
    }catch(error){context.toast(error.message);}finally{if(control.isConnected)control.disabled=false;}
   };
   body.onclick=async event=>{const button=event.target.closest('button');if(!button||button.matches('.chat-compose button[type=submit]'))return;try{if(button.dataset.consoleStep){consoleId=button.dataset.consoleId||consoleId;const selected=consoleState?.consoles?.find(item=>item.id===consoleId),versions=selected?.versions||[],index=versions.findIndex(v=>v.id===selected.viewVersionId),version=versions[index+Number(button.dataset.consoleStep)];if(version){await consoleCall('select',{consoleId,versionId:version.id,expectedRevision:selected.revision,requestId:'console-arrow-'+crypto.randomUUID()});await loadConsoles();renderChat();}return;}if(await conversationAction(button,body))return;if(button.dataset.chatEditCancel){const form=body.querySelector('[data-chat-edit-form="'+CSS.escape(button.dataset.chatEditCancel)+'"]'),bubble=body.querySelector('[data-chat-user-bubble="'+CSS.escape(button.dataset.chatEditCancel)+'"]');if(form&&bubble){form.hidden=true;bubble.hidden=false;}return;}if(button.hasAttribute('data-chat-history')){setChatHistory('toolbar');}else if(button.hasAttribute('data-chat-workspace-history')){setChatHistory('composer');}else if(button.hasAttribute('data-chat-history-close')){setChatHistory(chatHistoryEntry,false);}else if(button.hasAttribute('data-chat-export')){exportChat();}else if(button.dataset.chatCopy){await navigator.clipboard.writeText(body.querySelector('[data-message-text="'+button.dataset.chatCopy+'"]').value);context.toast('已复制');}else if(button.dataset.chatRemoveRef||button.hasAttribute('data-chat-remove-attachment')){const snapshot=chatBody(),live=currentChat(),key=button.dataset.chatRemoveRef,patch=key?{[key]:effectiveRefs(live,key).filter((_,index)=>index!==Number(button.dataset.refIndex))}:{attachments:(live.attachments||[]).filter((_,index)=>index!==Number(button.dataset.chatRemoveAttachment))};await saveDraft();const state=await api('/chat/configure',{...snapshot,...patch});if(chatScope.id===snapshot.id&&chatId===snapshot.conversationId){chatState=state;updateContextChips();}}else if(button.hasAttribute('data-chat-new')){await saveDraft();chatState=await api('/chat/new',chatBody());chatId=chatState.activeId;chatHistoryOpen=false;if(controlMode||board)await loadConsoles();renderChat();}else if(button.dataset.chatSelect){await saveDraft();chatId=button.dataset.chatSelect;chatState=await api('/chat/activate',{...chatScope,conversationId:chatId});chatHistoryOpen=false;if(controlMode||board)await loadConsoles();renderChat();}else if(button.dataset.chatRename){await saveDraft();const entry=chatState.conversations.find(item=>item.id===button.dataset.chatRename),answer=await context.modal('重命名对话',`<label>对话名称<input name="title" maxlength="120" value="${h(entry?.title||'')}" aria-label="对话名称"></label>`,[['取消','cancel'],['保存','ok']]);if(answer.value==='ok'){await api('/chat/rename',{...chatScope,conversationId:button.dataset.chatRename,title:answer.title});chatState=await api('/chat/read',chatScope);refreshHistoryList();}}else if(button.dataset.chatDelete){if(!(await context.flush()))return;await saveDraft();const answer=await context.modal('将对话移入回收站？','<p>对话全文可从回收站预览或恢复。</p>',[['取消','cancel'],['移入回收站','delete']]);if(answer.value==='delete'){await api('/chat/delete',{...chatScope,conversationId:button.dataset.chatDelete});await refreshWorkspace(chatScope.id);chatState=await api('/chat/read',chatScope);chatId=chatState.activeId;if(!chatId){chatState=await api('/chat/new',chatBody());chatId=chatState.activeId;}renderChat();}}else if(button.dataset.chatArchive){await saveDraft();const entry=chatState.conversations.find(item=>item.id===button.dataset.chatArchive);await api('/chat/archive',{...chatScope,conversationId:entry.id,archived:!entry.archived});if(entry.id===chatId&&!entry.archived){chatState=await api('/chat/new',chatBody());chatId=chatState.activeId;renderChat();}else{chatState=await api('/chat/read',chatScope);refreshHistoryList();}}else if(button.hasAttribute('data-chat-rename-current')){const answer=await context.modal('重命名对话',`<label>对话名称<input name="title" maxlength="120" value="${h(c.title)}" aria-label="对话名称"></label>`,[['取消','cancel'],['保存','ok']]);if(answer.value==='ok'){chatState=await api('/chat/rename',{...chatBody(),title:answer.title});renderChat();}}else if(button.hasAttribute('data-chat-archive-current')){await api('/chat/archive',{...chatBody(),archived:true});chatState=await api('/chat/new',chatBody());chatId=chatState.activeId;renderChat();}else if(button.hasAttribute('data-chat-stop')){await api('/chat/stop',chatBody());context.toast('已请求停止');}else if(button.hasAttribute('data-chat-supplement')){await submitChat(event);}else if(button.dataset.chatAnswer){await api('/chat/answer',{...chatBody(),approvalId:button.dataset.approvalId,answer:button.dataset.chatAnswer});chatState=await api('/chat/read',chatScope);renderChat();}else if(button.dataset.chatVersionStep){const message=currentChat().messages.find(m=>m.id===button.dataset.messageId),index=(message.versionIndex||0)+Number(button.dataset.chatVersionStep);await saveDraft();chatState=await api('/chat/select',{...chatBody(),messageId:message.id,index});renderChat();}else if(button.hasAttribute('data-chat-console-open')){await saveDraft();if(!context.current()?.canvas){context.toast('请先选择要编辑稿件的白板');return;}consoleId=button.dataset.chatConsoleOpen||consoleId;const result=await openConsoleEditor({modal:context.modal,call:consoleCall,toast:context.toast,selectedId:consoleId});consoleId=result.selectedId;await loadConsoles();renderChat();}else if(button.hasAttribute('data-generation-draft'))await generationDraft();}catch(error){context.toast(error.message);}};
  }
  function enginesName(id){return ({codex_api:'神思运行器',codex:'Codex 本地 Agent',opencode:'OpenCode',deepseek_opencode:'OpenCode + DeepSeek',claude_code:'Claude Code',workbuddy:'WorkBuddy',custom:'自定义 Agent'})[id]||id;}
 async function currentChatProfile(){await modelChangePromise;await refreshProfiles();const defaultProfile=()=>defaultTextProfile(profiles)?.id||'';const id=context.libraryId();if(chatScope?.id===id&&currentChat())return currentChat().profileId||plugins.find(p=>p.id===chatScope.pluginId)?.settings.textProfileId||defaultProfile();const pluginId=context.current()?.canvas?'official.whiteboard-generation':'official.document-chat',state=await api('/chat/read',{id,pluginId});return state.conversations.find(c=>c.id===state.activeId)?.profileId||plugins.find(p=>p.id===pluginId)?.settings.textProfileId||defaultProfile();}
 async function locateMediaTask(job,scope){
  const target=mediaTaskDestination(job,scope);await saveDraft(true);await context.openSavedDocument(target.notebookId,target.documentId);
  if(context.libraryId()!==target.notebookId||context.current()?.id!==target.documentId)throw Error('未能打开任务所属文档，请先处理保存或文档状态');
  if(target.nodeId&&context.current()?.canvas){await context.focusBoardNode?.(target.nodeId);return;}
  if(!target.conversationId)throw Error('此任务没有可定位的对话身份，已打开所属文档');
  const chatTarget={pluginId:target.board?'official.whiteboard-generation':'official.document-chat',id:target.notebookId};
  const data=await api('/chat/read',chatTarget);if(!data.conversations.some(c=>c.id===target.conversationId))throw Error('任务所属对话已不存在，已打开原文档');
  await api('/chat/activate',{...chatTarget,conversationId:target.conversationId});await chat(target.board);
 }
 let profileRefresh,profileRefreshedAt=0;
 const refreshProfiles=()=>{if(catalogFlight)return catalogFlight;if(profileRefresh)return profileRefresh;if(profileRefreshedAt&&Date.now()-profileRefreshedAt<30000)return Promise.resolve();const revision=catalogRevision;profileRefresh=api('/models').then(result=>{if(revision!==catalogRevision)return;profiles=result.profiles;updateCardModelDefaults(result);profileRefreshedAt=Date.now();}).finally(()=>profileRefresh=null);return profileRefresh;};
 const media=createMediaUI({context:{...context,locateMediaTask,includeDocumentTasks:()=>plugins.some(p=>p.id==='official.document-chat'&&p.enabled)},api,panel,options,profiles:()=>profiles,refreshProfiles,plugin:()=>plugins.find(p=>p.id==='official.whiteboard-generation')});
 const generationDraft=()=>media.draft();
 const queue=()=>media.queue();
async function action(action){if(['official-control','official-chat','official-board'].includes(action)&&enabled(controlId)){if(controlMode&&drawer?.querySelector('[data-chat-draft]')&&chatScope?.id===context.libraryId()){context.revealPanel?.();updateContextChips();return;}return openControl(++panelRevision);}const revision=++panelRevision,target=action==='official-chat'?'official.document-chat':action==='official-board'?'official.whiteboard-generation':'';if(target)controlMode=false;if(target&&chatScope?.pluginId===target&&chatScope.id===context.libraryId()&&drawer?.querySelector('[data-chat-draft]')&&enabled(target)){context.revealPanel?.();return;}const selection=action==='official-reader-selection'?context.selectedText?.()||'':'';await saveDraft(true);if(revision!==panelRevision)return;if(action==='official-reader'||action==='official-reader-selection')return openReader(selection);if(action==='official-works')return works();if(action==='official-graph')return graph();if(action==='official-links')return links();if(action==='official-sync')return sync();if(action==='official-chat')return chat(false,revision);if(action==='official-board')return chat(true,revision);if(action==='official-queue')return queue();if(action==='official-credits')return media.showCredits();if(action==='official-generate')return media.draft();}
 document.addEventListener('shensi:open-reader',()=>{void action('official-reader').catch(error=>context.toast(error.message));});
 async function mountSettings(id,target){if(['thirdparty.credential-vault','thirdparty.browser'].includes(id))return mountBrowserSettings(target,{...context,contextMenu});target.classList.toggle('plugin-native-copy',id.startsWith('thirdparty.'));if(id==='thirdparty.text-reader')return reader.settings(target);if(id==='thirdparty.doubao')return mountDoubaoSettings(target,context);if(id==='thirdparty.local-h3')return mountLocalH3Settings(target,{api:context.api,toast:context.toast,modal:context.modal,refresh});if(id==='official.nutstore')return sync(target);if(id===controlId||id==='official.whiteboard-generation')return mountGenerationSettings(target,{api:context.api,toast:context.toast,refresh});}
 let contextNotebook='',contextDocument='';
 async function changeChatNotebook(pluginId,id){
  releaseWriting();consoleLoadRevision++;const scope={pluginId,id};chatScope=scope;chatState=null;chatId='';consoleState=null;consoleId='';clearInterval(chatPollTimer);chatPollTimer=null;
  drawer.querySelector('.official-panel-body').textContent='正在读取当前笔记本的对话…';
  try{let state=await api('/chat/read',scope);if(chatScope?.id!==id||chatScope?.pluginId!==pluginId)return;if(!state.activeId)state=await api('/chat/new',{...scope,documentId:context.current()?.id||'',...(controlMode?{target:conversationTarget()}:{})});chatState=state;chatId=state.activeId;if(controlMode){historySources=(await api('/chat/history',{id})).conversations;if(chatScope!==scope)return;}if(controlMode||pluginId==='official.whiteboard-generation'&&context.current()?.canvas)await loadConsoles();if(chatScope===scope)renderChat();}catch(error){if(drawer&&chatScope?.id===id)drawer.querySelector('.official-panel-body').textContent=error.message;}
 }
 function onRender(){
  if(readerOpen&&!enabled('thirdparty.text-reader'))close();
  if(drawer&&chatScope){
   const id=context.libraryId(),doc=context.current();
   if(!enabled(chatScope.pluginId.replace('official.',''))||controlMode&&!enabled(controlId)){close();}
   else if(id!==chatScope.id){const savedScope={...chatScope,conversationId:chatId},text=drawer.querySelector('[data-chat-draft]')?.value;if(chatId&&text!==undefined)void persistDraft(savedScope,text).catch(()=>{});void changeChatNotebook(chatScope.pluginId,id);}
   else if(contextNotebook!==id||contextDocument!==(controlMode?targetKey(conversationTarget()):doc?.id)){
    if(controlMode){for(const editor of writingEditors.values())editor.detach({hideExpanded:true});consoleState=null;consoleId='';renderChat();}
    updateContextChips();
    if(controlMode||chatScope.pluginId==='official.whiteboard-generation')void flushWriting().then(loadConsoles).then(()=>{const compose=drawer?.querySelector('[data-chat-draft]'),text=compose?.value;if(text!==undefined&&currentChat())currentChat().draft=text;renderChat();}).catch(error=>context.toast(error.message));
   }
   contextNotebook=id;contextDocument=controlMode?targetKey(conversationTarget()):doc?.id;
  }
  void renderGraph();
 }
 return {currentTarget:conversationTarget,configureConversationContext:value=>{conversationContext=value;},closeEditorPanel:()=>{if(!readerOpen&&!controlMode)close();},currentChatProfile,settleModelSelection:()=>modelChangePromise,mountSettings,refresh,rail,header:()=>'',mountCanvas,paintMediaCards:()=>media.paintCards?.(),action,close,onRender,enabled,dockEntries,beforeSwitch:async()=>{await flushWriting();await saveDraft(true);},generate:channel=>media.draft({channel})};
}
