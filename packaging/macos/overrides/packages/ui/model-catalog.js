import {modelLabel} from './model-label.js';
import {escapeHtml as h} from './editor.js';
import {strictMediaCatalog} from './media-model-policy.js';
import {modelAuthorizationFields} from './model-authorization-source.js';
import {currentGptModels,removedModel} from './gpt-model-policy.js';
import {findTextModel} from './text-model-selection.js';
export function mountModelCatalog(form,{profile,call}){
 let sequence=0;const owner=form.querySelector('[data-model-catalog-status]');
 form.addEventListener('change',e=>{if(e.target.matches('[data-catalog-model]')&&e.target.value)delete e.target.dataset.unavailableModel;});
 const inputs=()=>modelAuthorizationFields(Object.fromEntries([...form.querySelectorAll('[name]')].map(input=>[input.name,input.value])));
 async function load(refresh=false){
  if(!owner.isConnected||!form.open)return;
  const request=++sequence,fields=inputs(),button=form.querySelector('[data-model-catalog-refresh]'),status=form.querySelector('[data-model-catalog-status]');
  button.disabled=true;status.textContent=refresh?'正在读取此连接的模型目录…':'正在读取模型目录…';
  try{
   const result=await call('/catalog',{profileId:profile.id,profile:{...profile,...fields,channel:profile.channel},...(fields.apiKey?{apiKey:fields.apiKey}:{}),refresh});
   if(!owner.isConnected||!form.open||request!==sequence)return;
   const missing=new Set(),retired=new Set(),connection={...profile,...fields};
   for(const select of form.querySelectorAll('[data-catalog-model]')){
    const current=select.value||select.dataset.unavailableModel||select.dataset.retiredModel||'',key=select.dataset.catalogModel,isRetired=removedModel(current,connection);
    // Do not mutate the returned directory by inserting a saved model. That
    // used to make an absent/downlisted model look provider-confirmed.
    const models=currentGptModels(result.models.filter(item=>item.available!==false&&item.selectable!==false&&(!key||item.channels?.includes(key)||!item.channels?.length&&profile.channel!=='multimodal')),connection);
    const unavailable=result.models.find(item=>item.id===current&&(item.available===false||item.selectable===false));
    const selected=findTextModel(connection,models,current)?.id||current;
    const absent=current&&!models.some(item=>item.id===selected),strict=strictMediaCatalog(connection),confirmedDirectory=['remote','dreamina-canvas','libtv-cli-directory','desktop-cache','codex-local-catalog','codex-images-api'].includes(result.source)&&result.complete===true;
    if(isRetired){retired.add(current);select.dataset.retiredModel=current;}
    else if(absent){if(strict||confirmedDirectory||unavailable)missing.add(current);if(strict)select.dataset.unavailableModel=current;else models.unshift({id:current,label:current+(unavailable?'（暂不可用）':confirmedDirectory?'（当前配置，目录未返回）':'（当前配置）'),disabled:!!unavailable});}
    if(!absent)delete select.dataset.unavailableModel;
    select.innerHTML=(isRetired?'<option value="" disabled selected>原型号已移除，请选择模型</option>':key?'<option value="">使用默认模型</option>':'<option value="">请选择模型</option>')+models.map(item=>`<option value="${h(item.id)}" ${item.id===selected?'selected':''} ${item.disabled?'disabled':''}>${h(modelLabel(item.label||item.id))}</option>`).join('');
   }
   status.textContent=(result.source==='remote'?`连接返回 ${result.models.length} 个模型${result.complete?'':'（服务目录仍有后续分页）'}`:result.message||'模型由来源管理')+'；只查询目录，不提交生成。'+(missing.size?' 当前模型 '+[...missing].join('、')+' 未出现在该连接的完整目录中，请核对模型是否下线或权限变化；原配置未替换。':'');
   if(retired.size)status.textContent+=' 原型号已移除，请选择新模型后保存。';
  }catch(error){if(request===sequence)status.textContent=error.message+'。保留当前模型，可重试读取目录。';}
  finally{if(request===sequence)button.disabled=false;}
 }
 form.querySelector('[data-model-catalog-refresh]').onclick=()=>load(true);
 void load(false).then(()=>{if(owner.isConnected&&profile.id&&!profile.memberRef&&!profile.externalRef&&form.open)void load(true);});
 return {load};
}
