import {validateWorkWrites} from './work-paths.mjs';
import {editAgentBoard} from './agent-board-edit.mjs';
import {createDocumentMover,copyAssets,verifyAssets} from './document-move.mjs';
import {createLocalSkills} from './local-skills.mjs';
import {hasDecodedParserMedia} from './parser-media-receipts.mjs';
import {createSkillDocumentation} from './skill-documentation.mjs';
import {MAP_ASSET_DOCUMENT,mediaTargetDocument} from './map-media-target.js';
import {fileProjection} from './file-projection.mjs';
import {createCoreCloudNotebookStorage} from './cloud-notebook-storage.mjs';
import {createCoreCloudMedia} from './cloud-media.mjs';
import {desktopMediaPath} from '../../mobile/media-contract.mjs';
import {snapshotCanvasNodeVersion} from '../legacy/whiteboard.js';
import {checkpointDirectory,directorySnapshot,verifyDirectoryVersion} from './directory-history.mjs';
import {createNotebookRecycle} from './notebook-recycle.mjs';
import {recycleSelection} from '../legacy/recycle-state.js';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {checkpoint,assertVersion,snapshotDocument} from './history.mjs';
import {archiveRouteHistory} from './route-history.mjs';
import {filterDeletedHistory,restoreHistoryTombstone,recycleVersions,pruneHistory,migrateCardVersionTrash} from './history-management.mjs';
import {purgeTrashPayloadsFromState,recycleHistoryCollection} from '../legacy/trash.js';
import {openDocumentInTabs,normalizeDocumentTabState} from '../legacy/document-tabs.js';
import {reconcileWindowState} from '../../ui/window-state.js';
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const digest = value => createHash('sha256').update(value).digest('hex');
const clone = structuredClone;
const fail = (message, code = 'INVALID_REQUEST') => Object.assign(new Error(message), { code });
function validateCanvas(canvas) {
  if(!canvas||!Array.isArray(canvas.nodes)||!Array.isArray(canvas.edges))throw fail('白板结构无效');
  const ids=new Set();for(const node of canvas.nodes){if(typeof node.id!=='string'||ids.has(node.id))throw fail('白板卡片身份重复或缺失');ids.add(node.id);for(const key of ['x','y','width','height'])if(!Number.isFinite(node[key]))throw fail('白板卡片坐标或尺寸无效');}
  if(canvas.viewport)for(const key of ['x','y','zoom'])if(!Number.isFinite(canvas.viewport[key]))throw fail('白板视口无效');
}
const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch(e) { if(e.code === 'ENOENT') return null; throw e; } };
async function atomicJson(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, file);
}
function snapshotNode(canvas, node) {
  if(!node)return;canvas.assets??=[];const ids=new Set(canvas.assets.map(a=>a.id));
  const projected=snapshotCanvasNodeVersion({nodes:[node],edges:[],assets:canvas.assets},node.id,{id:'canvas-version-'+randomUUID(),source:'manual'});
  canvas.assets.push(...projected.assets.filter(a=>!ids.has(a.id)).map(a=>({...a,coreNodeSnapshot:clone(node)})));
}
function mergeBoardGenerationDraft(previous,draft) {
  const {channels:previousChannels,...activeDraft}=previous,{channels:compiledChannels,...binding}=draft,channel=draft.channel,channels=clone(previousChannels||{});
  if(previous.channel)channels[previous.channel]=clone(activeDraft);
  const current={...clone(!previous.channel||previous.channel===channel?activeDraft:channels[channel]||{}),...clone(binding)};
  channels[channel]=clone(current);
  return {...current,channels};
}
export async function createCoreService({ dataRoot = join(projectRoot, 'user-data/core') } = {}) {
  dataRoot = resolve(dataRoot);
  const skills=createLocalSkills({dataRoot});
  let cardDefaultResolver=async()=>({});
  const stampNewCards=async nodes=>{if(!nodes.length)return;const defaults=await cardDefaultResolver();for(const node of nodes)if(!Object.hasOwn(node,'coreDefaultProfiles'))node.coreDefaultProfiles=clone(defaults);};
  const oldRoot = resolve(projectRoot, '../shensi-source');
  const rel = relative(oldRoot, dataRoot);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw fail('本体不能使用旧源码目录存放资料');
  process.env.SHENSI_DATA_ROOT = dataRoot;
  process.env.SHENSI_MACHINE_DATA_ROOT = join(dataRoot, 'machine');
  const engine = await import('../legacy/server/workspace.mjs');
  const { createBlankNotebookState } = await import('../legacy/data.js');
  const { sanitizeDocumentHtml } = await import('../legacy/document-sanitize.js');
  const notesRoot = join(dataRoot, '笔记');
  const draftsRoot = join(dataRoot, 'core-drafts');
  await mkdir(notesRoot, { recursive: true }); await mkdir(draftsRoot, { recursive: true });
  const options = id => {
    if (!/^[a-zA-Z0-9_-]{1,90}$/.test(id)) throw fail('无效资料库身份');
    return { appRoot: join(projectRoot, 'apps/desktop'), requestedPath: join(notesRoot, id) };
  };
  const queues = new Map();
  const listeners=new Set();
  let barrier=Promise.resolve();
  const exclusive=fn=>{const previous=barrier,inflight=[...queues.values()];let release;barrier=new Promise(resolve=>release=resolve);return previous.then(async()=>{await Promise.allSettled(inflight);return fn();}).finally(()=>release());};
  const checkSignal=signal=>{if(signal?.aborted)throw fail('任务已停止','ABORTED');};
  const serial = (id, fn, signal) => {
    const gate=barrier,job = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(()=>gate).then(()=>{checkSignal(signal);return fn();});
    queues.set(id, job); job.finally(() => { if(queues.get(id) === job) queues.delete(id); }).catch(()=>{}); return job;
  };
  const workspaceReads=new Map();
  async function load(id) {
    const opts=options(id),stamp=(await engine.getWorkspaceStateStamp(opts)).stateStamp;
    let entry=workspaceReads.get(id);
    if(!entry||entry.stamp!==stamp){
      entry={stamp,promise:loadUncached(id)};workspaceReads.set(id,entry);
      // Cache only validated publications, never the caller's editable state.
      // The stamp includes external document files, transactions and history.
      entry.promise.then(result=>{entry.stamp=result.stateStamp;},()=>{if(workspaceReads.get(id)===entry)workspaceReads.delete(id);});
      if(workspaceReads.size>2)workspaceReads.delete(workspaceReads.keys().next().value);
    }
    return clone(await entry.promise);
  }
  async function loadUncached(id) {
    const result = await engine.loadWorkspaceState(options(id));
    if (!result.state) throw fail('资料库不存在', 'NOT_FOUND');
    for (const doc of Object.values(result.state.documents ?? {})) {
      for(const node of doc.canvas?.nodes||[])if(node.localMedia&&!node.file)node.file=desktopMediaPath(node.localMedia);
      if(doc.canvas)validateCanvas(doc.canvas);
      if (doc.coreRichText?.markdownHash === digest(String(doc.markdown ?? '').trim())) doc.html = sanitizeDocumentHtml(doc.coreRichText.html);
    }
    migrateCardVersionTrash(result.state);
    return result;
  }
  const graphCache=new Map();
  const assetCache=new Map();
  async function assetLoad(id){
    const opts=options(id),stateStamp=(await engine.getWorkspaceStateStamp(opts)).stateStamp;let entry=assetCache.get(id);
    if(!entry||entry.stamp!==stateStamp){entry={stamp:stateStamp,promise:engine.loadWorkspaceAssetState(opts)};assetCache.set(id,entry);if(assetCache.size>12)assetCache.delete(assetCache.keys().next().value);entry.promise.catch(()=>{if(assetCache.get(id)===entry)assetCache.delete(id);});}
    return clone(await entry.promise);
  }
  async function graphLoad(id){
    const opts=options(id);let entry=graphCache.get(id);
    const stateStamp=entry?.stamp?(await engine.getWorkspaceStateStamp(opts)).stateStamp:null;
    if(!entry||entry.stamp&&entry.stamp!==stateStamp){entry={promise:engine.loadWorkspaceGraphState(opts).then(result=>{for(const doc of Object.values(result.state.documents||{}))if(doc.canvas){const {assets,coreGenerationDrafts,...canvas}=doc.canvas;doc.canvas=canvas;}return result;})};graphCache.set(id,entry);entry.promise.then(result=>{entry.stamp=result.stateStamp;},()=>{if(graphCache.get(id)===entry)graphCache.delete(id);});}
    return clone(await entry.promise);
  }
const directoryMetadata=fileProjection(state=>({name:state.projectName,knowledge:!!state.coreKnowledgeBase,work:!!state.coreWork?.enabled,folders:(state.coreFolders||[]).map(f=>({id:f.id,parentId:f.parentId,name:f.name})),documents:Object.entries(state.documents||{}).map(([id,d])=>({id,title:d.title,folderId:d.coreFolderId,board:d.documentKind==='whiteboard'||!!d.canvas,role:d.coreWorkRole}))}));
  async function list() {
    const result=[];
    for (const entry of await readdir(notesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]{1,90}$/.test(entry.name)) continue;
      if (engine.isWorkspacePathDeleted(join(notesRoot, entry.name))) continue;
      const state=await directoryMetadata(join(notesRoot, entry.name, '.shensi/current-state.json'));
      if(state) result.push({id:entry.name,name:state.name||entry.name,knowledge:!!state.knowledge});
    }
    return result.sort((a,b)=>Number(b.knowledge)-Number(a.knowledge));
  }
  async function directoryCatalog(){const entries=[];for(const library of await list()){const metadata=await directoryMetadata(join(notesRoot,library.id,'.shensi/current-state.json'));if(!metadata)continue;const folders=new Map(metadata.folders.map(f=>[f.id,f]));for(const d of metadata.documents){const path=[],seen=new Set();let folder=folders.get(d.folderId);while(folder&&!seen.has(folder.id)){seen.add(folder.id);path.unshift(folder.name);folder=folders.get(folder.parentId);}entries.push({id:library.id,documentId:d.id,title:d.title,notebookName:library.name,folders:path,path:[library.name,...path,d.title].join(' / '),board:d.board,setting:metadata.work&&/world|setting/.test(d.role||'')});}}return entries;}
  async function create(name='我的笔记') {
    const id='notebook-'+randomUUID();
    const state=createBlankNotebookState({name:String(name).slice(0,120)||'我的笔记'});
    Object.assign(state,{settings:{},documents:{},histories:{},moduleItems:{library:[]},activeModule:'library',activeDocument:'',documentTabs:[],activeDocumentTabId:'',theme:'light',coreFolders:[],coreRestoreLog:[]});
    await engine.saveWorkspaceState({...options(id),state});
    return {id,...await load(id)};
  }
  async function referenceIndex(){
    const entries=[];
    for(const notebook of await list()){
      const state=await readJson(join(notesRoot,notebook.id,'.shensi/current-state.json'));if(!state)continue;
      const folderPath=id=>{const path=[],seen=new Set();let f=(state.coreFolders||[]).find(f=>f.id===id);while(f&&!seen.has(f.id)){seen.add(f.id);path.unshift({id:f.id,name:f.name});f=state.coreFolders.find(p=>p.id===f.parentId);}return path;};
      for(const [documentId,doc] of Object.entries(state.documents||{}))entries.push({notebookId:notebook.id,documentId,title:doc.title,library:notebook.name,folderPath:folderPath(doc.coreFolderId),kind:doc.coreKnowledgeKind||'note',canvas:doc.documentKind==='whiteboard',work:!!state.coreWork,knowledge:!!state.coreKnowledgeBase});
    }
    return entries;
  }
  async function recycleIndex(){const entries=[];for(const library of await list()){const state=await readJson(join(notesRoot,library.id,'.shensi/current-state.json'));if(state?.trash?.length)entries.push({library,state});}return entries;}
  async function commit(id,{state,expectedStateStamp,clientId,draftRevision,signal}={},historyAction,incrementalDocuments=false,readBaseline=null) {
      checkSignal(signal);
      if (!state?.documents || !expectedStateStamp) throw fail('保存缺少正文或基线');
      // Internal serialized operations already hold a validated baseline. The
      // engine rechecks its stamp under the file lock before publishing.
      const current=readBaseline||await load(id);
      if(current.stateStamp!==expectedStateStamp) throw fail('磁盘内容已变化。本地稿已保留，请比较后另存或重新载入。','WORKSPACE_STATE_CONFLICT');
      // Clone the merged editing payload once. Authoritative history is copied
      // below; cloning both complete inputs first duplicated megabytes of history.
      const next=clone({...current.state,...state,histories:undefined,coreDirectoryHistories:undefined,coreHistoryDeleted:undefined});
      // Copies and recycling must not normalize every untouched legacy note.
      // Compare the full validated baseline; normal edits/new documents still
      // receive folder mapping, HTML sanitization and asset continuity below.
      const unchangedDocuments=new Set(incrementalDocuments&&JSON.stringify(next.coreFolders)===JSON.stringify(current.state.coreFolders)
        ?Object.keys(next.documents).filter(key=>JSON.stringify(next.documents[key])===JSON.stringify(current.state.documents[key])):[]);
      if(!historyAction?.mapAssets){
        if(current.state.coreMapMediaCanvas)next.coreMapMediaCanvas=clone(current.state.coreMapMediaCanvas);
        const incoming=next.workspaceAssets||[],known=new Set(incoming.map(a=>a.id));
        next.workspaceAssets=[...incoming,...(current.state.workspaceAssets||[]).filter(a=>!known.has(a.id))];
      }
      validateWorkWrites(next,current.state);
      // Map the shell's folder identities onto the existing physical path contract.
      if(Array.isArray(next.coreFolders)) {
        const folders=new Map(next.coreFolders.map(f=>[f.id,f]));
        const folderPath=(folder,seen=new Set())=>{if(!folder)return '';if(seen.has(folder.id))throw fail('文件夹层级循环，已停止保存');const parent=folders.get(folder.parentId);return parent?folderPath(parent,new Set([...seen,folder.id]))+'/'+folder.name:folder.name||'';};
        next.customFolders=[...(next.customFolders??[]).filter(f=>!f.coreManaged),...next.coreFolders.map(f=>({id:f.id,label:f.name,folderPath:folderPath(f),moduleId:'library',coreManaged:true}))];
        for(const [documentId,doc] of Object.entries(next.documents))if(!unchangedDocuments.has(documentId)&&Object.hasOwn(doc,'coreFolderId')) {
          const folder=folders.get(doc.coreFolderId);doc.customFolderId=folder?.id||'';doc.customFolderPath=folderPath(folder);
        }
      }
      // The service owns history continuity; a stale UI cannot silently drop old versions.
      next.histories = clone(current.state.histories ?? {});
      next.coreDirectoryHistories=clone(current.state.coreDirectoryHistories??{});
      next.coreHistoryDeleted=clone(current.state.coreHistoryDeleted||[]);
      if(historyAction?.moveImport)next.histories=clone(historyAction.moveImport.histories);
      if(historyAction?.syncMerge){next.histories=clone(historyAction.syncMerge.histories);next.coreHistoryDeleted=clone(historyAction.syncMerge.coreHistoryDeleted||[]);}
      if(historyAction?.directoryRestore){next.histories=clone(historyAction.directoryRestore.histories);next.coreDirectoryHistories=clone(historyAction.directoryRestore.coreDirectoryHistories);}
      if(historyAction?.documentMerges)for(const merge of historyAction.documentMerges){
        if(merge.routeArchive){archiveRouteHistory(next,current.state,merge);continue;}
        const primaryId=merge.primaryId,primary=next.documents[primaryId],original=current.state.documents[primaryId];
        if(!primary||!original)throw fail('文档合并主文档不存在');
        const candidates=[];
        for(const duplicateId of merge.duplicateIds){
          const duplicate=current.state.documents[duplicateId];if(!duplicate)throw fail('文档合并副本不存在');
          for(const entry of [...(current.state.histories?.[duplicateId]||[])].reverse())if(entry?.document)candidates.push({document:entry.document,reason:'合并副本历史版本'});
          candidates.push({document:duplicate,reason:'合并重复文档正文'});
        }
        for(const candidate of candidates){next.documents[primaryId]={...clone(candidate.document),title:primary.title,moduleId:primary.moduleId,documentKind:primary.documentKind};checkpoint(next,primaryId,{source:'migration',operationType:'merge',reason:candidate.reason});}
        next.documents[primaryId]=primary;checkpoint(next,primaryId,{source:'migration',operationType:'merge',reason:'重复文档合并后的主版本'});
        for(const duplicateId of merge.duplicateIds)delete next.histories[duplicateId];
      }
      for(const key of ['viewHistories','volumeHistories','moduleHistories','moduleHistoriesDeferred','moduleHistoryScopesLoaded','projectHistories','currentVersionMeta','assetHistoryTombstones'])if(current.state[key]!==undefined)next[key]=clone(current.state[key]);
      // Only explicit recycle operations may remove or restore archived history.
      const removedTrash=(current.state.trash||[]).filter(entry=>!(next.trash||[]).some(e=>e.trashId===entry.trashId));
      const purged=new Set(next.coreTrashPurged||[]);
      for(const entry of removedTrash.filter(e=>!purged.has(e.trashId))){
        for(const [documentId,history] of Object.entries(entry.histories||{}))if(next.documents[documentId]&&!next.histories[documentId]?.length)next.histories[documentId]=clone(history);
        for(const [folderId,history] of Object.entries(entry.volumeHistories||{})){next.volumeHistories??={};if(!next.volumeHistories[folderId]?.length)next.volumeHistories[folderId]=clone(history);}
        if(entry.kind==='history-version'&&entry.versionEntry){
          if(entry.scope?.type==='module'&&current.state.moduleHistoriesDeferred){
            const restored=await engine.loadWorkspaceHistoryScope({...options(id),scopeType:'module',scopeId:entry.scope.id});
            (next.moduleHistories??={})[entry.scope.id]=clone(restored.entries||[]);
            next.moduleHistoryScopesLoaded=[...new Set([...(next.moduleHistoryScopesLoaded||[]),entry.scope.id])];
          }
          const versions=recycleHistoryCollection(next,entry.scope);if(!versions.some(v=>v.id===entry.versionEntry.id))versions.unshift(clone(entry.versionEntry));
          if(['document','directory','card'].includes(entry.scope?.type))restoreHistoryTombstone(next,entry.scope,entry.versionEntry.id);
        }
      }
      const discarded=removedTrash.filter(e=>purged.has(e.trashId)).filter(e=>!Object.keys(e.documents||{[e.id]:e.document}).some(id=>next.documents[id]));
      purgeTrashPayloadsFromState(next,discarded);
      next.coreTextOperations=clone(current.state.coreTextOperations??{});
      if(historyAction?.operationId)next.coreTextOperations[historyAction.operationId]=clone(state.coreTextOperations[historyAction.operationId]);
      const restoreIds=new Set((current.state.coreRestoreLog??[]).map(v=>v.id));
      next.coreRestoreLog=[...(current.state.coreRestoreLog??[]),...(state.coreRestoreLog??[]).filter(v=>!restoreIds.has(v.id))];
      for(const [documentId,doc] of Object.entries(next.documents)) {
        if(unchangedDocuments.has(documentId))continue;
        if (doc.documentKind==='whiteboard') {
          const canvas=doc.canvas;
          validateCanvas(canvas);
          const previous=current.state.documents[documentId]?.canvas;
          const previousIds=new Set((previous?.assets??[]).map(a=>a.id));
          const recallJob=historyAction?.mediaRecall;
          canvas.assets=[...(previous?.assets??[]).map(a=>recallJob&&a.coreGenerationRecall?.jobId===recallJob?canvas.assets.find(v=>v.id===a.id&&v.coreGenerationRecall?.jobId===recallJob)||a:a),...(canvas.assets??[]).filter(a=>!previousIds.has(a.id))];
        } else if(typeof doc.html==='string') {
          doc.html=sanitizeDocumentHtml(doc.html);
          doc.coreRichText={html:doc.html,markdownHash:digest(String(doc.markdown??'').trim())};
        }
      }
      // Directory timestamps are workspace metadata, separate from document snapshots and history deduplication.
      const now=new Date().toISOString(),documentTimes=clone(current.state.coreDocumentTimes??{});
      const directoryContent=doc=>JSON.stringify([doc?.title,doc?.markdown,doc?.html,doc?.canvas?.nodes,doc?.canvas?.edges]);
      for(const [documentId,doc] of Object.entries(next.documents)){
        const previous=current.state.documents[documentId],times=documentTimes[documentId]??{};
        documentTimes[documentId]={createdAt:times.createdAt||previous?.createdAt||previous?.createdAtIso||(!previous?now:null),modifiedAt:!previous||directoryContent(previous)!==directoryContent(doc)?now:times.modifiedAt||previous?.updatedAt||previous?.updatedAtIso||previous?.savedAt||null};
      }
      next.coreDocumentTimes=documentTimes;
      if(historyAction?.moveImport)Object.assign(next.coreDocumentTimes,historyAction.moveImport.times);
      if(historyAction?.syncMerge)next.coreDocumentTimes=clone(historyAction.syncMerge.coreDocumentTimes||{});
      for(const documentId of historyAction?.documentUpdates||[]){
        const after=next.documents[documentId];next.documents[documentId]=clone(current.state.documents[documentId]);
        checkpoint(next,documentId,{source:'migration',operationType:'snapshot',reason:'内置技能升级前完整备份'});
        next.documents[documentId]=after;checkpoint(next,documentId,{source:'migration',operationType:'update',reason:'内置技能升级'});
      }
      let historyReceipt,beforeHistoryReceipt;
      for(const documentId of historyAction?.localDraftDocuments||[]){
        const after=next.documents[documentId],before=current.state.documents[documentId];
        if(before){next.documents[documentId]=clone(before);checkpoint(next,documentId,{source:'user',operationType:'snapshot',reason:'保留本地稿前的磁盘版本'});}
        if(after){next.documents[documentId]=after;checkpoint(next,documentId,{source:'user',operationType:'snapshot',reason:'继续保存本地稿'});}else delete next.documents[documentId];
      }
      if(historyAction?.documentId){
        const {documentId,source,operationType,reason,previousDocument}=historyAction;
        if(previousDocument){
          const after=next.documents[documentId];next.documents[documentId]=previousDocument;
          beforeHistoryReceipt=checkpoint(next,documentId,{source,operationType:'snapshot',reason:'修改前完整备份'});
          next.documents[documentId]=after;
        }
        const doc=next.documents[documentId];
        if(doc.canvas)for(const node of doc.canvas.nodes)snapshotNode(doc.canvas,node);
        historyReceipt=checkpoint(next,documentId,{source,operationType,reason,beforeContent:previousDocument?.markdown});
        if(historyAction.operationId)next.coreTextOperations[historyAction.operationId].historyReceipt=historyReceipt;
      }
      if(historyAction?.directoryScope)checkpointDirectory(next,historyAction.directoryScope);
      if(historyAction?.syncAll)for(const [documentId,doc]of Object.entries(next.documents))if(!doc.deleted)checkpoint(next,documentId,{source:'sync',operationType:'snapshot',reason:historyAction.syncAll==='download'?'云端下载前本机版本':'云端上传前版本'});
      if(historyAction?.deleteVersions)recycleVersions(next,historyAction.deleteVersions);
      for(const item of historyAction?.restoreAssets||[])if(item.documentId&&item.sourceNodeId)restoreHistoryTombstone(next,{type:'card',id:item.documentId,nodeId:item.sourceNodeId},item.assetId);
      if(historyAction?.cleanup)pruneHistory(next,historyAction.cleanup);
      filterDeletedHistory(next);
      if(historyAction?.source==='agent'){const folder=next.documents[historyAction.documentId]?.coreFolderId;for(const scope of ['index',...new Set((next.coreFolders||[]).filter(f=>f.workRole&&f.workRole!=='volume').map(f=>'section:'+f.workRole)),...(folder?[folder]:[])]){const before=directorySnapshot(current.state,scope),after=directorySnapshot(next,scope);if(JSON.stringify(before)!==JSON.stringify(after)){const histories=next.coreDirectoryHistories;const prior={...current.state,coreDirectoryHistories:histories};checkpointDirectory(prior,scope,{reason:'AI 修改前目录备份',source:'agent'});checkpointDirectory(next,scope,{reason:'AI 修改后目录版本',source:'agent'});}}}
      checkSignal(signal);
      // Use the engine's existing transactional delta contract for copies and recycling.
      // Compare complete documents after normalization; never trust caller dirty IDs.
      const writeState=incrementalDocuments?{...next,documentPatch:{mode:'delta-v1',documentIds:Object.keys(next.documents)},documents:Object.fromEntries(Object.entries(next.documents).filter(([key,doc])=>JSON.stringify(doc)!==JSON.stringify(current.state.documents[key])))}:next;
      const receipt=await engine.saveWorkspaceState({...options(id),state:writeState,expectedStateStamp,historyPolicy:'explicit'});
      if(clientId) await clearDraft(id,clientId,draftRevision);
      const loaded=await load(id);
      for(const proof of [beforeHistoryReceipt,historyReceipt].filter(Boolean)){const saved=loaded.state.histories?.[historyAction.documentId]?.find(v=>v.id===proof.versionId);if(!saved)throw fail('历史版本未能回读');assertVersion(saved);}
      const event={id,stateStamp:loaded.stateStamp,source:historyAction?.source||'user',documentIds:[...new Set([...Object.keys(current.state.documents),...Object.keys(next.documents)])].filter(key=>directoryContent(current.state.documents[key])!==directoryContent(next.documents[key]))};
      queueMicrotask(()=>{for(const listener of listeners)try{listener(event);}catch{/* A plugin listener cannot fail a committed save. */}});
      return {...loaded,receipt,historyReceipt,beforeHistoryReceipt};
  }
  const save=(id,payload)=>serial(id,()=>commit(id,payload),payload?.signal);
  const recycleDirectory=(id,{tokens,expectedStateStamp}={})=>serial(id,async()=>{if(!Array.isArray(tokens)||!tokens.length||tokens.length>10000||tokens.some(t=>typeof t!=='string'||! /^(document|folder):[a-zA-Z0-9_.-]+$/.test(t)))throw fail('请选择有效的目录项');const current=await load(id);if(current.stateStamp!==expectedStateStamp)throw fail('笔记本已更新，删除未执行，请刷新后重试','WORKSPACE_STATE_CONFLICT');const next=clone(current.state);if(!recycleSelection(next,tokens))throw fail('所选内容已不存在或不可回收');return commit(id,{state:next,expectedStateStamp},undefined,true,current);});
  const resolveLocalDraft=(id,{baseState,state,clientId,draftRevision}={})=>serial(id,async()=>{
    if(!baseState?.documents||!state?.documents)throw fail('缺少本地稿或原始保存基线');
    const current=await load(id),merged=reconcileWindowState(baseState,state,current.state,{preferLocal:true});
    if(merged.conflict)throw fail('无法核对本地稿基线，原稿已保留','WORKSPACE_STATE_CONFLICT');
    const documentIds=[...new Set([...Object.keys(current.state.documents),...Object.keys(merged.state.documents)])].filter(key=>JSON.stringify(snapshotDocument(current.state.documents[key]||{}))!==JSON.stringify(snapshotDocument(merged.state.documents[key]||{})));
    return commit(id,{state:merged.state,expectedStateStamp:current.stateStamp,clientId,draftRevision},{localDraftDocuments:documentIds});
  });
  const deleteHistory=(id,{scope,versionIds,expectedStateStamp}={})=>serial(id,async()=>{const current=await baseline(id,expectedStateStamp);return commit(id,{state:current.state,expectedStateStamp},{deleteVersions:{scope,versionIds}});});
  const setAssetTrash=(id,{items,trashed,expectedStateStamp})=>serial(id,async()=>{const current=await baseline(id,expectedStateStamp),state=clone(current.state);for(const item of items){const container=item.documentId?state.documents[item.documentId]?.canvas:state;if(!container)throw fail('原白板已不存在');const field=item.documentId?'coreAssetTrash':'coreWorkspaceAssetTrash';container[field]??={};if(trashed)container[field][item.assetId]=new Date().toISOString();else delete container[field][item.assetId];}return commit(id,{state,expectedStateStamp},{restoreAssets:trashed?[]:items});});
  async function cleanupHistory({months=3,now=Date.now()}={}){
    let removed=0;for(const item of await list())await serial(item.id,async()=>{const current=await load(item.id),state=clone(current.state),count=pruneHistory(state,{months,now});if(!count)return;await commit(item.id,{state:current.state,expectedStateStamp:current.stateStamp},{cleanup:{months,now}});removed+=count;});return {removed,months};
  }
  const baseline=async(id,expectedStateStamp)=>{
    const current=await load(id);
    if(current.stateStamp!==expectedStateStamp)throw fail('磁盘内容已变化，请重新载入后再试','WORKSPACE_STATE_CONFLICT');
    return current;
  };
  async function createDocument(id,{expectedStateStamp,kind='note',document:imported,copyFromDocumentId,copyFolderId,source='user',operationId,signal}={}){
    return serial(id,async()=>{
      checkSignal(signal);
      const current=await load(id),state={...current.state,documents:{...current.state.documents},moduleItems:{...current.state.moduleItems,library:[...(current.state.moduleItems.library||[])]},coreTextOperations:{...current.state.coreTextOperations}};
      let requestHash;
      if(copyFromDocumentId!==undefined&&(source!=='user'||imported!==undefined||typeof copyFromDocumentId!=='string'))throw fail('副本来源无效');
      if(copyFolderId!==undefined&&(copyFromDocumentId===undefined||typeof copyFolderId!=='string'||copyFolderId&&!state.coreFolders?.some(f=>f.id===copyFolderId)))throw fail('副本目标文件夹不存在');
      if(source!=='user'){
        requestHash=digest(JSON.stringify({kind,imported}));
        if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||''))throw fail('插件新建需要唯一操作身份');
        const old=state.coreTextOperations?.[operationId];
        if(old){if(old.requestHash!==requestHash)throw fail('操作身份已经用于其他内容');return {...current,documentId:old.documentId,replayed:true};}
      }
      if(current.stateStamp!==expectedStateStamp)throw fail('磁盘内容已变化，请重新载入后再试','WORKSPACE_STATE_CONFLICT');
      if(copyFromDocumentId!==undefined){
        const original=Object.hasOwn(state.documents,copyFromDocumentId)&&state.documents[copyFromDocumentId];if(!original)throw fail('原文档已不存在，未创建副本');
        kind=original.canvas?'whiteboard':'note';
        imported={...original,title:original.title+' 副本',...(copyFolderId!==undefined?{coreFolderId:copyFolderId}:{})};
      }
      if(imported?.coreFolderId!=null&&(typeof imported.coreFolderId!=='string'||imported.coreFolderId&&!state.coreFolders?.some(f=>f.id===imported.coreFolderId)))throw fail('保存目录已不存在，请重新选择');
      const board=kind==='whiteboard',base=String(imported?.title|| (board?'未命名白板':'未命名文档')).trim().slice(0,120);
      const names=new Set(Object.values(state.documents).map(d=>d.title));let title=base,n=2;while(names.has(title))title=base+' '+n++;
      const documentId=(board?'whiteboard-':'note-')+randomUUID();
      const document={...(imported?clone(imported):{}),title,moduleId:'library',documentKind:board?'whiteboard':'note'};
      // Unclassified manual notes default to reference material. Agents must
      // select a concrete directory with documents.folders before creation.
      if(source==='user'&&state.coreWork?.enabled&&!document.coreFolderId)document.coreFolderId=state.coreFolders.find(f=>f.workRole==='library')?.id;
      delete document.contentRef;delete document.sourcePath;delete document.savedAt;delete document.coreRichText;
      if(board)document.canvas??={nodes:[],edges:[],assets:[],viewport:{x:0,y:0,zoom:1},settings:{snapToGrid:true}};
      else {document.markdown??='';document.html??=engine.markdownToHtml(document.markdown);}
      state.documents[documentId]=document;(state.moduleItems.library??=[]).push([documentId,title]);
      Object.assign(state,openDocumentInTabs(state,documentId));
      if(source!=='user')(state.coreTextOperations??={})[operationId]={requestHash,documentId,createdAt:new Date().toISOString()};
      const result=await commit(id,{state,expectedStateStamp,signal},source==='user'?undefined:{documentId,source,operationType:'create',reason:'插件创建正式内容',operationId},true,current);
      if(!result.state.documents[documentId])throw fail('新建文件未能回读');
      return {...result,documentId};
    },signal);
  }
  async function appendAiCard(id,{documentId,text,title='生成文本',operationId,expectedStateStamp}){
    return serial(id,async()=>{
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||'')||typeof text!=='string'||text.length>4000000)throw fail('生成内容或操作身份无效');
      const loaded=await load(id),hash=digest(JSON.stringify({documentId,text,title})),old=loaded.state.coreTextOperations?.[operationId];
      if(old){if(old.requestHash!==hash)throw fail('操作身份已用于其他内容');return {...loaded,replayed:true};}
      if(loaded.stateStamp!==expectedStateStamp)throw fail('白板已变化','WORKSPACE_STATE_CONFLICT');
      const state=loaded.state,document=state.documents[documentId];if(!document?.canvas)throw fail('请选择白板');
      const previousDocument=clone(document),nodes=document.canvas.nodes;
      const node={id:'node-'+randomUUID(),type:'text',name:String(title).slice(0,120),text,x:nodes.length?Math.max(...nodes.map(n=>n.x+n.width))+60:40,y:40,width:400,height:300};await stampNewCards([node]);nodes.push(node);
      (state.coreTextOperations??={})[operationId]={requestHash:hash,documentId,nodeId:node.id,createdAt:new Date().toISOString()};
      return commit(id,{state,expectedStateStamp},{documentId,source:'agent',operationType:'append',reason:'AI 新增文本卡片',previousDocument,operationId});
    });
  }
  async function editMedia(id,{documentId,nodeId,operationId,action,expectedStateStamp,startMs,endMs,position,currentTimeMs,imageBase64}={}){
    return serial(id,async()=>{
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||''))throw fail('媒体编辑需要唯一操作身份');
      const loaded=await load(id),state=loaded.state,requestHash=digest(JSON.stringify({documentId,nodeId,action,startMs,endMs,position,currentTimeMs,imageBase64})),prior=state.coreTextOperations?.[operationId];
      if(prior){if(prior.requestHash!==requestHash)throw fail('操作身份已用于其他媒体编辑');return {...loaded,replayed:true,documentId};}
      if(loaded.stateStamp!==expectedStateStamp)throw fail('白板已变化，请重新读取','WORKSPACE_STATE_CONFLICT');
      const doc=state.documents[documentId],node=doc?.canvas?.nodes.find(n=>n.id===nodeId);
      if(!node?.file||node.type!=='file')throw fail('请选择真实媒体卡片');
      const previousDocument=clone(doc),input={...options(id),relativePath:node.file,whiteboardDocumentId:documentId};let results;
      if(action==='separate'&&node.kind==='video'){const result=await engine.separateWorkspaceVideoAudio(input);results=[result.silentVideo,result.audio];}
      else if(action==='trim'&&['video','audio'].includes(node.kind)){if(!Number.isFinite(startMs)||!Number.isFinite(endMs))throw fail('截取时间无效');const result=await engine[node.kind==='video'?'trimWorkspaceVideo':'trimWorkspaceAudio']({...input,startMs,endMs});results=[result.attachment];}
      else if(action==='frame'&&node.kind==='video'){const result=await engine.extractWorkspaceVideoFrame({...input,position,currentTimeMs});results=[result.attachment];}
      else if(action==='image'&&node.kind==='image'){if(typeof imageBase64!=='string'||imageBase64.length>55*1024*1024)throw fail('图片编辑结果无效');results=[await engine.saveWorkspaceAttachment({...options(id),name:'编辑-'+String(node.name||'图片').replace(/\.[^.]+$/,'')+'.png',mimeType:'image/png',base64:imageBase64,requireValidImage:true,whiteboardDocumentId:documentId,whiteboardMediaKind:'image'})];}
      else throw fail('媒体类型不支持该编辑操作');
      const nodeIds=[];for(const [index,asset] of results.entries()){
        await engine.readWorkspaceAttachmentContent({...options(id),relativePath:asset.relativePath,documentId});
        const next={id:'node-'+randomUUID(),type:'file',kind:String(asset.mimeType).split('/')[0],name:asset.name||'处理结果',file:asset.relativePath,mimeType:asset.mimeType,x:node.x+node.width+100,y:node.y+index*(node.height+70),width:node.width,height:node.height,coreMediaEdit:{sourceNodeId:nodeId,operationId,action}};
        doc.canvas.nodes.push(next);doc.canvas.edges.push({id:'edge-'+randomUUID(),fromNode:nodeId,toNode:next.id});nodeIds.push(next.id);
      }
      (state.coreTextOperations??={})[operationId]={requestHash,documentId,nodeIds,createdAt:new Date().toISOString()};
      return {...await commit(id,{state,expectedStateStamp},{documentId,previousDocument,source:'user',operationType:'media-edit',reason:'本地媒体编辑',operationId}),documentId,nodeIds};
    });
  }
  async function replaceCard(id,{documentId,nodeId,source,operationId,expectedStateStamp,selectionHash}={}){
    return serial(id,async()=>{
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||''))throw fail('替换需要唯一操作身份');
      const loaded=await load(id),requestHash=digest(JSON.stringify({documentId,nodeId,source})),prior=loaded.state.coreTextOperations?.[operationId];
      if(prior){if(prior.requestHash!==requestHash)throw fail('操作身份已用于其他替换');return {...loaded,documentId,replayed:true};}
      if(loaded.stateStamp!==expectedStateStamp)throw fail('白板已变化，请重新选择','WORKSPACE_STATE_CONFLICT');
      const state=loaded.state,doc=state.documents[documentId],node=doc?.canvas?.nodes.find(n=>n.id===nodeId);
      if(!node||!['image','video','audio'].includes(source?.kind)||!source.file)throw fail('请选择图片、视频或音频资产');
      const info=await engine.readWorkspaceAttachmentContent({...options(id),relativePath:source.file,documentId});
      if(!String(info.mimeType||'').startsWith(source.kind+'/'))throw fail('素材类型与实际附件不一致');
      const previousDocument=clone(doc);snapshotNode(doc.canvas,node);
      for(const key of ['generation','attachment','url','reference','bookReference','coreLinkedDocument','operation','durationMs','videoWidth','videoHeight','aspectRatio'])delete node[key];
      Object.assign(node,{type:'file',kind:source.kind,file:source.file,name:source.name||'替换素材',text:'',mimeType:info.mimeType});
      for(const key of ['durationMs','videoWidth','videoHeight','aspectRatio'])if(source[key]!==undefined)node[key]=source[key];
      const ratio=source.videoWidth/source.videoHeight||source.width/source.height;
      if(source.kind!=='audio'&&Number.isFinite(ratio)&&ratio>0)node.height=node.width/ratio;
      snapshotNode(doc.canvas,node);(state.coreTextOperations??={})[operationId]={requestHash,selectionHash,documentId,nodeId,createdAt:new Date().toISOString()};
      return {...await commit(id,{state,expectedStateStamp},{documentId,previousDocument,source:'user',operationType:'replace-card',reason:'替换卡片内容',operationId}),documentId,nodeId};
    });
  }
  async function saveVersion(id,{documentId,expectedStateStamp}={}){
    return serial(id,async()=>{
      const current=await baseline(id,expectedStateStamp);
      return commit(id,{state:current.state,expectedStateStamp},{documentId,source:'user',operationType:'snapshot',reason:'手动保存历史版本'});
    });
  }
  async function saveMergedDocuments(id,{state,expectedStateStamp,documentMerges=[],documentUpdates=[]}={}){
    return serial(id,async()=>{
      if(!Array.isArray(documentMerges)||documentMerges.some(merge=>!merge?.primaryId||!Array.isArray(merge.duplicateIds)))throw fail('文档合并合同无效');
      const current=await baseline(id,expectedStateStamp),requested=new Set();
      if(!Array.isArray(documentUpdates)||new Set(documentUpdates).size!==documentUpdates.length||documentUpdates.some(key=>!current.state.coreKnowledgeBase||!current.state.documents[key]||!state?.documents?.[key]||!state.documents[key].coreSkillSourceId))throw fail('技能升级历史合同无效');
      for(const merge of documentMerges){
        const primary=current.state.documents[merge.primaryId];if((!primary&&!merge.routeArchive)||!state?.documents?.[merge.primaryId])throw fail('文档合并主文档不存在');
        for(const duplicateId of merge.duplicateIds){if(duplicateId===merge.primaryId||requested.has(duplicateId)||!current.state.documents[duplicateId]||state.documents[duplicateId])throw fail('文档合并副本身份无效');requested.add(duplicateId);}
      }
      return commit(id,{state,expectedStateStamp},{documentMerges,documentUpdates});
    });
  }
  async function saveDirectoryVersion(id,{scope='index',expectedStateStamp}){return serial(id,async()=>{const current=await baseline(id,expectedStateStamp);directorySnapshot(current.state,scope);return commit(id,{state:current.state,expectedStateStamp},{directoryScope:scope});});}
  async function restoreDirectoryVersion(id,{scope='index',versionId,expectedStateStamp}){return serial(id,async()=>{
    const current=await baseline(id,expectedStateStamp),entry=current.state.coreDirectoryHistories?.[scope]?.find(v=>v.id===versionId);
    if(!verifyDirectoryVersion(entry))throw fail('目录历史版本校验失败');
    const state=clone(current.state),before=directorySnapshot(state,scope),affected=new Set([...Object.keys(before.documents),...Object.keys(entry.snapshot.documents)]);
    checkpointDirectory(state,scope,{reason:'恢复前完整目录'});
    for(const docId of Object.keys(before.documents)){
      checkpoint(state,docId,{reason:'目录恢复前备份'});
      if(!entry.snapshot.documents[docId]){(state.trash??=[]).push({id:docId,trashId:randomUUID(),kind:'file',title:state.documents[docId].title,document:clone(state.documents[docId]),deletedAtIso:new Date().toISOString()});delete state.documents[docId];}
    }
    state.coreFolders=(state.coreFolders||[]).filter(f=>!before.folders.some(v=>v.id===f.id)&&!entry.snapshot.folders.some(v=>v.id===f.id)).concat(clone(entry.snapshot.folders));
    for(const [docId,doc] of Object.entries(entry.snapshot.documents)){
      const prior=state.documents[docId],restored=clone(doc);if(restored.canvas)restored.canvas.viewport=clone(prior?.canvas?.viewport||{x:0,y:0,zoom:1});
      state.documents[docId]={...prior,...restored};checkpoint(state,docId,{reason:'采用目录历史'});
    }
    state.moduleItems??={};
    const memberships=entry.snapshot.moduleItems||Object.fromEntries(Object.entries(state.moduleItems).map(([module,items])=>[module,(items||[]).filter(item=>affected.has(item[0])&&state.documents[item[0]])]));
    for(const module of new Set([...Object.keys(state.moduleItems||{}),...Object.keys(memberships)]))state.moduleItems[module]=[...(state.moduleItems[module]||[]).filter(item=>!affected.has(item[0])),...clone(memberships[module]||[])];
    const registered=new Set(Object.values(state.moduleItems).flat().map(item=>item[0]));
    for(const [docId,doc] of Object.entries(entry.snapshot.documents))if(!registered.has(docId))(state.moduleItems.library??=[]).push([docId,doc.title]);
    Object.assign(state,normalizeDocumentTabState(state));
    return commit(id,{state,expectedStateStamp},{directoryRestore:state});
  });}
  async function stageMapMedia(id,{operationId,nodes,signal}){return serial(id,async()=>{
    if(!/^[\w-]{1,100}$/.test(operationId)||!Array.isArray(nodes)||!nodes.length||nodes.length>10)throw fail('地图资产任务无效');
    const loaded=await load(id),state=loaded.state,requestHash=digest(JSON.stringify(nodes)),old=state.coreTextOperations?.[operationId];
    if(old){if(old.requestHash!==requestHash)throw fail('地图任务身份冲突');return loaded;}
    const canvas=state.coreMapMediaCanvas??={nodes:[],edges:[],assets:[]};
    validateCanvas({nodes,edges:[]});for(const node of nodes){if(canvas.nodes.some(n=>n.id===node.id))throw fail('地图资产节点重复');canvas.nodes.push(clone(node));}
    (state.coreTextOperations??={})[operationId]={requestHash,createdAt:new Date().toISOString()};
    return commit(id,{state,expectedStateStamp:loaded.stateStamp,signal},{operationId,mapAssets:true});
  },signal);}
  // A recalled result becomes a historical asset, never a late write into the
  // current card. The ordinary history adoption path owns any later overwrite.
  async function saveMediaRecall(id,{documentId,nodeId,jobId,channel,prompt='',createdAt,result,recallState='pending',signal}){
    return serial(id,async()=>{
      signal?.throwIfAborted();if(!/^[\w-]{1,100}$/.test(jobId)||!['pending','recalled','cancelled'].includes(recallState))throw fail('召回记录无效');
      const loaded=await load(id),doc=mediaTargetDocument(loaded.state,documentId),node=doc?.canvas?.nodes.find(n=>n.id===nodeId);
      if(!doc?.canvas)throw fail('原白板已不存在，原任务记录保留','MEDIA_DOCUMENT_MISSING');
      const assets=doc.canvas.assets??=[],old=assets.filter(a=>a.coreGenerationRecall?.jobId===jobId);
      if(recallState!=='cancelled'&&old.some(a=>a.coreGenerationRecall.state==='cancelled'))throw fail('已放弃找回此任务','MEDIA_RECALL_CANCELLED');
      if(recallState==='pending'&&old.length)return loaded;
      const attachments=result?.attachments||[result?.attachment].filter(Boolean),text=result?.text;
      if(recallState==='recalled'&&!attachments.length&&!text?.trim())throw fail('尚未取得有效成品，原记录保留','MEDIA_RESULT_NOT_READY');
      for(const attachment of attachments){const info=await engine.readWorkspaceAttachmentContent({...options(id),relativePath:attachment.relativePath,documentId}),bytes=await readFile(info.absolutePath);if(!attachment.sha256||digest(bytes)!==attachment.sha256||bytes.length!==attachment.size)throw fail('成品文件校验失败，未写入历史','MEDIA_READBACK_FAILED');}
      const previousDocument=clone(doc),count=Math.max(1,attachments.length,recallState==='cancelled'?old.length:0);
      for(let index=0;index<count;index++){
        const entryId='recall-'+jobId+'-'+index,entry=assets.find(a=>a.id===entryId)||{id:entryId,kind:'text',origin:'generated',source:'agent',sourceNodeId:nodeId,nodeName:node?.name||old[0]?.nodeName||'原生成卡片',createdAt:createdAt||new Date().toISOString(),prompt};
        if(!assets.includes(entry))assets.push(entry);
        entry.coreGenerationRecall={jobId,state:recallState};
        if(recallState==='recalled'){if(attachments[index]){entry.kind=channel;entry.attachment=clone(attachments[index]);delete entry.text;}if(typeof text==='string'){entry.kind='text';entry.text=text;}delete entry.coreNodeSnapshot;}
        else if(!entry.attachment&&(!entry.text||entry.text==='成品尚未取回，点击召回读取原结果。'))entry.text=recallState==='cancelled'?'已放弃成品找回':'成品尚未取回，点击召回读取原结果。';
      }
      return commit(id,{state:loaded.state,expectedStateStamp:loaded.stateStamp,signal},{documentId,mediaRecall:jobId,source:'agent',operationType:'media-recall-history',reason:recallState==='cancelled'?'放弃成品召回':recallState==='recalled'?'原成品召回到历史版本':'原生成转入卡片历史',previousDocument});
    },signal);
  }
  async function applyGeneratedTextResult(id,{documentId,nodeId,jobId,text,baseNode,signal}){
    return serial(id,async()=>{
      signal?.throwIfAborted();
      if(typeof text!=='string'||!text.trim())throw fail('网页未返回有效文本，未修改卡片','TEXT_RESULT_EMPTY');
      const loaded=await load(id),state=loaded.state,doc=state.documents[documentId],node=doc?.canvas?.nodes.find(n=>n.id===nodeId);
      if(!node)throw fail('原卡片已移除，文本成品保留在任务中','MEDIA_CARD_MISSING');
      const operationId='media-'+jobId,requestHash=digest(JSON.stringify({documentId,nodeId,jobId,text}));
      const old=state.coreTextOperations?.[operationId];
      if(old){if(old.requestHash!==requestHash)throw fail('文本结果身份冲突');return {...loaded,replayed:true};}
      const content=n=>JSON.stringify([n?.type,n?.text||'',n?.file||'']);
      if(!baseNode||content(node)!==content(baseNode))throw fail('生成期间卡片内容已修改，文本成品已保留；请先处理冲突','MEDIA_CARD_CONFLICT');
      const previousDocument=clone(doc);snapshotNode(doc.canvas,node);
      Object.assign(node,{type:'text',kind:'text',text,coreMediaJobId:jobId});delete node.file;delete node.mimeType;
      (state.coreTextOperations??={})[operationId]={requestHash,documentId,nodeId,jobId,createdAt:new Date().toISOString()};
      const result=await commit(id,{state,expectedStateStamp:loaded.stateStamp,signal},{documentId,operationId,source:'agent',operationType:'replace',reason:'AI 文本结果落板',previousDocument});
      const saved=result.state.documents[documentId]?.canvas?.nodes.find(n=>n.id===nodeId);
      if(saved?.text!==text||saved?.coreMediaJobId!==jobId)throw fail('文本事务回读失败','MEDIA_READBACK_FAILED');
      return result;
    },signal);
  }
  async function applyMediaResult(id,{documentId,nodeId,jobId,channel,attachments,baseNode,signal,incremental=false}){
    return serial(id,async()=>{
      const loaded=await load(id),state=loaded.state,doc=mediaTargetDocument(state,documentId),node=doc?.canvas?.nodes.find(n=>n.id===nodeId),assetOnly=documentId===MAP_ASSET_DOCUMENT;
      if(!node)throw fail('原卡片已移除，生成结果保留在任务中','MEDIA_CARD_MISSING');
      const operationId='media-'+jobId,requestHash=digest(JSON.stringify({documentId,nodeId,jobId,attachments}));
      const old=state.coreTextOperations?.[operationId];
      const imageIncrement=incremental===true&&channel==='image';
      const fingerprints=(attachments||[]).map(a=>JSON.stringify([a.relativePath,a.sha256,a.size]));
      if(old?.requestHash===requestHash)return {...loaded,replayed:true};
      if(imageIncrement&&old?.incremental&&JSON.stringify(old.attachments)===JSON.stringify(fingerprints))return {...loaded,replayed:true};
      if(old&&(!imageIncrement||!old.incremental||!Array.isArray(old.attachments)||old.attachments.length>=fingerprints.length||old.attachments.some((v,i)=>v!==fingerprints[i])))throw fail('媒体结果身份冲突');
      const content=n=>JSON.stringify([n.type,n.text||'',n.file||'']);
      const expected=old?old.cardContent:content(baseNode);
      if(content(node)!==expected||old&&node.coreMediaJobId!==jobId)throw fail('生成期间卡片内容已被修改，结果已保留，请另存为新卡片','MEDIA_CARD_CONFLICT');
      if(!attachments?.length)throw fail('任务没有可回读的媒体文件');
      for(const attachment of attachments){
        const info=await engine.readWorkspaceAttachmentContent({...options(id),relativePath:attachment.relativePath,documentId});
        const bytes=await readFile(info.absolutePath);
        if(!attachment.sha256||digest(bytes)!==attachment.sha256||bytes.length!==attachment.size)throw fail('媒体文件哈希或大小回读不一致','MEDIA_READBACK_FAILED');
      }
      const previousDocument=clone(doc);if(!old)snapshotNode(doc.canvas,node);
      const first=attachments[0];Object.assign(node,{type:'file',file:first.relativePath,kind:channel,mimeType:first.mimeType,coreMediaJobId:jobId});delete node.text;delete node.coreSelectedVersionId;
      doc.canvas.assets??=[];
      for(const [index,attachment] of attachments.entries()){
        if(index<(old?.attachments?.length||0))continue;
        const entry={id:jobId+'-'+index,kind:channel,origin:'generated',source:'agent',sourceNodeId:nodeId,nodeName:node.name,generationJobId:jobId,attachment:clone(attachment),createdAt:new Date().toISOString()};
        (assetOnly?(state.workspaceAssets??=[]):doc.canvas.assets).push(entry);
      }
      (state.coreTextOperations??={})[operationId]={requestHash,documentId,nodeId,jobId,createdAt:old?.createdAt||new Date().toISOString(),...(imageIncrement?{incremental:true,attachments:fingerprints,cardContent:content(node)}:{})};
      return commit(id,{state,expectedStateStamp:loaded.stateStamp,signal},assetOnly?{operationId,mapAssets:true}:{documentId,operationId,source:'agent',operationType:'replace',reason:'AI 媒体结果落板',previousDocument});
    },signal);
  }
  async function applyDocumentMediaResult(id,{documentId,jobId,channel,attachments,baseDocument,anchorId,artifactId,signal}){
    return serial(id,async()=>{
      const loaded=await load(id),state=loaded.state,doc=state.documents[documentId];
      if(!doc||doc.canvas)throw fail('原文档已移除，生成结果保留在任务中','MEDIA_DOCUMENT_MISSING');
      const operationId='media-'+jobId,requestHash=digest(JSON.stringify({documentId,jobId,attachments,anchorId,artifactId}));
      const old=state.coreTextOperations?.[operationId];
      if(old){if(old.requestHash!==requestHash)throw fail('媒体结果身份冲突');return {...loaded,replayed:true};}
      const content=d=>JSON.stringify([d.markdown??'',d.html??'']);
      if(!baseDocument||content(doc)!==content(baseDocument))throw fail('生成期间正文已修改，结果保留待采用','MEDIA_DOCUMENT_CONFLICT');
      if(!anchorId||!artifactId||!attachments?.length||!['image','video','audio'].includes(channel))throw fail('文档媒体目标无效');
      for(const attachment of attachments){
        const info=await engine.readWorkspaceAttachmentContent({...options(id),relativePath:attachment.relativePath,documentId});
        const bytes=await readFile(info.absolutePath);
        if(!attachment.sha256||digest(bytes)!==attachment.sha256||bytes.length!==attachment.size)throw fail('媒体文件哈希或大小回读不一致','MEDIA_READBACK_FAILED');
        if(!String(attachment.mimeType||'').startsWith(channel+'/'))throw fail('文档媒体类型不一致','MEDIA_READBACK_FAILED');
      }
      const previousDocument=clone(doc),escape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      const blocks=attachments.map(a=>{const path=escape(a.relativePath);return '<figure>'+(channel==='image'?'<img src="'+path+'" data-attachment-path="'+path+'" alt="AI 生成图片">':'<'+channel+' controls src="'+path+'" data-attachment-path="'+path+'"></'+channel+'>')+'</figure>';});
      doc.html=(doc.html||engine.markdownToHtml(doc.markdown||''))+blocks.join('');
      doc.markdown=String(doc.markdown??'')+'\n\n'+attachments.map(a=>channel==='image'?'![AI 生成图片]('+a.relativePath+')':'![['+a.relativePath+']]').join('\n\n');
      (doc.coreMediaArtifacts??=[]).push({jobId,anchorId,artifactId,channel,attachments:clone(attachments)});
      (state.coreTextOperations??={})[operationId]={requestHash,documentId,jobId,createdAt:new Date().toISOString()};
      const result=await commit(id,{state,expectedStateStamp:loaded.stateStamp,signal},{documentId,operationId,source:'agent',operationType:'append',reason:'AI 媒体结果写入文档',previousDocument});
      const saved=result.state.documents[documentId];
      if(!saved.coreMediaArtifacts?.some(a=>a.jobId===jobId)||attachments.some(a=>!saved.markdown.includes(a.relativePath)||!saved.html.includes(escape(a.relativePath))))throw fail('文档媒体事务回读失败','MEDIA_READBACK_FAILED');
      return result;
    },signal);
  }
  // User-requested URL import has its own transaction. Model result/credential
  // workflows are deliberately not used by this path.
  async function stageVideoPreview(id,{documentId,output,signal}){return serial(id,async()=>{
    checkSignal(signal);const live=await load(id);if(!live.state.documents[documentId]?.canvas)throw fail('原白板已不存在');
    if(!['image','video','audio'].includes(output?.kind)||!String(output.mimeType||'').startsWith(output.kind+'/'))throw fail('暂存媒体类型不符');
    const attachment=await engine.saveWorkspaceAttachmentFromPath({...options(id),sourcePath:output.path,name:output.name,mimeType:output.mimeType,requirePlayableMedia:output.kind!=='image'&&!hasDecodedParserMedia(output),requireValidImage:output.kind==='image',whiteboardDocumentId:documentId,whiteboardMediaKind:output.kind});
    checkSignal(signal);if(attachment.sha256!==output.sha256||attachment.size!==output.size)throw fail('暂存附件回读校验失败');return attachment;
  },signal);}
  async function importBoardMedia(id,{documentId,nodeId='',baseNode,point,operationId,output,stagedAttachment,signal}){
    return serial(id,async()=>{
      checkSignal(signal);if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||''))throw fail('下载落板缺少操作身份');
      const loaded=await load(id),state=loaded.state,requestHash=digest(JSON.stringify({documentId,nodeId,baseNode,point,output})),prior=state.coreTextOperations?.[operationId];
      if(prior){if(prior.requestHash!==requestHash)throw fail('下载操作身份已用于其他内容');return {...loaded,nodeId:prior.nodeId,replayed:true};}
      const doc=state.documents[documentId];if(!doc?.canvas)throw fail('原白板已不存在，下载结果保留');
      let node=nodeId?doc.canvas.nodes.find(n=>n.id===nodeId):null;
      if(nodeId&&(!node||node.file||String(node.text||'').trim()||node.operation?.type==='depth-explorer'||digest(JSON.stringify(node))!==digest(JSON.stringify(baseNode))))throw fail('原空白卡片已变化，下载结果保留，请重新选择落板位置','WORKSPACE_STATE_CONFLICT');
      if(!nodeId&&(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)))throw fail('落板位置无效');
      if(output?.kind!=='file'&&(!['image','video','audio'].includes(output?.kind)||!String(output.mimeType||'').startsWith(output.kind+'/')))throw fail('下载媒体类型不符');
      let attachment;
      if(stagedAttachment){
        // A parser preview is already an imported, fully decoded attachment.
        // Verify its bytes again, then commit that exact file instead of copying
        // and decoding an eight-minute video a second time on "转存到卡片".
        if(stagedAttachment.sha256!==output.sha256||stagedAttachment.size!==output.size||stagedAttachment.mimeType!==output.mimeType)throw fail('暂存附件与下载结果不一致');
        const info=await engine.readWorkspaceAttachmentContent({...options(id),relativePath:stagedAttachment.relativePath,documentId}),hash=createHash('sha256');let size=0;
        for await(const bytes of createReadStream(info.absolutePath)){checkSignal(signal);size+=bytes.length;hash.update(bytes);}
        if(size!==output.size||hash.digest('hex')!==output.sha256)throw fail('暂存附件已变化，未写入卡片');attachment=clone(stagedAttachment);
      }else attachment=await engine.saveWorkspaceAttachmentFromPath({...options(id),sourcePath:output.path,name:output.name,mimeType:output.mimeType,requirePlayableMedia:['video','audio'].includes(output.kind)&&!hasDecodedParserMedia(output),requireValidImage:output.kind==='image',whiteboardDocumentId:documentId,whiteboardMediaKind:output.kind});
      checkSignal(signal);if(attachment.sha256!==output.sha256||attachment.size!==output.size)throw fail('下载文件哈希或大小回读不一致');
      const previousDocument=clone(doc);if(node)snapshotNode(doc.canvas,node);else{node={id:operationId+'-card',x:point.x,y:point.y,width:360,height:240};await stampNewCards([node]);doc.canvas.nodes.push(node);}
      Object.assign(node,{type:'file',kind:output.kind,file:attachment.relativePath,name:output.name,mimeType:attachment.mimeType,text:'',coreVideoImportId:operationId});
      for(const key of ['durationMs','videoWidth','videoHeight','imageWidth','imageHeight','thumbnailRelativePath'])if(attachment[key]!==undefined)node[key]=attachment[key];
      const ratio=(attachment.videoWidth||attachment.imageWidth)/(attachment.videoHeight||attachment.imageHeight);if(output.kind!=='audio'&&Number.isFinite(ratio)&&ratio>0)node.height=node.width/ratio;
      snapshotNode(doc.canvas,node);(doc.canvas.assets??=[]).push({id:operationId+'-asset',kind:output.kind,origin:'upload',source:'video-parser',sourceNodeId:node.id,nodeName:node.name,attachment:clone(attachment),createdAt:new Date().toISOString()});
      (state.coreTextOperations??={})[operationId]={requestHash,documentId,nodeId:node.id,createdAt:new Date().toISOString()};
      return {...await commit(id,{state,expectedStateStamp:loaded.stateStamp,signal},{documentId,previousDocument,operationId,source:'user',operationType:'video-import',reason:'解析视频下载落板'}),nodeId:node.id};
    },signal);
  }
  async function appendMediaNodes(id,{documentId,expectedStateStamp,operationId,nodes=[],edges=[],drafts={},signal}){
    return serial(id,async()=>{
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||''))throw fail('媒体落板缺少操作身份');
      if(!drafts||typeof drafts!=='object'||Array.isArray(drafts))throw fail('媒体生成草稿无效');
      const loaded=await load(id),requestHash=digest(JSON.stringify({documentId,nodes,edges,...(Object.keys(drafts).length?{drafts}:{})})),prior=loaded.state.coreTextOperations?.[operationId];
      if(prior){if(prior.requestHash!==requestHash)throw fail('操作编号冲突');return {...loaded,replayed:true};}
      if(loaded.stateStamp!==expectedStateStamp)throw fail('白板已变化，请重试采用','WORKSPACE_STATE_CONFLICT');
      const state=loaded.state,doc=state.documents[documentId];if(!doc?.canvas)throw fail('目标不是白板');if(!nodes.length||nodes.length>30||edges.length>60)throw fail('媒体落板数量无效');
      const previousDocument=clone(doc),ids=new Set(doc.canvas.nodes.map(n=>n.id));
      for(const node of nodes){if(ids.has(node.id)||node.type!=='file'||!['image','video','audio'].includes(node.kind))throw fail('只能追加新的媒体卡片');await engine.readWorkspaceAttachmentContent({...options(id),relativePath:node.file,documentId});ids.add(node.id);doc.canvas.nodes.push(clone(node));}
      await stampNewCards(doc.canvas.nodes.slice(-nodes.length));
      const edgeIds=new Set(doc.canvas.edges.map(e=>e.id));for(const edge of edges){if(!edge.id||edgeIds.has(edge.id)||!ids.has(edge.fromNode)||!ids.has(edge.toNode))throw fail('连线端点无效');edgeIds.add(edge.id);doc.canvas.edges.push(clone(edge));}
      for(const [nodeId,draft] of Object.entries(drafts)){
        const node=nodes.find(n=>n.id===nodeId);
        if(!node||!draft||draft.channel!==node.kind||typeof draft.prompt!=='string'||draft.prompt.length>4000000||!Array.isArray(draft.references)||new Set(draft.references).size!==draft.references.length||draft.references.some(ref=>ref===nodeId||!ids.has(ref)))throw fail('媒体生成草稿或参考身份无效');
        (doc.canvas.coreGenerationDrafts??={})[nodeId]=mergeBoardGenerationDraft({},draft);
      }
      (state.coreTextOperations??={})[operationId]={requestHash,documentId,createdAt:new Date().toISOString()};return commit(id,{state,expectedStateStamp,signal},{documentId,operationId,source:'agent',operationType:'append',reason:'本地生成媒体落板',previousDocument});
    },signal);
  }
  async function bindBoardDraft(id,{documentId,nodeId,expectedStateStamp,operationId,draft,signal}){
    return serial(id,async()=>{
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||''))throw fail('参考写入缺少操作身份');
      const loaded=await load(id),requestHash=digest(JSON.stringify({documentId,nodeId,draft})),prior=loaded.state.coreTextOperations?.[operationId];
      if(prior){if(prior.requestHash!==requestHash)throw fail('参考操作编号冲突');return {...loaded,replayed:true,documentId};}
      if(loaded.stateStamp!==expectedStateStamp)throw fail('白板内容已变化，请重新读取','WORKSPACE_STATE_CONFLICT');
      const doc=loaded.state.documents[documentId],canvas=doc?.canvas;
      if(!canvas?.nodes.some(n=>n.id===nodeId)||!['image','video','audio'].includes(draft?.channel)||typeof draft.prompt!=='string'||draft.prompt.length>4000000||!Array.isArray(draft.references)||new Set(draft.references).size!==draft.references.length||draft.references.some(ref=>ref===nodeId||!canvas.nodes.some(n=>n.id===ref)))throw fail('卡片或参考草稿无效');
      const previousDocument=clone(doc);canvas.coreGenerationDrafts??={};
      canvas.coreGenerationDrafts[nodeId]=mergeBoardGenerationDraft(canvas.coreGenerationDrafts[nodeId]||{},draft);
      (loaded.state.coreTextOperations??={})[operationId]={requestHash,documentId,createdAt:new Date().toISOString()};
      return {...await commit(id,{state:loaded.state,expectedStateStamp,signal},{documentId,operationId,source:'agent',operationType:'reference-binding',reason:'插入提示词真实参考',previousDocument}),documentId};
    },signal);
  }
  async function applyBoardPatch(id,{documentId,expectedStateStamp,operationId,nodes=[],edges=[],drafts={},signal}){
    return serial(id,async()=>{
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||''))throw fail('白板写入缺少操作身份');
      const loaded=await load(id),requestHash=digest(JSON.stringify({documentId,nodes,edges,drafts})),prior=loaded.state.coreTextOperations?.[operationId];
      if(prior){if(prior.requestHash!==requestHash)throw fail('操作编号冲突');return {...loaded,replayed:true};}
      if(loaded.stateStamp!==expectedStateStamp)throw fail('白板内容已变化，请重新读取','WORKSPACE_STATE_CONFLICT');
      const state=loaded.state,doc=state.documents[documentId];if(!doc?.canvas)throw fail('目标不是白板');
      const previousDocument=clone(doc),canvas=doc.canvas,ids=new Set(canvas.nodes.map(n=>n.id));
      if(!Array.isArray(nodes)||!Array.isArray(edges)||nodes.length>100||edges.length>200)throw fail('白板批次太大');
      for(const node of nodes){if(ids.has(node.id)||node.type!=='text'||typeof node.text!=='string'||node.text.length>4000000)throw fail('只能追加新的文本卡片');ids.add(node.id);canvas.nodes.push(clone(node));}
      if(nodes.length)await stampNewCards(canvas.nodes.slice(-nodes.length));
      const edgeIds=new Set(canvas.edges.map(e=>e.id));for(const edge of edges){if(!edge.id||edgeIds.has(edge.id)||!ids.has(edge.fromNode)||!ids.has(edge.toNode))throw fail('连线身份或端点无效');edgeIds.add(edge.id);canvas.edges.push(clone(edge));}
      canvas.coreGenerationDrafts??={};for(const [nodeId,draft] of Object.entries(drafts)){
        const existing=!nodes.some(n=>n.id===nodeId);
        if(!ids.has(nodeId)||!draft||typeof draft.prompt!=='string'||draft.prompt.length>4000000||!Array.isArray(draft.references)||new Set(draft.references).size!==draft.references.length||draft.references.some(id=>id===nodeId||!ids.has(id))||(existing&&!['image','video','audio'].includes(draft.channel)))throw fail('生成草稿或参考身份无效');
        canvas.coreGenerationDrafts[nodeId]=existing?mergeBoardGenerationDraft(canvas.coreGenerationDrafts[nodeId]||{},draft):clone(draft);
      }
      (state.coreTextOperations??={})[operationId]={requestHash,documentId,createdAt:new Date().toISOString()};
      return commit(id,{state,expectedStateStamp,signal},{documentId,operationId,source:'agent',operationType:'append',reason:'Agent 白板追加',previousDocument});
    },signal);
  }
  async function editBoard(id,{documentId,expectedStateStamp,operationId,patch,signal}){
    return serial(id,async()=>{
      checkSignal(signal);
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||''))throw fail('白板编辑缺少操作身份');
      const loaded=await load(id),requestHash=digest(JSON.stringify({documentId,patch})),prior=loaded.state.coreTextOperations?.[operationId];
      if(prior){if(prior.requestHash!==requestHash)throw fail('白板编辑身份冲突');return {...loaded,documentId,nodeIds:prior.nodeIds||[],replayed:true};}
      if(loaded.stateStamp!==expectedStateStamp)throw fail('白板已变化，请重新读取；未覆盖人工修改','WORKSPACE_STATE_CONFLICT');
      const previousDocument=loaded.state.documents[documentId];if(!previousDocument?.canvas)throw fail('目标不是白板');
      const edited=editAgentBoard(previousDocument,patch);
      loaded.state.documents[documentId]=edited.document;
      (loaded.state.coreTextOperations??={})[operationId]={requestHash,documentId,nodeIds:edited.nodeIds,createdAt:new Date().toISOString()};
      return {...await commit(id,{state:loaded.state,expectedStateStamp,signal},{documentId,operationId,source:'agent',operationType:'board-edit',reason:'对话编辑白板',previousDocument}),documentId,nodeIds:edited.nodeIds};
    },signal);
  }
  async function applyTextEdit(id,{documentId,nodeId,expectedStateStamp,expectedDocument,operationId,scope='full',start,end,expectedText,text,richText,signal}={}){
    return serial(id,async()=>{
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId||''))throw fail('文本写入需要唯一操作身份');
      if(typeof text!=='string'||text.length>4000000)throw fail('文本内容无效');
      const requestHash=digest(JSON.stringify({documentId,nodeId,scope,start,end,expectedText,text,...(richText?{richText}:{})}));
      const loaded=await load(id),old=loaded.state.coreTextOperations?.[operationId];
      if(old){if(old.requestHash!==requestHash)throw fail('操作身份已经用于其他内容');return {...loaded,replayed:true,historyReceipt:old.historyReceipt};}
      if(loaded.stateStamp!==expectedStateStamp){
        const content=d=>d&&JSON.stringify([d.documentKind,d.markdown??'',d.html??'',d.canvas??null]);
        if(!expectedDocument||content(loaded.state.documents[documentId])!==content(expectedDocument))throw fail('文本基线已变化','WORKSPACE_STATE_CONFLICT');
      }
      const state=loaded.state,document=state.documents[documentId];
      if(!document)throw fail('文档不存在');
      const node=nodeId?document.canvas?.nodes.find(n=>n.id===nodeId):null;
      if(nodeId&&!node)throw fail('文本卡片不存在');
      if(document.canvas&&!nodeId)throw fail('请指定白板文本卡片');
      const before=String(node?node.text??'':document.markdown??'');
      let after=text;
      if(scope==='partial'){
        if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>before.length||typeof expectedText!=='string'||before.slice(start,end)!==expectedText)throw fail('局部文本基线不匹配','WORKSPACE_STATE_CONFLICT');
        after=before.slice(0,start)+text+before.slice(end);
      }else if(scope==='rich-partial'){
        if(node||!richText||typeof richText.html!=='string'||typeof richText.markdown!=='string'||richText.html.length>16000000||richText.markdown.length>4000000||richText.expectedHtml!==document.html)throw fail('富文本局部修改基线无效','WORKSPACE_STATE_CONFLICT');
        after=richText.markdown;
      }else if(scope!=='full')throw fail('未知文本修改范围');
      if(after===before)return {...loaded,unchanged:true};
      const previousDocument=clone(document);
      if(node){snapshotNode(document.canvas,node);node.text=after;}else{document.markdown=after;document.html=scope==='rich-partial'?sanitizeDocumentHtml(richText.html):engine.markdownToHtml(after);}
      (state.coreTextOperations??={})[operationId]={requestHash,documentId,scope,createdAt:new Date().toISOString()};
      const result=await commit(id,{state,expectedStateStamp:loaded.stateStamp,signal},{documentId,operationId,source:'agent',operationType:scope!=='full'?'partial-replace':'replace',reason:scope!=='full'?'AI 局部修改':'AI 全文修改',previousDocument});
      return result;
    },signal);
  }
  const draftPath=(id,clientId)=>{options(id);if(!/^[a-zA-Z0-9_-]{1,90}$/.test(clientId))throw fail('无效草稿身份');return join(draftsRoot,`${id}-${clientId}.json`);};
  async function draft(id,clientId,payload) {
    const path=draftPath(id,clientId);
    if(payload===undefined)return readJson(path);
    return serial('draft:'+id+':'+clientId,async()=>{
      const old=await readJson(path);
      if((old?.revision??-1)>(payload.revision??0))return old;
      await atomicJson(path,{...payload,updatedAt:new Date().toISOString()});return {saved:true};
    });
  }
  async function clearDraft(id,clientId,revision) {
    if(revision===undefined)return;
    await serial('draft:'+id+':'+clientId,async()=>{
      const path=draftPath(id,clientId),old=await readJson(path);
      if(old && old.revision<=revision)await atomicJson(path,{revision:old.revision,cleared:true});
    });
  }
  async function restore(id,{documentId,versionId,recoveryId,expectedStateStamp,clientId,draftRevision}) {
    return serial(id,async()=>{
    const current=await load(id);
    if(current.stateStamp!==expectedStateStamp) throw fail('磁盘内容已变化','WORKSPACE_STATE_CONFLICT');
    const entry=recoveryId?current.state.coreRestoreLog?.find(v=>v.id===recoveryId&&v.documentId===documentId):current.state.histories?.[documentId]?.find(v=>v.id===versionId);
    if(!recoveryId)assertVersion(entry);
    if(!entry?.document || !current.state.documents[documentId])throw fail('版本与当前文档不匹配');
    const state=clone(current.state), previous=state.documents[documentId];
    state.documents[documentId]={...clone(entry.document),title:previous.title,moduleId:previous.moduleId,contentRef:previous.contentRef,sourcePath:previous.sourcePath};
    for(const key of ['coreFolderId','customFolderId','customFolderPath']){if(Object.hasOwn(previous,key))state.documents[documentId][key]=previous[key];else delete state.documents[documentId][key];}
    if(previous.documentKind==='whiteboard') {
      const canvas=state.documents[documentId].canvas;
      canvas.viewport=clone(previous.canvas.viewport||{x:0,y:0,zoom:1});
      const ids=new Set((canvas.assets??[]).map(a=>a.id));
      canvas.assets=[...(canvas.assets??[]),...(previous.canvas.assets??[]).filter(a=>!ids.has(a.id))];
    }
    (state.coreRestoreLog??=[]).push({id:randomUUID(),documentId,versionId,document:clone(previous),createdAt:new Date().toISOString()});
    return commit(id,{state,expectedStateStamp,clientId,draftRevision});
    });
  }
  const moveDocuments=createDocumentMover({exclusive,load,commit,options,validate:validateWorkWrites,assertDrafts:async(id,ids)=>{const current=(await load(id)).state;for(const file of await readdir(draftsRoot)){if(!file.startsWith(id+'-'))continue;const draft=await readJson(join(draftsRoot,file));if(draft?.state&&ids.some(docId=>draft.state.documents?.[docId]&&JSON.stringify(snapshotDocument(draft.state.documents[docId]))!==JSON.stringify(snapshotDocument(current.documents[docId]))))throw fail('其他窗口仍有文档草稿，请先保存后再移动');}}});
  const notebookRecycle=createNotebookRecycle({engine,dataRoot,notesRoot,appRoot:join(projectRoot,'apps/desktop'),serial,load,notify:event=>{for(const listener of listeners)listener(event);}});
  const cloudNotebooks=createCoreCloudNotebookStorage({load,list:()=>barrier.then(()=>list()),commit,serial,engine,options,blank:createBlankNotebookState,sanitize:sanitizeDocumentHtml,media:createCoreCloudMedia(dataRoot)});
  const service={dataRoot,skills,setCardDefaultResolver:fn=>{cardDefaultResolver=fn;},moveDocuments,cloudNotebooks,notebookRecycle,setAssetTrash,deleteHistory,cleanupHistory,directoryCatalog:()=>barrier.then(()=>directoryCatalog()),list:()=>barrier.then(()=>list()),recycleIndex:()=>barrier.then(()=>recycleIndex()),referenceIndex:()=>barrier.then(()=>referenceIndex()),create:name=>serial('catalog',()=>create(name)),load:id=>barrier.then(()=>load(id)),stateStamp:id=>barrier.then(()=>engine.getWorkspaceStateStamp(options(id))).then(({stateStamp})=>({stateStamp})),graphLoad:id=>barrier.then(()=>graphLoad(id)),save,resolveLocalDraft,saveMergedDocuments,createDocument,saveVersion,replaceCard,saveDirectoryVersion,restoreDirectoryVersion,applyTextEdit,appendAiCard,saveMediaRecall,applyGeneratedTextResult,applyMediaResult,applyBoardPatch,draft,restore,exclusive,markdown:engine.markdownToHtml,subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);},
    assetLoad:id=>barrier.then(()=>assetLoad(id)),recycleDirectory,stageMapMedia,stageVideoPreview,editMedia,editBoard,appendMediaNodes,importBoardMedia,bindBoardDraft,applyDocumentMediaResult,asset:(id,payload)=>serial(id,()=>engine.saveWorkspaceAttachment({...options(id),...payload})),
    // Internal host capability for account-browser results. The existing stream
    // validator checks signatures, complete images and playable video frames.
    assetMediaStream:(id,payload)=>serial(id,()=>engine.saveWorkspaceAttachmentFromStream({...payload,...options(id),requireValidImage:payload.mimeType?.startsWith('image/'),requirePlayableMedia:payload.mimeType?.startsWith('video/')}),payload.signal),
    assetMetadata:(id,path,documentId)=>barrier.then(()=>engine.readWorkspaceAttachmentMetadata({...options(id),relativePath:path,documentId})),
    assetInfo:(id,path,documentId)=>barrier.then(()=>engine.readWorkspaceAttachmentContent({...options(id),relativePath:path,documentId}))};
  // Internal migration only: normal UI saves must never supply arbitrary history.
  const saveKnowledgeMerge=(id,{state,expectedStateStamp,imports})=>exclusive(async()=>{
    const target=await load(id);if(!target.state.coreKnowledgeBase||target.stateStamp!==expectedStateStamp)throw fail('知识库已变化，请重新合并','WORKSPACE_STATE_CONFLICT');
    const histories=clone(target.state.histories||{}),times=clone(target.state.coreDocumentTimes||{}),copied=[];
    for(const source of imports){
      const current=await load(source.id);if(!current.state.coreKnowledgeBase||current.stateStamp!==source.expectedStateStamp)throw fail('待合并知识库已变化，原库保留','WORKSPACE_STATE_CONFLICT');
      for(const [documentId,document]of Object.entries(current.state.documents)){
        const nextId=source.documentMap[documentId];if(!nextId||!state.documents[nextId])throw fail('合并文档映射不完整，原库保留');
        histories[nextId]??=[];
        for(const version of current.state.histories?.[documentId]||[]){
          assertVersion(version);const existing=histories[nextId].find(item=>item.id===version.id);
          if(existing&&JSON.stringify(existing)!==JSON.stringify(version))throw fail('合并历史身份冲突，原库保留');
          if(!existing)histories[nextId].push(clone(version));
        }
        histories[nextId].sort((a,b)=>String(b.createdAt||b.time||'').localeCompare(String(a.createdAt||a.time||'')));
        if(!times[nextId]&&current.state.coreDocumentTimes?.[documentId])times[nextId]=clone(current.state.coreDocumentTimes[documentId]);
      }
      const sourceRoot=options(source.id).requestedPath,targetRoot=options(id).requestedPath;
      copied.push({sourceRoot,targetRoot,files:await copyAssets(sourceRoot,targetRoot,{documents:current.state.documents,histories:current.state.histories})});
    }
    const result=await commit(id,{state,expectedStateStamp},{moveImport:{histories,times}});
    for(const [documentId,versions]of Object.entries(histories))for(const version of versions)if(!result.state.histories[documentId]?.some(item=>item.id===version.id&&JSON.stringify(item)===JSON.stringify(version)))throw fail('合并历史回读不一致，原库保留');
    for(const {sourceRoot,targetRoot,files}of copied)await verifyAssets(files,sourceRoot,targetRoot);
    return result;
  });
  service.skillDocumentation=createSkillDocumentation(service,saveKnowledgeMerge);skills.setDocumentationSync(service.skillDocumentation.sync);return service;
}
