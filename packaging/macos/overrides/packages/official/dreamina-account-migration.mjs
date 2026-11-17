import {canvasAccountId,unifiedCanvasProfile,usesUnifiedCanvas} from '../ui/media-model-policy.js';
// One account owns one connection. Old connection IDs remain aliases; saved
// jobs and their frozen settings are never rewritten by this settings upgrade.
export function mergeDreaminaAccounts(state,sources,{imageModel='seedream_5.5'}={}){
 const groups=new Map(),sourceIds=new Set(sources.map(s=>s.profileId));
 for(const original of state.profiles){
  const p=unifiedCanvasProfile(original);
  if(!usesUnifiedCanvas(p)||p.memberRef||p.externalRef||p.browserProfileId||!sourceIds.has(p.dreaminaCliProfile))continue;
  const key=canvasAccountId(p),items=groups.get(key)||[];items.push(original);groups.set(key,items);
 }
 let changed=false;
 for(const items of groups.values()){
  // Multiple intentional configurations for the same channel are ambiguous.
  if(items.length<2||items.some(p=>p.channel==='multimodal')||new Set(items.map(p=>p.channel)).size!==items.length||new Set(items.map(p=>p.enabled!==false)).size!==1)continue;
  const primary=items.find(p=>p.channel==='image')||items[0],now=new Date().toISOString();
  const models=Object.fromEntries(items.map(p=>[p.channel,unifiedCanvasProfile(p).model]));
  models.image=imageModel;models.video||='seedance_2.5';models.audio||='seed_music_1.0';
  const channelDefaults=Object.fromEntries(items.map(p=>[p.channel,Object.fromEntries(['aspectRatio','resolution','durationSeconds','voice'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]))]));
  const next={...unifiedCanvasProfile(primary),channel:'multimodal',channels:['image','video','audio'],capabilityModels:models,channelDefaults,model:imageModel,authorizationSource:'external_browser',updatedAt:now};
  state.canvasAccountMigration??={version:1,previousProfiles:[],migratedAt:now};
  state.canvasAccountMigration.previousProfiles.push(...structuredClone(items));
  state.profileAliases??={};for(const p of items)if(p.id!==primary.id)state.profileAliases[p.id]=primary.id;
  const ids=new Set(items.map(p=>p.id));state.profiles=state.profiles.filter(p=>!ids.has(p.id));state.profiles.push(next);changed=true;
 }
 if(changed)state.revision++;return changed;
}

export function canvasProfileAliases(state){
 const retained=new Set((state.multimodalAccountMigration?.previousProfiles||[]).map(p=>p.id));
 return Object.entries(state.profileAliases||{}).filter(([id])=>!retained.has(id)).flatMap(([id,target])=>{const p=state.profiles.find(p=>p.id===target);return p?[{...p,id,aliasFor:target}]:[];});
}
