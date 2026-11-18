import {isGptImageModel} from './gpt-image-options.js';

// Product picker policy, not a claim that every provider has retired these IDs.
// Numeric GPT text versions only: GPT Image, OSS and o-series are separate.
export function retiredGptModel(id){
 const version=String(id||'').trim().match(/(?:^|[/:])gpt-(\d+)(?:\.(\d+))?(?=[a-z._:/-]|$)/i);
 return !!version&&(Number(version[1])<5||Number(version[1])===5&&Number(version[2]||0)<6);
}
export function removedModel(id,profile){
 const model=String(id||'').trim().toLowerCase();
 return retiredGptModel(model)||/^(?:openai\/)?gpt-reserve$/.test(model)||(profile?.agentEngine==='workbuddy'&&model==='hy3');
}
export function currentGptModels(items=[],profile){
 return items.filter(item=>!removedModel(item.id||item.slug,profile));
}
export const currentGptCatalog=(catalog,profile)=>({...catalog,models:currentGptModels(catalog.models,profile).map(item=>({...item,channels:gptCatalogChannels(item)}))});

// Only infer output for recognizable model families when /models omits it.
// An explicit provider declaration always wins, including on cached entries.
export function gptCatalogChannels(item){
 if(item.channels?.length)return item.channels;
 if(isGptImageModel(item.id))return ['image'];
 if(/^(?:openai\/)?(?:gpt-(?:\d+(?:\.\d+)?(?:-(?:sol|astra|terra|luna|mini|nano|pro|codex))?|reserve|oss-\d+b)|codex-auto-review)(?:-\d{4}-\d{2}-\d{2})?$/i.test(item.id))return ['text'];
 return [];
}

