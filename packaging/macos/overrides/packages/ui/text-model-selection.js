// Task controls use the selected model's declared capabilities, never stale values
// from another model or connection. This does not modify a saved profile.
import {currentGptModels,removedModel} from './gpt-model-policy.js';
export function defaultTextProfile(profiles,preferredId=''){
 const available=profiles.filter(p=>p.enabled!==false&&(p.channel==='text'||p.channels?.includes('text')));
 const selected=available.find(p=>p.id===preferredId);if(selected)return selected;
 const visible=available.filter(p=>!p.aliasFor);
 return visible.find(p=>p.adapter==='api'&&/聚合\s*api|aggregate/i.test([p.name,p.remarkName,p.id,p.legacyImport?.profileId].filter(Boolean).join(' ')))||visible.find(p=>p.adapter==='cli'&&(p.agentEngine==='codex'||/openai|codex/i.test(p.provider||'')||/openai|codex/i.test(p.cliPath||'')))||visible[0];
}
export function findTextModel(profile,models,id){
 if(!id)return;
 const exact=models.find(item=>item.id===id);
 if(exact||profile?.agentEngine!=='deepseek_opencode')return exact;
 const bare=id.replace(/^deepseek\//,'');
 return models.find(item=>item.id.replace(/^deepseek\//,'')===bare);
}
export function textModelOptions(profile){
 const items=[...(profile?.textModels||[])],model=profile?.capabilityModels?.text||profile?.model;
 if(model&&!profile?.textModelCatalogExact&&!findTextModel(profile,items,model))items.unshift({id:model,label:model,reasoningLevels:[],speedModes:[]});
 return currentGptModels(items,profile);
}
export function textModelSelection(profile,selection={}){
 const models=textModelOptions(profile),defaultModel=profile?.capabilityModels?.text||profile?.model||models[0]?.id||'';
 const requested=selection.model||defaultModel,defaultEntry=findTextModel(profile,models,defaultModel);
 let entry=findTextModel(profile,models,requested);
 if(!entry&&!profile?.textModelCatalogExact&&!removedModel(requested,profile))entry=defaultEntry||models[0];
 const model=entry?.id||'';
 const reasoningLevels=[...new Set(entry?.reasoningLevels||[])].filter(Boolean),speedModes=[...new Set(entry?.speedModes||[])].filter(value=>value&&value!=='default'),sameModel=!!entry&&entry===defaultEntry;
 const defaultReasoning=sameModel&&reasoningLevels.includes(profile?.reasoningEffort)?profile.reasoningEffort:reasoningLevels.includes(entry?.defaultReasoningLevel)?entry.defaultReasoningLevel:'';
 const requestedReasoning=selection.reasoningEffort??defaultReasoning,requestedSpeed=selection.speedMode??(sameModel?profile?.speedMode:'default');
 return {models,entry,model,reasoningLevels,speedModes,reasoningEffort:requestedReasoning===''||reasoningLevels.includes(requestedReasoning)?requestedReasoning:defaultReasoning,speedMode:speedModes.includes(requestedSpeed)?requestedSpeed:'default'};
}
export function textModelSummary(profile,selection={}){
 if(!profile)return '选择模型配置';
 const selected=textModelSelection(profile,selection),label=selected.entry?.label||selected.model;
 return [profile.name,label].filter(Boolean).join(' · ')||'选择模型配置';
}
