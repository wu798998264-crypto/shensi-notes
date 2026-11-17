import {snapshotCardModelDefaults,snapshotCopiedCardDefaults} from './card-model-defaults.js';
import {snapshotCanvasNodeVersion,generationAssetQualifiesForHistory} from '../core/legacy/whiteboard.js';
export const emptyCanvas=()=>({nodes:[],edges:[],assets:[],viewport:{x:60,y:60,zoom:1},settings:{snapToGrid:true,gridSize:20}});
export function fittedBoardViewport(nodes,width,height){
 if(!nodes.length)return {x:60,y:60,zoom:1};
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const n of nodes){left=Math.min(left,n.x);top=Math.min(top,n.y);right=Math.max(right,n.x+n.width);bottom=Math.max(bottom,n.y+n.height);}
 const spanX=Math.max(1,right-left),spanY=Math.max(1,bottom-top);
 const zoom=Math.min(1.2,Math.max(1,width-100)/spanX,Math.max(1,height-100)/spanY);
 return {x:(width-spanX*zoom)/2-left*zoom,y:(height-spanY*zoom)/2-top*zoom,zoom};
}
export function nodeVersions(canvas,nodeId){return (canvas.assets??[]).filter(a=>a.sourceNodeId===nodeId&&generationAssetQualifiesForHistory(a));}
export function imageOutputBatch(canvas,node){
 if(node?.kind!=='image'||!node.file)return null;
 const images=nodeVersions(canvas,node.id).filter(a=>a.kind==='image'&&a.attachment?.relativePath&&!canvas.coreAssetTrash?.[a.id]);
 const batch=a=>a?.generationJobId||String(a?.id||'').match(/^((?:generation-|doubao-media-)[a-f0-9-]+)-\d+$/)?.[1];
 const selected=images.find(a=>a.id===node.coreSelectedVersionId),file=selected?.attachment.relativePath||node.file;
 const current=selected&&batch(selected)?selected:images.findLast(a=>a.attachment.relativePath===file&&batch(a));
 const jobId=batch(current);if(!jobId)return null;
 return {jobId,count:new Set(images.filter(a=>batch(a)===jobId).map(a=>a.attachment.relativePath)).size};
}
export const imageOutputCount=(canvas,node)=>imageOutputBatch(canvas,node)?.count||(node?.kind==='image'&&node.file?1:0);
export const unseenImageOutputCount=(canvas,node)=>{const batch=imageOutputBatch(canvas,node);return batch&&!canvas.coreSeenImageOutputBatches?.[node.id+':'+batch.jobId]?batch.count:0;};
export function acknowledgeImageOutput(canvas,node){const batch=imageOutputBatch(canvas,node);if(!batch||batch.count<2)return false;const key=node.id+':'+batch.jobId;if(canvas.coreSeenImageOutputBatches?.[key])return false;(canvas.coreSeenImageOutputBatches??={})[key]=true;return true;}
export function captureNodeVersion(canvas,nodeId,{source='manual',id='canvas-version-'+crypto.randomUUID(),createdAt=new Date().toISOString()}={}){
 const node=canvas.nodes.find(n=>n.id===nodeId);if(!node)return false;const ids=new Set((canvas.assets||[]).map(a=>a.id));
 const projected=snapshotCanvasNodeVersion({nodes:[node],edges:[],assets:canvas.assets||[]},nodeId,{source,id,createdAt});
 const added=projected.assets.filter(a=>!ids.has(a.id));if(!added.length)return false;
 (canvas.assets??=[]).push(...added.map(a=>({...a,coreNodeSnapshot:structuredClone(node)})));return true;
}
export function adoptNodeVersion(canvas,nodeId,versionId){
  const next=structuredClone(canvas),node=next.nodes.find(n=>n.id===nodeId),asset=next.assets?.find(a=>a.id===versionId&&a.sourceNodeId===nodeId);
  if(!node||!asset)throw Error('找不到当前卡片的版本');
  if(asset.coreGenerationRecall&&asset.coreGenerationRecall.state!=='recalled')throw Error('请先召回原成品，不能采用待召回或已放弃的任务记录');
  captureNodeVersion(next,nodeId,{source:'whiteboard'});
  const preserved={id:node.id,x:node.x,y:node.y,width:node.width,height:node.height};
  if(asset.coreNodeSnapshot){for(const key of Object.keys(node))delete node[key];Object.assign(node,structuredClone(asset.coreNodeSnapshot));}
  else{
    for(const key of ['text','file','mimeType','thumbnailRelativePath','thumbnailMimeType','videoWidth','videoHeight','durationMs','aspectRatio','reference','url','operation','generation','coreMediaJobId','coreDepthJobId'])delete node[key];
    if(asset.kind==='text'){node.type='text';node.kind=asset.origin==='generated'?'generated':'text';node.text=asset.text??'';}
    else{node.type='file';node.kind=asset.kind;node.file=asset.attachment.relativePath;node.mimeType=asset.attachment.mimeType;for(const key of ['thumbnailRelativePath','thumbnailMimeType','durationMs','videoWidth','videoHeight'])if(asset.attachment[key]!==undefined)node[key]=asset.attachment[key];if(asset.aspectRatio!==undefined)node.aspectRatio=asset.aspectRatio;}
  }
  if(asset.nodeName)node.name=asset.nodeName;
  if(asset.origin==='generated')node.generation={channel:asset.kind,prompt:asset.prompt??'',jobId:asset.generationJobId||'',createdAt:asset.createdAt||'',...(asset.elapsedMs===undefined?{}:{elapsedMs:asset.elapsedMs}),...(Array.isArray(asset.referenceOrder)?{referenceOrder:structuredClone(asset.referenceOrder)}:{}),...(asset.generationProfile?{profile:structuredClone(asset.generationProfile)}:{})};
  Object.assign(node,preserved,{coreSelectedVersionId:versionId});
  return next;
}
export function addTextCard(canvas,{x=60,y=60,text='',name='文本卡片'}={}){
  const node={id:'node-'+crypto.randomUUID(),type:'text',kind:'text',name,text,x,y,width:340,height:240};snapshotCardModelDefaults(node);canvas.nodes.push(node);return node;
}
export function resizedCard(node,start,dx,dy,grid=1){
  const snap=Math.max(1,grid),round=value=>Math.round(value/snap)*snap;
  if(node.file&&['image','video'].includes(node.kind)&&start.width>0&&start.height>0){
    const ratio=start.width/start.height,change=Math.abs(dx/start.width)>=Math.abs(dy/start.height)?dx/start.width:dy/start.height;
    const minimum=Math.ceil(Math.max(180,120*ratio)/snap)*snap,width=Math.max(minimum,round(start.width*(1+change)));
    return {width,height:width/ratio};
  }
  return {width:Math.max(180,round(start.width+dx)),height:Math.max(120,round(start.height+dy))};
}
export function copySelection(canvas,ids){const set=new Set(ids);return structuredClone({nodes:canvas.nodes.filter(n=>set.has(n.id)),edges:canvas.edges.filter(e=>set.has(e.fromNode)&&set.has(e.toNode))});}
export function pasteSelection(canvas,payload,offset=40){const map=new Map(payload.nodes.map(n=>[n.id,'node-'+crypto.randomUUID()]));for(const n of payload.nodes)canvas.nodes.push(snapshotCopiedCardDefaults({...structuredClone(n),id:map.get(n.id),x:n.x+offset,y:n.y+offset}));for(const e of payload.edges??[])canvas.edges.push({...structuredClone(e),id:'edge-'+crypto.randomUUID(),fromNode:map.get(e.fromNode),toNode:map.get(e.toNode)});return [...map.values()];}
export function edgePath(a,b,fromSide='right',toSide='left'){
 return connectionPath(nodeSidePoint(a,fromSide),nodeSidePoint(b,toSide));
}
// Floating handles and both saved/live edges share the same world-space center.
export const CONNECTOR_OFFSET=14;
export function nodeSidePoint(n,side='right'){return {x:n.x+(side==='right'?n.width+CONNECTOR_OFFSET:side==='left'?-CONNECTOR_OFFSET:n.width/2),y:n.y+(side==='bottom'?n.height:side==='top'?0:n.height/2)};}
export function connectionPoints(from,to){const distance=Math.max(70,Math.abs(to.x-from.x)*.45);return [from,{x:from.x+distance,y:from.y},{x:to.x-distance,y:to.y},to];}
export function connectionPath(from,to){const [a,b,c,d]=connectionPoints(from,to);return `M ${a.x} ${a.y} C ${b.x} ${b.y}, ${c.x} ${c.y}, ${d.x} ${d.y}`;}
