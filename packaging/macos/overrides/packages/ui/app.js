import {snapshotCardModelDefaults} from './card-model-defaults.js';
import {uiGlyph} from './ui-glyph.js';
import {snapCanvasValue} from '/legacy/whiteboard.js';
import {editingState} from './workspace-view.js';
import {transferFileType,transferText,cardClipboardToken,editableTransferTarget} from './external-transfer.js';
import {startNotebookAutoSync} from './notebook-auto-sync.js';
import {replaceWorkspaceMarkup,replaceBoardMarkup,bindBoardMedia} from './board-media-lifecycle.js';
import {workChapterLabels} from './work-chapter-labels.js';
import {workFolderCopy} from './work-directory-copy.js';
import {chooseStorageLocation} from './storage-location-picker.js';
import {chooseDocumentExport} from './document-export.js';
import {folderOptions} from './directory-paths.js';
import {bindWorkspaceTabOrder} from './workspace-tab-order.js';
import {createDirectorySelection} from './directory-selection.js';
import {directorySelectionContents,recycleSelection} from './recycle-state.js';
import {createRecycleBin} from './recycle-bin.js';
import {bindNotebookPicker} from './notebook-picker.js';
import {createMarqueeSelection} from './board-selection.js';
import {rememberMediaRatio} from './generation-intent.js';
import {createWorkspaceSplits} from './workspace-splits.js';
import {createDetachedTabs,returnedTabState,tabTransferPosition} from './detached-tabs.js';
import {createBrowserWorkspaceUI} from './browser-workspace.js';
import {createNovelPublisherUI} from './novel-publisher.js';
import {createGlyphWorkshopUI} from './glyph-workshop.js';
import {createWritingTimer} from './writing-timer.js';
import {frameLatest,boardGestureView} from './board-interaction.js';
import {createWorkToolUI} from './work-tools.js';
import {createWorkToolReports} from './work-tool-report.js';
import {createCharacterParlorUI} from './character-parlor.js';
import {createMapWorkshopUI} from './map-workshop.js';
import {createNodePreview} from './node-preview.js';
import {createCardInlineEditor} from './card-inline-editor.js';
import {preserveWindowView,reconcileWindowState,editableDraftState,restoreDraftState,newestLocalDraft} from './window-state.js';
import {createDirectoryHistory} from './directory-history.js';
import {bindPluginOrder} from './plugin-order.js';
import * as tabs from '/legacy/document-tabs.js';
import {sanitizeDocumentHtml} from '/legacy/document-sanitize.js';
import {findTextMatches} from '/legacy/document-find-replace.js';
import {emptyCanvas,fittedBoardViewport,addTextCard,resizedCard,nodeVersions,unseenImageOutputCount,acknowledgeImageOutput,captureNodeVersion,adoptNodeVersion,copySelection,pasteSelection,edgePath} from './canvas-model.js';
import {escapeHtml as h,htmlToMarkdown,hydrateMedia,ensureMediaTextSlots,cleanEditorHtml,replaceEditorImage,replaceEditorText,documentCharacterCount,selectedDocumentText,editorDocumentText} from './editor.js';
import {normalizePreferences,THEMES,SHORTCUTS,shortcutFromEvent,applyPresentation} from './preferences.js';
import {createSettingsPage} from './settings.js';
import {createAboutPage} from './about-page.js';
import {createAppUpdates} from './app-updates.js';
import {createSystemNotices} from './system-notices.js';
import {createDocumentOutline} from './document-outline.js';
import {createSettingAtlas} from './setting-atlas.js';
import {settingContext,settingAtlasEntries} from './setting-atlas-model.js';
import {createSelectionEditor} from './selection-edit.js';
import {bindDocumentImageMenu} from './document-image-menu.js';
import {createHistoryViewer} from './history.js';
import {createBoardTools,CARD_COLORS} from './board-tools.js';
import {contextMenu} from './context-menu.js';
import {DIRECTORY_SORTS,sortDirectoryItems} from './directory-sort.js';
import {createWindowControls} from './window-controls.js';
import {createPluginDock} from './plugin-dock.js';
import {createEditorColors} from './editor-colors.js';
import {createOfficialUI} from './official-ui.js';
import {createExtensionUI} from './extensions.js';
import {localizeCore,translate} from './localization.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
// Prefer the knowledge base whenever no explicit notebook was requested.
const defaultLibraryId=items=>items.find(item=>item.knowledge||item.name==='知识库')?.id||items[0]?.id||'';
const paths={star:'m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L2.8 9.7l6.4-.9z',minus:'M5 12h14',file:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6',board:'M3 4h18v14H3z M8 22l4-4 4 4 M7 8h4v5H7z M15 8h2 M15 12h2',folder:'M3 6h7l2 2h9v12H3z',search:'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',history:'M4 5v5h5 M4 10a8 8 0 1 1 0 5 M12 7v5l3 2',settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M6 6l2 2 M16 16l2 2 M6 18l2-2 M16 8l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',trash:'M4 6h16 M9 3h6 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',panel:'M3 4h18v16H3z M9 4v16',more:'M5 12h.01 M12 12h.01 M19 12h.01',plus:'M12 5v14 M5 12h14',arrow:'M5 12h14 M13 6l6 6-6 6',expand:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',link:'M10 14l4-4 M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',graph:'M5 5h4v4H5z M15 15h4v4h-4z M15 3h4v4h-4z M9 7l6-2 M8 9l8 6 M15 7l1 8',list:'M4 5h2 M9 5h11 M4 12h2 M9 12h11 M4 19h2 M9 19h11',outline:'M5 4v16 M5 7h5l-2 2 2 2H5 M5 14h5l-2 2 2 2H5',memory:'M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5',table:'M3 4h18v16H3z M3 10h18 M9 4v16 M15 4v16',image:'M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M16 7h.01',download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',upload:'M12 16V4 M7 9l5-5 5 5 M4 16v5h16v-5',chevron:'M9 5l7 7-7 7',undo:'M9 14 4 9l5-5 M4 9h9a7 7 0 1 1 0 14h-2',redo:'m15 14 5-5-5-5 M20 9h-9a7 7 0 1 0 0 14h2',paint:'M14 4l6 6-9 9a3 3 0 0 1-4-4z M4 20c0-2 1-3 3-3 0 2-1 3-3 3z',clear:'M4 20h16 M8 16l8-8 4 4-8 8H8z M13 11l4 4',alignLeft:'M4 5h16 M4 9h10 M4 13h16 M4 17h10',alignCenter:'M4 5h16 M7 9h10 M4 13h16 M7 17h10',alignRight:'M4 5h16 M10 9h10 M4 13h16 M10 17h10'};
paths.collapseAll='M8 3h12v13 M4 7h12v14H4z M7 14h6';
paths.spark='m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z M20 2v4 M18 4h4';
paths.user='M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M4 21v-2a8 8 0 0 1 16 0v2';
paths.globe='M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18';
paths.clock='M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0 M12 6v6l4 2';
paths.volume='M11 5 6 9H3v6h3l5 4zM15 8q6 4 0 8M18 4q10 8 0 16';
paths.book='M12 5v16 M12 5C8 2 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-2-1-6-2-10 1';
paths.theme=paths.settings;paths.settings='M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0';
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.file}"/></svg>`;
const noteIcon=glyph=>icon(({'\uE7A7':'undo','\uE7A6':'redo','\uE76D':'paint','\uE75C':'clear','\uE8FD':'list','\uE9D5':'checklist','\uE8E4':'alignLeft','\uE8E3':'alignCenter','\uE8E2':'alignRight','\uE71B':'link','\uF0E2':'table','\uE91B':'image','\uE848':'quote'})[glyph]||'file');
paths.checklist='M4 6l2 2 3-4M12 6h8M4 15l2 2 3-4M12 15h8';paths.quote='M4 5h6v7H5c0 3-1 5-3 6M14 5h6v7h-5c0 3-1 5-3 6';
const btn=(act,label,symbol='',extra='')=>`<button data-action="${act}" title="${label}" aria-label="${label}" ${extra}>${symbol?icon(symbol):h(label)}</button>`;
const token=$('meta[name=shensi-session]').content;
const systemNotices=createSystemNotices({api});
document.addEventListener('shensi:open-system-notices',()=>void systemNotices.open());
const detached=new URLSearchParams(location.search);const detachedType=detached.get('detached')||'';
if(!detachedType){if(document.readyState==='complete')systemNotices.start();else window.addEventListener('load',()=>systemNotices.start(),{once:true});}
function announceWorkspaceReady(){globalThis.shensiWorkspaceReady=true;appUpdates.start();const launchId=detached.get('launchId');if(launchId)(detached.get('pane')==='1'?window.parent:window.opener)?.postMessage({type:'shensi:workspace-ready',launchId},location.origin);}
const windowClientKey='core-window-client'+(detached.get('paneId')?':'+detached.get('paneId'):'');const clientId=detachedType?(sessionStorage.getItem(windowClientKey)||crypto.randomUUID()):(localStorage.getItem('core-client-id')||crypto.randomUUID());if(detachedType)sessionStorage.setItem(windowClientKey,clientId);else localStorage.setItem('core-client-id',clientId);
document.documentElement.classList.toggle('detached-workspace',!!detachedType);
document.documentElement.classList.toggle('plugin-only-workspace',detachedType==='plugin');
document.documentElement.classList.toggle('workspace-pane',detached.get('pane')==='1');
const ui=JSON.parse(localStorage.getItem('core-ui')||'{}');Object.assign(ui,normalizePreferences(ui));
const appUpdates=createAppUpdates({api});
let preferencesRevision=null;
async function persistPreferences(value){const result=await api('/api/settings/preferences',{preferences:normalizePreferences(value),expectedRevision:preferencesRevision});preferencesRevision=result.revision;Object.assign(ui,result.preferences);prefs();applyTheme();}
async function refreshPreferences(){const result=await api('/api/settings/preferences');preferencesRevision=result.revision;if(result.preferences){Object.assign(ui,result.preferences);prefs();}}
const settingsPage=createSettingsPage({updates:appUpdates,pluginsChanged:async()=>{await official.refresh();await extensions.refresh();},mountOfficialSettings:(id,target)=>official.mountSettings(id,target),openExtension:()=>extensions.action('plugin:menu'),runExtension:(pluginId,commandId)=>extensions.action('plugin:command:'+pluginId+':'+commandId),openOfficial:id=>id==='thirdparty.browser'?document.dispatchEvent(new Event('shensi:open-browser')):official.action({'official.conversation-control':'official-control','official.works':'official-works','official.graph':'official-graph','official.nutstore':'official-sync','official.document-chat':'official-chat','official.whiteboard-generation':'official-board'}[id]),api,modal,toast,preferences:()=>ui,persist:persistPreferences,refreshPreferences,libraryId:()=>libraryId,flush:save,stateStamp:()=>stamp,applyResult:result=>{state=result.state;stamp=result.stateStamp;panel='';selected.clear();selectedEdge='';selectedEdges.clear();boardUndo=[];boardRedo=[];mode='rich';render();},translate,previewLanguage:language=>{languagePreview=language;localizeCore(document.body,language);},reloadLibrary:async id=>{libraries=(await api('/api/bootstrap')).libraries;await loadLibrary(id);}});
const directoryHistory=createDirectoryHistory({api,modal,toast,libraryId:()=>libraryId,flush:save,apply:result=>{state=editingState(result.state);stamp=result.stateStamp;render();}});
const aboutPage=createAboutPage({api,libraryId:()=>libraryId,flush:save,updates:appUpdates});
const documentOutline=createDocumentOutline();
const settingAtlas=createSettingAtlas();
const selectionEditor=createSelectionEditor({api,modal,toast,readerEnabled:()=>official.enabled('thirdparty.text-reader'),readSelection:()=>official.action('official-reader-selection'),enabled:()=>official.enabled('document-chat'),mode:()=>mode,current:()=>current()?{...current(),id:state.activeDocument}:null,libraryId:()=>libraryId,stamp:()=>stamp,shortcuts:()=>ui.shortcuts,flush:save,upload:()=>chooseAttachment(),settleModelSelection:()=>official.settleModelSelection(),applyResult:result=>{state=preserveWindowView(result.state,state);stamp=result.stateStamp;persistedState=structuredClone(result.state);dirty=false;render();}});
const windowControls=createWindowControls({flush:async()=>(await prepareWindowClose()).saved,toast});
const workspaceSplits=createWorkspaceSplits({toast,restore:restoreDetachedTab,detach:(...args)=>detachedTabs.move(...args)});
const detachedTabs=createDetachedTabs({restore:restoreDetachedTab,toast});
globalThis.shensiFlushPane=async()=>(await prepareWindowClose()).saved;
globalThis.shensiPrepareWindowClose=prepareWindowClose;
globalThis.shensiPrepareApplicationQuit=async()=>{if(settingsPage.hasUnsavedChanges){toast('设置尚未保存，请保存或取消更改后再退出。');return {saved:false};}return prepareWindowClose();};
window.shensiWindow?.onOpenSettings?.(()=>{if(!settingsPage.isOpen)void settingsPage.open().catch(error=>toast(error.message));});
const historyViewer=createHistoryViewer({api,modal,toast,assetUrl:(path,id)=>assetUrl(path,id),libraryId:()=>libraryId,flush:save,apply:result=>{state=editingState(result.state);stamp=result.stateStamp;boardUndo=[];boardRedo=[];render();}});
const official=createOfficialUI({mutateGraph,api,modal,toast,selectedText:()=>selectedDocumentText($('.editor'),$('.markdown-source')),preferences:()=>ui,openSavedDocument:async(notebookId,documentId)=>{if(!(await save()))return;if(notebookId!==libraryId)await loadLibrary(notebookId);if(libraryId===notebookId&&state.documents[documentId])await openDocument(documentId);else toast("文档已不存在或笔记本未能打开");},beforePanel:()=>extensions.dismiss(),mountPanel:(node,id,view)=>dock.present(node,id,view),hidePanel:()=>dock.collapse(),revealPanel:()=>dock.setOpen(true),openSettings:section=>settingsPage.open(section),openGraphTab,closeGraphTab,documentMenu:fileMenu,graphTabHost:()=>graphTabActive?$('#graph-tab-host'):null,notebookName:(id=libraryId)=>libraries.find(l=>l.id===id)?.name||(id===libraryId?'我的笔记':'其他笔记本'),assetUrl:(path,docId,notebookId=libraryId)=>`/api/asset?id=${encodeURIComponent(notebookId)}&path=${encodeURIComponent(path)}&documentId=${encodeURIComponent(docId)}&token=${token}`,isDirty:()=>dirty||saving||conflict||composition,current:()=>current()?{...current(),id:state.activeDocument}:null,state:()=>state,libraryId:()=>libraryId,stamp:()=>stamp,refreshWorkspace:()=>syncRemoteState(),flush:()=>save(),render:()=>{if(state)render();},selectedNode:()=>selectedNode(),markDirty:()=>markDirty(),recordBoardUndo:pushBoardUndo,refreshBoard:renderBoard,openDocument:id=>openDocument(id),focusBoardNode:async id=>{const node=current()?.canvas?.nodes.find(n=>n.id===id);if(!node)throw Error('任务卡片已不存在');selected=new Set([id]);selectedEdges.clear();selectedEdge='';for(const el of document.querySelectorAll('.card'))el.classList.toggle('selected',el.dataset.node===id);await boardTools.action('focus',{node});updateBoardTools();document.dispatchEvent(new CustomEvent('shensi:board-selection',{detail:{nodeId:id}}));},applyResult:result=>{state=result.state;stamp=result.stateStamp;persistedState=structuredClone(result.state);dirty=false;boardUndo=[];boardRedo=[];render();},insertLink:(id,title)=>{if(current().canvas){toast('文档链接请在文本卡片中使用 [[文档身份]]');return;}restoreSelection();document.execCommand('insertHTML',false,'<a href="#doc:'+h(id)+'">'+h(title)+'</a>');$('.editor')?.oninput();}});
const extensions=createExtensionUI({api,modal,toast,conversationChanged:()=>official.onRender(),pluginsChanged:()=>official.refresh(),openSettings:section=>settingsPage.open(section),openSavedDocument:async(notebookId,documentId)=>{if(!(await save()))throw Error('请先处理当前保存冲突');if(notebookId!==libraryId)await loadLibrary(notebookId);if(libraryId!==notebookId||!state.documents[documentId])throw Error('关联文档已不存在，请重新关联');await openDocument(documentId);},openOfficial:id=>official.action({'official.conversation-control':'official-control','official.works':'official-works','official.graph':'official-graph','official.document-chat':'official-chat','official.whiteboard-generation':'official-board'}[id]),beforePanel:async()=>{await official.beforeSwitch();official.close();},mountPanel:(node,id)=>dock.present(node,id),hidePanel:()=>dock.collapse(),revealPanel:()=>dock.setOpen(true),libraryId:()=>libraryId,current:()=>current()?{...current(),id:state.activeDocument}:null,flush:save,isDirty:()=>dirty||saving||conflict||composition,shortcuts:()=>ui.shortcuts,render:()=>{if(state)render();},applyResult:result=>{state=result.state;stamp=result.stateStamp;render();}});
const dock=createPluginDock({notebookId:()=>libraryId,sessionOnly:!!detachedType,detachPlugin:async pluginId=>{if(!(await save()))throw Error('请先处理保存冲突');return window.shensiWindow.openWindow({type:'plugin',pluginId,notebookId:libraryId,...(pluginId==='official.conversation-control'?{conversationTarget:official.currentTarget()}:{})});},openSettings:id=>settingsPage.open('plugin:'+id),preferences:ui,persist:()=>prefs(),toast,entries:()=>[...official.dockEntries(),...extensions.dockEntries()],ready:()=>extensions.ready,inspectorOpen:()=>panel==='node',clearInspector:()=>{if(panel==='node'){panel='';renderPanel();}},beforeSwitch:()=>official.beforeSwitch(),dismissPanel:()=>{official.close();extensions.dismiss();},activate:action=>action.startsWith('plugin:')?extensions.action(action):official.action(action)});
const writingTimer=createWritingTimer({eligible:()=>!!state?.coreWork?.enabled&&!!current()&&!current().canvas&&!graphTabActive&&official.enabled('works')});
const workToolRuns=new Map();
function applyWorkToolBadges(){for(const button of document.querySelectorAll('.work-creation-tools [data-action]'))button.setAttribute('aria-busy',String(!!workToolRuns.get(libraryId+':'+button.dataset.action.slice(10))));}
const workTools=createWorkToolUI({api,clientId,badge:(id,kind,busy)=>{workToolRuns.set(id+':'+kind,busy);applyWorkToolBadges();},currentProfile:()=>official.currentChatProfile(),flush:save,libraryId:()=>libraryId,toast,openReport:job=>workReports.open({jobId:job.id}),openSavedDocument:async(id,documentId)=>{if(!await save())return;if(id!==libraryId)await loadLibrary(id);else{const latest=await api('/api/state?id='+encodeURIComponent(id));state=latest.state;stamp=latest.stateStamp;}if(state.documents[documentId])await openDocument(documentId);else toast('文档已不存在');},applyResult:result=>{state=preserveWindowView(result.state,state);stamp=result.stateStamp;render();}});
const workReports=createWorkToolReports({api,clientId,notebookId:()=>libraryId,otherTabCount:()=>browserWorkspace.count()+novelPublisher.count()+state.documentTabs.length+(graphTabOpen?1:0)+characterParlor.count()+mapWorkshop.count()+glyphWorkshop.count(),toast,flush:save,render,deactivateOther:()=>{void browserWorkspace.deactivate();novelPublisher.deactivate();mapWorkshop.deactivate();graphTabActive=false;characterParlor.deactivate();},menu:contextMenu,detach:(target,remove)=>workspaceSplits.detach(target,remove),split:(target,direction,remove)=>workspaceSplits.open(target,direction,remove),save:(kind,jobId)=>workTools.saveJob(kind,jobId),returnToTool:(kind,jobId)=>workTools.open(kind,{jobId})});
const characterParlor=createCharacterParlorUI({api,modal,toast,render,libraryId:()=>libraryId,flush:save,tabSpace,menu:contextMenu,enabled:()=>official.enabled('thirdparty.character-chat'),deactivateOther:()=>{mapWorkshop.deactivate();graphTabActive=false;void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();official.closeEditorPanel();}});
const mapWorkshop=createMapWorkshopUI({api,modal,toast,render,flush:save,tabSpace,libraryId:()=>libraryId,menu:contextMenu,otherActive:()=>browserWorkspace.active()||novelPublisher.active()||graphTabActive||workReports.active()||characterParlor.active(),enabled:()=>official.enabled('thirdparty.map-workshop'),assetUrl:(path,documentId,notebookId)=>`/api/asset?id=${encodeURIComponent(notebookId)}&path=${encodeURIComponent(path)}&documentId=${encodeURIComponent(documentId)}&token=${token}`,deactivateOther:()=>{graphTabActive=false;void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();characterParlor.deactivate();official.closeEditorPanel();}});
document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#map:"]');if(link){event.preventDefault();event.stopPropagation();void mapWorkshop.open(link.getAttribute('href').slice(5)).catch(error=>toast(error.message));}},true);
document.addEventListener('shensi:open-character-parlor',()=>void characterParlor.open().catch(error=>toast(error.message)));
// Opening chat retains the focused plugin; focusing main content returns to it.
for(const event of ['pointerdown','focusin'])document.addEventListener(event,e=>{if(e.target.closest('.main')&&extensions.clearConversationTarget())official.onRender();},true);
for(const event of ['shensi:open-map','shensi:open-glyph'])document.addEventListener(event,()=>extensions.clearConversationTarget(),true);
const editorColors=createEditorColors({isEditable:()=>mode==='rich'&&!!$('.editor'),editor:()=>$('.editor'),rememberSelection,restoreSelection,changed:()=>$('.editor')?.oninput()});
const cardEditContext={scope:()=>({notebookId:libraryId,documentId:state.activeDocument}),document:()=>current(),drafts:()=>state.coreNodeDrafts??={},changed:()=>markDirty(),undo:pushBoardUndo,flush:save,checkpoint:scope=>checkpointCurrent(scope,true),render:()=>renderBoard(),toast};
const glyphWorkshop=createGlyphWorkshopUI({openSettings:section=>settingsPage.open(section),api,modal,toast,clientId,render,flush:save,tabSpace,enabled:()=>official.enabled('thirdparty.glyph-workshop'),otherActive:()=>browserWorkspace.active()||novelPublisher.active()||mapWorkshop.active()||characterParlor.active()||workReports.active()||graphTabActive,deactivateOther:()=>{mapWorkshop.deactivate();characterParlor.deactivate();void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();graphTabActive=false;official.closeEditorPanel();}});
const novelPublisher=createNovelPublisherUI({api,modal,toast,render,flush:save,tabSpace,menu:contextMenu,libraryId:()=>libraryId,libraryName:()=>libraries.find(l=>l.id===libraryId)?.name,enabled:()=>official.enabled('thirdparty.novel-publisher'),deactivateOther:async()=>{void browserWorkspace.deactivate();if(!await glyphWorkshop.flush())return false;glyphWorkshop.deactivate();mapWorkshop.deactivate();characterParlor.deactivate();workReports.deactivate();graphTabActive=false;official.closeEditorPanel();return true;}});
document.addEventListener('shensi:open-novel-publisher',()=>void novelPublisher.open().catch(error=>toast(error.message)));
const browserWorkspace=createBrowserWorkspaceUI({modal,contextMenu,browser:(action,body)=>{if(!window.shensiWindow?.browser)throw Error('浏览器扩展需要更新后的神思桌面版');return window.shensiWindow.browser(action,body);},toast,render,flush:save,tabSpace,enabled:()=>official.enabled('thirdparty.browser'),targetChanged:()=>official.onRender(),deactivateOther:async()=>{if(!await glyphWorkshop.flush()||!await mapWorkshop.flush())throw Error('请先保存当前工坊');extensions.clearConversationTarget();glyphWorkshop.deactivate();mapWorkshop.deactivate();characterParlor.deactivate();novelPublisher.deactivate();workReports.deactivate();graphTabActive=false;official.closeEditorPanel();}});
document.addEventListener('shensi:open-browser',event=>void(async()=>{if(settingsPage.isOpen){await settingsPage.close();if(settingsPage.isOpen)return;}await browserWorkspace.open(event.detail||{});})().catch(error=>toast(error.message)));
official.configureConversationContext({
 target:()=>{const web=browserWorkspace.target();if(web)return web;const plugin=extensions.conversationTarget();if(plugin)return plugin;const workshop=glyphWorkshop.conversationTarget()||mapWorkshop.conversationTarget();if(workshop)return workshop;if(graphTabActive||characterParlor.active()||novelPublisher.active()||workReports.active())return {kind:'none',title:'当前页面尚未适配 · 可处理其他对象'};const doc=current();return doc?{kind:doc.canvas?'whiteboard':'document',documentId:state.activeDocument,title:doc.title,selection:[...selected]}:{kind:'none',title:'未指定页面对象'};},
 // Focused content supplies the target; there is no manual selector.
 flush:async target=>target.kind==='map'?mapWorkshop.flush():target.kind==='glyph'?glyphWorkshop.flush():save(),
 refresh:async target=>{if(target.kind==='browser')await browserWorkspace.refresh();if(target.kind==='map')await mapWorkshop.refreshConversation(target);if(target.kind==='glyph')await glyphWorkshop.refreshConversation(target);if(target.kind==='plugin')await extensions.refresh();}
});
const inlineEditor=createCardInlineEditor(cardEditContext);
const nodePreview=createNodePreview({...cardEditContext,api,refresh:options=>syncRemoteState(options),deleteVersion:async(nodeId,versionId)=>{if(!await save())throw Error('保存未完成');const result=await api('/api/history/delete',{id:libraryId,scope:{type:'card',id:state.activeDocument,nodeId},versionIds:Array.isArray(versionId)?versionId:[versionId],expectedStateStamp:stamp});state=result.state;stamp=result.stateStamp;renderBoard();},checkpoint:()=>checkpointCurrent(),adopt:canvas=>{current().canvas=canvas;renderBoard();},assetUrl:(...args)=>assetUrl(...args),download:item=>boardTools.action('save-as',{node:item}),frame:async(id,seconds)=>{selected=new Set([id]);await boardTools.action('frame',{node:current().canvas.nodes.find(n=>n.id===id),seconds});}});
const boardTools=createBoardTools({isDirty:()=>dirty||saving||conflict||composition,current:()=>current()?{...current(),id:state.activeDocument}:null,selected:()=>selected,selectedEdges:()=>selectedEdges,selectEdges:ids=>{selectedEdges=new Set(ids);selectedEdge=ids.length===1?ids[0]:'';selected.clear();},select:ids=>{selected=new Set(ids);selectedEdges.clear();selectedEdge='';for(const el of $$('.card'))el.classList.toggle('selected',selected.has(el.dataset.node));},canPaste:()=>!!navigator.clipboard?.read,undo:pushBoardUndo,changed:boardChanged,refreshWorkspace:()=>syncRemoteState(),finishEditing:()=>inlineEditor.finish(),selectionChanged:()=>{for(const el of document.querySelectorAll(".card"))el.classList.toggle("selected",selected.has(el.dataset.node));for(const el of document.querySelectorAll("[data-edge]"))el.classList.toggle("selected",selectedEdges.has(el.dataset.edge));updateBoardTools();},toast,modal,api,flush:save,libraryId:()=>libraryId,stamp:()=>stamp,assetUrl:(...args)=>assetUrl(...args),download,openDocument,openNode,run:runAction,generationEnabled:()=>official.enabled('whiteboard-generation'),depthEnabled:()=>official.enabled('thirdparty.depth-explorer'),generate:channel=>official.generate(channel),apply:result=>{state=result.state;stamp=result.stateStamp;render();}});
let languagePreview=ui.uiLanguage;
const localizationObserver=new MutationObserver(records=>{const language=settingsPage.isOpen?languagePreview:ui.uiLanguage;if(language!=='en-US')return;const roots=new Set();for(const record of records)for(const node of record.type==='childList'?record.addedNodes:[record.target]){const root=node.nodeType===1?node:node.parentElement;if(root?.isConnected)roots.add(root);}for(const root of roots)if(![...roots].some(other=>other!==root&&other.contains(root)))localizeCore(root,language);});
localizationObserver.observe(document.body,{childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder','label','alt'],subtree:true});
let persistedState,remoteStamp='',syncingRemote=false,workspacePointerActive=false;
document.addEventListener('pointerdown',e=>{if(e.target.closest('.board'))workspacePointerActive=true;},true);
for(const event of ['pointerup','pointercancel'])document.addEventListener(event,()=>{workspacePointerActive=false;if(remoteStamp)void receiveWorkspaceChange({id:libraryId,stateStamp:remoteStamp});},true);
let libraryLoadQueue=Promise.resolve(),libraryTransition=false,libraryEpoch=0,libraryLoadRequest=0,documentSwitchRequest=0;
let state,stamp,libraryId,libraries=[],revision=0,dirty=false,saving=false,saveTimer,draftTimer,savePromise,conflict=false,composition=false,graphTabOpen=false,graphTabActive=false,suppressGraphTabClick=false;
let query='',mode='rich',panel='',nodeTab='preview',selected=new Set(),selectedEdge='',selectedEdges=new Set(),connection='',previewVersion='',findOpen=false,workSection='manuscript',documentClipboard=null;
let formatPaint=null;
let lastEditorScope='';const documentModes=new Map();try{for(const entry of JSON.parse(localStorage.getItem('shensi-document-modes')||'[]'))if(Array.isArray(entry)&&['rich','read','markdown','atlas'].includes(entry[1]))documentModes.set(entry[0],entry[1]);}catch{}
const editorScope=()=>libraryId+':'+state?.activeDocument;
function rememberEditorMode(value){mode=value;documentModes.set(editorScope(),value);try{localStorage.setItem('shensi-document-modes',JSON.stringify([...documentModes].slice(-2000)));}catch{}}
async function changeEditorMode(next){const doc=current(),scope=editorScope();if(!doc)return;if(next!=='atlas'&&next!=='markdown'&&typeof doc.html!=='string'){const result=await api('/api/markdown',{markdown:doc.markdown||''});if(scope!==editorScope()||doc!==current())return;doc.html=result.html;}rememberEditorMode(next);render();}
let richReplaceBatches=[],boardUndo=[],boardRedo=[],clipboard=null,toastTimer,selectionRange,toolbarResizeObserver,pendingAttachmentTarget,disposeDocumentImages;
const prefs=()=>{localStorage.setItem('core-ui',JSON.stringify(ui));};
const current=()=>state?.documents?.[state.activeDocument];
const directorySelection=createDirectorySelection(()=>libraryId+':'+workSection+':'+(ui.directoryView||'files'));
const recycleBin=createRecycleBin({libraryId:()=>libraryId,state:()=>state,api,assetUrl:(...args)=>assetUrl(...args),recycleAssetUrl:(trashId,fileId)=>'/api/recycle/asset?trashId='+encodeURIComponent(trashId)+'&fileId='+encodeURIComponent(fileId)+'&token='+token,flush:()=>save(),changed:()=>markDirty(),render:()=>renderPanel(),refreshLibraries:async()=>{libraries=(await api('/api/bootstrap')).libraries;const select=$('#library-select');if(select)select.innerHTML=libraries.map(l=>`<option value="${h(l.id)}" ${l.id===libraryId?'selected':''}>${h(l.name)}</option>`).join('');},modal,toast});
const assetUrl=(path,docId=state.activeDocument,notebookId=libraryId)=>`/api/asset?id=${encodeURIComponent(notebookId)}&path=${encodeURIComponent(path)}&documentId=${encodeURIComponent(docId)}&token=${token}`;
async function api(path,body,remember=true){const scope=body?.id||new URL(path,location.origin).searchParams.get('id'),epoch=libraryEpoch,startedId=libraryId;const fullHistory=/\/api\/(?:history|directory-history|restore)(?:\/|\?|$)/.test(path)||new URL(path,location.origin).searchParams.get('view')==='history';const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-Shensi-Token':token,...(!fullHistory?{'X-Shensi-View':'editing'}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body?.state?{...body,state:editingState(body.state)}:body)});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.message),{code:data.code,...(typeof data.submissionOutcomeKnown==='boolean'?{submissionOutcomeKnown:data.submissionOutcomeKnown}:{})});if(remember&&scope&&data?.state&&data.stateStamp){if(scope===startedId&&(scope!==libraryId||epoch!==libraryEpoch))throw Object.assign(new Error('资料库已切换，操作结果已保存在原资料库，请返回查看。'),{code:'WORKSPACE_VIEW_CHANGED'});if(scope===libraryId&&epoch===libraryEpoch)persistedState=structuredClone(editingState(data.state));}return data;}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').style.display='block';toastTimer=setTimeout(()=>$('#toast').style.display='none',4500);}
function modal(title,body,buttons=[['取消','cancel'],['确定','ok']],wide=false){
  const setup=typeof wide==='function'?wide:null;if(setup)wide=true;
  const dialog=$('#dialog');if(dialog.open)dialog.close();dialog.style.width=wide?'850px':'440px';
  dialog.innerHTML=`<h2>${h(title)}</h2>${body}<div class="dialog-actions">${buttons.map(([label,value],i)=>`<button data-choice="${value}" class="${i===buttons.length-1?'primary':''}">${h(label)}</button>`).join('')}</div>`;dialog.showModal();
  setup?.(dialog);return new Promise(resolve=>{const done=value=>{
    // Custom dialog buttons do not submit a form: validate before resolving.
    if(!['cancel','close','discard','keep','continue'].includes(value)){
      const invalid=[...dialog.querySelectorAll('input,select,textarea')].find(el=>el.willValidate&&el.getClientRects().length&&!el.checkValidity());
      if(invalid){invalid.focus();invalid.reportValidity();return;}
    }
    const values=Object.fromEntries([...dialog.querySelectorAll('[name]')].map(el=>[el.name,el.type==='checkbox'?(el.checked?'on':''):el.value]));dialog.close();resolve({value,...values});
  };dialog.onclick=e=>{const b=e.target.closest('[data-choice]');if(b&&!b.disabled)done(b.dataset.choice);};dialog.oncancel=e=>{e.preventDefault();done('cancel');};dialog.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.target.tagName==='INPUT'&&buttons.length){const choice=buttons.at(-1)[1],button=[...dialog.querySelectorAll('[data-choice]')].find(b=>b.dataset.choice===choice);e.preventDefault();if(!button?.disabled)done(choice);}};setTimeout(()=>{dialog.querySelector('input')?.focus();dialog.querySelector('input')?.select();},0);});
}
async function askName(title,value=''){const answer=await modal(title,`<input name="name" aria-label="名称" value="${h(value)}" maxlength="120">`);return answer.value==='ok'?answer.name.trim():null;}
function setStatus(text,error=false,refreshCount=true){document.dispatchEvent(new CustomEvent('shensi:save-status',{detail:{saved:text==='已保存到本地',error}}));const top=$('#autosave-status');if(top){top.textContent=text==='已保存到本地'?'已自动保存':text;top.classList.toggle('error',error);top.setAttribute('aria-label',top.textContent);}const el=$('#save-status');if(el){el.textContent=text;el.className=error?'error':'';}const d=current(),count=graphTabActive?'':d?.documentKind==='whiteboard'?`${d.canvas.nodes.length} 张卡片 · ${d.canvas.edges.length} 条连线`:`${documentCharacterCount($('.editor')?editorDocumentText($('.editor')):$('.markdown-source')?.value??d?.markdown??'').toLocaleString()} 字`;if($('#word-count'))$('#word-count').textContent=count;updateSelectedCount();}
function updateSelectedCount(){const counter=$('#selection-count');if(!counter)return;const count=documentCharacterCount(selectedDocumentText($('.editor'),$('.markdown-source')));counter.hidden=!count;counter.textContent=count?'已选 '+count.toLocaleString()+' 字':'';}
function draftKey(){return 'core-draft:'+libraryId+(detachedType?':'+clientId:'');}
let graphMutationDepth=0;
async function mutateGraph(operation){
 const id=libraryId,epoch=libraryEpoch;graphMutationDepth++;
 try{
  const result=await operation();if(!result)return result;
  // A graph relationship changes document content, not the user's window view.
  // Adopt its save baseline without replacing the live graph canvas.
  if(id===libraryId&&epoch===libraryEpoch){
   if(dirty){const merged=reconcileWindowState(persistedState,state,result.state);if(merged.conflict){conflict=true;setStatus('保存冲突 · 本地稿已保留',true);toast('链接已保存；新编辑仍在本地，请比较后处理。');return result;}state=merged.state;}
   else state=preserveWindowView(result.state,state);
   stamp=result.stateStamp;persistedState=structuredClone(result.state);boardUndo=[];boardRedo=[];if(!graphTabActive)render();
  }
  return result;
 }finally{graphMutationDepth--;if(!graphMutationDepth&&remoteStamp&&remoteStamp!==stamp)void receiveWorkspaceChange({id:libraryId,stateStamp:remoteStamp});}
}
async function syncRemoteState({force=false}={}){
 if(!libraryId||composition||conflict)return !conflict;
 if(!force&&!saving&&(workspacePointerActive||document.activeElement?.matches('input,textarea,[contenteditable=true]')))return false;
 const id=libraryId,epoch=libraryEpoch,readStamp=stamp;
 if(!remoteStamp||remoteStamp===readStamp){const revision=await api('/api/workspace-state-stamp?id='+encodeURIComponent(id),undefined,false);if(id!==libraryId||epoch!==libraryEpoch)return false;if(stamp!==readStamp)return true;if(revision.stateStamp===readStamp)return true;}
 const result=await api('/api/state?id='+encodeURIComponent(id),undefined,false);if(id!==libraryId||epoch!==libraryEpoch)return false;
 if(composition||!force&&!saving&&(workspacePointerActive||document.activeElement?.matches('input,textarea,[contenteditable=true]')))return false;
 // A foreground save/graph mutation can finish while this read is in flight.
 // Never let its older response roll back that accepted baseline or rebuild the view.
 if(stamp!==readStamp)return true;
 if(result.stateStamp===stamp)return true;
 if(dirty){const merged=reconcileWindowState(persistedState,state,result.state);if(merged.conflict){conflict=true;setStatus('保存冲突 · 本地稿已保留',true);toast('另一窗口修改了相同内容，本地稿已保留，请比较后处理。');return false;}state=merged.state;}
 else state=preserveWindowView(result.state,state);
 stamp=result.stateStamp;persistedState=structuredClone(result.state);if(!dirty){boardUndo=[];boardRedo=[];render();}else if(!saving&&current()?.canvas){boardUndo=[];boardRedo=[];renderBoard();}return true;
}
async function receiveWorkspaceChange(event){
 if(libraryTransition||event.id!==libraryId||event.stateStamp===stamp)return;remoteStamp=event.stateStamp;
 if(graphMutationDepth||saving||composition||conflict||syncingRemote||workspacePointerActive||dirty&&!current()?.canvas||document.activeElement?.matches('input,textarea,[contenteditable=true]'))return;
 syncingRemote=true;try{do{remoteStamp='';await syncRemoteState();}while(remoteStamp&&remoteStamp!==stamp&&!dirty&&!saving&&!composition&&!conflict);}catch(error){toast(error.message);}finally{syncingRemote=false;}
}
async function listenWorkspaceChanges(){
 if(window.shensiWindow?.onWorkspaceChange){window.shensiWindow.onWorkspaceChange(event=>void receiveWorkspaceChange(event));document.body.dataset.workspaceEvents='connected';return;}
 const poll=async()=>{try{const id=libraryId;if(id){const result=await api('/api/workspace-revision?id='+encodeURIComponent(id),undefined,false);document.body.dataset.workspaceEvents='connected';if(result.event)await receiveWorkspaceChange(result.event);}}catch{document.body.dataset.workspaceEvents='disconnected';}finally{setTimeout(()=>void poll(),document.hidden?2000:650);}};
 void poll();
}
function draftPayload(){return {notebookId:libraryId,state:editableDraftState(state),baseStamp:stamp,revision,clientId};}
let localDraftTimer=0,localDraftStarted=0;
function cacheLocalDraft(){clearTimeout(localDraftTimer);localDraftTimer=0;localDraftStarted=0;if(!dirty)return;try{localStorage.setItem(draftKey(),JSON.stringify(draftPayload()));}catch{setStatus('本地缓存空间不足，请立即保存',true);}}
function markDirty({contentChanged=true}={}){if($('#find-query'))$('#find-query').oninput?.();dirty=true;revision++;conflict&&setStatus('保存冲突 · 本地稿已保留',true,contentChanged);if(!conflict)setStatus('待保存',false,contentChanged);localDraftStarted||=Date.now();clearTimeout(localDraftTimer);localDraftTimer=setTimeout(cacheLocalDraft,Math.max(0,Math.min(180,700-(Date.now()-localDraftStarted))));clearTimeout(draftTimer);draftTimer=setTimeout(()=>{cacheLocalDraft();void api('/api/draft',{id:libraryId,clientId,payload:draftPayload()}).catch(e=>toast('草稿写入失败：'+e.message));},300);clearTimeout(saveTimer);if(!composition&&!conflict)saveTimer=setTimeout(()=>save(),950);}
async function save(rebaseAttempts=1){
  clearTimeout(saveTimer);clearTimeout(draftTimer);cacheLocalDraft();if(composition)return false;if(savePromise){await savePromise;if(dirty&&!conflict)return save(rebaseAttempts);return !conflict;}if(!dirty)return true;if(conflict)return false;
  saving=true;let rebased=false;
  savePromise=Promise.resolve().then(async()=>{try{
    if(remoteStamp&&remoteStamp!==stamp&&!(await syncRemoteState()))return false;
    const sent=revision,payload=draftPayload(),expectedStateStamp=stamp;setStatus('正在保存…');
    await api('/api/draft',{id:libraryId,clientId,payload});
    const result=await api('/api/state',{id:libraryId,state:payload.state,expectedStateStamp,clientId,draftRevision:sent});stamp=result.stateStamp;persistedState=structuredClone(result.state);
    // Keep live editor/node objects stable: input handlers may still hold them.
    state.histories=result.state.histories;state.coreDocumentTimes=result.state.coreDocumentTimes??state.coreDocumentTimes;state.savedAt=result.state.savedAt;state.workspaceCommitId=result.state.workspaceCommitId;
    for(const [id,doc] of Object.entries(state.documents)){const saved=result.state.documents[id];if(!saved)continue;doc.contentRef=saved.contentRef;if(doc.canvas&&saved.canvas){const ids=new Set(saved.canvas.assets.map(a=>a.id));doc.canvas.assets=[...saved.canvas.assets,...(doc.canvas.assets??[]).filter(a=>!ids.has(a.id))];}else if(revision===sent)doc.coreRichText=saved.coreRichText;}
    if(revision===sent){dirty=false;localStorage.removeItem(draftKey());}
    setStatus(dirty?'待保存':'已保存到本地');
    document.dispatchEvent(new CustomEvent('shensi:workspace-committed',{detail:{id:payload.notebookId,stateStamp:result.stateStamp,generationDrafts:Object.fromEntries(Object.entries(result.state.documents).filter(([,doc])=>doc.canvas?.coreGenerationDrafts).map(([id,doc])=>[id,doc.canvas.coreGenerationDrafts]))}}));
    if(panel==='history'||panel==='node'&&nodeTab==='history')renderPanel();return true;
  }catch(e){
    // A source window can commit its tab removal between our preflight read
    // and commit. Rebase disjoint changes once; real content conflicts still
    // retain both drafts and prevent the pane/window from closing.
    if(e.code==='WORKSPACE_STATE_CONFLICT'&&rebaseAttempts>0){try{if(await syncRemoteState()){rebased=true;return false;}}catch{/* Keep the durable local draft if the rebase read itself fails. */}}
    if(e.code==='WORKSPACE_STATE_CONFLICT')conflict=true;setStatus(conflict?'保存冲突 · 点击处理':'保存失败 · 点击重试',true);toast(e.message);return false;
  }finally{saving=false;savePromise=null;}});const saved=await savePromise;return rebased?save(rebaseAttempts-1):saved;
}
async function checkpointCurrent(scope={notebookId:libraryId,documentId:state.activeDocument},quiet=false){
  const same=()=>scope.notebookId===libraryId&&scope.documentId===state.activeDocument;
  if(!same()||!(await save())||!same())return false;
  const result=await api('/api/history/save',{id:scope.notebookId,documentId:scope.documentId,expectedStateStamp:stamp});
  if(!same())return false;stamp=result.stateStamp;
  if(quiet){state.histories=result.state.histories;state.savedAt=result.state.savedAt;state.workspaceCommitId=result.state.workspaceCommitId;for(const [id,doc] of Object.entries(state.documents)){const saved=result.state.documents[id];if(!saved)continue;doc.contentRef=saved.contentRef;if(doc.canvas&&saved.canvas){const ids=new Set(saved.canvas.assets.map(a=>a.id));doc.canvas.assets=[...saved.canvas.assets,...doc.canvas.assets.filter(a=>!ids.has(a.id))];}}}
  else{state=preserveWindowView(result.state,state);render();}
  if(!quiet)toast(result.historyReceipt.created?'历史版本已保存':result.historyReceipt.promoted?'相同版本已置于最新':'内容与最新版本相同，无需重复保存');return true;
}
function loadLibrary(id,options){
  // One transition owns the live state and its save identity until it settles.
  const request=++libraryLoadRequest,pending=libraryLoadQueue.then(()=>request===libraryLoadRequest?performLibraryLoad(id,options):false);libraryLoadQueue=pending.catch(()=>{});return pending;
}
async function performLibraryLoad(id,{archivedSource=false}={}){
 if(id===libraryId&&state&&!archivedSource)return true;
 const app=$('#app');libraryTransition=true;app.inert=true;app.setAttribute('aria-busy','true');
 if($('#library-select'))$('#library-select').value=libraryId;
 const incoming=Promise.all([api('/api/state?id='+encodeURIComponent(id),undefined,false),api(`/api/draft?id=${encodeURIComponent(id)}&clientId=${clientId}`,undefined,false)]);void incoming.catch(()=>{});
 try{
  if(!await workTools.close())return false;
  if(state&&!archivedSource&&(!(await inlineEditor.finish())||!(await save())))return false;
  await official.beforeSwitch();await dock.closeSplit();
  // Read everything against the captured target before publishing any globals.
  const [result,diskDraft]=await incoming;
  let browserDraft;try{browserDraft=JSON.parse(localStorage.getItem('core-draft:'+id+(detachedType?':'+clientId:''))||'null');}catch{}
  const pending=newestLocalDraft(browserDraft,diskDraft,clientId);
  const draftMatches=!pending?.state||(!pending.notebookId||pending.notebookId===id)&&pending.state.coreLegacyLibraryImport?.sourceId===result.state.coreLegacyLibraryImport?.sourceId;
  void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();official.close();extensions.dismiss();
  libraryEpoch++;libraryId=id;state=result.state;stamp=result.stateStamp;persistedState=structuredClone(result.state);remoteStamp='';graphTabOpen=false;graphTabActive=false;localStorage.setItem('core-library',id);revision=0;dirty=false;conflict=false;panel='';documentClipboard=null;selected.clear();selectedEdges.clear();selectedEdge='';boardUndo=[];boardRedo=[];
  if(['graph','blank','document','whiteboard','work-report'].includes(detachedType)){state.documentTabs=[];state.activeDocument='';state.activeDocumentTabId='';const targetId=detached.get('document');if(['document','whiteboard'].includes(detachedType)&&state.documents[targetId])Object.assign(state,tabs.openDocumentInTabs(state,targetId));}
  revision=Math.max(revision,Number(diskDraft?.revision)||0,Number(browserDraft?.revision)||0);
  Object.assign(state,tabs.normalizeDocumentTabState(state));state.coreFolders??=[];
  render();
  if(!draftMatches)toast('检测到归属不符的旧草稿，已保留原稿并打开磁盘内容。');
  else if(pending?.state){const answer=await modal('发现未保存的编辑',`<p>${pending.baseStamp===stamp?'上次退出前的本地稿可以继续编辑。':'磁盘内容已发生变化；恢复后会保留本地稿，并要求比较处理冲突。'}</p>`,[['先查看磁盘稿','cancel'],['恢复本地稿','restore']]);if(answer.value==='restore'){state=restoreDraftState(pending.state,result.state);revision=pending.revision+1;dirty=true;conflict=pending.baseStamp!==stamp;stamp=pending.baseStamp;render();if(!conflict)await save();}}
  return true;
 }finally{libraryTransition=false;app.inert=false;app.removeAttribute('aria-busy');if($('#library-select'))$('#library-select').value=libraryId;}
}
function applyTheme(){applyPresentation(ui);localizeCore(document.body,ui.uiLanguage);}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(!settingsPage.isOpen)applyTheme();});
function treeMarkup(){
  let rows=[...new Set([...(state.moduleItems?.library??[]).map(([id])=>id),...Object.keys(state.documents)])].filter(id=>state.documents[id]);
  if(!state.coreWork?.enabled)rows=sortDirectoryItems(rows.map(id=>({...state.documents[id],id})),state.coreDirectorySort,state.coreDocumentTimes).map(d=>d.id);
  const search=query.toLowerCase(),matches=id=>{const d=state.documents[id];return d&&(!search||state.coreWork?.enabled||(d.title+' '+(d.markdown||'')+' '+(d.canvas?.nodes??[]).map(n=>n.text||'').join(' ')).toLowerCase().includes(search));};
  const chapterLabels=workChapterLabels(state,rows,ui.uiLanguage);
  const row=id=>{const d=state.documents[id];return `<div class="tree-row ${id===state.activeDocument?'selected':''}" draggable="true" data-doc="${h(id)}" role="treeitem" tabindex="0">${icon(d.documentKind==='whiteboard'?'board':'file')}<span>${h(chapterLabels.get(id)||d.title)}</span><button data-file-menu="${h(id)}" aria-label="${h(d.title)}的操作">${icon('more')}</button></div>`;};
  if(query&&!state.coreWork?.enabled)return rows.filter(matches).map(row).join('')||'<p class="muted" style="padding:10px">没有匹配内容</p>';
  const folders=state.coreFolders??[];
  // Render-local indexes: never reuse document content across edits or notebooks.
  const folderIndex=new Map(folders.map(f=>[f.id,f])),folderRows=new Map(),children=new Map();
  for(const id of rows){const key=state.documents[id].coreFolderId;if(!folderRows.has(key))folderRows.set(key,[]);folderRows.get(key).push(id);}
  for(const f of state.coreWork?.enabled?folders:sortDirectoryItems(folders,state.coreDirectorySort)){if(!children.has(f.parentId))children.set(f.parentId,[]);children.get(f.parentId).push(f);}
  const docsIn=id=>(folderRows.get(id)||[]).map(row).join('');
  if(!state.coreWork?.enabled&&ui.directoryView==='favorites'){const favorites=state.coreFavorites||[];return favorites.map(key=>{const [kind,id]=key.split(':');if(kind==='document'&&state.documents[id])return row(id);const folder=kind==='folder'&&folderIndex.get(id);return folder?`<div class="tree-row folder-row" data-folder="${h(id)}"><span>${icon('folder')}${h(folder.name)}</span><button data-folder-menu="${h(id)}" aria-label="文件夹操作">${icon('more')}</button></div>${folder.collapsed?'':docsIn(id)}`:'';}).join('')||'<p class="muted work-empty">右键文档、白板或文件夹，收藏到当前笔记本。</p>';}
  if(state.coreWork?.enabled){
    const role=workSection==='index'?'':workSection;
    const belongs=id=>{const d=state.documents[id],folder=folderIndex.get(d?.coreFolderId);return workSection==='index'?(!d.coreWorkType||d.coreWorkType===state.coreWork.type):role==='manuscript'?folder?.workRole==='manuscript'||folder?.workRole==='volume':folder?.workRole===role||d?.coreWorkRole===role;};
    const folderMarkup=(f,ancestors=new Set())=>{if(ancestors.has(f.id))return '';const next=new Set([...ancestors,f.id]);return `<div class="tree-row folder-row work-folder" data-folder="${h(f.id)}"><span>${f.collapsed?'›':'⌄'} ${icon('folder')} <span ${workFolderCopy(f)?`data-core-copy data-core-english="${h(workFolderCopy(f))}"`:''}>${h(f.name)}</span></span><small>${folderRows.get(f.id)?.length||0}</small><button data-folder-menu="${h(f.id)}" aria-label="${h(f.name)}的操作">${icon('more')}</button></div><div class="folder-children" ${f.collapsed?'hidden':''}>${docsIn(f.id)}${(children.get(f.id)||[]).map(child=>folderMarkup(child,next)).join('')}</div>`;};
    if(role==='manuscript'){
      const root=folders.find(f=>f.workRole==='manuscript'&&(!f.workType||f.workType===state.coreWork.type)),volumes=folders.filter(f=>f.workRole==='volume'&&(!f.workType||f.workType===state.coreWork.type)&&(!root||f.parentId===root.id));
      return (root?docsIn(root.id):'')+volumes.map(f=>folderMarkup(f)).join('')+(!root&&!volumes.length?rows.filter(belongs).map(row).join(''):'');
    }
    if(role){const root=folders.find(f=>f.workRole===role);return (root?docsIn(root.id):'')+(children.get(root?.id)||[]).map(f=>folderMarkup(f)).join('')||'<p class="muted work-empty">此分区还没有文档</p>';}
    return rows.filter(belongs).map(row).join('')||'<p class="muted work-empty">作品目录还没有文档</p>';
  }
  const visibleFolders=sortDirectoryItems(folders,state.coreDirectorySort);
  const folderMarkup=(f,ancestors=new Set())=>{if(ancestors.has(f.id))return '';const visited=new Set([...ancestors,f.id]);return `<div class="tree-row folder-row" data-folder="${h(f.id)}" role="treeitem" aria-expanded="${!f.collapsed}"><span>${f.collapsed?'›':'⌄'} ${h(f.name)}</span><button data-folder-menu="${h(f.id)}" aria-label="${h(f.name)}的操作">${icon('more')}</button></div><div class="folder-children" ${f.collapsed?'hidden':''}>${docsIn(f.id)}${(children.get(f.id)||[]).map(child=>folderMarkup(child,visited)).join('')}</div>`;};
  return rows.filter(id=>!folderIndex.has(state.documents[id].coreFolderId)).map(row).join('')+visibleFolders.filter(f=>!folderIndex.has(f.parentId)).map(f=>folderMarkup(f)).join('');
}
let titleTreeTimer=0;
function refreshDirectory(){
 clearTimeout(titleTreeTimer);const tree=$('.filetree');if(!tree)return;
 tree.innerHTML=treeMarkup();bindTreeDrag();
 for(const button of $$('.directory-view-button'))button.setAttribute('aria-pressed',String((button.dataset.action==='directory-favorites')===(ui.directoryView==='favorites')));
 localizeCore($('.sidebar'),ui.uiLanguage);
}
function selectWorkSection(next){
 if(next===workSection)return;workSection=next;
 // Only the directory changes; preserve editor selection, IME, media and plugin inputs.
 const sidebar=$('.sidebar'),parts=document.createElement('template');parts.innerHTML=workSidebarMarkup();
 sidebar.querySelector('.work-tree-head').replaceWith(parts.content.querySelector('.work-tree-head'));
 for(const button of sidebar.querySelectorAll('[data-work-section]')){const active=button.dataset.workSection===next;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
 $('.filetree').innerHTML=treeMarkup();bindTreeDrag();localizeCore(sidebar,ui.uiLanguage);
}
const workSections=[['index','索引','list'],['manuscript','正文','file'],['outline','大纲','outline'],['setting','设定','settings'],['memory','记忆','memory'],['library','资料库','folder']];
function settingShortcuts(){const symbols={character:'user',item:'file',creature:'spark',faction:'folder',place:'board',world:'globe',relations:'link',timeline:'clock',general:'book'};return '<div class="setting-atlas-shortcuts" aria-label="已有设定集">'+settingAtlasEntries(state,official.enabled('works')).map(entry=>`<button type="button" data-action="setting-atlas:${entry.type}" title="${h(entry.label)}" aria-label="${h(entry.label)}">${icon(symbols[entry.type]||'file')}</button>`).join('')+'</div>';}
function workSidebarMarkup(){const label=workSections.find(([id])=>id===workSection)?.[1]||'正文',createRole=workSection==='index'?'manuscript':workSection,kind='document';return `<div class="work-creation-tools" role="toolbar" aria-label="作品创作工具">${btn('work-tool:deconstruction','爆款拆书','file')}${btn('work-tool:distillation','文风蒸馏','spark')}${btn('work-tool:ranking','爆款扫榜','list')}${btn('work-tool:names','起名','paint')}</div><nav class="work-nav" aria-label="作品分区">${workSections.map(([id,name,symbol])=>`<button class="work-nav-item ${workSection===id?'active':''}" data-work-section="${id}" ${workSection===id?'aria-current="page"':''}>${icon(symbol)}<span>${name}</span></button>`).join('')}</nav><div class="work-tree-head">${workSection==='setting'?settingShortcuts():''}<span>${label}目录</span>${workSection==='manuscript'?`<button data-work-create="manuscript" data-work-create-kind="volume" title="${state.coreWork.type==='screenplay'?'新建文件夹':'新建卷'}">${icon('folder')}</button>`:''}<button data-work-create="${createRole}" data-work-create-kind="${kind}" title="${kind==='volume'?(state.coreWork.type==='screenplay'?'新建文件夹':'新建卷'):'新建文档'}">${icon('plus')}</button></div>`;}
function toggleFavorite(kind,id){const key=kind+':'+id;state.coreFavorites=state.coreFavorites||[];state.coreFavorites=state.coreFavorites.includes(key)?state.coreFavorites.filter(v=>v!==key):[...state.coreFavorites,key];markDirty();refreshDirectory();}
async function revealLocation(payload){if(payload.documentId)return locateDocumentInDirectory(payload.documentId);if(!(await save()))return;const result=await api('/api/settings/open-folder',{id:libraryId,kind:'item',...payload});if(result.message)toast(result.message);}
async function locateDocumentInDirectory(id){
 if(!(await inlineEditor.finish())||!(await save()))return;
 const doc=state.documents[id];if(!doc){toast('文档已不存在');return;}
 const folders=state.coreFolders||[],seen=new Set();let folder=folders.find(f=>f.id===doc.coreFolderId),role=doc.coreWorkRole||'';
 while(folder&&!seen.has(folder.id)){seen.add(folder.id);folder.collapsed=false;if(!role&&folder.workRole)role=folder.workRole;if(state.coreWork?.enabled&&folder.workRole==='volume')state.coreWork.activeFolderId=folder.id;folder=folders.find(f=>f.id===folder.parentId);}
 if(state.coreWork?.enabled){if(role==='volume')role='manuscript';workSection=workSections.some(([key])=>key===role)?role:'index';}
 query='';ui.directoryView='files';ui.sidebarHidden=false;prefs();
 if(detachedType)document.documentElement.classList.add('directory-revealed');
 await openDocument(id);
 const row=$$('.filetree [data-doc]').find(el=>el.dataset.doc===id);if(row){directorySelection.select(row);row.scrollIntoView({block:'center',inline:'nearest'});row.focus({preventScroll:true});}
}
function render(){
  const previousScroll=$('.editor-scroll'),documentView=previousScroll?.dataset.documentScope===editorScope()?{top:previousScroll.scrollTop,left:previousScroll.scrollLeft,sourceTop:$('.markdown-source')?.scrollTop||0}:null;
  disposeDocumentImages?.();disposeDocumentImages=null;
  selectionEditor.reset();
  editorColors.close();
  toolbarResizeObserver?.disconnect();documentOutline.dispose();settingAtlas.dispose();
  applyTheme();const doc=current(),board=doc?.documentKind==='whiteboard';
  const atlasContext=settingContext(state,doc,official.enabled('works')),scope=editorScope();
  if(lastEditorScope!==scope){mode=documentModes.get(scope)||(atlasContext?'atlas':'rich');lastEditorScope=scope;}
  if(documentModes.has(scope))mode=documentModes.get(scope);else if(atlasContext)mode='atlas';
  if(!atlasContext&&mode==='atlas')mode='rich';
  replaceWorkspaceMarkup($('#app'),`<div class="shell" style="--left:${ui.sidebarHidden?0:ui.leftWidth||248}px;--right:${panel&&panel!=='trash'?ui.rightWidth||370:0}px">
<nav class="rail" aria-label="本体导航"><img class="logo" src="/logo.png" alt="神思">${btn('sidebar','文件目录','panel')}${official.rail()}${extensions.rail()}<div class="spacer"></div></nav>
    <aside class="sidebar"><div class="workspace"><select id="library-select" aria-label="资料库">${libraries.map(l=>`<option value="${l.id}" ${l.id===libraryId?'selected':''}>${h(l.name)}</option>`).join('')}</select>${btn('new-library','新建笔记','plus')}</div>${state.coreWork?.enabled?workSidebarMarkup():`<label class="searchbox">${icon('search')}<input id="global-search" type="search" value="${h(query)}" placeholder="搜索笔记和卡片" aria-label="搜索全部笔记"></label><div class="section-label note-directory-tools" role="toolbar" aria-label="笔记目录操作">${btn('directory-files','文件列表','list','class="directory-view-button" aria-pressed="'+(ui.directoryView!=='favorites')+'"')}${btn('directory-favorites','收藏','star','class="directory-view-button" aria-pressed="'+(ui.directoryView==='favorites')+'"')}<div class="spacer"></div>${btn('new-folder','新建文件夹','folder')}${btn('new-note','新建文档','file')}${btn('new-board','新建白板','board')}${btn('directory-sort','排序','list','aria-haspopup="menu"')}${btn('collapse-folders','全部折叠','collapseAll')}${btn('import','导入文件','upload')}</div>`}<div class="filetree ${state.coreWork?.enabled?'work-tree':''}" role="tree" aria-label="文件目录">${treeMarkup()}</div><div class="side-bottom"><button data-action="help" class="help-button" title="软件信息与更新检查" aria-label="软件信息与更新检查">?</button><div class="spacer"></div><div class="side-bottom-actions" aria-label="回收站和设置">${btn('trash','回收站','trash')}${btn('settings','设置','settings')}</div></div></aside>
<div class="divider" role="separator" aria-label="调整目录宽度"></div><header class="topbar"><span class="breadcrumb">${h(libraries.find(l=>l.id===libraryId)?.name||'我的笔记')}${doc?' / <b>'+h(doc.title)+'</b>':''}</span><div class="spacer"></div>${doc?btn('autosave-status','已自动保存','','id="autosave-status" class="autosave-state"')+btn('save-history','保存历史版本','','class="save-version"'):''}${extensions.toolbar()}${official.header()}${windowControls.fullscreenMarkup()}${btn('toggle-plugin-dock','展开右侧插件区域','panel','class="plugin-dock-toggle" aria-expanded="false" aria-controls="plugin-dock"')}${windowControls.markup()}</header><main class="main"><nav class="tabs" aria-label="文档标签页">${state.documentTabs.map(t=>`<div class="tab ${!graphTabActive&&t.id===state.activeDocumentTabId?'active':''}" data-tab="${h(t.id)}" role="tab" aria-selected="${!graphTabActive&&t.id===state.activeDocumentTabId}" draggable="true">${icon(state.documents[t.documentId]?.documentKind==='whiteboard'?'board':'file')}<span>${h(state.documents[t.documentId]?.title||'新标签页')}</span><button data-close-tab="${h(t.id)}" aria-label="关闭标签页">×</button></div>`).join('')}${btn('new-tab','新标签页','plus')}</nav>
    ${doc?board?boardToolbar():editorToolbar():''}${findOpen&&doc?findMarkup():''}
    ${!doc?emptyMarkup():board?'<section class="board" aria-label="白板画布" tabindex="0"></section>':`<div class="editor-scroll editor-mode-${h(mode)}" data-editor-mode="${h(mode)}">${mode==='atlas'?'':`<div class="note-page"><input class="doc-title" aria-label="文档标题" value="${h(doc.title)}">${mode==='markdown'?`<textarea class="markdown-source" aria-label="Markdown 正文" spellcheck="false">${h(doc.markdown||'')}</textarea>`:`<article class="editor" contenteditable="${mode==='rich'}" spellcheck="false" aria-label="可编辑正文">${sanitizeDocumentHtml(doc.html||'')}</article>`}</div>`}</div>`}
    <footer class="statusbar"><div class="spacer"></div><span>${board?'白板':doc?mode==='atlas'?'设定集 · 只读':mode==='markdown'?'Markdown':mode==='read'?'阅读':'富文本':'本地笔记'}</span><span id="word-count"></span><span id="selection-count" aria-label="选中字数" hidden></span><span>UTF-8</span>${extensions.statusbar()}<div class="footer-actions" aria-label="软件操作">${btn('theme','主题','theme')}</div></footer></main>${panel==='trash'?'<button class="trash-backdrop" data-action="close-trash" aria-label="关闭回收站"></button>':''}<div class="right-region"><div class="plugin-dock-slot" hidden></div><aside class="inspector ${panel==='trash'?'trash-modal':''}" ${panel?'':'hidden'} ${panel==='trash'?'role="dialog" aria-modal="true" aria-label="回收站"':'aria-label="详情面板"'}></aside></div></div>`,JSON.stringify([libraryId,state.activeDocument]));
  appUpdates.paint();const tabStrip=$('.tabs');$('.shell').insertBefore(tabStrip,$('.topbar'));$('.shell').classList.add('compact-workspace');
  if(graphTabOpen){const newTab=$('[data-action=new-tab]'),position=readGraphTabPosition(),target=$$('.tab[data-tab]').find(tab=>tab.dataset.tab===position?.tabId),markup=`<div class="tab graph-tab ${graphTabActive?'active':''}" data-graph-tab role="tab" aria-selected="${graphTabActive}" draggable="true">${icon('link')}<span>知识图谱</span><button data-close-graph-tab aria-label="关闭知识图谱标签页">×</button></div>`;if(target)target.insertAdjacentHTML(position.side==='after'?'afterend':'beforebegin',markup);else newTab?.insertAdjacentHTML('beforebegin',markup);}
  if(graphTabActive){$('.shell').classList.add('graph-tab-active');const libraryName=libraries.find(l=>l.id===libraryId)?.name||'我的笔记';$('.breadcrumb').innerHTML=h(libraryName)+' / <b>知识图谱</b>';$('.topbar').querySelectorAll('button:not(.window-controls button):not([data-action=toggle-plugin-dock]):not([data-action=window-fullscreen])').forEach(button=>button.hidden=true);$$('.main > .toolbar,.main > .findbar').forEach(el=>el.remove());const content=$('.board')||$('.editor-scroll')||$('.empty');if(content){const host=document.createElement('div');host.id='graph-tab-host';host.className='graph-tab-view';content.replaceWith(host);}const status=$('.statusbar').children[2];if(status)status.textContent='知识图谱';}
  writingTimer.mount();applyWorkToolBadges();official.onRender();bindShell();bindPluginOrder($('.rail'),ui,'railPluginOrder',prefs);if(!graphTabActive&&board)renderBoard();else if(!graphTabActive&&doc)bindEditor();renderPanel();dock.mount();workspaceSplits.mount();workReports.mount();characterParlor.mount();mapWorkshop.mount();glyphWorkshop.mount();novelPublisher.mount();browserWorkspace.mount();bindWorkspaceTabOrder($('.tabs'),{scope:libraryId,changed:ids=>{const next=ids.map(id=>state.documentTabs.find(t=>t.id===id)).filter(Boolean);if(JSON.stringify(next)!==JSON.stringify(state.documentTabs)){state.documentTabs=next;markDirty();}}});setStatus(conflict?'保存冲突 · 点击处理':dirty?'待保存':'已保存到本地',conflict);
  const scroll=$('.editor-scroll');if(scroll){scroll.dataset.documentScope=editorScope();if(documentView){let stopped=false,applied;const restore=()=>{if(stopped||!scroll.isConnected||applied!==undefined&&Math.abs(scroll.scrollTop-applied)>1)return;scroll.scrollTop=documentView.top;scroll.scrollLeft=documentView.left;applied=scroll.scrollTop;const source=scroll.querySelector('.markdown-source');if(source)source.scrollTop=documentView.sourceTop;};restore();requestAnimationFrame(restore);for(const event of ['pointerdown','wheel','keydown'])scroll.addEventListener(event,()=>stopped=true,{once:true,capture:true});for(const image of scroll.querySelectorAll('img'))if(!image.complete)image.addEventListener('load',restore,{once:true});}}
}
function emptyMarkup(){return `<section class="empty"><div class="empty-symbol">${icon('file')}</div><h1>留一处，给正在发生的想法</h1><p>本地记录 · 自由组织 · 随时回到之前的版本</p><div class="empty-actions">${btn('new-note','新建文档')}${btn('new-board','新建白板')}${btn('import','导入文件')}</div>${Object.keys(state.documents).length?`<div class="recent"><div class="section-label">最近打开</div>${[...(state.coreRecent??[]),...Object.keys(state.documents)].filter((id,i,a)=>a.indexOf(id)===i&&state.documents[id]).slice(0,5).map(id=>`<button data-open-doc="${h(id)}">${icon(state.documents[id].documentKind==='whiteboard'?'board':'file')}${h(state.documents[id].title)}<small>打开 ↗</small></button>`).join('')}</div>`:''}</section>`;}
function editorToolbar(){return `<div class="toolbar rich-toolbar note-rich-toolbar" role="toolbar" aria-label="正文富文本工具栏">
  <button type="button" data-outline-toggle title="展开文档大纲" aria-label="展开文档大纲" aria-expanded="false">${icon('list')}</button>
  <div class="note-toolbar-primary" ${official.enabled('editor-toolbar')?'':'hidden'}>
    <button type="button" data-command="undo" title="撤销（Ctrl + Z）" aria-label="撤销">${noteIcon('\uE7A7')}</button>
    <button type="button" data-command="redo" title="重做（Ctrl + Y / Ctrl + Shift + Z）" aria-label="重做">${noteIcon('\uE7A6')}</button>
    <button type="button" data-action="format-painter" title="格式刷" aria-label="格式刷" aria-pressed="false">${noteIcon('\uE76D')}</button>
    <button type="button" data-command="removeFormat" title="清除格式" aria-label="清除格式">${noteIcon('\uE75C')}</button>
    <span class="note-toolbar-divider" aria-hidden="true"></span>
    <button type="button" data-command="formatBlock" data-format-value="p" title="正文">正文</button>
    <button type="button" data-command="formatBlock" data-format-value="h1" title="标题 1">H1</button>
    <button type="button" data-command="formatBlock" data-format-value="h2" title="标题 2">H2</button>
    <button type="button" data-command="formatBlock" data-format-value="h3" title="标题 3">H3</button>
    <button type="button" data-command="bold" title="加粗（Ctrl + B）" aria-label="加粗"><strong>B</strong></button>
    <button type="button" data-command="italic" title="斜体（Ctrl + I）" aria-label="斜体"><em>I</em></button>
    <button type="button" data-command="strikeThrough" title="删除线" aria-label="删除线"><s>S</s></button>
    <button type="button" data-command="underline" title="下划线（Ctrl + U）" aria-label="下划线"><u>U</u></button>
    <button type="button" data-command="insertUnorderedList" title="项目符号列表">${noteIcon('\uE8FD')}</button>
    <button type="button" data-command="insertOrderedList" title="编号列表"><span class="note-number-list-icon"><b>1.</b><span>≡</span></span></button>
    <button type="button" data-action="checklist" title="核对清单" aria-label="核对清单">${noteIcon('\uE9D5')}</button>
    <button type="button" data-command="justifyLeft" title="左对齐">${noteIcon('\uE8E4')}</button>
    <button type="button" data-command="justifyCenter" title="居中">${noteIcon('\uE8E3')}</button>
    <button type="button" data-command="justifyRight" title="右对齐">${noteIcon('\uE8E2')}</button>
    <button data-action="link" title="插入链接" aria-label="插入链接">${noteIcon('\uE71B')}</button><button data-action="table" title="选择表格尺寸" aria-label="插入表格">${noteIcon('\uF0E2')}</button><button data-action="attachment" title="在光标位置插入图片或视频" aria-label="插入图片或视频">${noteIcon('\uE91B')}</button>
  </div>
  <button ${official.enabled('editor-toolbar')?'':'hidden'} class="note-toolbar-expand" type="button" data-action="toolbar-more" title="展开全部工具" aria-label="展开全部工具" aria-expanded="false">»</button>
  <div class="note-toolbar-more" hidden>
    <button type="button" data-command="formatBlock" data-format-value="p" title="正文">正文</button>
    <button type="button" data-command="formatBlock" data-format-value="h1" title="标题 1">H1</button>
    <button type="button" data-command="formatBlock" data-format-value="h2" title="标题 2">H2</button>
    <button type="button" data-command="formatBlock" data-format-value="h3" title="标题 3">H3</button>
    <button type="button" data-command="bold" title="加粗"><strong>B</strong></button>
    <button type="button" data-command="italic" title="斜体"><em>I</em></button>
    <button type="button" data-command="strikeThrough" title="删除线"><s>S</s></button>
    <button type="button" data-command="underline" title="下划线"><u>U</u></button>
    <button type="button" data-command="removeFormat" title="清除格式">${noteIcon('\uE75C')}</button>
    <button type="button" data-command="insertUnorderedList" title="项目符号列表">${noteIcon('\uE8FD')}</button>
    <button type="button" data-command="insertOrderedList" title="编号列表"><span class="note-number-list-icon"><b>1.</b><span>≡</span></span></button>
    <button type="button" data-action="checklist" title="核对清单">${noteIcon('\uE9D5')}</button>
    <button type="button" data-command="formatBlock" data-format-value="blockquote" title="引用">${noteIcon('\uE848')}</button>
    <button type="button" data-command="formatBlock" data-format-value="pre" title="代码块"><span class="note-code-icon">&lt;/&gt;</span></button>
    <button type="button" data-command="justifyLeft" title="左对齐">${noteIcon('\uE8E4')}</button>
    <button type="button" data-command="justifyCenter" title="居中">${noteIcon('\uE8E3')}</button>
    <button type="button" data-command="justifyRight" title="右对齐">${noteIcon('\uE8E2')}</button>
    ${editorColors.markup('foreColor','\uE8D3')}
    ${editorColors.markup('hiliteColor','\uE7E6')}
    <button data-action="link" title="插入链接" aria-label="插入链接">${noteIcon('\uE71B')}</button><button data-action="table" title="选择表格尺寸" aria-label="插入表格">${noteIcon('\uF0E2')}</button><button data-action="attachment" title="在光标位置插入图片或视频" aria-label="插入图片或视频">${noteIcon('\uE91B')}</button>
    <button type="button" data-command="insertHorizontalRule" title="插入分隔线"><span class="note-rule-icon">─</span></button>
  </div>
<div class="note-toolbar-right">${writingTimer.markup()}${official.enabled('thirdparty.text-reader')?'<button data-action="official-reader" title="文档朗读" aria-label="文档朗读">'+icon('volume')+'</button>':''}${btn('find','查找与替换（Ctrl+F）','search')}${current()&&official.enabled('graph')?`<button class="toolbar-graph-link" data-action="official-links" aria-label="双向链接" title="双向链接">${icon('graph')}</button>`:''}<select id="editor-mode" aria-label="编辑模式">${settingContext(state,current(),official.enabled('works'))?`<option value="atlas" ${mode==='atlas'?'selected':''}>设定集</option>`:''}<option value="rich" ${mode==='rich'?'selected':''}>编辑</option><option value="read" ${mode==='read'?'selected':''}>预览</option><option value="markdown" ${mode==='markdown'?'selected':''}>Markdown</option></select></div>
</div>`;}
function boardToolbar(){return '';}
function findMarkup(){return `<div class="findbar"><input id="find-query" placeholder="查找当前内容" aria-label="查找内容"><input id="find-replacement" placeholder="替换为" aria-label="替换为"><output id="find-count"></output>${btn('find-next','下一处')}${btn('replace-all','全部替换')}${btn('close-find','关闭')}</div>`;}
function bindShell(){
  $('#app').onclick=e=>{const action=e.target.closest('[data-action]');if(action){void runAction(action.dataset.action).catch(error=>toast(error.message));return;}const section=e.target.closest('[data-work-section]');if(section){selectWorkSection(section.dataset.workSection);return;}const create=e.target.closest('[data-work-create]');if(create){void createWorkEntry(create.dataset.workCreate,create.dataset.workCreateKind||'document').catch(error=>toast(error.message));return;}const graphClose=e.target.closest('[data-close-graph-tab]');if(graphClose){e.stopPropagation();closeGraphTab();return;}const graphTab=e.target.closest('[data-graph-tab]');if(graphTab){if(suppressGraphTabClick){suppressGraphTabClick=false;e.preventDefault();return;}void activateGraphTab();return;}const menu=e.target.closest('[data-file-menu]');if(menu){void fileMenu(menu.dataset.fileMenu,e);return;}const fm=e.target.closest('[data-folder-menu]');if(fm){void folderMenu(fm.dataset.folderMenu,e);return;}const row=e.target.closest('[data-doc],[data-open-doc]');if(row){void openDocument(row.dataset.doc||row.dataset.openDoc).then(()=>{if(row.closest('.filetree'))$('.filetree')?.focus({preventScroll:true});}).catch(error=>toast(error.message));return;}const folder=e.target.closest('[data-folder]');if(folder){const f=state.coreFolders.find(f=>f.id===folder.dataset.folder);if(f){f.collapsed=!f.collapsed;if(state.coreWork?.enabled&&f.workRole==='volume')state.coreWork.activeFolderId=f.id;markDirty();$('.filetree').innerHTML=treeMarkup();bindTreeDrag();}return;}const close=e.target.closest('[data-close-tab]');if(close){void changeTabs(()=>tabs.closeDocumentTab(state,close.dataset.closeTab));return;}const tab=e.target.closest('[data-tab]');if(tab)void changeTabs(()=>tabs.activateDocumentTab(state,tab.dataset.tab));};
  if($('#global-search'))$('#global-search').oninput=e=>{query=e.target.value;$('.filetree').innerHTML=treeMarkup();bindTreeDrag();};
  $('#library-select').onchange=e=>{const targetId=e.target.value;e.target.value=libraryId;void loadLibrary(targetId).catch(error=>toast(error.message));};
  bindNotebookPicker($('#library-select'),{menu:notebookMenu,onError:error=>toast(error.message)});
  bindResize($('.divider'),'leftWidth',180,420,false);
  bindTreeDrag();bindTabDrag();
  $('.workspace').oncontextmenu=e=>{e.preventDefault();void notebookMenu(e).catch(error=>toast(error.message));};
  $('.topbar').ondblclick=e=>{if(document.documentElement.classList.contains('desktop-shell')&&!e.target.closest('button,input,select'))void runAction('window-maximize');};
  $('.tabs').oncontextmenu=async e=>{
   e.preventDefault();e.stopPropagation();try{
    const tab=e.target.closest('[data-tab]'),entry=state.documentTabs.find(t=>t.id===tab?.dataset.tab),graph=e.target.closest('[data-graph-tab]');
    if(!entry&&!graph)return;
    const answer=await contextMenu([...(entry?.documentId?[{value:'favorite',label:(state.coreFavorites||[]).includes('document:'+entry.documentId)?'取消收藏':'收藏'},{value:'history',label:'历史版本'},{value:'reveal',label:'打开所在目录'},null]:[]),{value:'detach',label:'移动至新窗口'},{value:'split-horizontal',label:'左右分屏'},{value:'split-vertical',label:'上下分屏'},null,{value:'close',label:'关闭'}],e,{historyFirst:false});
    if(answer.value==='favorite'){toggleFavorite('document',entry.documentId);await save();return;}
    if(answer.value==='history')return historyViewer.open(entry.documentId);
    if(answer.value==='reveal')return locateDocumentInDirectory(entry.documentId);
    if(!['detach','split-horizontal','split-vertical','close'].includes(answer.value)||!(await inlineEditor.finish())||!(await save()))return;
    const target={type:graph?'graph':entry?.documentId?(state.documents[entry.documentId]?.canvas?'whiteboard':'document'):'blank',notebookId:libraryId,documentId:entry?.documentId||'',tabId:entry?.id||'',...tabTransferPosition(state.documentTabs,entry?.id,[...transferredTabs.values()].filter(t=>t.notebookId===libraryId)),...(graph?{graphPosition:readGraphTabPosition()||{tabId:'',side:'before'}}:{}),title:graph?'知识图谱':state.documents[entry?.documentId]?.title||'新标签页'};
    const remove=async()=>{
     if(libraryId!==target.notebookId||!(await inlineEditor.finish())||!(await save()))return false;
     const view={documentTabs:structuredClone(state.documentTabs),activeDocument:state.activeDocument,activeDocumentTabId:state.activeDocumentTabId},graphView={open:graphTabOpen,active:graphTabActive};
     if(graph)closeGraphTab();else if(entry&&!await changeTabs(()=>tabs.closeDocumentTab(state,entry.id)))return false;
     if(await save())return true;
     Object.assign(state,view);graphTabOpen=graphView.open;graphTabActive=graphView.active;markDirty();render();return false;
    };
    if(answer.value==='close'){await remove();return;}
    const key=transferKey(target);transferredTabs.set(key,target);
    try{if(answer.value.startsWith('split-'))await workspaceSplits.open(target,answer.value.slice(6),remove);else await workspaceSplits.detach(target,remove);}catch(error){transferredTabs.delete(key);throw error;}
   }catch(error){toast(error.message);}
  };
  $('.breadcrumb').oncontextmenu=e=>{if(current()){e.preventDefault();fileMenu(state.activeDocument,e).catch(e=>toast(e.message));}};
  $('.work-nav')?.addEventListener('contextmenu',event=>{const section=event.target.closest('[data-work-section]');if(!section)return;event.preventDefault();const role=section.dataset.workSection,scope=role==='index'?'index':'section:'+role;void contextMenu([{value:'history',label:'历史版本'},{value:'reveal',label:'打开所在文件夹'}],event).then(answer=>answer.value==='history'?directoryHistory.open(scope,section.textContent):answer.value==='reveal'?revealLocation({workRole:role}):null).catch(error=>toast(error.message));});
  bindDirectorySelection();
  $('.filetree').onkeydown=e=>{const row=e.target.closest('[data-doc]');if(row&&e.key==='Enter')openDocument(row.dataset.doc);};
  if($('#find-query'))$('#find-query').oninput=()=>{const d=current(),text=d.canvas?d.canvas.nodes.map(n=>n.text||'').join('\n'):d.markdown||'';$('#find-count').textContent=findTextMatches(text,$('#find-query').value).length+' 处';};
}
function bindResize(el,key,min,max,invert){el.onpointerdown=e=>{const start=e.clientX,initial=ui[key]||(invert?370:248);el.setPointerCapture(e.pointerId);el.onpointermove=ev=>{ui[key]=Math.max(min,Math.min(max,initial+(ev.clientX-start)*(invert?-1:1)));$('.shell').style.setProperty(invert?'--right':'--left',ui[key]+'px');};el.onpointerup=()=>{el.onpointermove=null;prefs();};};}
function bindTreeDrag(){bindDirectorySelection();for(const row of $$('.tree-row[data-doc]'))row.ondragstart=e=>{e.dataTransfer.setData('application/shensi-doc',row.dataset.doc);};for(const target of $$('.filetree,[data-folder],[data-doc]')){target.ondragover=e=>{if(e.dataTransfer.types.includes('application/shensi-doc')){e.preventDefault();e.stopPropagation();}};target.ondrop=e=>{const id=e.dataTransfer.getData('application/shensi-doc');if(!state.documents[id])return;e.preventDefault();e.stopPropagation();if(target.dataset.doc){const ordered=(state.moduleItems.library??[]).filter(([key])=>key!==id);const index=ordered.findIndex(([key])=>key===target.dataset.doc);ordered.splice(Math.max(0,index),0,[id,state.documents[id].title]);state.moduleItems.library=ordered;state.documents[id].coreFolderId=state.documents[target.dataset.doc].coreFolderId||'';}else state.documents[id].coreFolderId=target.dataset.folder||'';markDirty();render();};}}
function readGraphTabPosition(){try{return JSON.parse(localStorage.getItem(`core-graph-tab-position:${libraryId}`)||'null');}catch{return null;}}
function writeGraphTabPosition(tabId=null,side='before'){if(tabId)localStorage.setItem(`core-graph-tab-position:${libraryId}`,JSON.stringify({tabId,side}));else localStorage.removeItem(`core-graph-tab-position:${libraryId}`);}
function reorderDocumentAroundGraph(id,side){const graph=$('[data-graph-tab]');if(!graph)return;const previous=graph.previousElementSibling?.matches('[data-tab]')?graph.previousElementSibling:null,next=graph.nextElementSibling?.matches('[data-tab]')?graph.nextElementSibling:null;const target=side==='before'?(previous||next):(next||previous);if(!target)return;const placement=target===previous?'after':'before';const result=tabs.reorderDocumentTabs(state,id,target.dataset.tab,placement);if(result.changed){Object.assign(state,result);markDirty();render();}}
function bindTabDrag(){const docs=$$('[data-tab]');for(const tab of docs){tab.ondragstart=e=>{e.dataTransfer.setData('application/shensi-tab',tab.dataset.tab);e.dataTransfer.effectAllowed='move';};tab.ondragover=e=>{if(e.dataTransfer.types.includes('application/shensi-tab')||e.dataTransfer.types.includes('application/shensi-graph-tab')){e.preventDefault();tab.classList.add('tab-drop-target');}};tab.ondragleave=()=>tab.classList.remove('tab-drop-target');tab.ondrop=e=>{e.preventDefault();e.stopPropagation();tab.classList.remove('tab-drop-target');const graph=e.dataTransfer.getData('application/shensi-graph-tab');if(graph){writeGraphTabPosition(tab.dataset.tab,e.clientX>tab.getBoundingClientRect().left+tab.getBoundingClientRect().width/2?'after':'before');render();setTimeout(()=>{suppressGraphTabClick=false;},0);return;}const id=e.dataTransfer.getData('application/shensi-tab');if(!id)return;const placement=e.clientX>tab.getBoundingClientRect().left+tab.getBoundingClientRect().width/2?'after':'before',result=tabs.reorderDocumentTabs(state,id,tab.dataset.tab,placement);if(result.changed){Object.assign(state,result);markDirty();render();}};}
 const graph=$('[data-graph-tab]'),tabBar=$('.tabs');if(graph){graph.ondragstart=e=>{e.dataTransfer.setData('application/shensi-graph-tab','graph');e.dataTransfer.effectAllowed='move';graph.classList.add('tab-dragging');suppressGraphTabClick=true;};graph.ondragend=()=>{graph.classList.remove('tab-dragging');setTimeout(()=>{suppressGraphTabClick=false;},0);};graph.onpointerdown=e=>{if(e.pointerType==='mouse'||e.button!==0||e.target.closest('button'))return;e.preventDefault();graph.setPointerCapture(e.pointerId);graph.__tabDrag={pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,moved:false};/* Touch and pen fallback; mouse uses the same native drag path as document tabs. */};graph.onpointermove=e=>{const drag=graph.__tabDrag;if(!drag)return;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>6){drag.moved=true;graph.classList.add('tab-dragging');}};graph.onpointerup=e=>{const drag=graph.__tabDrag;graph.__tabDrag=null;graph.classList.remove('tab-dragging');if(!drag?.moved)return;suppressGraphTabClick=true;const target=docs.find(tab=>{const bounds=tab.getBoundingClientRect();return e.clientX>=bounds.left&&e.clientX<=bounds.right&&e.clientY>=bounds.top&&e.clientY<=bounds.bottom;});if(target){writeGraphTabPosition(target.dataset.tab,e.clientX>target.getBoundingClientRect().left+target.getBoundingClientRect().width/2?'after':'before');render();}else if(tabBar){const bounds=tabBar.getBoundingClientRect();if(e.clientX>=bounds.left&&e.clientX<=bounds.right&&e.clientY>=bounds.top&&e.clientY<=bounds.bottom){writeGraphTabPosition();render();}}setTimeout(()=>{suppressGraphTabClick=false;},0);};graph.onpointercancel=()=>{graph.__tabDrag=null;graph.classList.remove('tab-dragging');};graph.ondragover=e=>{if(e.dataTransfer.types.includes('application/shensi-tab')){e.preventDefault();graph.classList.add('tab-drop-target');}};graph.ondragleave=()=>graph.classList.remove('tab-drop-target');graph.ondrop=e=>{const id=e.dataTransfer.getData('application/shensi-tab');if(!id)return;e.preventDefault();e.stopPropagation();graph.classList.remove('tab-drop-target');reorderDocumentAroundGraph(id,e.clientX<graph.getBoundingClientRect().left+graph.getBoundingClientRect().width/2?'before':'after');};}
 if(tabBar){tabBar.ondragover=e=>{if(e.dataTransfer.types.includes('application/shensi-graph-tab'))e.preventDefault();};tabBar.ondrop=e=>{if(!e.dataTransfer.getData('application/shensi-graph-tab')||e.target.closest('[data-tab],[data-graph-tab]'))return;e.preventDefault();writeGraphTabPosition();render();setTimeout(()=>{suppressGraphTabClick=false;},0);};}}
