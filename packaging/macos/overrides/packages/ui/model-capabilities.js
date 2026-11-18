export const MODEL_CHANNELS=['text','image','video','audio'];
export function profileChannels(profile){return profile?.channel==='multimodal'?MODEL_CHANNELS.filter(channel=>profile.channels?.includes(channel)):MODEL_CHANNELS.includes(profile?.channel)?[profile.channel]:[];}
export const profileSupports=(profile,channel)=>profileChannels(profile).includes(channel);
export const profileHasMedia=profile=>profileChannels(profile).some(channel=>channel!=='text');
// New selections use the merged text/image connection. Other legacy routes
// can intentionally have different parameters (e.g. LibTV music vs speech).
export function pickerProfileId(profiles,id){
 const alias=profiles.find(p=>p.id===id&&p.aliasFor);
 if(!alias)return id;
 const target=profiles.find(p=>p.id===alias.aliasFor);
 const gptPair=target?.channel==='multimodal'&&target.channels?.includes('text')&&target.channels.includes('image')
   &&(target.provider==='OpenAI'&&target.adapter==='cli'||target.adapter==='api'&&target.provider==='自定义兼容接口');
 return target&&(!alias.preserveLegacySettings||gptPair)?target.id:id;
}
export function profileForChannel(profile,channel){
 if(!profileSupports(profile,channel))throw Error('配置不支持此能力');
 const source=profile.channelProfiles?.[channel];
 if(source)return {...source,...Object.fromEntries(['id','name','enabled','aliasFor','mediaModels','textModels','modelCatalogModels','updatedAt','mergedCredentialId'].filter(k=>profile[k]!==undefined).map(k=>[k,profile[k]])),channel,model:profile.capabilityModels?.[channel]||source.model};
 return {...profile,...profile.channelDefaults?.[channel],channel,model:profile.capabilityModels?.[channel]||profile.model};
}
