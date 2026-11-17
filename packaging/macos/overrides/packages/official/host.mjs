import {createBookService} from './books.mjs';
import {createBrowserService} from '../thirdparty/browser/service.mjs';
import {createBrowserProfiles} from '../thirdparty/browser/profiles.mjs';
import {createConversationControl} from './conversation-control.mjs';
import {createNovelPublisher} from '../thirdparty/novel-publisher/service.mjs';
import {createCredentialVault,VAULT_PLUGIN_ID} from '../thirdparty/credential-vault.mjs';
import {createBoardVideoParser} from './video-parser.mjs';
import {createMapWorkshop} from '../thirdparty/map-workshop.mjs';
import {createGlyphWorkshop} from '../thirdparty/glyph-workshop.mjs';
import {createDoubaoPlugin} from '../thirdparty/doubao.mjs';
import {createDoubaoMedia} from '../thirdparty/doubao-media.mjs';
import {createMediaRouter} from './media-router.mjs';
import {createDoubaoAccountQueue} from '../thirdparty/doubao-account-queue.mjs';
import {createTextMedia} from './text-media.mjs';
import {createTextReader} from '../thirdparty/text-reader.mjs';
import {createSpeechMedia} from '../thirdparty/speech-media.mjs';
import {createWorkTools} from './work-tools.mjs';
import {registerLegacyXuannianRecycle} from '../core/src/legacy-xuannian-recycle.mjs';
import {createCharacterParlor} from './character-parlor.mjs';
import {createPluginRecycle} from './plugin-recycle.mjs';
import {pluginStorage} from '../core/src/plugin-storage.mjs';
import {createLocalH3Plugin,LOCAL_H3_PLUGIN_ID,LOCAL_H3_PACKAGE} from '../thirdparty/local-h3.mjs';
import {profileSupports,profileHasMedia} from '../ui/model-capabilities.js';
import {isAbsolute} from 'node:path';
import {join} from 'node:path';
import {OFFICIAL_PLUGINS} from './catalog.mjs';
import {nativeExtensionRuntime} from '../core/src/native-extensions.mjs';
import {jsonStore,failure} from './store.mjs';
import {createModelService} from './models.mjs';
import {createModelDefaults} from './model-defaults.mjs';
import {createModelVerification} from './model-verification.mjs';
import {createMembershipService} from './membership.mjs';
import {createDesktopCloudNotebooks} from './cloud-notebooks.mjs';
import {activateWork,deactivateWork,workItem,linkIndex,globalLinkIndex,connectDocuments,disconnectDocuments} from './workspace.mjs';
import {createChatService} from './chat.mjs';
import {assertNotebookIdle} from './notebook-activity.mjs';
import {createSelectionEdits} from './selection-edits.mjs';
import {createMediaService} from './media.mjs';
import {createVerificationBudget} from './verification-budget.mjs';
import {createKnowledgeService} from './knowledge.mjs';
import {createConsoleService} from './consoles.mjs';
import {createAgentService} from './agent.mjs';
import {createDepthService} from './depth.mjs';
import {createNutstoreSyncEngine} from './legacy/server/nutstore-sync/sync-engine.mjs';
import {createWebDavClient} from './legacy/server/nutstore-sync/webdav-client.mjs';
import {createDesktopNutstoreNotebooks} from './nutstore-notebooks.mjs';
export function createOfficialHost({service,desktop={},syncOptions={},mediaOptions={},agentOptions={},memberOptions={},depthOptions={},localH3Options={},readerOptions={},bookOptions={},consoleService,extensions}){
 const registry=jsonStore(join(service.dataRoot,'plugins','official.json'),{}),models=createModelService({dataRoot:service.dataRoot,desktop,consolidateLegacyAccounts:true});
 const recycle=createPluginRecycle(service);
 const storage=pluginStorage(service);storage.setRecycle(recycle);
 registerLegacyXuannianRecycle({service,recycle});
 const membership=createMembershipService({dataRoot:service.dataRoot,models,...memberOptions});models.setMemberResolver(membership.resolve);models.setMemberAccess(membership.modelAccess);
 const cloudNotebooks=createDesktopCloudNotebooks({service,membership});
 const nutstoreNotebooks=createDesktopNutstoreNotebooks({service,models,fetchImpl:desktop.syncFetch});
 const nativeVersion=id=>{const runtime=nativeExtensionRuntime();return runtime?.dataRoot===service.dataRoot?runtime.records[id]?.version:'';};
 const list=async()=>{const saved=await registry.read();return OFFICIAL_PLUGINS.map(p=>{
  const owner=p.managedBy?saved[p.managedBy]||{}:null;const record=saved[p.id]||(p.id==='thirdparty.browser'?saved['thirdparty.credential-vault']:null)||{},version=nativeVersion(p.id),nativeInstalled=version&&p.id!=='thirdparty.local-h3'&&!record.nativeUninstalledVersion;
  const installed=p.category==='official'||!!nativeInstalled?true:record.installed??p.installed;
  return {...structuredClone(p),...record,settings:{...p.settings,...record.settings,...owner?.settings},...(p.managedBy?{enabled:owner.enabled!==false,managedBy:p.managedBy}:{}),...(installed!==undefined?{installed}:{}),...(nativeInstalled?{enabled:record.enabled??true}:{}),available:p.category!=='official'&&installed===false};
 });};
 const modelDefaults=createModelDefaults({dataRoot:service.dataRoot,models,legacySettings:async()=>(await list()).find(p=>p.id==='official.whiteboard-generation')?.settings||{}});
 service.setCardDefaultResolver?.(async()=>(await modelDefaults.read()).defaultProfiles);
 models.setBuiltinSource(LOCAL_H3_PLUGIN_ID,async()=>{const p=(await list()).find(p=>p.id===LOCAL_H3_PLUGIN_ID);return p?.installed===true&&p.enabled===true;});
 models.setBuiltinSource('thirdparty.text-reader',async()=>{const p=(await list()).find(p=>p.id==='thirdparty.text-reader');return p?.installed===true&&p.enabled===true;});
 const requirePlugin=async id=>{if(id===VAULT_PLUGIN_ID)id='thirdparty.browser';const p=(await list()).find(p=>p.id===id);if(!p?.enabled||p.installed===false)throw failure('插件尚未启用','PLUGIN_DISABLED');return p;};
 const browserProfiles=createBrowserProfiles({dataRoot:service.dataRoot});
 const vault=createCredentialVault({dataRoot:service.dataRoot,windows:desktop.vault,requirePlugin,browserProfiles});
 const browser=createBrowserService({service,desktop,requirePlugin,vault,models,profiles:browserProfiles});
 desktop.videoParser?.connectAccounts?.(browser.shareAccounts);
 models.setBrowserProfileResolver(browser.modelSettings);
 const sync=createNutstoreSyncEngine({dataRoot:service.dataRoot,machineRoot:join(service.dataRoot,'machine'),desktopRuntime:!!desktop.encryptSecret,...(desktop.syncFetch?{clientFactory:options=>createWebDavClient({...options,fetchImpl:desktop.syncFetch})}:{}),...syncOptions,withLocalLock:service.exclusive});
 let syncHostClosed=false;
 const unsubscribeSync=service.subscribe(()=>{if(syncHostClosed)return;void (async()=>{await requirePlugin('official.nutstore');if(!syncHostClosed)await sync.noteLocalChange('*');})().catch(()=>{});});
 const budget=createVerificationBudget({dataRoot:service.dataRoot}),legacyMedia=createMediaService({service,models,requirePlugin,budget,webImageReader:vault.readDreaminaResult,...mediaOptions}),knowledge=createKnowledgeService(service),consoles=consoleService||createConsoleService(service);
 const doubao=createDoubaoPlugin({service,desktop,models,requirePlugin,recycle});
 const modelVerification=createModelVerification({models,desktop,vault,browser,doubao,cwd:service.dataRoot});
 const doubaoMedia=createDoubaoMedia({service,models,doubao,requirePlugin,budget});doubao.setMedia(doubaoMedia);
 const reader=createTextReader({service,models,requirePlugin,...readerOptions}),speechMedia=createSpeechMedia({service,models,reader,requirePlugin});
 const textMedia=createTextMedia({service,models,requirePlugin,runText:request=>agent.run(request)});
 const media=createMediaRouter({service,legacy:legacyMedia,browser:doubaoMedia,speech:speechMedia,text:textMedia,models,accountQueue:createDoubaoAccountQueue(doubao.tasks)});
 const localH3=createLocalH3Plugin({models,stopProfiles:ids=>media.stopProfiles(ids),...localH3Options});
 const books=createBookService({service,...bookOptions});
 const maps=createMapWorkshop({service,models,media,requirePlugin,recycle});
 const glyphs=createGlyphWorkshop({service,requirePlugin,recycle});
 const control=createConversationControl({service,requirePlugin,maps,glyphs,extensions,consoles,browser});
 const agent=createAgentService({service,models,media,knowledge,consoles,budget,books,control,...agentOptions,chushouOptions:{websiteTranscriber:desktop.chushouTranscriber,videoParser:desktop.videoParser,...agentOptions.chushouOptions}});
 const characters=createCharacterParlor({service,models,agent,requirePlugin,recycle});
 const publisher=createNovelPublisher({service,desktop,requirePlugin});
 const videoParser=createBoardVideoParser({service,requirePlugin,runtime:desktop.videoParser});
 const workTools=createWorkTools({service,agent,knowledge,books,models,requirePlugin,recycle});
 const chat=createChatService({service,models,requirePlugin,agent,consoles,media,books,control,doubao}),depth=createDepthService({service,requirePlugin,...depthOptions});
 const selectionEdits=createSelectionEdits({service,agent,chat,models,requirePlugin,doubao});
 models.setProfileStopper(async ids=>{await reader.stopProfiles(ids);await characters.stopAll(ids);await selectionEdits.abortProfiles(ids);await workTools.abortProfiles(ids);await chat.abortProfiles(ids);return media.stopProfiles(ids);});
 let syncedCredential=false;
 async function hydrateSync(){if(syncedCredential)return;const saved=await models.secret('nutstore');if(saved)await sync.setSessionCredentials(JSON.parse(saved));syncedCredential=true;}
 async function update({pluginId,enabled,settings,uninstall=false,install=false}){
  if(pluginId===VAULT_PLUGIN_ID)pluginId='thirdparty.browser';
  if(settings&&/^(official.conversation-control|official.whiteboard-generation|official.document-chat)$/.test(pluginId))await modelDefaults.read();
  if(OFFICIAL_PLUGINS.find(p=>p.id===pluginId)?.managedBy)pluginId='official.conversation-control';
  const base=OFFICIAL_PLUGINS.find(p=>p.id===pluginId);if(!base)throw failure('未知官方插件');if(uninstall&&base.category==='official')throw failure('核心插件只能停用，不能卸载','CORE_PLUGIN_REQUIRED');
  let localH3Install;
  if(pluginId===LOCAL_H3_PLUGIN_ID){if(install)localH3Install=await localH3.install();else if(enabled===true&&(await list()).find(p=>p.id===pluginId)?.installed!==true)throw failure('请先安装本地 H3 插件');if(enabled===false||uninstall)await localH3.stop({onlyOwned:true});}
  if(settings){const available=(await models.list()).profiles;for(const [key,value] of Object.entries(settings)){if((!base.package.settings.some(f=>f.key===key)&&! /^(text|image|video|audio)ProfileId$/.test(key))||typeof value!=='string'||value.length>4000)throw failure('无效插件参数');if(key==='defaultRunPath'&&value&&!isAbsolute(value))throw failure('默认运行路径必须是绝对路径');if(/ProfileId$/.test(key)&&value&&!available.some(p=>p.id===value&&profileSupports(p,key.replace('ProfileId',''))))throw failure('所选模型不存在或类型不匹配');}}
  if(pluginId==='official.works'&&(enabled===false||uninstall))await workTools.stopAll();
  if(pluginId==='thirdparty.browser'&&(enabled===false||uninstall)){await browser.close();await vault.close();}
  if(pluginId==='thirdparty.novel-publisher'&&(enabled===false||uninstall))await publisher.close();
  if(['thirdparty.map-workshop','official.whiteboard-generation'].includes(pluginId)&&(enabled===false||uninstall))await maps.stopAll();
  if(pluginId==='official.whiteboard-generation'&&(enabled===false||uninstall))await videoParser.stopAll();
  if(pluginId==='thirdparty.doubao'&&(enabled===false||uninstall)){await stopExternalProvider(pluginId);await doubao.stop();}
  if(pluginId==='thirdparty.character-chat'&&(enabled===false||uninstall))await characters.stopAll();
  if(pluginId==='thirdparty.text-reader'&&(enabled===false||uninstall)){models.blockProvider(pluginId);await speechMedia.stopAll();await reader.stopTasks();}
  if(pluginId==='official.nutstore'&&(enabled===false||uninstall)){await sync.pause();await nutstoreNotebooks.settle();}
  const runtime=nativeExtensionRuntime(),pending=runtime?.dataRoot===service.dataRoot?(await runtime.snapshot()).pending[pluginId]:null;
  await registry.update(s=>{const current=s[pluginId]||{};s[pluginId]={...current,...(enabled!==undefined?{enabled:!!enabled}:{}),...(settings?{settings:{...base.settings,...current.settings,...settings}}:{}),...(uninstall?{installed:false,enabled:false,nativeUninstalledVersion:pending?.version||nativeVersion(pluginId)||null}:{}),...(install?{installed:true,enabled:true}:{}),...(!uninstall&&(install||enabled!==undefined)?{nativeUninstalledVersion:null}:{})};return s;});
  if(pluginId==='official.whiteboard-generation'&&enabled===true)videoParser.resume();
  if(pluginId==='thirdparty.novel-publisher'&&(enabled===true||install))publisher.resume();
  if(pluginId==='thirdparty.browser'&&(enabled===true||install))browser.resume();
  if(pluginId==='thirdparty.doubao'&&(enabled===true||install)){models.unblockProvider(pluginId);doubao.resume();await doubao.configureAccounts();}
  if(pluginId==='thirdparty.text-reader'&&(enabled===true||install)){models.unblockProvider(pluginId);await reader.enable();}
  if(pluginId==='official.conversation-control'&&(enabled===false||uninstall)){await selectionEdits.stopAll();await maps.stopAll();await videoParser.stopAll();for(const source of ['official.document-chat','official.whiteboard-generation'])await chat.abortPlugin(source);}
  if(pluginId==='official.conversation-control'&&(enabled===true||install))videoParser.resume();
  let mediaStop;if((enabled===false||uninstall)&&['official.document-chat','official.whiteboard-generation','official.conversation-control'].includes(pluginId))mediaStop=await chat.abortPlugin(pluginId);
  if((enabled===false||uninstall)&&pluginId==='thirdparty.depth-explorer')await depth.stopAll();
  return {plugins:await list(),...(mediaStop?{mediaStop}:{}),...(localH3Install?{localH3:localH3Install}:{})};
 }
 async function syncAction(action,body){await requirePlugin('official.nutstore');await hydrateSync();if(action==='status')return sync.status();if(action==='configure'){const before=await sync.status();if(before.account&&body.account&&body.account!==before.account)throw failure('更换账号前请先点击“更换账号”，以隔离两账号的同步基线');const retained=await models.secret('nutstore');const result=await sync.configure(body);if(body.remember!==false)await models.putSecret('nutstore',JSON.stringify({account:result.account,password:body.password||(retained?JSON.parse(retained).password:'')}));else await models.putSecret('nutstore','');return {configured:true,capabilityLevel:result.capabilityLevel};}if(['disconnect','switch'].includes(action)){await models.putSecret('nutstore','');syncedCredential=false;}const allowed={switch:sync.switchAccount,test:sync.testConnection,preview:sync.firstSyncPreview,enable:sync.enable,run:sync.run,pause:sync.pause,resume:sync.resume,disconnect:sync.disconnect,auto:sync.setAutoSync,operations:sync.operations,conflicts:sync.conflicts,resolve:sync.resolveConflict,retry:sync.retry,logs:sync.logs};if(!allowed[action])throw failure('未知同步操作');return allowed[action](body);}
 async function handle(path,body){
  if(path.startsWith('/browser-profiles/'))return browser.manage(path.slice('/browser-profiles/'.length),body);
  if(path.startsWith('/sync-notebooks/')){await requirePlugin('official.nutstore');return nutstoreNotebooks.handle(path.slice('/sync-notebooks/'.length),body);}
  if(path.startsWith('/publisher/'))return publisher.handle(path.slice(11),body);
  if(path.startsWith('/plugin-storage/'))return storage.handle(path.slice(16),body);
  if(path.startsWith('/glyphs/'))return glyphs.handle(path.slice(8),body);
  if(path.startsWith('/vault/'))return vault.handle(path.slice(7),body);
  if(path.startsWith('/reader/'))return reader.handle(path.slice(8),body);
  if(path.startsWith('/video-parser/'))return videoParser.handle(path.slice(14),body);
  if(path.startsWith('/maps/'))return maps.handle(path.slice(6),body);
  if(path.startsWith('/doubao/'))return doubao.handle(path.slice(8),body);
  if(path.startsWith('/recycle/'))return recycle.handle(path.slice(9),body);
  if(path.startsWith('/characters/'))return characters.handle(path.slice(12),body);
  if(path.startsWith('/local-h3/')){const action=path.slice(10);if(action==='package')return LOCAL_H3_PACKAGE;if(action==='status')return {...await localH3.status(),plugin:(await list()).find(p=>p.id===LOCAL_H3_PLUGIN_ID)};await requirePlugin(LOCAL_H3_PLUGIN_ID);if(action==='start')return localH3.start();if(action==='stop')return localH3.stop();throw failure('未知本地 H3 操作');}
  if(path.startsWith('/cloud-notebooks/'))return cloudNotebooks.handle(path.slice('/cloud-notebooks/'.length),body);
  if(path.startsWith('/membership/'))return membership.action(path.slice('/membership/'.length),body);
  if(path.startsWith('/models/credentials/'))return modelVerification.run(path.slice('/models/credentials/'.length),body);
  if(path==='/models/authorization-sources')return models.authorizationSources();
  if(path==='/models/default')return modelDefaults.set(body);
  if(path==='/models'){const catalog=await models.list();return {...catalog,...await modelDefaults.read(catalog)};}
  if(path.startsWith('/models/external-browsers/'))return models.externalBrowsers.handle(path.slice('/models/external-browsers/'.length),body);
  if(path==='/knowledge')return knowledge.list();
  if(path.startsWith('/selection/'))return selectionEdits.handle(path.slice(11),body);
  if(path==='/models/save')return models.save(body);if(path==='/models/remove'){const result=await models.remove(body);if(!result.profiles.some(p=>profileSupports(p,'text')&&models.ready(p)))for(const id of ['official.document-chat','official.whiteboard-generation','official.conversation-control'])await chat.abortPlugin(id);if(!result.profiles.some(p=>profileHasMedia(p)&&models.ready(p)))await media.stopAll();return result;}if(path==='/models/test')return models.test(body);if(path==='/models/catalog')return models.catalog(body);
  if(path.startsWith('/books/'))return books.handle(path.slice(7),body);
  if(path.startsWith('/works/tools/'))return workTools.handle(path.slice(13),body);
  if(path==='/works/activate'){await requirePlugin('official.works');return activateWork(service,body);}if(path==='/works/deactivate'){await requirePlugin('official.works');await workTools.stopAll();return deactivateWork(service,body);}if(path==='/works/create'){await requirePlugin('official.works');return workItem(service,body);}
  if(path==='/graph/disconnect'){await requirePlugin('official.graph');return disconnectDocuments(service,body);}
  if(path==='/graph/connect'){await requirePlugin('official.graph');return connectDocuments(service,body);}
  if(path==='/graph'){await requirePlugin('official.graph');return body.scope==='global'?globalLinkIndex(service):linkIndex((await service.load(body.id)).state);}
  if(path.startsWith('/chat/'))return chat.handle(path.slice(6),body);
  if(path.startsWith('/depth/'))return depth.handle(path.slice(7),body);
  if(path==='/sync/preview'&&body.conflictId){await requirePlugin('official.nutstore');await hydrateSync();return sync.previewConflict(body);}
  if(['/sync/history','/sync/history-preview','/sync/history-restore'].includes(path)){await requirePlugin('official.nutstore');await hydrateSync();return ({'/sync/history':sync.history,'/sync/history-preview':sync.previewHistory,'/sync/history-restore':sync.restoreHistory})[path](body);}
  if(path.startsWith('/sync/'))return syncAction(path.slice(6),body);
  if(path==='/board/status'){const profiles=(await models.list()).profiles.filter(models.ready),plugin=await requirePlugin('official.whiteboard-generation');return {showQueue:profiles.some(p=>profileHasMedia(p)),showCredits:profiles.some(p=>profileHasMedia(p)&&p.provider==='即梦'),profiles,plugin,...await media.list(body)};}
  if(path.startsWith('/media/'))return media.action(path.slice(7),body);
  throw failure('未提供的官方插件操作');
 }
 async function stopExternalProvider(pluginId){
  models.blockProvider(pluginId);
  const ids=(await models.list({includeManagedBindings:true})).profiles.filter(p=>p.externalRef?.pluginId===pluginId).map(p=>p.id);
  await characters.stopAll(ids);await selectionEdits.abortProfiles(ids);await workTools.abortProfiles(ids);await chat.abortProfiles(ids);return media.stopProfiles(ids);
 }
 const startRuntime=async()=>{const available=await list();if(available.some(p=>p.id==='official.nutstore'&&p.installed!==false&&p.enabled)){await sync.startup();try{await hydrateSync();}catch{sync.clearSessionCredentials();console.warn('坚果云本机登录凭据暂时不可读取；未启动自动同步，请在同步设置重新核验。');}}if(available.some(p=>p.id==='thirdparty.doubao'&&p.installed&&p.enabled))await doubao.configureAccounts();if(available.some(p=>p.id==='thirdparty.text-reader'&&p.installed&&p.enabled))await reader.enable();};
 async function installManagedPackage(body){const pkg=body.package;if(!pkg||Object.keys(pkg).sort().join(',')!==Object.keys(LOCAL_H3_PACKAGE).sort().join(',')||Object.entries(LOCAL_H3_PACKAGE).some(([k,v])=>pkg[k]!==v))throw failure('托管插件包未通过随软件固定清单校验');return update({pluginId:LOCAL_H3_PLUGIN_ID,install:true});}
 return {browserCommand:(action,body,owner)=>browser.handle(action,body,owner),prepareBrowserQuit:()=>browser.close(),list,update,handle,models,stopExternalProvider,startRuntime,installManagedPackage,assertNotebookIdle:id=>assertNotebookIdle({dataRoot:service.dataRoot,id,chat}),close:async()=>{await browser.close({force:true});syncHostClosed=true;unsubscribeSync();await publisher.close();await nutstoreNotebooks.close();await cloudNotebooks.close();await sync.close();await vault.close();await videoParser.close();await maps.close();await characters.stopAll();await selectionEdits.stopAll();await workTools.stopAll();await localH3.close();membership.close();chat.abortAll();await desktop.chushouTranscriber?.close();await media.close();await reader.close();await doubao.close();await depth.close();},requirePlugin};
}
