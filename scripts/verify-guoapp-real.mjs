// Explicit real-download acceptance: one previously requested public episode.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]||'.'),evidence=resolve(process.argv[3]||'docs/migration/evidence/guoapp-20261117'),resourceRoot=process.argv[4]?resolve(process.argv[4]):join(root,'resources');
const {createCoreService}=await import(pathToFileURL(join(root,'packages/core/src/service.mjs'))),{createChushouExecutor}=await import(pathToFileURL(join(root,'packages/official/chushou-executor.mjs'))),{configureBundledMedia}=await import(pathToFileURL(join(root,'apps/desktop/runtime-paths.mjs')));
await mkdir(evidence,{recursive:true});const dataRoot=await mkdtemp(join(tmpdir(),'guoapp-real-')),service=await createCoreService({dataRoot});configureBundledMedia({root,resourcesPath:resourceRoot,isPackaged:true});
const book=await service.create('红果下载验收'),state=await service.load(book.id),doc=await service.createDocument(book.id,{kind:'whiteboard',expectedStateStamp:state.stateStamp}),scope={id:book.id,documentId:doc.documentId,pluginId:'official.conversation-control',conversationId:'guoapp-real'};
const executor=createChushouExecutor({service,resourceRoot}),signal=AbortSignal.timeout(300000),start=Date.now(),report={passed:false,platform:process.platform,arch:process.arch,packageRoot:root,realDownload:true,paidGeneration:0,dataRoot};
const run=(tool,args,id)=>executor.invoke(tool,args,{scope,signal,operationId:id});
try{
 const inspected=await run('run',{action:'drama_inspect',parameters:{source:'7690184933037329432'}},'guoapp-inspect');assert.equal(inspected.result.title,'困兽之战');assert.equal(inspected.result.total_episodes,17);report.inspectMs=Date.now()-start;
 const began=Date.now(),result=await run('run',{action:'drama_download',parameters:{source:'7690184933037329432',episodes:'1'}},'guoapp-download');assert.equal(result.status,'complete');assert.equal(result.result.completed_episodes,1);assert.equal(result.result.metadata.validation,'full_video_and_available_audio_decode');report.downloadAndValidationMs=Date.now()-began;
 const video=result.files.find(f=>f.name==='source.mp4');assert(video);const t=Date.now(),imported=await run('import_media',{fileId:video.fileId},'guoapp-import'),current=await service.load(book.id);
 await service.appendMediaNodes(book.id,{documentId:doc.documentId,expectedStateStamp:current.stateStamp,operationId:'guoapp-land',nodes:[{id:'guoapp-video',type:'file',kind:'video',file:imported.relativePath,x:0,y:0,width:320,height:180}],edges:[]});
 const reopened=await createCoreService({dataRoot}),readback=await reopened.load(book.id);assert.equal(readback.state.documents[doc.documentId].canvas.nodes[0].file,imported.relativePath);const asset=await reopened.assetInfo(book.id,imported.relativePath,doc.documentId);assert.equal(createHash('sha256').update(await readFile(asset.absolutePath)).digest('hex'),video.sha256);report.importAndReadbackMs=Date.now()-t;
 assert((await run('run',{action:'drama_download',parameters:{source:'7690184933037329432',episodes:'1'}},'guoapp-download')).replayed);
 Object.assign(report,{passed:true,totalMs:Date.now()-start,bytes:video.size,sha256:video.sha256,metadata:result.result.metadata,output:asset.absolutePath,replayedWithoutNewDownload:true,notebookId:book.id,documentId:doc.documentId});
}catch(e){report.error=String(e.message).replace(/https?:\/\/\S+/g,'[URL]');throw e;}finally{await writeFile(join(evidence,'real-'+process.platform+'-'+process.arch+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
