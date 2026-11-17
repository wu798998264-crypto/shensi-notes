import {snapshotCopiedCardDefaults} from './card-model-defaults.js';
// Duplication copies editable state, not an executable job. Incoming edges and
// reference offsets are retained; outgoing consumers remain owned by the source.
const chinese=n=>n<10?'零一二三四五六七八九'[n]:n<100?(n<20?'':'零一二三四五六七八九'[Math.floor(n/10)])+'十'+(n%10?'零一二三四五六七八九'[n%10]:''):String(n);
const remapDraft=(draft,nodes,edges)=>{
 const value=structuredClone(draft),map=id=>nodes.get(id)||id;
 for(const key of ['references','promptReferenceSequence','referenceExcludedIds'])if(Array.isArray(value[key]))value[key]=value[key].map(ref=>typeof ref==='string'?map(ref):{...ref,...(ref.nodeId?{nodeId:map(ref.nodeId)}:{}),...(ref.id?{id:map(ref.id)}:{})});
 if(Array.isArray(value.referenceEdgeIds))value.referenceEdgeIds=value.referenceEdgeIds.map(id=>edges.get(id)||id);
 for(const key of ['mentions','promptMentions'])if(Array.isArray(value[key]))value[key]=value[key].map(ref=>({...ref,nodeId:map(ref.nodeId)}));
 if(Array.isArray(value.multiframeTransitions))value.multiframeTransitions=value.multiframeTransitions.map(item=>({...item,fromNode:map(item.fromNode),toNode:map(item.toNode)}));
 if(value.channels)for(const key of Object.keys(value.channels))value.channels[key]=remapDraft(value.channels[key],nodes,edges);
 return value;
};
export function duplicateCards(doc,ids){
 const canvas=doc.canvas,selected=new Set(ids),sources=canvas.nodes.filter(n=>selected.has(n.id)),nodeMap=new Map(sources.map(n=>[n.id,'node-'+crypto.randomUUID()])),edgeMap=new Map();
 const incoming=canvas.edges.filter(e=>nodeMap.has(e.toNode)).map(edge=>{const id='edge-'+crypto.randomUUID();edgeMap.set(edge.id,id);return {...structuredClone(edge),id,fromNode:nodeMap.get(edge.fromNode)||edge.fromNode,toNode:nodeMap.get(edge.toNode)};});
 const existingNames=new Set(canvas.nodes.map(n=>n.name)),historyByNode=new Map();
 for(const asset of canvas.assets||[])if(nodeMap.has(asset.sourceNodeId)){if(!historyByNode.has(asset.sourceNodeId))historyByNode.set(asset.sourceNodeId,[]);historyByNode.get(asset.sourceNodeId).push(asset);}
 for(const source of sources){
  const base=source.coreDuplicateBase||String(source.name||'卡片').replace(/ 副本(?:[零一二三四五六七八九十百\d]+)?$/u,''),sequence=canvas.coreDuplicateSequences??={};
  let count=Object.hasOwn(sequence,base)&&Number.isSafeInteger(sequence[base])&&sequence[base]>=0?sequence[base]:0,name;
  do{name=base+' 副本'+(count?chinese(count):'');count++;}while(existingNames.has(name));
  Object.defineProperty(sequence,base,{value:count,writable:true,enumerable:true,configurable:true});existingNames.add(name);
  const id=nodeMap.get(source.id),copy={...structuredClone(source),id,name,coreDuplicateBase:base,x:source.x+source.width+60,y:source.y};
  copy.coreCopiedFrom={nodeId:source.id,mediaJobId:source.coreMediaJobId||source.generation?.jobId||source.coreCopiedFrom?.mediaJobId||'',depthJobId:source.coreDepthJobId||''};
  delete copy.coreMediaJobId;delete copy.coreDepthJobId;
  const assetMap=new Map();
  for(const asset of historyByNode.get(source.id)||[]){
   const assetId='asset-copy-'+crypto.randomUUID();assetMap.set(asset.id,assetId);
   const next={...structuredClone(asset),id:assetId,sourceNodeId:id};
   if(next.coreNodeSnapshot){next.coreNodeSnapshot.id=id;next.coreNodeSnapshot.name=name;delete next.coreNodeSnapshot.coreMediaJobId;delete next.coreNodeSnapshot.coreDepthJobId;}
   (canvas.assets??=[]).push(next);
   if(Object.hasOwn(canvas.coreAssetTrash||{},asset.id))(canvas.coreAssetTrash??={})[assetId]=structuredClone(canvas.coreAssetTrash[asset.id]);
  }
  if(assetMap.has(copy.coreSelectedVersionId))copy.coreSelectedVersionId=assetMap.get(copy.coreSelectedVersionId);
  const draft=canvas.coreGenerationDrafts?.[source.id]??doc.coreLegacyGenerationDrafts?.[source.id];
  if(draft)(canvas.coreGenerationDrafts??={})[id]=remapDraft(draft,nodeMap,edgeMap);
  if(doc.coreLegacyGenerationDrafts?.[source.id])doc.coreLegacyGenerationDrafts[id]=remapDraft(doc.coreLegacyGenerationDrafts[source.id],nodeMap,edgeMap);
  snapshotCopiedCardDefaults(copy);canvas.nodes.push(copy);
 }
 canvas.edges.push(...incoming);return [...nodeMap.values()];
}
