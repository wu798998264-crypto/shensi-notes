import {createHash} from 'node:crypto';

// Only the previously imported connections requested for consolidation qualify.
// Names alone never establish an account or credential relationship.
const accountFields=['provider','adapter','baseUrl','browserProfileId','authorizationSource','externalBrowserId','externalBrowserProfile','credentialAccountId','dreaminaCliProfile','libtvConfigDir','runtimeProfileId','runtimeConfigPath'];
const sameAccount=items=>accountFields.every(key=>new Set(items.map(p=>String(p[key]||''))).size===1)&&new Set(items.map(p=>p.enabled!==false)).size===1;
const plain=p=>!p.memberRef&&!p.externalRef&&!p.aliasFor&&p.channel!=='multimodal'&&!!p.legacyImport?.sourceId;
export function legacyMultimodalGroups(state){
 const groups=[],sources=new Set(state.profiles.filter(plain).map(p=>p.legacyImport.sourceId));
 for(const sourceId of sources){
  const entries=state.profiles.filter(p=>plain(p)&&p.legacyImport.sourceId===sourceId);
  const find=(id,channel)=>entries.filter(p=>p.legacyImport.profileId===id&&p.channel===channel);
  const openai=[...find('text-default','text'),...find('image-openai-codex-cli','image')];
  if(openai.length===2&&openai.every(p=>p.provider==='OpenAI'&&p.adapter==='cli')&&openai.find(p=>p.channel==='text')?.cliPath==='codex'&&openai.find(p=>p.channel==='text')?.credentialSource==='codex_session'&&openai.find(p=>p.channel==='image')?.cliPath==='shensi-openai-image'&&sameAccount(openai))groups.push({name:'OpenAI CLI',items:openai});
  const libtv=[...find('image-libtv','image'),...find('video-libtv','video'),...find('audio-libtv-jimeng','audio'),...find('audio-libtv-hailuo','audio')];
  if(libtv.length>=2&&new Set(libtv.map(p=>p.channel)).size>=2&&libtv.every(p=>p.provider==='LibTV'&&p.adapter==='cli'&&p.cliPath==='libtv')&&new Set(libtv.map(p=>p.legacyImport.profileId)).size===libtv.length&&new Set(libtv.map(p=>p.cliArgs||'')).size===1&&new Set(libtv.map(p=>p.credentialSource||'')).size===1&&sameAccount(libtv))groups.push({name:'LibTV',items:libtv});
  for(const image of entries.filter(p=>p.channel==='image'&&p.adapter==='api'&&p.credentialSharing==='same_endpoint'&&p.credentialSharedFromChannel==='text')){
   const text=find(image.credentialSharedFromProfileId,'text');
   if(text.length===1&&sameAccount([text[0],image])&&!groups.some(g=>g.items.includes(text[0])))groups.push({name:text[0].name,items:[text[0],image]});
  }
 }
 return groups;
}

export async function mergeLegacyMultimodalAccounts(state,{sameCredentials=async()=>false}={}){
 let changed=false;
 for(const {name,items} of legacyMultimodalGroups(state)){
  if(!await sameCredentials(items))continue;
  const ids=items.map(p=>p.id).sort(),id='multimodal-'+createHash('sha256').update(ids.join('\n')).digest('hex').slice(0,32);
  if(state.profiles.some(p=>p.id===id)||ids.some(id=>state.profileAliases?.[id]))continue;
  const channels=['text','image','video','audio'].filter(c=>items.some(p=>p.channel===c)),primary=items.find(p=>p.channel===channels[0]),now=new Date().toISOString();
  const channelProfiles=Object.fromEntries(channels.map(channel=>{
   const selected=items.find(p=>p.channel===channel),{id,name,channel:_,legacyImport,enabled,updatedAt,...settings}=structuredClone(selected);
   // The consolidated audio entry supports both music and speech. Keep the
   // longer existing deadline; legacy references retain their exact deadline.
   const timeoutMs=Math.max(...items.filter(p=>p.channel===channel).map(p=>Number(p.timeoutMs)||0));
   return [channel,{...settings,...(timeoutMs?{timeoutMs}:{})}];
  }));
  const {legacyImport,...base}=primary;
  const merged={...base,id,name,channel:'multimodal',channels,capabilityModels:Object.fromEntries(channels.map(c=>[c,channelProfiles[c].model])),channelProfiles,mergedPrimaryChannel:channels[0],mergedCredentialId:primary.id,updatedAt:now};
  state.multimodalAccountMigration??={version:1,previousProfiles:[],migratedAt:now};
  state.multimodalAccountMigration.previousProfiles.push(...structuredClone(items));
  state.profileAliases??={};for(const item of items)state.profileAliases[item.id]=id;
  state.profiles=state.profiles.filter(p=>!ids.includes(p.id));state.profiles.push(merged);changed=true;
 }
 if(changed)state.revision++;return changed;
}

export function mergedProfileAliases(state){
 return (state.multimodalAccountMigration?.previousProfiles||[]).flatMap(original=>{
  const target=state.profiles.find(p=>p.id===state.profileAliases?.[original.id]);
  return target?[{...original,aliasFor:target.id,preserveLegacySettings:true,enabled:target.enabled!==false&&original.enabled!==false&&target.channels.includes(original.channel)}]:[];
 });
}

// The form edits the primary connection. Account changes are shared; command
// templates and protocol changes apply only to that primary capability.
export function updateMergedChannelProfiles(old,next){
 if(!old.channelProfiles)return next;
 if(next.channels.some(c=>!old.channelProfiles[c]))throw Error('此合并配置只包含已接通的能力；请先为新增能力配置实际连接');
 const routes=structuredClone(old.channelProfiles),shared=new Set(accountFields.concat(['credentialSource','credentialPageUrl']));
 for(const key of Object.keys(routes[old.mergedPrimaryChannel])){
  if(next[key]===old[key])continue;
  for(const channel of shared.has(key)?Object.keys(routes):[old.mergedPrimaryChannel]){
   if(next[key]===undefined)delete routes[channel][key];else routes[channel][key]=next[key];
  }
 }
 for(const key of shared)if(next[key]!==old[key])for(const route of Object.values(routes))route[key]=next[key]??'';
 return {...next,channelProfiles:routes};
}

// Directory caches contain no credentials. Carry over the capability-specific
// entries already returned by these exact source connections, including denials.
export function carryMergedCatalogs(state,cached,keyFor){
 for(const target of state.profiles.filter(p=>p.channelProfiles)){
  const key=keyFor(target);if(cached[key])continue;
  const originals=(state.multimodalAccountMigration?.previousProfiles||[]).filter(p=>state.profileAliases?.[p.id]===target.id);
  const entries=originals.map(p=>({channel:p.channel,catalog:cached[keyFor(p)]}));
  if(!target.channels.every(c=>entries.some(e=>e.channel===c&&e.catalog)))continue;
  const models=new Map();
  for(const {channel,catalog} of entries){
   for(const item of catalog?.models||[]){
    if(item.channels?.length&&!item.channels.includes(channel))continue;
    const prior=models.get(item.id);models.set(item.id,{...prior,...item,channels:[...new Set([...(prior?.channels||[]),channel])]});
   }
  }
  if(models.size)cached[key]={models:[...models.values()],source:'merged-existing',complete:false,checkedAt:new Date().toISOString(),message:'保留合并前各能力的模型目录；读取连接目录可刷新当前可用范围。'};
 }
 return cached;
}
