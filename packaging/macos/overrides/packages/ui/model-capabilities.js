export const MODEL_CHANNELS=['text','image','video','audio'];
export function profileChannels(profile){return profile?.channel==='multimodal'?MODEL_CHANNELS.filter(channel=>profile.channels?.includes(channel)):MODEL_CHANNELS.includes(profile?.channel)?[profile.channel]:[];}
export const profileSupports=(profile,channel)=>profileChannels(profile).includes(channel);
export const profileHasMedia=profile=>profileChannels(profile).some(channel=>channel!=='text');
export function profileForChannel(profile,channel){
 if(!profileSupports(profile,channel))throw Error('配置不支持此能力');
 const source=profile.channelProfiles?.[channel];
 if(source)return {...source,...Object.fromEntries(['id','name','enabled','aliasFor','mediaModels','textModels','modelCatalogModels','updatedAt','mergedCredentialId'].filter(k=>profile[k]!==undefined).map(k=>[k,profile[k]])),channel,model:profile.capabilityModels?.[channel]||source.model};
 return {...profile,...profile.channelDefaults?.[channel],channel,model:profile.capabilityModels?.[channel]||profile.model};
}