async function changeTabs(fn){const request=++documentSwitchRequest,epoch=libraryEpoch;if(composition||conflict)return false;if(!(await inlineEditor.finish())||request!==documentSwitchRequest||epoch!==libraryEpoch)return false;cacheLocalDraft();glyphWorkshop.deactivate();mapWorkshop.deactivate();characterParlor.deactivate();void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();Object.assign(state,fn());panel='';graphTabActive=false;selected.clear();boardUndo=[];boardRedo=[];markDirty({contentChanged:false});render();return true;}
async function prepareWindowClose(){
 await official.beforeSwitch();if(!await dock.flushSplit())return {saved:false};
 if(!await workTools.flush()||!await glyphWorkshop.flush()||!await mapWorkshop.flush()||!await novelPublisher.flush())return {saved:false};
 if(!state||!(await inlineEditor.finish())||!(await save())){toast('当前编辑尚未保存，请处理保存冲突或重试后关闭。');return {saved:false};}
 return {saved:true};
}
const returnNotices=new Set();
const transferredTabs=new Map();
const transferKey=target=>target.notebookId+':'+(target.tabId||target.type);
function tabSpace(){if(browserWorkspace.count()+novelPublisher.count()+state.documentTabs.length+(graphTabOpen?1:0)+workReports.count()+characterParlor.count()+mapWorkshop.count()+glyphWorkshop.count()<8)return true;toast('签页位置已满，请先关闭一个签页。');return false;}
async function restoreDetachedTab(target){
 if(!(await inlineEditor.finish())||!(await save()))return false;
 if(libraryId!==target.notebookId)await loadLibrary(target.notebookId);
 if(libraryId!==target.notebookId||!(await syncRemoteState()))return false;
 if(target.type==='work-report')return workReports.restore(target);
 if(target.type==='graph'){if(!graphTabOpen&&!tabSpace())return false;characterParlor.deactivate();void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();if(target.graphPosition)writeGraphTabPosition(target.graphPosition.tabId,target.graphPosition.side);graphTabOpen=true;graphTabActive=true;panel='';transferredTabs.delete(transferKey(target));render();return true;}
 const result=returnedTabState(state,target,{maxTabs:8-browserWorkspace.count()-novelPublisher.count()-workReports.count()-characterParlor.count()-mapWorkshop.count()-(graphTabOpen?1:0)});
 if(result.limitReached){const key=target.tabId||target.documentId;if(!returnNotices.has(key)){returnNotices.add(key);toast('签页等待归还，请先关闭一个签页以腾出位置。');}return false;}
 if(result.missing){transferredTabs.delete(transferKey(target));toast('目标视图已关闭；原文件已被删除，没有重新创建文件。');return true;}
 if(!result.changed)return true;
 state.documentTabs=result.documentTabs;state.activeDocument=result.activeDocument;state.activeDocumentTabId=result.activeDocumentTabId;
 characterParlor.deactivate();graphTabActive=false;panel='';selected.clear();boardUndo=[];boardRedo=[];markDirty();render();
 const saved=await save();if(saved)transferredTabs.delete(transferKey(target));return saved;
}
async function openDocument(id){const request=++documentSwitchRequest,epoch=libraryEpoch;id=state.coreDocumentRedirects?.[id]||id;if(composition||conflict){toast('请先处理当前保存冲突或完成输入');return false;}if(!state.documents[id])return false;if(!await glyphWorkshop.flush()||!(await inlineEditor.finish())||request!==documentSwitchRequest||epoch!==libraryEpoch)return false;cacheLocalDraft();extensions.clearConversationTarget();glyphWorkshop.deactivate();mapWorkshop.deactivate();characterParlor.deactivate();void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();Object.assign(state,tabs.openDocumentInTabs(state,id));state.coreRecent=[id,...(state.coreRecent??[]).filter(x=>x!==id)].slice(0,30);panel='';graphTabActive=false;selected.clear();boardUndo=[];boardRedo=[];markDirty({contentChanged:false});render();return true;}
async function openGraphTab(){if(!graphTabOpen&&!tabSpace())return;mapWorkshop.deactivate();characterParlor.deactivate();void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();if(!(await inlineEditor.finish())||!(await save()))return;graphTabOpen=true;graphTabActive=true;panel='';render();}
async function activateGraphTab(){mapWorkshop.deactivate();characterParlor.deactivate();void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();if(!(await inlineEditor.finish())||!(await save()))return;graphTabActive=true;panel='';render();}
function closeGraphTab(){graphTabOpen=false;graphTabActive=false;render();}
let creatingDocument=false;
async function newDocument(board=false,imported,copy={}){
 if(creatingDocument){toast('正在新建并保存，请稍候');return;}const scope=libraryId+':'+libraryEpoch;creatingDocument=true;
 try{
  setStatus(copy.copyFromDocumentId?'正在创建副本…':board?'正在新建白板…':'正在新建文档…');
  if(!(await inlineEditor.finish())||!(await save())||scope!==libraryId+':'+libraryEpoch)return;
  let sent=revision,base=persistedState,result;
  for(let attempt=0;attempt<2;attempt++){
   try{result=await api('/api/document',{id:libraryId,expectedStateStamp:stamp,kind:board?'whiteboard':'note',document:imported,...copy});break;}
   catch(error){if(attempt||error.code!=='WORKSPACE_STATE_CONFLICT')throw error;
    if(!(await syncRemoteState({force:true}))||!(await save())||scope!==libraryId+':'+libraryEpoch)return;
    sent=revision;base=persistedState;
   }
  }
  if(scope!==libraryId+':'+libraryEpoch)return;
  persistedState=structuredClone(result.state);
  if(revision!==sent){
   const merged=reconcileWindowState(base,state,result.state);
   if(merged.conflict){conflict=true;setStatus('保存冲突 · 本地稿已保留',true);toast('新文件已保存，当前编辑保留；请处理保存冲突后查看。');return;}
   state=merged.state;stamp=result.stateStamp;markDirty();refreshDirectory();toast('新文件已保存，当前编辑保持不变。');return;
  }
  mapWorkshop.deactivate();characterParlor.deactivate();void browserWorkspace.deactivate();novelPublisher.deactivate();workReports.deactivate();
  state=result.state;stamp=result.stateStamp;panel='';graphTabActive=false;selected.clear();boardUndo=[];boardRedo=[];mode='rich';query='';ui.sidebarHidden=false;prefs();render();setStatus('已保存到本地');$('.doc-title')?.focus();$('.doc-title')?.select();toast(board?'白板已创建并保存':'文档已创建并保存');
 }catch(error){setStatus('新建未完成 · 请重试',true);toast(error.message);}finally{creatingDocument=false;}
}
async function createFolder(name='未命名文件夹',parentId=''){const base=name;let suffix=1;while(state.coreFolders.some(f=>(f.parentId||'')===parentId&&f.name===name))name=base+' '+(++suffix);const now=new Date().toISOString();state.coreFolders.push({id:'folder-'+crypto.randomUUID(),name,parentId,createdAt:now,modifiedAt:now});markDirty();refreshDirectory();}
async function createWorkEntry(role,kind='document',parentId=''){if(!(await save()))return;if(kind!=='volume'&&!state.coreFolders.some(f=>f.workRole===role)){const name=workSections.find(([id])=>id===role)?.[1]||role;state.coreFolders.push({id:'work-'+crypto.randomUUID(),name,workRole:role});markDirty();if(!(await save()))return;}const result=await api('/api/official/works/create',{id:libraryId,expectedStateStamp:stamp,role,kind,parentId});state=result.state;stamp=result.stateStamp;panel='';render();toast(kind==='volume'?(state.coreWork.type==='screenplay'?'作品文件夹已创建':'作品分卷已创建'):'作品文档已创建');}
async function deleteDocument(id){return deleteDirectoryTokens(['document:'+id],false);}
async function deleteDirectoryTokens(tokens,confirm=true){const targetId=libraryId,epoch=libraryEpoch;
 if(confirm){const result=await modal('移入回收站？','<p>所选文档、白板以及文件夹内的内容将去重后一并移入回收站。固定作品目录保留，内容可恢复。</p>',[['取消','cancel'],['移入回收站','delete']]);if(result.value!=='delete')return;}
 if(targetId!==libraryId||epoch!==libraryEpoch)return;
 if(!(await inlineEditor.finish())||!(await save())){toast('删除未执行：请先处理当前保存失败或冲突，原内容已保留。');return;}
 if(targetId!==libraryId||epoch!==libraryEpoch)return;
 const app=$('#app');app.inert=true;app.setAttribute('aria-busy','true');setStatus('正在移入回收站…');
 try{let result;
  for(let attempt=0;attempt<2;attempt++){
   try{result=await api('/api/directory/recycle',{id:targetId,tokens,expectedStateStamp:stamp});break;}
   catch(error){if(attempt||error.code!=='WORKSPACE_STATE_CONFLICT')throw error;
    if(!(await syncRemoteState({force:true}))||!(await save())||targetId!==libraryId||epoch!==libraryEpoch)return;
   }
  }
  state=preserveWindowView(result.state,state);stamp=result.stateStamp;persistedState=structuredClone(result.state);dirty=false;directorySelection.clear();panel='';render();setStatus('已保存到本地');toast('已移入回收站，可恢复正文和历史');
 }catch(error){setStatus('删除未完成 · 原内容已保留',true);throw error;}
 finally{app.inert=false;app.removeAttribute('aria-busy');}
}
async function moveDocuments(ids){const origin=libraryId;if(!(await save()))return;const target=await chooseStorageLocation({api:(path,body)=>api(path,body,false),notebookId:origin,folderId:state.documents[ids[0]]?.coreFolderId||'',mode:'move'});if(!target||libraryId!==origin)return;if(!(await save()))return;const from=await api('/api/state?id='+encodeURIComponent(origin),undefined,false),to=target.id===origin?from:await api('/api/state?id='+encodeURIComponent(target.id),undefined,false);if(libraryId!==origin)return;const app=$('#app');app.inert=true;try{await api('/api/documents/move',{id:origin,targetId:target.id,folderId:target.folderId,documentIds:ids,expectedStateStamp:from.stateStamp,expectedTargetStateStamp:to.stateStamp},false);await syncRemoteState();toast('文档已移动，正文和历史版本已保留');}finally{app.inert=false;}}
async function directoryBatchMenu(anchor,targetToken){
 const tokens=directorySelection.tokens(),onlyDocs=tokens.every(t=>t.startsWith('document:')),ids=[...directorySelectionContents(state,tokens).documents];
 const answer=await contextMenu([...(onlyDocs?[{value:'move',label:'移动所选文档到…'},{value:'copy',label:'复制所选文档'},{value:'cut',label:'剪切所选文档'}]:[]),...(documentClipboard?[{value:'paste',label:'粘贴到当前层级'}]:[]),{value:'export',label:'导出'},{value:'share',label:'分享'},null,{value:'delete',label:'删除',danger:true}],anchor);
 const folder=targetToken?.startsWith('folder:')?targetToken.slice(7):state.documents[targetToken?.slice(9)]?.coreFolderId||'';
 if(answer.value==='delete')return deleteDirectoryTokens(tokens);
 if(answer.value==='copy'||answer.value==='cut'){documentClipboard={kind:'documents',ids,mode:answer.value};toast('已'+(answer.value==='copy'?'复制':'剪切')+' '+ids.length+' 个文档');return;}
 if(answer.value==='paste')return pasteClipboardTo(folder);
 if(answer.value==='move')return moveDocuments(ids);
 if(answer.value==='export')return exportSelectedDocuments(ids,'所选文档');
 if(answer.value==='share'){const content=ids.map(id=>{const d=state.documents[id];return '# '+d.title+'\n\n'+(d.canvas?'```json\n'+JSON.stringify(d.canvas,null,2)+'\n```':d.markdown||htmlToMarkdown(d.html||''));}).join('\n\n---\n\n');if(answer.value==='share'&&navigator.share){await navigator.share({title:'神思',text:content});}else download(content,answer.value==='share'?'分享文档.md':'所选文档.md');}
}
function bindDirectorySelection(){
 directorySelection.sync();const tree=$('.filetree');tree.setAttribute('aria-multiselectable','true');tree.tabIndex=0;tree.onmousedown=e=>{if(e.shiftKey)e.preventDefault();};tree.onclick=e=>{const row=e.target.closest('.tree-row');if(!row)return;if(e.target.closest('button')){directorySelection.ensure(row);return;}directorySelection.select(row,e);tree.focus({preventScroll:true});if(e.shiftKey||e.ctrlKey||e.metaKey){e.preventDefault();e.stopPropagation();}};
 tree.oncontextmenu=e=>{e.preventDefault();const row=e.target.closest('.tree-row');if(row)directorySelection.ensure(row);const token=directorySelection.token(row);if(row&&directorySelection.tokens().length>1){void directoryBatchMenu(e,token).catch(error=>toast(error.message));return;}void (row?.dataset.doc?fileMenu(row.dataset.doc,e):row?.dataset.folder?folderMenu(row.dataset.folder,e):contextMenu([{value:'paste',label:'粘贴',disabled:!documentClipboard},{value:'new-note',label:'新建文档'},{value:'new-folder',label:'新建文件夹'},{value:'new-board',label:'新建白板'},{value:'import',label:'导入文件'}],e).then(a=>a.value==='paste'?pasteClipboardTo(''):runAction(a.value))).catch(error=>toast(error.message));};
}
async function pasteClipboardTo(folderId=''){
 const clip=documentClipboard;if(!clip){toast('请先复制或剪切文档或文件夹');return;}
 if(clip.kind==='documents'){const ids=clip.ids.filter(id=>state.documents[id]);if(clip.mode==='cut'){for(const id of ids)state.documents[id].coreFolderId=folderId;documentClipboard=null;markDirty();render();await save();}else{if(!(await save()))return;for(const id of ids){const doc=state.documents[id],result=await api('/api/document',{id:libraryId,expectedStateStamp:stamp,kind:doc.documentKind==='whiteboard'?'whiteboard':'note',copyFromDocumentId:id,copyFolderId:folderId});state=result.state;stamp=result.stateStamp;}render();}return;}
 if(clip.kind==='document'){const doc=state.documents[clip.id];if(!doc){documentClipboard=null;toast('剪贴板中的文档已不存在');return;}if(clip.mode==='cut'){doc.coreFolderId=folderId;documentClipboard=null;markDirty();render();toast('文档已移动到当前目录');return;}await newDocument(doc.documentKind==='whiteboard',undefined,{copyFromDocumentId:clip.id,copyFolderId:folderId});return;}
 const source=state.coreFolders.find(f=>f.id===clip.id);if(!source){documentClipboard=null;toast('剪贴板中的文件夹已不存在');return;}
 const subtree=[];const visit=f=>{subtree.push(f);for(const child of state.coreFolders.filter(v=>v.parentId===f.id))visit(child);};visit(source);
 if(clip.mode==='cut'){if(folderId&&subtree.some(f=>f.id===folderId)){toast('不能把文件夹移入自身或子文件夹');return;}source.parentId=folderId;documentClipboard=null;markDirty();render();toast('文件夹已移动到当前目录');return;}
 const idMap=new Map(subtree.map(f=>[f.id,'folder-'+crypto.randomUUID()]));state.coreFolders.push(...subtree.map((f,index)=>({...f,id:idMap.get(f.id),name:index===0?f.name+' 副本':f.name,parentId:f.id===source.id?folderId:idMap.get(f.parentId)})));markDirty();render();if(!(await save()))return;
 const folderIds=new Set(subtree.map(f=>f.id)),documents=Object.entries(state.documents).filter(([,d])=>folderIds.has(d.coreFolderId));for(const [sourceId,doc] of documents){const result=await api('/api/document',{id:libraryId,expectedStateStamp:stamp,kind:doc.documentKind==='whiteboard'?'whiteboard':'note',copyFromDocumentId:sourceId,copyFolderId:idMap.get(doc.coreFolderId)});state=result.state;stamp=result.stateStamp;}documentClipboard=null;render();toast('文件夹及其中的文档已复制');
}
async function fileMenu(id,anchor,{graph=false,link}={}){if(!graph&&anchor?.target?.closest('.filetree')&&directorySelection.tokens().length>1)return directoryBatchMenu(anchor,'document:'+id);const d=state.documents[id];if(!d)return;const items=[{value:'open',label:'打开'},...(graph?[{value:'link',label:'链接'}]:[]),{value:'reveal',label:'打开所在文件夹'},{value:'favorite',label:(state.coreFavorites||[]).includes('document:'+id)?'取消收藏':'收藏'},null,{value:'history',label:'历史版本'},null,{value:'new-note',label:'新建文档'},{value:'new-folder',label:'新建文件夹'},{value:'new-board',label:'新建白板'},null,{value:'move',label:'移动到…'},{value:'copy',label:'复制'},{value:'duplicate',label:'创建副本'},{value:'cut',label:'剪切'},{value:'paste',label:'粘贴',disabled:!documentClipboard},{value:'export',label:'导出'},null,{value:'rename',label:'重命名'},{value:'delete',label:'删除',danger:true}];const answer=await contextMenu(graph?items.filter(item=>item&&!['move','new-note','new-folder','new-board','copy','duplicate','cut','paste','export'].includes(item.value)):items,anchor);if(answer.value==='link')return link?.();if(answer.value==='open')return openDocument(id);if(answer.value==='reveal')return revealLocation({documentId:id});if(answer.value==='favorite')return toggleFavorite('document',id);if(answer.value==='history')return historyViewer.open(id);if(answer.value==='new-note')return newDocument(false,{coreFolderId:d.coreFolderId||''});if(answer.value==='new-board')return newDocument(true,{coreFolderId:d.coreFolderId||''});if(answer.value==='new-folder')return createFolder(undefined,d.coreFolderId||'');if(answer.value==='copy'||answer.value==='cut'){documentClipboard={kind:'document',id,mode:answer.value};toast(answer.value==='copy'?'已复制文档':'已剪切文档');return;}if(answer.value==='paste')return pasteClipboardTo(d.coreFolderId||'');if(answer.value==='move')return moveDocuments([id]);if(answer.value==='export'){return exportOneDocument(id);}if(answer.value==='rename'){const title=await askName('重命名',d.title);if(title){d.title=title;syncTitles(id);if(id===state.activeDocument&&$('.doc-title'))$('.doc-title').value=title;markDirty();}return;}if(answer.value==='duplicate'){await newDocument(d.documentKind==='whiteboard',undefined,{copyFromDocumentId:id});return;}if(answer.value==='delete')return deleteDocument(id);}
function syncTitles(documentId=state.activeDocument){
 const doc=state.documents[documentId];if(!doc)return;
 for(const items of Object.values(state.moduleItems))for(const item of items)if(item[0]===documentId)item[1]=doc.title;
 const order=[...new Set([...(state.moduleItems.library||[]).map(([id])=>id),...Object.keys(state.documents)])],labels=workChapterLabels(state,order,ui.uiLanguage);
 for(const row of $$('.filetree [data-doc]'))if(row.dataset.doc===documentId){row.querySelector('span').textContent=labels.get(documentId)||doc.title;row.querySelector('button')?.setAttribute('aria-label',doc.title+'的操作');}
 // Only search/name ordering needs a rebuilt tree; coalesce typing bursts.
 if(!state.coreWork?.enabled&&(query||String(state.coreDirectorySort).startsWith('name-'))){clearTimeout(titleTreeTimer);titleTreeTimer=setTimeout(refreshDirectory,120);}
 const crumb=$('.breadcrumb b');if(crumb)crumb.textContent=current()?.title||'';
 const titles=new Map(state.documentTabs.map(t=>[t.id,state.documents[t.documentId]?.title||'新标签页']));for(const tab of $$('.tab'))if(titles.has(tab.dataset.tab))tab.querySelector('span').textContent=titles.get(tab.dataset.tab);
}
async function folderMenu(id,anchor){if(anchor?.target?.closest('.filetree')&&directorySelection.tokens().length>1)return directoryBatchMenu(anchor,'folder:'+id);const folder=state.coreFolders.find(f=>f.id===id);if(!folder)return;const result=await contextMenu([{value:'reveal',label:'打开所在文件夹'},{value:'favorite',label:(state.coreFavorites||[]).includes('folder:'+id)?'取消收藏':'收藏'},{value:'history',label:'查看历史版本'},null,{value:'move',label:'移动到…'},{value:'copy',label:'复制'},{value:'cut',label:'剪切'},{value:'paste',label:'粘贴到文件夹内',disabled:!documentClipboard},null,{value:'note',label:'新建文档'},{value:'folder',label:'新建文件夹'},{value:'board',label:'新建白板'},null,{value:'rename',label:'重命名'},{value:'export',label:'导出'},{value:'remove',label:'删除',danger:true}],anchor);if(result.value==='reveal')return revealLocation({folderId:id});if(result.value==='favorite')return toggleFavorite('folder',id);if(result.value==='history')return directoryHistory.open(id,folder.name);if(result.value==='note'){const role=folder.workRole==='volume'?'manuscript':folder.workRole;if(state.coreWork?.enabled&&role)return createWorkEntry(role,'document',id);return newDocument(false,{coreFolderId:id});}if(result.value==='board')return newDocument(true,{coreFolderId:id});if(result.value==='folder')return createFolder(undefined,id);if(result.value==='copy'||result.value==='cut'){documentClipboard={kind:'folder',id,mode:result.value};toast(result.value==='copy'?'已复制文件夹及其内容':'已剪切文件夹');return;}if(result.value==='paste')return pasteClipboardTo(id);if(result.value==='move'){const descendants=new Set();const visit=f=>{descendants.add(f.id);for(const child of state.coreFolders.filter(v=>v.parentId===f.id))visit(child);};visit(folder);const target=await modal('移动文件夹',`<select name="parent">${folderOptions(state.coreFolders,{selected:folder.parentId,exclude:descendants})}</select>`);if(target.value==='ok'){folder.parentId=target.parent;markDirty();render();}return;}if(result.value==='rename'){const name=await askName('文件夹名称',folder.name);if(name)folder.name=name;}if(result.value==='export')return exportFolder(id);if(result.value==='remove')return deleteDirectoryTokens(['folder:'+id]);if(result.value!=='cancel'){markDirty();render();}}
async function notebookMenu(anchor,targetId=libraryId){
 const answer=await contextMenu([{value:'history',label:'历史版本'},null,{value:'new-library',label:'新建笔记本'},{value:'reveal',label:'在文件夹中显示'},{value:'export',label:'导出'},{value:'rename',label:'重命名'},null,{value:'archive',label:'删除',danger:true}],anchor);
 if(!answer.value)return;
 if(answer.value==='new-library')return runAction(answer.value);
 if(answer.value==='cancel')return;
 const selectedCurrent=targetId===libraryId;
 if(answer.value==='archive'){
  const response=await modal('将整个笔记本移入回收站？','<p>文档、白板、目录和历史将整体保留 30 天。运行中的任务需要先停止。</p>',[['取消','cancel'],['移入回收站','delete']]);if(response.value!=='delete')return;
  const app=$('#app');app.inert=true;app.setAttribute('aria-busy','true');setStatus('正在回收笔记本…');
  try{if(selectedCurrent){if(!(await workTools.close())||!(await inlineEditor.finish())||!(await save())){toast('删除未执行：请先处理当前保存失败或冲突。');return;}await official.beforeSwitch();}
   const target=await api('/api/workspace-state-stamp?id='+encodeURIComponent(targetId),undefined,false),result=await api('/api/library/archive',{id:targetId,expectedStateStamp:target.stateStamp},false);libraries=result.libraries;
   if(targetId===libraryId){official.close();extensions.dismiss();const fallback=defaultLibraryId(libraries);if(fallback)await loadLibrary(fallback,{archivedSource:true});else $('#app').innerHTML='<div class="empty"><p>没有可打开的笔记本。</p></div>';}else render();setStatus('已保存到本地');toast('整个笔记本已移入回收站');}catch(error){setStatus('笔记本回收未完成',true);throw error;}finally{app.inert=false;app.removeAttribute('aria-busy');}return;
 }
 if(!selectedCurrent){
  if(answer.value==='reveal'){const result=await api('/api/settings/open-folder',{id:targetId,kind:'workspace'},false);if(result.message)toast(result.message);return;}
  if(answer.value==='rename'){const name=await askName('重命名笔记本',libraries.find(l=>l.id===targetId)?.name||'');if(!name)return;const target=await api('/api/state?id='+encodeURIComponent(targetId),undefined,false);target.state.projectName=name;await api('/api/state',{id:targetId,state:target.state,expectedStateStamp:target.stateStamp},false);libraries=(await api('/api/bootstrap')).libraries;render();return;}
  if(answer.value==='export'){const target=await api('/api/state?id='+encodeURIComponent(targetId),undefined,false);return chooseDocumentExport({api,modal,id:targetId,state:target.state,stateStamp:target.stateStamp,documentIds:Object.keys(target.state.documents),title:target.state.projectName});}
  if(answer.value==='history'){if(!await loadLibrary(targetId))return;}else return;
 }
 if(answer.value==='rename'){const name=await askName('重命名笔记本',libraries.find(l=>l.id===libraryId)?.name||state.projectName||'我的笔记');if(!name)return;state.projectName=name;markDirty();if(!(await save()))return;libraries=(await api('/api/bootstrap')).libraries;render();return;}
 if(answer.value==='export')return exportNotebook();
 if(answer.value==='reveal'){const result=await api('/api/settings/open-folder',{id:libraryId,kind:'workspace'});if(result.message)toast(result.message);return;}
 if(answer.value==='history'){const ids=Object.keys(state.documents);if(!ids.length){toast('当前笔记本没有可查看历史的文档');return;}const pick=await modal('选择历史文档',`<select name="document">${ids.map(id=>`<option value="${id}">${h(state.documents[id].title)}</option>`).join('')}</select>`);if(pick.value==='ok')return historyViewer.open(pick.document);}
}
async function exportSelectedDocuments(documentIds,title){const id=libraryId;if(!await save())return;if(id!==libraryId)throw Error('笔记本已切换，请重新选择导出文件');return chooseDocumentExport({api,modal,id,state,stateStamp:stamp,documentIds,title});}
function exportNotebook(){return exportSelectedDocuments(Object.keys(state.documents),state.projectName||'我的笔记');}
function exportOneDocument(id){if(!state.documents[id])return;return exportSelectedDocuments([id],state.documents[id].title);}
function exportFolder(id){const folder=state.coreFolders.find(f=>f.id===id);if(!folder)return;const ids=new Set([id]),visit=f=>{for(const child of state.coreFolders.filter(v=>v.parentId===f.id&&!ids.has(v.id))){ids.add(child.id);visit(child);}};visit(folder);return exportSelectedDocuments(Object.entries(state.documents).filter(([,d])=>ids.has(d.coreFolderId)).map(([key])=>key),folder.name);}
function runRichCommand(command,value){const editor=$('.editor');if(!editor)return;const batch=['undo','redo'].includes(command)&&richReplaceBatches.findLast(b=>editor.innerHTML===(command==='undo'?b.after:b.before));if(batch){const target=command==='undo'?batch.before:batch.after;for(let i=0;i<batch.count&&editor.innerHTML!==target;i++)if(!document.execCommand(command))break;}else document.execCommand(command,false,value);}
function syncRichToolbar(){
  const toolbar=$('.note-rich-toolbar');if(!toolbar)return;const primary=toolbar.querySelector('.note-toolbar-primary'),more=toolbar.querySelector('.note-toolbar-more'),expand=toolbar.querySelector('.note-toolbar-expand'),right=toolbar.querySelector('.note-toolbar-right');
  if(!official.enabled('editor-toolbar')){primary.hidden=true;more.hidden=true;expand.hidden=true;return;}
  const inline=toolbar.clientWidth-right.offsetWidth-34>=900;toolbar.classList.toggle('inline-tools-expanded',inline);expand.hidden=inline;more.hidden=!inline&&expand.getAttribute('aria-expanded')!=='true';
  const controls=[...primary.querySelectorAll('button')],key=b=>b.dataset.command?b.dataset.command+':'+(b.dataset.formatValue||''):b.dataset.action;
  controls.forEach(b=>b.hidden=false);const bounds=primary.getBoundingClientRect(),visible=new Map(controls.map(b=>{const r=b.getBoundingClientRect();return [key(b),r.left>=bounds.left-.75&&r.right<=bounds.right+.75];}));
  for(const button of more.querySelectorAll('button')){const original=controls.find(b=>key(b)===key(button));button.hidden=!!original&&visible.get(key(button));if(original)original.hidden=!visible.get(key(button));}
}
function closeRichToolbar(){const toolbar=$('.note-rich-toolbar');if(!toolbar||toolbar.classList.contains('inline-tools-expanded'))return;toolbar.querySelector('.note-toolbar-more').hidden=true;toolbar.querySelector('.note-toolbar-expand').setAttribute('aria-expanded','false');}
function bindEditor(){
  richReplaceBatches=[];
  if(mode==='atlas')$$('.toolbar [data-action="attachment"],.findbar [data-action="replace-all"],.findbar #find-replacement').forEach(b=>b.disabled=true);
  $$('.toolbar [data-command],.toolbar [data-action="link"],.toolbar [data-action="table"],.toolbar [data-action="checklist"],.toolbar [data-action="format-painter"],.toolbar [data-color-command]').forEach(b=>b.disabled=mode!=='rich');
  const editor=$('.editor'),source=$('.markdown-source');let lastWritingText=editor?.textContent||source?.value||'';const recordWriting=()=>{const next=editor?.textContent??source?.value??'';writingTimer.activity(state.activeDocument,lastWritingText,next);lastWritingText=next;};if(editor)hydrateMedia(editor,assetUrl);
  ensureMediaTextSlots(editor);
  editor?.addEventListener('input',()=>ensureMediaTextSlots(editor));
  disposeDocumentImages=bindDocumentImageMenu(editor,{api,contextMenu,toast,id:libraryId,documentId:state.activeDocument,upload:chooseAttachment});
  if($('.doc-title'))$('.doc-title').oninput=e=>{current().title=e.target.value.trim()||'未命名笔记';syncTitles();markDirty({contentChanged:false});};
  if(editor){editor.oninput=()=>{recordWriting();current().html=cleanEditorHtml(editor);current().markdown=htmlToMarkdown(current().html);markDirty();};editor.oncompositionstart=()=>{composition=true;};editor.oncompositionend=()=>{composition=false;editor.oninput();};editor.onpaste=e=>{const html=e.clipboardData.getData('text/html');if(html){e.preventDefault();document.execCommand('insertHTML',false,sanitizeDocumentHtml(html));editor.oninput();}else if(e.clipboardData.files.length){e.preventDefault();void uploadFiles([...e.clipboardData.files]).catch(error=>toast(error.message));}};editor.onmouseup=()=>{rememberSelection();if(formatPaint&&!window.getSelection()?.isCollapsed){for(const [cmd,value] of Object.entries(formatPaint))if(typeof value!=='boolean'||document.queryCommandState(cmd)!==value)document.execCommand(cmd,false,value);formatPaint=null;$('[data-action=format-painter]')?.setAttribute('aria-pressed','false');editor.oninput();}};editor.onkeyup=rememberSelection;editor.onclick=e=>{const item=e.target.closest('li');if(item&&/^[☐☑] /.test(item.textContent)){item.firstChild.textContent=item.firstChild.textContent.replace(/^[☐☑] /,v=>v==='☐ '?'☑ ':'☐ ');editor.oninput();return;}const link=e.target.closest('a');if(!link)return;e.preventDefault();if(mode==='rich'&&!e.ctrlKey&&!e.metaKey){toast('按住 Ctrl 点击可打开链接');return;}const url=link.getAttribute('href')||'';if(url.startsWith('#doc:')){void openDocument(url.slice(5));return;}if(/^(https?:|mailto:)/i.test(url)){api('/api/open-link',{url}).then(result=>{if(!result.opened)window.open(result.url,'_blank','noopener');}).catch(error=>toast(error.message));}else if(url&&!/^[a-z][a-z0-9+.-]*:/i.test(url)){const a=document.createElement('a');a.href=assetUrl(url);a.download=link.textContent||'附件';a.click();}};}
  if(source){source.oninput=()=>{recordWriting();current().markdown=source.value;delete current().html;delete current().coreRichText;markDirty();};source.onselect=updateSelectedCount;source.oncompositionstart=()=>composition=true;source.oncompositionend=()=>{composition=false;source.oninput();};}
  for(const input of [editor,source].filter(Boolean)){
   const originalPaste=input.onpaste;
   input.onpaste=e=>{if(mode==='read'||mode==='atlas')return;const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();e.stopPropagation();void uploadFiles(files).catch(error=>toast(error.message));}else originalPaste?.(e);};
  }
  bindExternalDrop($('.editor-scroll'));
  $$('.toolbar [data-command]').forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>{if(mode!=='rich'){toast('请切换到编辑模式');return;}editor.focus();runRichCommand(b.dataset.command,b.dataset.formatValue);editor.oninput();};});
  editorColors.bind();
  $('#editor-mode').onchange=async e=>{try{await changeEditorMode(e.target.value);}catch(error){toast(error.message);e.target.value=mode;}};
  if(mode==='atlas')settingAtlas.mount({host:$('.editor-scroll'),doc:current(),context:settingContext(state,current(),official.enabled('works')),markdown:async text=>(await api('/api/markdown',{markdown:text})).html,assetUrl,outline:documentOutline,openDocument,openLink:async url=>{const result=await api('/api/open-link',{url});if(!result.opened)window.open(result.url,'_blank','noopener');},onError:error=>toast(error.message)});
  else documentOutline.mount();selectionEditor.mount();syncRichToolbar();toolbarResizeObserver=new ResizeObserver(syncRichToolbar);toolbarResizeObserver.observe($('.note-rich-toolbar'));
}
function rememberSelection(){const selection=window.getSelection();if(selection?.rangeCount&&$('.editor')?.contains(selection.anchorNode))selectionRange=selection.getRangeAt(0).cloneRange();}
function restoreSelection(){const editor=$('.editor');editor?.focus();if(selectionRange&&editor?.contains(selectionRange.commonAncestorContainer)){const s=window.getSelection();s.removeAllRanges();s.addRange(selectionRange);}}
function pushBoardUndo(){boardUndo.push(structuredClone(current().canvas));if(boardUndo.length>80)boardUndo.shift();boardRedo=[];}
function boardChanged(redraw=true){markDirty();if(redraw)renderBoard();}
function selectedNode(){return current()?.canvas?.nodes.find(n=>n.id===[...selected][0]);}
function nodeDraftKey(){return state.activeDocument+':'+selectedNode()?.id;}
function commitNodeDraft(){
  const node=selectedNode(),key=nodeDraftKey(),draft=state.coreNodeDrafts?.[key];if(!node||!draft)return true;
  if(node.text!==draft.baseText||node.name!==draft.baseName){toast('卡片已有其他修改，编辑草稿已保留。请取消编辑后重新打开。');return false;}
  pushBoardUndo();if(node.text!==draft.text)captureNodeVersion(current().canvas,node.id,{source:'preview-edit'});node.name=draft.name;node.text=draft.text;delete node.coreSelectedVersionId;delete state.coreNodeDrafts[key];markDirty();renderBoard();return true;
}
function updateBoardTools(){updateBoardSelectionBounds();boardTools.position();for(const [action,enabled] of Object.entries({'undo-board':boardUndo.length,'redo-board':boardRedo.length,'copy-cards':selected.size,'paste-cards':!!navigator.clipboard?.read,'delete-cards':selected.size||selectedEdges.size})){$$(`[data-action="${action}"]`).forEach(b=>b.disabled=!enabled);}}
function updateBoardSelectionBounds(){
 const world=$('.board-world'),nodes=current()?.canvas?.nodes.filter(n=>selected.has(n.id))||[];if(!world)return;
 let bounds=world.querySelector('.board-multi-selection');if(nodes.length<2){bounds?.remove();return;}
 if(!bounds){bounds=document.createElement('div');bounds.className='board-multi-selection';world.append(bounds);}
 const left=Math.min(...nodes.map(n=>n.x)),top=Math.min(...nodes.map(n=>n.y));Object.assign(bounds.style,{left:left-12+'px',top:top-12+'px',width:Math.max(...nodes.map(n=>n.x+n.width))-left+24+'px',height:Math.max(...nodes.map(n=>n.y+n.height))-top+24+'px'});
}
function acknowledgeCardImageOutputs(e){const card=e.target.closest('[data-node]'),canvas=current()?.canvas,node=canvas?.nodes.find(n=>n.id===card?.dataset.node);if(acknowledgeImageOutput(canvas,node)){card?.querySelector('.image-output-count')?.remove();markDirty();}}
function renderBoard(){
  updateBoardTools();const board=$('.board');if(!board)return;const canvas=current().canvas;canvas.viewport??={x:60,y:60,zoom:1};canvas.assets??=[];const {x,y,zoom}=canvas.viewport;
  board.dataset.mediaScope=JSON.stringify([libraryId,state.activeDocument]);
  const nodeIndex=new Map(canvas.nodes.map(node=>[node.id,node]));
  replaceBoardMarkup(board,`<div class="board-grid"></div><div class="board-world" style="transform:translate(${x}px,${y}px) scale(${zoom})"><svg class="edges"><defs><marker id="whiteboardArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>${canvas.edges.map((e,index)=>{const a=nodeIndex.get(e.fromNode),b=nodeIndex.get(e.toNode);if(!a||!b)return '';const d=edgePath(a,b,e.fromSide,e.toSide);return `<g data-edge="${h(e.id)}" class="whiteboard-edge-group ${selectedEdges.has(e.id)?'selected':''}"><path class="whiteboard-edge-hit" d="${d}"/><path class="whiteboard-edge" d="${d}"/><path class="whiteboard-edge-flow" d="${d}" pathLength="100" style="--whiteboard-flow-delay:-${(index%8)*.17}s"/></g>`;}).join('')}</svg>${canvas.nodes.map(n=>`<article class="card ${n.file&&['image','video','audio'].includes(n.kind)?'media-card':''} ${selected.has(n.id)?'selected':''}" data-node="${h(n.id)}" data-card-color="${h(n.color||'default')}" style="left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px;--card-tint:${CARD_COLORS[n.color]||'var(--line)'}"><header class="card-head">${icon(n.type==='file'?'image':'file')}<span>${h(n.name||'文本卡片')}</span></header><div class="card-body">${inlineEditor.markup(n)??(n.operation?.type==='depth-explorer'?boardTools.depthMarkup(n):n.type==='file'?mediaMarkup(n,true):n.text?h(n.text):'<span data-core-copy>双击卡片，开始编辑</span>')}</div>${[["left","左侧"],["right","右侧"]].map(([side,label])=>`<button class="connector connector-${side}" data-connect="${h(n.id)}" data-connect-side="${side}" aria-label="从卡片${label}连线"></button>`).join("")}<div class="card-resize" aria-label="调整卡片大小"></div></article>`).join('')}</div>${!canvas.nodes.length?`<div class="board-empty empty"><div class="empty-symbol">${icon('board')}</div><h1>把想法放到画布上</h1><p>双击空白处添加卡片 · 滚轮平移 · Ctrl + 滚轮缩放</p><div class="empty-actions">${btn('add-card','添加文本卡片','plus')}${btn('attachment','导入媒体','image')}</div></div>`:''}<div class="whiteboard-tool-controls">${`<button data-action="board-assets" title="全部资产" aria-label="全部资产">${uiGlyph('E81C')}</button>`}${`<button data-action="toggle-snap" title="自动吸附" aria-label="自动吸附"><span class="whiteboard-tool-glyph">⌁</span></button>`}${`<button data-action="fit" title="一键居中" aria-label="一键居中"><span class="whiteboard-tool-glyph">⌖</span></button>`}${`<button data-action="board-arrange" title="自动整理" aria-label="自动整理"><span class="whiteboard-tool-glyph">▦</span></button>`}</div><div class="board-hud">${`<button data-action="zoom-out" title="缩小白板" aria-label="缩小白板">${uiGlyph('E71F')}</button>`}<output>${Math.round(zoom*100)}%</output>${`<button data-action="zoom-in" title="放大白板" aria-label="放大白板">${uiGlyph('E71E')}</button>`}</div>${`<button data-action="add-card" class="whiteboard-add-button" title="添加普通卡片" aria-label="添加普通卡片">${uiGlyph('E710')}</button>`}<div class="whiteboard-corner-controls"><div class="whiteboard-history-controls" role="group" aria-label="白板操作历史">${`<button data-action="undo-board" title="上一步（Ctrl + Z）" aria-label="上一步（Ctrl + Z）">${uiGlyph('E7A7')}</button>`}${`<button data-action="redo-board" title="下一步（Ctrl + Y）" aria-label="下一步（Ctrl + Y）">${uiGlyph('E7A6')}</button>`}</div><span data-canvas-model-controls></span></div><span class="board-help">Ctrl 多选 · 空格拖动画布</span>`);
  const cards=new Map([...board.querySelectorAll('[data-node]')].map(card=>[card.dataset.node,card]));
  for(const node of canvas.nodes){const count=unseenImageOutputCount(canvas,node);if(count<2)continue;const button=document.createElement('button');button.type='button';button.className='image-output-count';button.dataset.cardHistory=node.id;button.textContent=count;button.title='本批 '+count+' 张图片，查看历史版本';button.setAttribute('aria-label',button.title);cards.get(node.id)?.append(button);}
  bindBoardMedia(board);boardTools.mount(board);official.mountCanvas(board);updateBoardTools();
  board.tabIndex=0;bindExternalDrop(board);
  board.addEventListener('pointerdown',focusBoardTransfer,{capture:true});
  board.removeEventListener('click',acknowledgeCardImageOutputs,true);board.addEventListener('click',acknowledgeCardImageOutputs,true);
  board.onwheel=e=>{if(e.target.closest('textarea,video,audio'))return;e.preventDefault();if(e.ctrlKey||e.metaKey){const rect=board.getBoundingClientRect();zoomBoard(Math.exp(-e.deltaY*.002),e.clientX-rect.left,e.clientY-rect.top);}else{canvas.viewport.x-=e.deltaX;canvas.viewport.y-=e.deltaY;applyViewport();markDirty();}};
  board.removeEventListener('dblclick',boardDoubleClick,true);board.addEventListener('dblclick',boardDoubleClick,true);
  board.onclick=async e=>{
    if(await boardTools.click(e))return;const history=e.target.closest('[data-card-history]'),edit=e.target.closest('[data-card-edit]'),connect=e.target.closest('[data-connect]');
    if(history){openNode(history.dataset.cardHistory,'history');return;}if(edit){openNode(edit.dataset.cardEdit,'preview');return;}if(connect)return;
    const card=e.target.closest('[data-node]');if(connection&&card&&card.dataset.node!==connection){pushBoardUndo();canvas.edges.push({id:'edge-'+crypto.randomUUID(),fromNode:connection,toNode:card.dataset.node,fromSide:'right',toSide:'left'});connection='';boardChanged();return;}
    const edge=e.target.closest('[data-edge]');if(edge){const id=edge.dataset.edge;if(e.ctrlKey||e.metaKey){selectedEdges.has(id)?selectedEdges.delete(id):selectedEdges.add(id);}else selectedEdges=new Set([id]);selectedEdge=selectedEdges.size===1?[...selectedEdges][0]:'';selected.clear();for(const el of board.querySelectorAll('[data-node]'))el.classList.remove('selected');for(const el of board.querySelectorAll('[data-edge]'))el.classList.toggle('selected',selectedEdges.has(el.dataset.edge));updateBoardSelectionBounds();updateBoardTools();document.dispatchEvent(new CustomEvent('shensi:board-selection',{detail:{nodeId:''}}));}
    if(card)boardTools.mount(board);if(card&&!e.target.closest('button,input,textarea,select,video,audio,.card-resize,.depth-operation')&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey)document.dispatchEvent(new CustomEvent('shensi:board-selection',{detail:{nodeId:card.dataset.node}}));
  };
  board.ondragstart=event=>{if(event.target.closest('[data-node]'))event.preventDefault();};
  for(const element of board.querySelectorAll('.media-card img,.media-card video')){const sync=()=>{const card=element.closest('[data-node]'),node=nodeIndex.get(card?.dataset.node),w=element.naturalWidth||element.videoWidth,h=element.naturalHeight||element.videoHeight;if(!node||!w||!h||node.coreMediaGeometryFile===node.file)return;node.coreMediaGeometryFile=node.file;node.aspectRatio=w/h;const height=node.width*h/w;markDirty();if(Math.abs(node.height-height)<.5)return;node.height=height;card.style.height=height+'px';document.dispatchEvent(new Event('shensi:board-layout'));};element[element.tagName==='IMG'?'onload':'onloadedmetadata']=sync;if(element.complete||element.readyState>=1)sync();}
  board.querySelector('[data-action="toggle-snap"]')?.setAttribute('aria-pressed',String(canvas.settings?.snapToGrid!==false));board.onpointerdown=boardPointerDown;inlineEditor.bind(board);updateBoardTools();document.dispatchEvent(new Event('shensi:board-layout'));official.paintMediaCards?.();
}
function boardDoubleClick(e){
  const edge=e.target.closest('[data-edge]');if(edge){e.preventDefault();e.stopPropagation();pushBoardUndo();current().canvas.edges=current().canvas.edges.filter(item=>item.id!==edge.dataset.edge);selectedEdges.delete(edge.dataset.edge);selectedEdge='';boardChanged();return;}
  if(e.target.closest('button,textarea,input,select,video,audio,.depth-operation'))return;
  const card=e.target.closest('[data-node]');
  if(card){e.preventDefault();e.stopPropagation();const node=current().canvas.nodes.find(n=>n.id===card.dataset.node);void openNode(card.dataset.node,node?.file||node?.reference||node?.url?'preview':'edit');return;}
  if(e.target.closest('.board-hud'))return;const board=$('.board'),canvas=current().canvas,rect=board.getBoundingClientRect();pushBoardUndo();const n=addTextCard(canvas,{x:(e.clientX-rect.left-canvas.viewport.x)/canvas.viewport.zoom,y:(e.clientY-rect.top-canvas.viewport.y)/canvas.viewport.zoom});selected=new Set([n.id]);boardChanged();
}
function mediaMarkup(n,card=false){const url=assetUrl(n.file||n.attachment?.relativePath||'');if(n.kind==='file')return `<a href="${h(url)}" download="${h(n.name||'附件')}" draggable="false">${h(n.name||'附件')}</a>`;if(n.kind==='video'){const video=`<video src="${h(url)}"${n.thumbnailRelativePath?` poster="${h(assetUrl(n.thumbnailRelativePath))}"`:''} draggable="false" preload="metadata" controls playsinline aria-label="${h(n.name||'白板视频')}"></video>`;return card?`<div class="whiteboard-card-media-shell">${video}<span class="whiteboard-card-video-drag-surface" data-video-drag-surface aria-hidden="true" title="拖拽移动；双击全屏预览"></span></div>`:video;}if(n.kind==='audio')return `<div class="whiteboard-card-audio-shell"><strong title="${h(n.name||'白板音频')}">${h(n.name||'白板音频')}</strong><audio class="whiteboard-card-audio" src="${h(url)}" controls preload="metadata" aria-label="${h(n.name||'白板音频')}"></audio></div>`;return `<img src="${h(url)}" decoding="async" draggable="false" alt="${h(n.name||'图片')}">`;}
function applyViewport(){const c=current().canvas,v=c.viewport;$('.board-world').style.transform=`translate(${v.x}px,${v.y}px) scale(${v.zoom})`;$('.board-hud output').textContent=Math.round(v.zoom*100)+'%';boardTools.position();document.dispatchEvent(new Event('shensi:board-layout'));}
function zoomBoard(factor,cx,cy){const board=$('.board'),v=current().canvas.viewport;cx??=board.clientWidth/2;cy??=board.clientHeight/2;const minimum=Math.min(.125,fittedBoardViewport(current().canvas.nodes,board.clientWidth,board.clientHeight).zoom),z=Math.max(minimum,Math.min(3,v.zoom*factor));v.x=cx-(cx-v.x)*z/v.zoom;v.y=cy-(cy-v.y)*z/v.zoom;v.zoom=z;applyViewport();markDirty();}
let spaceDown=false;
function boardPointerDown(e){
  if(e.button!==0&&e.button!==1)return;if(e.target.closest('[data-connect]')){boardTools.connectPointer(e);return;}if(e.target.closest('button,video,audio,input,textarea,select,.depth-operation input,.depth-operation select,.depth-operation button,.board-hud,[data-edge]'))return;
  const board=$('.board'),canvas=current().canvas,v=canvas.viewport,card=e.target.closest('[data-node]'),start={x:e.clientX,y:e.clientY};let moved=false;
  if(!card)document.dispatchEvent(new CustomEvent('shensi:board-selection',{detail:{nodeId:''}}));
  if(card&&e.button===0&&!spaceDown){if(!e.target.closest('[data-card-inline-editor]'))e.preventDefault();const id=card.dataset.node;rememberMediaRatio(canvas,canvas.nodes.find(n=>n.id===id));if(connection)return;if(e.ctrlKey||e.metaKey){if(selected.has(id))selected.delete(id);else selected.add(id);}else if(!selected.has(id))selected=new Set([id]);selectedEdge='';selectedEdges.clear();for(const el of $$('.card'))el.classList.toggle('selected',selected.has(el.dataset.node));
    const node=canvas.nodes.find(n=>n.id===id),resize=e.target.closest('.card-resize'),view=boardGestureView(board,canvas,selected),positions=new Map(view.nodes.map(n=>[n.id,{x:n.x,y:n.y,width:n.width,height:n.height}]));
    // Capture only once dragging starts. Capturing a stationary press retargets
    // click/dblclick to the canvas and incorrectly creates a new blank card.
    const motion=frameLatest(ev=>{const dx=(ev.clientX-start.x)/v.zoom,dy=(ev.clientY-start.y)/v.zoom;if(!moved&&Math.hypot(dx,dy)<3)return;if(!moved){pushBoardUndo();moved=true;}const snap=canvas.settings?.snapToGrid===false?1:canvas.settings?.gridSize||20,anchor=positions.get(id);if(!anchor)return;const sx=snapCanvasValue(anchor.x+dx,canvas)-anchor.x,sy=snapCanvasValue(anchor.y+dy,canvas)-anchor.y;for(const n of view.nodes){const p=positions.get(n.id);if(resize&&n.id===id)Object.assign(n,resizedCard(n,p,dx,dy,snap));else if(!resize){n.x=p.x+sx;n.y=p.y+sy;}}view.paint();updateBoardSelectionBounds();boardTools.position();document.dispatchEvent(new Event('shensi:board-layout'));});
    board.onpointermove=ev=>{if(!moved&&Math.hypot(ev.clientX-start.x,ev.clientY-start.y)<3*v.zoom)return;if(!board.hasPointerCapture(e.pointerId))board.setPointerCapture(e.pointerId);motion.push({clientX:ev.clientX,clientY:ev.clientY});};
    board.onpointerup=board.onpointercancel=()=>{motion.flush();view.finish();board.onpointermove=null;board.onpointerup=null;board.onpointercancel=null;if(moved)boardChanged(false);updateBoardTools();};return;
  }
  const rect=board.getBoundingClientRect();if(e.button===1||spaceDown){
   const initial={x:v.x,y:v.y},motion=frameLatest(ev=>{if(!board.isConnected||current()?.canvas!==canvas)return;v.x=initial.x+ev.clientX-start.x;v.y=initial.y+ev.clientY-start.y;applyViewport();moved=true;});
   board.setPointerCapture(e.pointerId);board.onpointermove=ev=>motion.push({clientX:ev.clientX,clientY:ev.clientY});
   board.onpointerup=board.onpointercancel=ev=>{if(ev.type!=='pointercancel')motion.push({clientX:ev.clientX,clientY:ev.clientY});motion.flush();board.onpointermove=null;board.onpointerup=null;board.onpointercancel=null;if(moved&&board.isConnected)markDirty();};
  }
  else {
   selected.clear();selectedEdge='';selectedEdges.clear();connection='';updateBoardTools();const marquee=document.createElement('div');marquee.className='marquee';board.append(marquee);board.setPointerCapture(e.pointerId);
   let hitTest;const cards=[...board.querySelectorAll('.card')],edges=[...board.querySelectorAll('[data-edge]')];
   const motion=frameLatest(ev=>{
    if(!board.isConnected||current()?.canvas!==canvas)return;
    const left=Math.min(start.x,ev.clientX)-rect.left,top=Math.min(start.y,ev.clientY)-rect.top,width=Math.abs(ev.clientX-start.x),height=Math.abs(ev.clientY-start.y);moved=width>=4||height>=4;
    Object.assign(marquee.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'});
    const result=moved?(hitTest??=createMarqueeSelection(canvas))({left:(left-v.x)/v.zoom,top:(top-v.y)/v.zoom,right:(left+width-v.x)/v.zoom,bottom:(top+height-v.y)/v.zoom}):{nodes:[],edges:[]};
    selected=new Set(result.nodes);selectedEdges=new Set(result.edges);selectedEdge=result.edges.length===1?result.edges[0]:'';
    for(const el of cards)el.classList.toggle('selected',selected.has(el.dataset.node));for(const el of edges)el.classList.toggle('selected',selectedEdges.has(el.dataset.edge));updateBoardSelectionBounds();
   });
   board.onpointermove=ev=>motion.push({clientX:ev.clientX,clientY:ev.clientY});board.onpointerup=board.onpointercancel=ev=>{
    if(ev.type!=='pointercancel')motion.push({clientX:ev.clientX,clientY:ev.clientY});motion.flush();board.onpointermove=null;board.onpointerup=null;board.onpointercancel=null;marquee.remove();
    if(!board.isConnected)return;if(!moved){panel='';renderPanel();}updateBoardTools();
   };
  }
}
async function openNode(id,tab='preview'){if(!(await inlineEditor.finish()))return;selected=new Set([id]);panel='';nodeTab=tab==='edit'?'edit':'preview';renderPanel();for(const el of $$('.card'))el.classList.toggle('selected',el.dataset.node===id);updateBoardTools();if(tab==='edit'){const popup=document.querySelector('.whiteboard-generation-popover');if(popup)popup.querySelector('[data-generation-close]')?.click();return inlineEditor.open(id);}return nodePreview.open(id,{history:tab==='history'});}
function renderPanel(){
  if(panel!=='node')document.body.classList.remove('full-panel');
  const aside=$('.inspector');if(!aside)return;aside.hidden=!panel;dock.layout();if(!panel){aside.innerHTML='';return;}
  const node=selectedNode(),doc=current();
  const header=title=>`<div class="inspector-resize" role="separator" aria-label="调整详情宽度"></div><div class="panel-head">${h(title)}<div class="spacer"></div>${btn('expand-panel','扩大面板','expand')}${btn('close-panel','关闭面板')}</div>`;
  if(panel==='node'&&node){
    aside.innerHTML=header(node.name||'文本卡片')+`<nav class="panel-tabs">${['preview','edit','history'].map((name,i)=>`<button data-node-tab="${name}" class="${nodeTab===name?'active':''}">${['预览','编辑','版本'][i]}</button>`).join('')}<div class="spacer"></div><span class="badge">${nodeVersions(doc.canvas,node.id).length} 个版本</span></nav><div class="panel-content" id="node-content"></div><footer class="panel-foot"><span class="muted" style="font-size:11px">${nodeTab==='edit'?'草稿自动保留，保存后采用':'选择采用后，卡片使用所选版本'}</span><div class="spacer"></div>${nodeTab==='edit'?btn('cancel-node-edit','取消编辑'):''}${btn('save','保存')}</footer>`;
    const content=$('#node-content');
if(nodeTab==='edit') {const key=nodeDraftKey(),draft=state.coreNodeDrafts?.[key];content.innerHTML=`<input id="node-name" aria-label="卡片名称" value="${h(draft?.name??node.name??'')}" style="width:100%;margin-bottom:12px">${node.type==='file'?mediaMarkup(node):`<textarea id="node-text" aria-label="卡片文本编辑" spellcheck="false">${h(draft?.text??node.text??'')}</textarea>`}`;const change=()=>{state.coreNodeDrafts??={};const existing=state.coreNodeDrafts[key];state.coreNodeDrafts[key]={baseText:existing?.baseText??node.text,baseName:existing?.baseName??node.name,name:$('#node-name').value,text:$('#node-text')?.value??node.text};markDirty();};$('#node-name').oninput=change;if($('#node-text')){$('#node-text').oninput=change;$('#node-text').oncompositionstart=()=>composition=true;$('#node-text').oncompositionend=()=>{composition=false;change();};}}
    else if(nodeTab==='preview'){content.innerHTML=node.type==='file'?mediaMarkup(node):`<div class="history-preview">${h(node.text||'这张卡片还没有内容。')}</div>`;}
    else {const versions=nodeVersions(doc.canvas,node.id);content.innerHTML=versions.length?versions.map((v,i)=>{const active=node.coreSelectedVersionId?v.id===node.coreSelectedVersionId:v.kind==='text'?v.text===node.text:v.attachment?.relativePath===node.file;return `<section class="version ${active?'current':''}"><div class="version-top"><b>版本 ${i+1}</b><small>${active?'当前采用':formatTime(v.createdAt)}</small></div><p>${h(v.text||v.nodeName||v.attachment?.name||'媒体版本')}</p><div class="version-actions"><button data-version-preview="${h(v.id)}">预览</button><button data-version-adopt="${h(v.id)}" ${active?'disabled':''}>选择采用</button></div></section>`;}).reverse().join(''):'<p class="muted">点击右上角“保存历史版本”，保留当前卡片版本。</p>';}
    if(nodeTab==='history'&&state.coreNodeRecoveries?.[nodeDraftKey()])content.insertAdjacentHTML('beforeend',btn('restore-node-recovery','恢复采用前的卡片'));
    $$('[data-node-tab]').forEach(b=>b.onclick=async()=>{if(nodeTab==='edit'){if(!commitNodeDraft()||!(await save()))return;}nodeTab=b.dataset.nodeTab;renderPanel();});
    $$('[data-version-preview]').forEach(b=>b.onclick=()=>previewNodeVersion(b.dataset.versionPreview));
    $$('[data-version-adopt]').forEach(b=>b.onclick=async()=>{if(!(await save()))return;(state.coreNodeRecoveries??={})[nodeDraftKey()]={node:structuredClone(node),createdAt:new Date().toISOString()};pushBoardUndo();current().canvas=adoptNodeVersion(current().canvas,node.id,b.dataset.versionAdopt);markDirty();renderBoard();renderPanel();if(await save())toast('已采用所选版本，其他版本保留');});
  }else if(panel==='trash'){
    recycleBin.render(aside);
  }else {panel='';renderPanel();return;}
  const resize=$('.inspector-resize');if(resize)bindResize(resize,'rightWidth',300,760,true);
}
function formatTime(value){const date=new Date(value);return Number.isNaN(date.getTime())?'已保存':date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
async function previewNodeVersion(id){const node=selectedNode(),v=nodeVersions(current().canvas,node.id).find(v=>v.id===id);if(!v)return;await modal('卡片版本预览',`<p>${h(v.nodeName||node.name)} · ${formatTime(v.createdAt)}</p>${v.kind==='text'?`<div class="history-preview" style="max-height:60vh;overflow:auto">${h(v.text)}</div>`:mediaMarkup({file:v.attachment?.relativePath,kind:v.kind})}`,[['关闭','cancel']],true);}
async function themePicker(){
  if(settingsPage.isOpen)return settingsPage.open('theme');
  await refreshPreferences();applyTheme();
  const choices=[...THEMES,...ui.customThemes.map(t=>[t.id,t.name||'自定义主题',t.colors.editor])];
  const resultPromise=modal(translate('主题',ui.uiLanguage),`<div class="themes">${choices.map(([id,label,color])=>`<button type="button" class="theme-chip ${ui.theme===id?'active':''}" data-theme-choice="${id}"><i style="background:${color}"></i>${h(translate(label,ui.uiLanguage))}</button>`).join('')}</div>`,[[translate('打开设置',ui.uiLanguage),'settings'],[translate('完成',ui.uiLanguage),'done']]);
  let choosing=false;$$('[data-theme-choice]').forEach(b=>b.onclick=async()=>{if(choosing)return;choosing=true;try{await persistPreferences({...ui,theme:b.dataset.themeChoice});$$('[data-theme-choice]').forEach(el=>el.classList.toggle('active',el===b));}catch(e){toast(e.message);}finally{choosing=false;}});
  const result=await resultPromise;if(result.value==='settings')await settingsPage.open('theme');
}

async function resolveConflict(){
 const id=libraryId,epoch=libraryEpoch,baseState=structuredClone(persistedState);
 const answer=await modal('磁盘内容已变化','<p>本地编辑已保留为草稿。继续保存会把冲突双方存入历史版本，采用本地稿并恢复自动保存；也可以把当前文件另存为冲突副本。</p>',[['继续保存本地稿','local'],['当前文件另存副本','copy']]);
 if(id!==libraryId||epoch!==libraryEpoch)return;
 if(answer.value==='copy'){const local=structuredClone(current()),disk=await api('/api/state?id='+id,undefined,false);state=disk.state;stamp=disk.stateStamp;persistedState=structuredClone(disk.state);conflict=false;dirty=false;await newDocument(local.documentKind==='whiteboard',{...local,title:local.title+' 冲突副本',contentRef:undefined,sourcePath:undefined});toast('已另存当前文件副本，原磁盘文件保留');return;}
 if(answer.value!=='local'||savePromise)return;
 cacheLocalDraft();clearTimeout(saveTimer);clearTimeout(draftTimer);saving=true;const sent=revision,local=structuredClone(state);setStatus('正在保存…');
 savePromise=(async()=>{try{
  const result=await api('/api/state/resolve-local',{id,baseState,state:local,clientId,draftRevision:sent},false);if(id!==libraryId||epoch!==libraryEpoch)return false;
  const merged=reconcileWindowState(local,state,result.state);stamp=result.stateStamp;persistedState=structuredClone(result.state);remoteStamp='';
  if(merged.conflict){conflict=true;setStatus('保存冲突 · 本地稿已保留',true);return false;}
  state=merged.state;conflict=false;dirty=revision!==sent;if(!dirty)localStorage.removeItem(draftKey());else cacheLocalDraft();render();setStatus(dirty?'待保存':'已保存到本地');toast('本地稿已保存，双方版本已保留在历史中，自动保存已恢复');return true;
 }catch(error){conflict=true;setStatus('保存冲突 · 点击处理',true);toast(error.message);return false;}finally{saving=false;savePromise=null;}})();
 const saved=await savePromise;if(saved&&dirty)await save();
}
async function exportDocument(){if(current())return exportOneDocument(state.activeDocument);}
function download(content,name){const url=URL.createObjectURL(new Blob([content],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[<>:"/\\|?*]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function importFiles(files){for(const file of files){const text=await file.text();if(/\.canvas$/i.test(file.name)){const canvas=JSON.parse(text);if(!Array.isArray(canvas.nodes)||!Array.isArray(canvas.edges))throw Error('Canvas 缺少节点或连线');for(const n of canvas.nodes)for(const key of ['x','y','width','height'])if(!Number.isFinite(n[key]))throw Error('Canvas 卡片坐标或尺寸无效');if(canvas.viewport)for(const key of ['x','y','zoom'])if(!Number.isFinite(canvas.viewport[key]))throw Error('Canvas 视口无效');await newDocument(true,{title:file.name.replace(/\.canvas$/i,''),documentKind:'whiteboard',canvas:{...emptyCanvas(),...canvas}});}else{const html=/\.html?$/i.test(file.name)?sanitizeDocumentHtml(text):(await api('/api/markdown',{markdown:text})).html;const markdown=/\.html?$/i.test(file.name)?htmlToMarkdown(html):text;await newDocument(false,{title:file.name.replace(/\.(md|markdown|txt|html?)$/i,''),markdown,html});}}}
function attachmentTarget(image,{replace=false,point}={}){
 const editor=$('.editor'),source=$('.markdown-source'),board=$('.board'),target={id:libraryId,epoch:libraryEpoch,documentId:state.activeDocument,editor,source,imagesOnly:!!image,...replace&&image?{replacement:{image,html:image.outerHTML}}:{}};
 if(current()?.canvas&&board){const rect=board.getBoundingClientRect(),v=current().canvas.viewport;target.point={x:((point?.x??rect.left+board.clientWidth/2)-rect.left-v.x)/v.zoom,y:((point?.y??rect.top+board.clientHeight/2)-rect.top-v.y)/v.zoom};}
 if(source)target.sourceRange={start:source.selectionStart,end:source.selectionEnd,value:source.value};
 if(editor){const selection=getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):selectionRange;target.range=range&&editor.contains(range.commonAncestorContainer)?range.cloneRange():document.createRange();if(image){target.range.setStartAfter(image.closest('figure')||image);target.range.collapse(true);}else if(!editor.contains(target.range.commonAncestorContainer)){target.range.selectNodeContents(editor);target.range.collapse(false);}}
 return target;
}
function ensureAttachmentTarget(target){if(libraryTransition||target.id!==libraryId||target.epoch!==libraryEpoch||target.documentId!==state.activeDocument||!current()||!current().canvas&&(mode==='read'||mode==='atlas'||(target.source?!target.source.isConnected||target.source.value!==target.sourceRange.value:!target.editor?.isConnected||!target.editor.isContentEditable||!target.editor.contains(target.range.commonAncestorContainer))))throw Error('文档已切换或编辑位置已变化，未插入附件，请在目标文档重新上传');if(target.replacement&&(!target.editor.contains(target.replacement.image)||target.replacement.image.outerHTML!==target.replacement.html))throw Error('原图片已变化，未替换，请重新选择');}
function chooseAttachment(image,options){rememberSelection();pendingAttachmentTarget=attachmentTarget(image,options);const input=$('#attachment-input');input.accept=image?'image/*':'';input.multiple=!pendingAttachmentTarget.replacement;input.click();}
async function uploadFiles(files,target=attachmentTarget()){
 if(!files.length)return;ensureAttachmentTarget(target);if(target.replacement&&files.length!==1)throw Error('替换图片时请选择一张图片');
 for(const file of files){if(target.imagesOnly&&transferFileType(file).kind!=='image')throw Error('请选择图片文件');if(file.size>55*1024*1024)throw Error(file.name+'：单个附件上限为 55 MB');}
 for(const [index,file] of files.entries()){
  const {mime,kind}=transferFileType(file);
  const text=current()?.canvas&&kind==='text'&&file.size<=2*1024*1024?(await file.text()).replace(/^\uFEFF/u,''):null;
  const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('无法读取所选文件'));reader.readAsDataURL(file);});ensureAttachmentTarget(target);
  const asset=await api('/api/attachment',{id:target.id,name:file.name,mimeType:mime,base64,...current().canvas?{whiteboardDocumentId:target.documentId,...['image','video','audio'].includes(kind)?{whiteboardMediaKind:kind}:{}}:{}});ensureAttachmentTarget(target);
  if(current().canvas){pushBoardUndo();const c=current().canvas,node={id:'node-'+crypto.randomUUID(),type:text===null?'file':'text',kind:text===null?(kind==='text'?'file':kind):'text',name:file.name,...text===null?{file:asset.relativePath}:{text,attachment:asset},mimeType:mime,durationMs:asset.durationMs,videoWidth:asset.videoWidth,videoHeight:asset.videoHeight,x:target.point.x+index*40,y:target.point.y+index*40,width:360,height:260};snapshotCardModelDefaults(node);c.nodes.push(node);selected=new Set([node.id]);boardChanged();}
  else if(target.source){
   const name=file.name.replace(/[\[\]\\\r\n]/g,'_'),path=encodeURI(asset.relativePath).replaceAll('(','%28').replaceAll(')','%29'),markup=(kind==='image'?'!':'')+'['+name+']('+path+')';
   const {source,sourceRange:r}=target;source.setRangeText(markup,r.start,r.end,'end');source.oninput();target.sourceRange={start:source.selectionStart,end:source.selectionEnd,value:source.value};
  }
  else{
   if(target.replacement){const {image}=target.replacement,next=image.cloneNode(true);next.src=assetUrl(asset.relativePath);next.dataset.attachmentPath=asset.relativePath;next.alt=file.name;replaceEditorImage(target.editor,image,next);hydrateMedia(target.editor,assetUrl);await save();return;}
   const editor=target.editor;editor.focus({preventScroll:true});const selection=getSelection();selection.removeAllRanges();selection.addRange(target.range);
   const tag=kind==='video'?'video':kind==='audio'?'audio':kind==='image'?'img':'';
   const html=tag?`<figure><${tag} src="${h(asset.relativePath)}" data-attachment-path="${h(asset.relativePath)}" ${tag==='img'?'alt="'+h(file.name)+'">':'controls></'+tag+'>'}</figure><p><br></p>`:'<a href="'+h(asset.relativePath)+'">'+h(file.name)+'</a>';
   if(!document.execCommand('insertHTML',false,html))throw Error('附件已上传，但未能插入正文');
   ensureMediaTextSlots(editor);editor.oninput();hydrateMedia(editor,assetUrl);target.range=selection.getRangeAt(0).cloneRange();rememberSelection();
  }
 }
 await save();
}

function focusBoardTransfer(event){if(!editableTransferTarget(event.target)&&!event.target.closest('button,a,video,audio'))event.currentTarget.focus({preventScroll:true});}
function bindExternalDrop(root){
 if(!root)return;
 const accepted=event=>{const types=[...(event.dataTransfer?.types||[])];return !types.some(type=>type.startsWith('application/shensi-'))&&(types.includes('Files')||root.matches('.board')&&types.some(type=>['text/plain','text/html','text/uri-list'].includes(type))&&!editableTransferTarget(event.target));};
 root.ondragover=event=>{if(accepted(event)){event.preventDefault();event.dataTransfer.dropEffect='copy';}};
 root.ondrop=event=>{
  if(!accepted(event))return;event.preventDefault();event.stopPropagation();
  const files=[...(event.dataTransfer.files||[])];
  if(!current()?.canvas&&mode!=='rich'&&mode!=='markdown'){toast('请切换到编辑模式后导入文件');return;}
  const editor=$('.editor');if(editor?.isContentEditable){const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);if(range&&editor.contains(range.commonAncestorContainer)){editor.focus({preventScroll:true});const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}}
  const target=attachmentTarget(undefined,{point:{x:event.clientX,y:event.clientY}});
  void (files.length?uploadFiles(files,target):pasteExternalBoard(event.dataTransfer,target)).catch(error=>toast(error.message));
 };
}
let cardCopyToken='',cardCopyLibrary='';
function copyCards(event){
 const payload=copySelection(current().canvas,selected);if(!payload.nodes.length)return;
 clipboard=payload;cardCopyToken=crypto.randomUUID();cardCopyLibrary=libraryId;
 const text=payload.nodes.map(node=>node.text||node.name||'').join('\n\n'),html='<span data-shensi-cards="'+cardCopyToken+'">'+h(text)+'</span>';
 if(event){event.preventDefault();event.clipboardData.setData('application/x-shensi-cards',cardCopyToken);event.clipboardData.setData('text/html',html);event.clipboardData.setData('text/plain',text);}
 else void navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([text],{type:'text/plain'}),'text/html':new Blob([html],{type:'text/html'})})]).catch(()=>toast('系统剪贴板不可用，请重试复制卡片'));
 updateBoardTools();toast(`已复制 ${clipboard.nodes.length} 张卡片`);
}
async function pasteExternalBoard(data,target=attachmentTarget()){
 ensureAttachmentTarget(target);
 if(cardCopyToken&&cardClipboardToken(data)===cardCopyToken&&clipboard){if(cardCopyLibrary!==libraryId)throw Error('卡片属于另一个笔记本，请使用文档移动或导入以保留附件');pushBoardUndo();selected=new Set(pasteSelection(current().canvas,clipboard));boardChanged();await save();return;}
 const text=transferText(data);if(!text.trim())return;
 pushBoardUndo();const node=addTextCard(current().canvas,{...target.point,text,name:'粘贴文本'});selected=new Set([node.id]);boardChanged();await save();
}
async function pasteBoardClipboard(){
 const target=attachmentTarget(),data=new Map(),files=[];let items;
 try{items=await navigator.clipboard.read();}catch{throw Error('无法读取系统剪贴板，请点击白板空白处后按 Ctrl+V');}
 for(const item of items)for(const type of item.types){const blob=await item.getType(type);if(type.startsWith('text/'))data.set(type,await blob.text());else if(/^(image|audio|video)\//.test(type))files.push(new File([blob],'粘贴-'+Date.now()+'.'+type.split('/')[1],{type}));}
 ensureAttachmentTarget(target);if(files.length)return uploadFiles(files,target);
 if(!data.size)throw Error('剪贴板没有可粘贴的内容；复制的文件请用 Ctrl+V 或拖入');
 return pasteExternalBoard({getData:type=>data.get(type)||''},target);
}
function boardTransferAllowed(event){const board=$('.board');return !event.defaultPrevented&&!libraryTransition&&board&&current()?.canvas&&!$$('dialog[open],[role=dialog],.context-menu').some(el=>el.checkVisibility())&&!editableTransferTarget(event.target)&&(board.contains(event.target)||event.target===document.body);}
document.addEventListener('copy',event=>{if(boardTransferAllowed(event))copyCards(event);});
document.addEventListener('paste',event=>{
 if(!boardTransferAllowed(event))return;event.preventDefault();const data=event.clipboardData,files=[...(data?.files||[])];
 void (files.length?uploadFiles(files):pasteExternalBoard(data)).catch(error=>toast(error.message));
});

async function openBoardContent(){
 if(!current()?.canvas||!(await save()))return;
 const scope={id:libraryId,documentId:state.activeDocument},data=await api('/api/board/content',scope),items=[];
 for(const conversation of Object.values(data.conversations))for(const item of Object.values(conversation.consoles||{}))items.push({conversationId:conversation.id,item});
 const answer=await modal('白板稿件',`<p>停用生成插件后，已有生成参数、参考和微操作栏仍保留。这里不会提交生成任务。</p><label>生成草稿与有序参考<textarea name="drafts" rows="8" aria-label="生成草稿与有序参考">${h(JSON.stringify(data.drafts,null,2))}</textarea></label>${items.length?'<label>微操作栏<select name="console">'+items.map((entry,index)=>'<option value="'+index+'">'+h(entry.item.kind==='script'?'脚本':'提示词')+' · '+h(entry.item.id)+'</option>').join('')+'</select></label>':'<p>暂无微操作栏。</p>'}`,[['关闭','cancel'],...(items.length?[['查看编辑微操作栏','console']]:[]),['保存生成草稿','save']],true);
 if(answer.value==='save'){
  const drafts=JSON.parse(answer.drafts);if(!drafts||Array.isArray(drafts)||typeof drafts!=='object')throw Error('生成草稿格式无效');
  const ids=new Set(current().canvas.nodes.map(n=>n.id));for(const [id,draft] of Object.entries(drafts))if(!ids.has(id)||!draft||typeof draft.prompt!=='string'||!Array.isArray(draft.references)||draft.references.some(ref=>!ids.has(typeof ref==='string'?ref:ref.nodeId||ref.id)))throw Error('草稿卡片或参考已不存在');
  current().canvas.coreGenerationDrafts=drafts;markDirty();await save();toast('生成草稿已保存');return;
 }
 if(answer.value==='console'){
  const entry=items[Number(answer.console)];if(!entry)return;
  const item=entry.item,versionId=item.currentVersionId,text=item.drafts?.[versionId]??item.versions.find(v=>v.id===versionId)?.text??'';
  const edited=await modal('微操作栏完整稿',`<label>当前全文<textarea name="text" rows="16" aria-label="微操作栏当前全文">${h(text)}</textarea></label><p>已保留 ${item.versions.length} 个历史版本。</p>`,[['取消','cancel'],['保存并创建版本','save']],true);
  if(edited.value==='save'){const input={...scope,conversationId:entry.conversationId,consoleId:item.id},saved=await api('/api/board/content/edit',{...input,text:edited.text,expectedRevision:item.revision,viewVersionId:versionId});await api('/api/board/content/version',{...input,expectedRevision:saved.revision,requestId:'core-console-'+crypto.randomUUID()});toast('微操作栏已保存为新版本');}
 }
}
async function runAction(action){try{
  if(action.startsWith('setting-atlas:')){const entry=settingAtlasEntries(state,official.enabled('works')).find(e=>e.type===action.slice(14));if(!entry)return;let id=entry.documents[0].id;if(entry.documents.length>1){const answer=await modal(entry.label,'<label>选择已有文档<select name="document">'+entry.documents.map(d=>`<option value="${h(d.id)}">${h(d.context.path+' / '+d.title)}</option>`).join('')+'</select></label>');if(answer.value!=='ok')return;id=answer.document;}await openDocument(id);if(state.activeDocument===id)await changeEditorMode('atlas');return;}
  if(mode==='atlas'&&['replace-all','attachment','link','table','checklist','format-painter'].includes(action)){toast('设定集为只读预览，请切换到编辑模式');return;}
  if(inlineEditor.active&&!(await inlineEditor.finish()))return false;
 if(action==='directory-files'||action==='directory-favorites'){ui.directoryView=action==='directory-favorites'?'favorites':'files';prefs();refreshDirectory();return;}
  if(action==='board-content')return await openBoardContent();
  if(action==='board-add-menu'){const b=$('[data-action=board-add-menu]'),r=b.getBoundingClientRect(),answer=await contextMenu([{value:'add-plain',label:'普通卡片'},...official.enabled('whiteboard-generation')?[['text','文本'],['image','图片'],['video','视频'],['audio','音频']].map(([id,name])=>({value:'generate-'+id,label:'生成'+name})):[]],{clientX:r.left,clientY:r.top});if(answer.value!=='cancel')return boardTools.action(answer.value,{node:null});return;}
  if(action==='board-assets')return boardTools.action('assets');if(action==='board-arrange')return boardTools.action('arrange-all');
  if(action==='toggle-plugin-dock'){if(panel==='node'){panel='';renderPanel();dock.setOpen(true);}else dock.toggle();return;}
  if(action.startsWith('window-'))return await windowControls.command(action);
  if(settingsPage.isOpen&&!['settings','theme'].includes(action)){await settingsPage.close();if(settingsPage.isOpen)return;}
  if(aboutPage.isOpen&&action!=='help')aboutPage.close();
  if(action==='help')return aboutPage.open();
  if(action.startsWith('work-tool:'))return workTools.open(action.slice(10));
  if(action.startsWith('official-'))return official.action(action);
  if(action.startsWith('plugin:'))return extensions.action(action);
  if(action==='toolbar-more'){const b=$('[data-action=toolbar-more]');b.setAttribute('aria-expanded',String(b.getAttribute('aria-expanded')!=='true'));syncRichToolbar();return;}
  if(action==='directory-sort'){if(state.coreWork?.enabled)return;const button=$('[data-action=directory-sort]'),bounds=button.getBoundingClientRect(),answer=await contextMenu(DIRECTORY_SORTS.map(([value,label])=>({value,label:(state.coreDirectorySort||'manual')===value?'✓ '+label:label})),{clientX:bounds.left,clientY:bounds.bottom});if(!DIRECTORY_SORTS.some(([id])=>id===answer.value))return;state.coreDirectorySort=answer.value;markDirty();render();await save();return;}
  if(action==='collapse-folders'){if(state.coreWork?.enabled)return;for(const folder of state.coreFolders??[])folder.collapsed=true;markDirty();render();await save();return;}
  if(action==='format-painter'){restoreSelection();const node=window.getSelection()?.anchorNode,el=node?.nodeType===1?node:node?.parentElement;if(!el||!$('.editor')?.contains(el))return;const style=getComputedStyle(el);formatPaint={foreColor:style.color,bold:document.queryCommandState('bold'),italic:document.queryCommandState('italic'),underline:document.queryCommandState('underline')};$('[data-action=format-painter]').setAttribute('aria-pressed','true');toast('已复制粗体、斜体、下划线和颜色，选择目标文字即可应用');return;}
  if(action==='checklist'){restoreSelection();await executeShortcut('selectionChecklist');return;}
  if(action==='autosave-status'){if(conflict)return resolveConflict();if(await save())toast('当前内容已保存到本地；历史版本需要手动保存，或由 AI 修改触发。');return;}
  if(action==='save-history'){if(!current()||!(await inlineEditor.finish()))return false;if(panel==='node'&&nodeTab==='edit'&&!commitNodeDraft())return false;return checkpointCurrent();}
  if(action==='new-note')return newDocument();if(action==='new-board')return newDocument(true);if(action==='save'){if(!(await inlineEditor.finish()))return;if(panel==='node'&&nodeTab==='edit'&&!commitNodeDraft())return;await save();return;}
  if(action==='restore-node-recovery'){const recovery=state.coreNodeRecoveries?.[nodeDraftKey()],node=selectedNode();if(!recovery||!node)return;if(!(await save()))return;pushBoardUndo();const before=structuredClone(node);current().canvas.nodes=current().canvas.nodes.map(n=>n.id===node.id?structuredClone(recovery.node):n);recovery.node=before;recovery.createdAt=new Date().toISOString();markDirty();renderBoard();renderPanel();await save();return;}
  if(action==='cancel-node-edit'){if(state.coreNodeDrafts)delete state.coreNodeDrafts[nodeDraftKey()];markDirty();nodeTab='preview';renderPanel();await save();return;}
  if(action==='new-library'){if(!(await save()))return;const name=await askName('新建笔记');if(name){const result=await api('/api/library',{name});libraries=(await api('/api/bootstrap')).libraries;await loadLibrary(result.id);}return;}
  if(action==='new-folder')return createFolder();
  if(action==='new-tab'){if(tabSpace())await changeTabs(()=>tabs.openBlankDocumentTab(state));return;}
  if(action==='sidebar'){ui.sidebarHidden=!ui.sidebarHidden;prefs();render();return;}if(action==='search'){if(ui.sidebarHidden){ui.sidebarHidden=false;prefs();render();}$('#global-search').focus();return;}
  if(action==='settings')return settingsPage.open();if(action==='theme')return themePicker();if(action==='focus')return windowControls.command('window-fullscreen');if(action==='expand-panel'){document.body.classList.toggle('full-panel');return;}
  if(action==='close-panel'){if(panel==='trash'){panel='';render();return;}panel='';document.body.classList.remove('full-panel');renderPanel();return;}
  if(action==='close-trash'){panel='';render();return;}
  if(action==='trash'){if(!(await save()))return;panel='trash';document.body.classList.remove('full-panel');render();return;}
  if(action==='find'){findOpen=!findOpen;render();$('#find-query')?.focus();return;}if(action==='close-find'){findOpen=false;render();return;}
  if(action==='find-next'){const q=$('#find-query').value;if(current().canvas){const matches=current().canvas.nodes.filter(n=>q&&n.text?.includes(q));const index=matches.findIndex(n=>selected.has(n.id));const node=matches[(index+1)%matches.length];if(node)openNode(node.id,'preview');else toast('没有匹配内容');}else if(mode==='markdown'){const el=$('.markdown-source'),start=el.value.indexOf(q,el.selectionEnd);const index=start<0?el.value.indexOf(q):start;if(index>=0){el.focus();el.setSelectionRange(index,index+q.length);}}else window.find(q,false,false,true);return;}
  if(action==='replace-all'){const q=$('#find-query').value,r=$('#find-replacement').value;if(!q)return;const answer=await modal('替换全部匹配','<p>将在当前文档中替换。若需保留替换前的历史，请先点击“保存历史版本”。</p>');if(answer.value!=='ok')return;if(current().canvas){pushBoardUndo();for(const node of current().canvas.nodes)if(node.text)node.text=node.text.split(q).join(r);boardChanged();renderPanel();}else if(mode==='markdown'){$('.markdown-source').value=$('.markdown-source').value.split(q).join(r);$('.markdown-source').oninput();}else{const editor=$('.editor'),before=editor.innerHTML,count=replaceEditorText(editor,q,r);if(count)richReplaceBatches.push({before,after:editor.innerHTML,count});editor.oninput();}return;}
  if(action==='import'){$('#import-input').click();return;}if(action==='export')return exportDocument();
  if(action==='attachment'){if(!current().canvas&&mode!=='rich'){toast('请在编辑模式插入附件');return;}chooseAttachment();return;}
  if(action==='link'){rememberSelection();const result=await modal('插入链接','<input name="url" type="url" required aria-label="链接地址" placeholder="https://">');if(result.value==='ok'){let url;try{url=new URL(result.url);}catch{throw Error('链接地址无效，请输入完整网址');}if(!['http:','https:','mailto:'].includes(url.protocol)||url.username||url.password)throw Error('仅支持 HTTP、HTTPS 或邮件链接，且不能包含账号密码');restoreSelection();if(window.getSelection()?.isCollapsed)document.execCommand('insertHTML',false,'<a href="'+h(url.href)+'">'+h(url.href)+'</a>');else document.execCommand('createLink',false,url.href);$('.editor').oninput();}return;}
  if(action==='table'){rememberSelection();const result=await modal('插入表格','<label>列数<input type="number" name="cols" value="3" min="1" max="12"></label><label>行数<input type="number" name="rows" value="3" min="1" max="30"></label>');if(result.value==='ok'){const rows=Math.max(1,Math.min(30,Number(result.rows))),cols=Math.max(1,Math.min(12,Number(result.cols)));restoreSelection();document.execCommand('insertHTML',false,'<table><tbody>'+Array.from({length:rows},(_,i)=>'<tr>'+Array.from({length:cols},()=>i===0?'<th>标题</th>':'<td>内容</td>').join('')+'</tr>').join('')+'</tbody></table><p><br></p>');$('.editor').oninput();}return;}
  const c=current()?.canvas;if(!c)return;
  if(action==='add-card'){pushBoardUndo();const board=$('.board');const n=addTextCard(c,{x:Math.round((board.clientWidth/2-c.viewport.x)/c.viewport.zoom)-170,y:Math.round((board.clientHeight/2-c.viewport.y)/c.viewport.zoom)-120});selected=new Set([n.id]);panel='';boardChanged();renderPanel();}
  if(action==='undo-board'&&boardUndo.length){boardRedo.push(structuredClone(c));const prior=boardUndo.pop();const ids=new Set(prior.assets.map(a=>a.id));prior.assets.push(...c.assets.filter(a=>!ids.has(a.id)));current().canvas=prior;boardChanged();renderPanel();}
  if(action==='redo-board'&&boardRedo.length){boardUndo.push(structuredClone(c));const next=boardRedo.pop(),ids=new Set(next.assets.map(a=>a.id));next.assets.push(...c.assets.filter(a=>!ids.has(a.id)));current().canvas=next;boardChanged();renderPanel();}
  if(action==='copy-cards')copyCards();
  if(action==='paste-cards')await pasteBoardClipboard();
  if(action==='delete-cards'){if(selected.size||selectedEdges.size){pushBoardUndo();c.nodes=c.nodes.filter(n=>!selected.has(n.id));c.edges=c.edges.filter(e=>!selected.has(e.fromNode)&&!selected.has(e.toNode)&&!selectedEdges.has(e.id));selected.clear();selectedEdge='';selectedEdges.clear();panel='';boardChanged();renderPanel();}}
  if(action==='zoom-in')zoomBoard(1.2);if(action==='zoom-out')zoomBoard(1/1.2);
  if(action==='toggle-snap'){c.settings??={};c.settings.snapToGrid=c.settings.snapToGrid===false;markDirty();render();}
  if(action==='fit'){const board=$('.board');c.viewport=fittedBoardViewport(c.nodes,board.clientWidth,board.clientHeight);applyViewport();markDirty();}
}catch(error){toast(error.message);}}
$('#import-input').onchange=async e=>{try{await importFiles([...e.target.files]);}catch(error){toast(error.message);}e.target.value='';};
$('#attachment-input').onchange=async e=>{const target=pendingAttachmentTarget;pendingAttachmentTarget=null;try{await uploadFiles([...e.target.files],target||attachmentTarget());}catch(error){toast(error.message);}e.target.value='';};
$('#attachment-input').oncancel=()=>{pendingAttachmentTarget=null;};
async function executeShortcut(id){
  if(id==='selectionChange'){selectionEditor.change();return;}
  const actions={focusSearch:'search',saveVersion:'save-history',openSettings:'settings',save:'save',find:'find',newNote:'new-note'};
  if(actions[id])return runAction(actions[id]);
  if(id==='togglePreview'){if(current()?.canvas){const node=selectedNode();if(node){if(nodeTab==='edit'&&(!commitNodeDraft()||!(await save())))return;openNode(node.id,nodeTab==='edit'?'preview':'edit');}}else if(current()){if(!(await save()))return;await changeEditorMode(mode==='read'?'rich':'read');}return;}
  const editor=$('.editor');if(!editor||mode!=='rich'||!editor.contains(document.activeElement)&&document.activeElement!==editor)return;
  const commands={selectionBold:['bold'],selectionItalic:['italic'],selectionParagraph:['formatBlock','p'],selectionHeading1:['formatBlock','h1'],selectionHeading2:['formatBlock','h2'],selectionHeading3:['formatBlock','h3'],selectionOrderedList:['insertOrderedList'],selectionBulletList:['insertUnorderedList'],clearDocumentFormatting:['removeFormat']};
  if(id==='selectAllDocument'){const range=document.createRange();range.selectNodeContents(editor);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return;}
  if(id==='selectionChecklist'){document.execCommand('insertUnorderedList');const selection=window.getSelection();let list=selection.anchorNode?.parentElement?.closest('ul');if(list&&editor.contains(list)){list.dataset.checklist='true';}if(list&&editor.contains(list))for(const item of list.children)if(!item.textContent.startsWith('☐ '))item.prepend(document.createTextNode('☐ '));editor.oninput();return;}
  if(commands[id]){document.execCommand(commands[id][0],false,commands[id][1]);editor.oninput();}
}
document.addEventListener('keydown',e=>{
 if(libraryTransition&&!$('#dialog').open){e.preventDefault();return;}
 if(e.key==='F11'){e.preventDefault();if(!e.repeat)void windowControls.command('window-fullscreen').catch(error=>toast(error.message));return;}
 if($('#dialog').open)return;
 if(settingsPage.isOpen){if(e.key==='Escape'){e.preventDefault();void settingsPage.close();}return;}
 if(panel==='trash'&&e.key==='Escape'){e.preventDefault();void runAction('close-trash');return;}
 if(e.key==='Escape'&&$('.note-toolbar-expand')?.getAttribute('aria-expanded')==='true'){e.preventDefault();closeRichToolbar();return;}
 if((e.key==='Delete'||e.key==='Backspace')&&e.target.closest('.filetree')&&!e.target.closest('input,textarea,[contenteditable=true]')){const tokens=directorySelection.tokens();if(tokens.length){e.preventDefault();void deleteDirectoryTokens(tokens).catch(error=>toast(error.message));}return;}
 if(document.querySelector('dialog[open]')||e.target.closest('[role=dialog],.context-menu'))return;
 const typing=e.target.matches('input,textarea,[contenteditable=true]')||e.target.closest('[contenteditable=true]');
 if(e.code==='Space'&&!typing){spaceDown=true;e.preventDefault();}
 const binding=shortcutFromEvent(e).toLowerCase(),command=SHORTCUTS.find(([id])=>ui.shortcuts[id]?.toLowerCase()===binding)?.[0];
 const editorOnly=command?.startsWith('selection')||['selectAllDocument','clearDocumentFormatting'].includes(command);
 const inEditor=$('.editor')?.contains(e.target)&&mode==='rich'||command==='selectionChange'&&$('.markdown-source')===e.target;
 if(command&&!command.startsWith('send')&&(!editorOnly||inEditor)){e.preventDefault();void executeShortcut(command).catch(error=>toast(error.message));return;}
 const mod=e.ctrlKey||e.metaKey;
 if(mod&&mode==='rich'&&$('.editor')?.contains(e.target)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();runRichCommand(e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');$('.editor').oninput();return;}
 if(current()?.canvas&&!typing){const key=e.key.toLowerCase();if(mod&&['z','y'].includes(key)){e.preventDefault();runAction(key==='y'||e.shiftKey?'redo-board':'undo-board');}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();runAction('delete-cards');}if(e.key==='Escape'){connection='';selected.clear();panel='';renderBoard();renderPanel();}}
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.note-rich-toolbar,.note-color-menu'))closeRichToolbar();if(ui.pauseVideoWhenClickOutside===false)return;for(const video of $$('video')){const owner=video.closest('.card,figure')||video;if(!owner.contains(e.target))video.pause();}},true);

document.addEventListener('selectionchange',updateSelectedCount);
document.addEventListener('focusin',updateSelectedCount);
document.addEventListener('keyup',e=>{if(e.code==='Space')spaceDown=false;});
window.addEventListener('blur',()=>spaceDown=false);
window.addEventListener('beforeunload',e=>{if(dirty||settingsPage.hasUnsavedChanges||workTools.hasPending()){if(dirty)try{localStorage.setItem(draftKey(),JSON.stringify(draftPayload()));}catch{}e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty&&!conflict)save();});
if(!detachedType)startNotebookAutoSync({
 clients:[{status:async()=>official.enabled('official.nutstore')?api('/api/official/sync-notebooks/auto',{}):{enabled:false},tick:()=>api('/api/official/sync-notebooks/auto-tick',{})},{status:()=>api('/api/official/cloud-notebooks/auto',{}),tick:()=>api('/api/official/cloud-notebooks/auto-tick',{})}],
 canRun:()=>!!state&&!dirty&&!saving&&!conflict&&!composition&&!libraryTransition&&!workspacePointerActive&&!document.activeElement?.matches('input,textarea,[contenteditable=true]'),
 changed:()=>syncRemoteState(),onError:error=>toast('自动同步未完成：'+error.message)
});
try{const boot=await api('/api/bootstrap');if(!boot.capabilities?.includes('explicit-history'))throw Error('应用文件已更新。请关闭当前神思窗口并重新启动，以加载新版保存与新建服务。');libraries=boot.libraries;preferencesRevision=boot.revision;if(boot.preferences)Object.assign(ui,boot.preferences);prefs();const last=detached.get('notebook')||localStorage.getItem('core-library');await loadLibrary(libraries.some(l=>l.id===last)?last:libraries[0].id);if(boot.capabilities?.includes('official-plugins')){await official.refresh();await api('/api/official/knowledge');libraries=(await api('/api/bootstrap')).libraries;render();}await extensions.refresh();if(['graph','blank','document','whiteboard','work-report'].includes(detachedType)){state.documentTabs=[];state.activeDocument='';state.activeDocumentTabId='';}if(detachedType==='work-report')await workReports.open({jobId:detached.get('job')});else if(detachedType==='graph')await openGraphTab();else if(detachedType==='blank'){Object.assign(state,tabs.openBlankDocumentTab(state));render();}else if(detached.get('document')&&state.documents[detached.get('document')]){Object.assign(state,tabs.openDocumentInTabs(state,detached.get('document')));render();}else if(detachedType==='plugin')await extensions.action('plugin:open:'+detached.get('plugin'));await detachedTabs.start();announceWorkspaceReady();void listenWorkspaceChanges();}catch(error){$('#app').innerHTML=`<div class="boot"><h1>资料库未能打开</h1><p>${h(error.message)}</p><p>已停止初始化，原文件未被空白内容覆盖。</p></div>`;}
