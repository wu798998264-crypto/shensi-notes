import {modelLabel} from './model-label.js';
import {strictMediaCatalog} from './media-model-policy.js';
import {EXTERNAL_BROWSER,modelAuthorizationFields,hasCredentialPage} from './model-authorization-source.js';
import {mountExternalBrowser} from './model-external-browser.js';
import {showConnectionResult} from './model-connection-result.js';
import {openModelVerification} from './model-verification.js';
import {profileChannels,profileSupports} from './model-capabilities.js';
import {mountModelCatalog} from './model-catalog.js';
import {escapeHtml as h} from './editor.js';
import {removedModel} from './gpt-model-policy.js';

const labels={text:'文本',audio:'音频',video:'视频',image:'图片',multimodal:'多模态'};
const engines=[['codex_api','神思运行器（API）'],['codex','Codex 本地 Agent'],['opencode','OpenCode'],['deepseek_opencode','OpenCode + DeepSeek'],['claude_code','Claude Code'],['workbuddy','WorkBuddy'],['custom','自定义本地 Agent']];
const permissions=[['shensi_only','仅神思工作区工具'],['approval_required','敏感操作逐项确认'],['full_access','完整访问']];

export function createModelsPanel(context){
 let channel='text',data,root,browserProfiles=[],externalBrowsers=[];const editDrafts=new Map();
 const call=(name,body)=>context.api('/api/official/models'+name,body);
 async function mount(target){root=target;root.dataset.coreLocalize='';root.textContent='正在读取模型配置…';try{[data,browserProfiles,externalBrowsers]=await Promise.all([call(''),context.api('/api/official/browser-profiles/read',{}).then(s=>s.profiles).catch(()=>[]),call('/authorization-sources').then(s=>s.externalBrowsers||[]).catch(()=>[])]);render();}catch(error){root.textContent=error.message;}}
 function render(){
  data={...data,defaultAliasTargets:{...data.defaultAliasTargets,...Object.fromEntries(data.profiles.filter(p=>p.aliasFor).map(p=>[p.id,p.aliasFor]))},profiles:data.profiles.filter(p=>!p.aliasFor)};
root.innerHTML=`<header class="settings-section-title"><h2>模型设置</h2><p>集中管理文本、图片、视频、音频和多模态连接，供插件选择。文本 Agent 可由神思运行器或已配置的本地 Agent 执行。</p></header><nav class="plugin-tabs">${Object.entries(labels).map(([key,label])=>`<button data-channel="${key}" class="${channel===key?'active':''}">${label}</button>`).join('')}</nav><div class="setting-row"><p>${data.credentialStorage==='encrypted'?'密钥使用本机安全存储加密，插件仅保存配置引用。':data.credentialStorage==='encrypted-readonly'?'预览只读原账号空间的加密密钥；新增密钥仅在本次运行生效，持久修改请使用桌面版。':'当前预览没有桌面解密能力；新输入的密钥仅在本次运行生效，已有加密密钥请从原桌面入口使用。'}</p><button data-model-new>＋ 新增${labels[channel]}配置</button></div><section class="official-compute-entry setting-block ${data.officialConfiguration?.locked!==false?'is-locked':''}"><button data-official-compute aria-disabled="${data.officialConfiguration?.locked!==false}" class="official-compute-button"><strong>官方算力</strong><span>${h(data.officialConfiguration?.message||'请登录神思账号并购买算力积分套餐；在线购买暂未提供服务。')}</span></button></section><div class="models-list">${data.profiles.filter(profile=>channel==='multimodal'?profile.channel===channel:profileSupports(profile,channel)).map(profile=>`<section class="setting-block"><div class="setting-inline"><h3>${h(profile.name)}</h3><span class="badge">${profile.enabled===false?'已停用':profile.adapter.toUpperCase()}</span></div><p>${h(profile.provider)}${profile.externalRef?' · 插件算力：'+h(profile.externalRef.pluginId):profile.memberRef?' · 官方算力凭据，调用前核验':profile.hasSecret?' · 密钥已配置':''}${channel==='text'?` · ${h(engines.find(([id])=>id===profile.agentEngine)?.[1]||'神思运行器')}`:''}</p><div class="setting-inline">${profile.adapter==='tts'?'<button data-speech-settings>音源与音色设置</button>':''}<button data-model-edit="${profile.id}" ${profile.externalRef?'disabled title="由来源插件管理"':''}>${profile.externalRef?'插件管理':'编辑'}</button><button data-model-test="${profile.id}">测试连接</button><button data-model-delete="${profile.id}" ${profile.externalRef?'disabled title="请在来源插件中移除配置"':''}>删除</button></div></section>`).join('')||'<div class="plugin-empty">尚无配置。添加后可在对话或生成操作栏选择。</div>'}</div>`;
  root.querySelectorAll('[data-model-edit]').forEach(button=>{if(data.profiles.find(p=>p.id===button.dataset.modelEdit)?.memberRef)button.textContent='编辑参数';});
  for(const profile of data.profiles.filter(p=>channel==='multimodal'?p.channel===channel:profileSupports(p,channel))){
   const actions=root.querySelector(`[data-model-test="${profile.id}"]`)?.parentElement;if(!actions)continue;
   const card=actions.closest('.setting-block');card.querySelector('h3').dataset.userContent='';card.querySelector('p').innerHTML=`<span data-user-content>${h(profile.provider)}</span>${profile.externalRef?' · <span>插件算力：</span><span data-user-content>'+h(profile.externalRef.pluginId)+'</span>':profile.memberRef?' · <span>官方算力凭据，调用前核验</span>':profile.hasSecret?' · <span>密钥已配置</span>':''}${channel==='text'?' · <span>'+h(engines.find(([id])=>id===profile.agentEngine)?.[1]||'神思运行器')+'</span>':''}`;
   if(channel!=='multimodal'){const isDefault=(data.defaultAliasTargets?.[data.defaultProfiles?.[channel]]||data.defaultProfiles?.[channel])===profile.id;const b=document.createElement('button');b.type='button';b.dataset.modelDefault=profile.id;b.textContent=isDefault?'默认配置':'设为默认';b.setAttribute('aria-pressed',String(isDefault));b.disabled=profile.enabled===false||isDefault;actions.prepend(b);if(profile.channel==='multimodal'){const source=document.createElement('p');source.textContent='来自多模态配置 · 共用原连接与凭证';actions.before(source);}}
   for(const [label,action]of [[profile.adapter==='api'?'核验接口':'核验','verify'],...(hasCredentialPage(profile)?[['打开凭证页面','open']]:[])]){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.modelCredentialAction=action;b.onclick=()=>void openModelVerification(context,profile,{action}).catch(error=>context.toast(error.message));actions.append(b);}
   if(profile.adapter==='cli'&&profile.browserProfileId){const source=document.createElement('p');source.className='model-browser-source';source.textContent='凭证来源：'+(browserProfiles.find(p=>p.id===profile.browserProfileId)?.name||'已删除或未启用，请重新选择')+' · 网页登录与模型授权分别核验';actions.before(source);}
   else if(profile.adapter==='cli'&&profile.dreaminaCliProfile){const original=externalBrowsers.find(p=>p.profileId===profile.dreaminaCliProfile),source=document.createElement('p');source.className='model-browser-source';source.textContent='外部浏览器：'+(original?original.name+' · '+original.browserName:'原账号来源待核验');actions.before(source);}
  }
  for(const p of data.profiles.filter(p=>p.adapter==='browser')){const card=root.querySelector(`[data-model-edit="${p.id}"]`)?.closest('.setting-block');if(card){card.querySelector('.badge').textContent=p.enabled===false?'来源未就绪':'网页账号';card.querySelector('h3').dataset.userContent='';card.querySelector('p').innerHTML='<span data-user-content>'+h(p.provider)+'</span> · <span>'+(p.channel==='text'?'网页问答（不执行 Agent 工具）':'原账号媒体生成')+'</span>';const source=card.querySelector('[data-model-edit]');source.disabled=false;delete source.dataset.modelEdit;source.dataset.sourcePlugin=p.externalRef.pluginId;source.textContent='打开来源插件';}}
root.onclick=async event=>{try{const button=event.target.closest('button');if(!button)return;if(button.dataset.sourcePlugin)return context.openPlugin?.(button.dataset.sourcePlugin);if(button.hasAttribute('data-official-compute'))return official();if(button.dataset.speechSettings)return context.openPlugin?.('thirdparty.text-reader');if(button.dataset.channel){channel=button.dataset.channel;render();return;}if(button.dataset.modelDefault){data=await call('/default',{channel,profileId:button.dataset.modelDefault,expectedRevision:data.defaultsRevision});render();await context.changed?.();context.toast('默认配置已保存，仅用于之后新建的卡片');return;}if(button.hasAttribute('data-model-new'))return edit();if(button.dataset.modelEdit)return edit(button.dataset.modelEdit);if(button.dataset.modelDelete){const answer=await context.modal('删除模型配置','<p>插件会保留此配置的引用，重新选择配置前不能调用。笔记、对话和历史均保留。</p>');if(answer.value==='ok'){data={...data,...await call('/remove',{profileId:button.dataset.modelDelete,expectedRevision:data.revision})};render();await context.changed?.();}return;}if(button.dataset.modelTest){const answer=await context.modal('测试模型连接','<p>测试会访问你填写的服务。文本连接测试可能产生少量模型用量。</p>',[['取消','cancel'],['测试连接','test']]);if(answer.value==='test'){await showConnectionResult(button,()=>call('/test',{profileId:button.dataset.modelTest}));}}}catch(error){context.toast(error.message);}};
 }
 async function official(){
  const access=data.officialConfiguration;
  if(access?.enabled){
   const state=await context.api('/api/official/membership/status',{}),catalog=state.models||[];
   const answer=await context.modal('官方算力模型','<p>已购买算力积分套餐。启用时由账号服务签发专属凭据；实际调用仍校验权益与积分。</p><label>官方模型<select name="modelId">'+catalog.map(p=>'<option value="'+h(p.id)+'">'+h(p.name)+' · '+h(labels[p.channel])+'</option>').join('')+'</select></label>',catalog.length?[['关闭','cancel'],['启用模型','enable']]:[['关闭','cancel']]);
   if(answer.value==='enable'){if(data.profiles.some(p=>p.memberRef?.modelId===answer.modelId)){context.toast('此官方模型已添加，可在下方启用或编辑参数');return;}await context.api('/api/official/membership/issue',{modelId:answer.modelId,requestId:crypto.randomUUID()});data=await call('');render();await context.changed?.();}
   return;
  }
  const answer=await context.modal('官方算力积分套餐','<p>'+h(access?.message||'请购买算力积分套餐后使用官方模型。')+'</p><p>神思会员仅提供云存储与增值服务。在线购买暂未提供服务。</p>',[['关闭','cancel'],['刷新权益','refresh']]);
  if(answer.value==='refresh'){await context.api('/api/official/membership/refresh',{});data=await call('');render();await context.changed?.();}
 }
 async function edit(id){
  if(id)data=await call('');
  const profile=data.profiles.find(item=>item.id===id)||{channel,name:'',provider:'自定义兼容接口',adapter:'api',protocol:channel==='video'?'videos':'chat_completions',baseUrl:'',model:'',enabled:true,agentEngine:'codex_api',agentPermissionMode:'shensi_only'};
  try{browserProfiles=(await context.api('/api/official/browser-profiles/read',{})).profiles;}catch{browserProfiles=[];}
  let sourceError='',authorizationSources={};try{authorizationSources=await call('/authorization-sources');externalBrowsers=authorizationSources.externalBrowsers||[];}catch(error){externalBrowsers=[];sourceError=error.message;}
  const externalSelected=!profile.browserProfileId;
  const browserBinding='<div data-browser-source-field><label>凭证来源<select name="browserProfileId"><option value="" disabled>请选择凭证来源</option><option value="'+EXTERNAL_BROWSER+'" '+(externalSelected?'selected':'')+'>外部浏览器</option>'+browserProfiles.map(p=>'<option value="'+h(p.id)+'" '+(profile.browserProfileId===p.id?'selected':'')+'>'+h(p.name)+'</option>').join('')+(profile.browserProfileId&&!browserProfiles.some(p=>p.id===profile.browserProfileId)?'<option selected value="'+h(profile.browserProfileId)+'">原配置已删除或浏览器未启用，请重新绑定</option>':'')+'</select></label><label data-external-browser-account>外部浏览器账号<select name="dreaminaCliProfile"><option value="">请选择已有的账号来源</option>'+externalBrowsers.map(p=>'<option value="'+h(p.profileId)+'" '+(profile.dreaminaCliProfile===p.profileId?'selected':'')+'>'+h(p.name+' · '+p.browserName)+'</option>').join('')+(profile.dreaminaCliProfile&&!externalBrowsers.some(p=>p.profileId===profile.dreaminaCliProfile)?'<option selected value="'+h(profile.dreaminaCliProfile)+'">原账号来源不可用，请核验后重选</option>':'')+'</select>'+(sourceError?'<span>'+h(sourceError)+'</span>':'')+'</label></div><p>外部浏览器用于打开账号的登录与授权网页；选择内置浏览器配置后，按该配置独立授权。切换网页配置不改变运行中任务的账号。</p>';
  const field=(label,key,type='text')=>`<label>${label}<input name="${key}" type="${type}" value="${h(profile[key]??'')}" ${key==='apiKey'?'autocomplete="new-password" placeholder="留空保留已有密钥"':''}></label>`;
  const modelSelect=(key,value='',capability='')=>`<select name="${key}" data-catalog-model="${capability}" ${removedModel(value,profile)?`data-retired-model="${h(value)}"`:strictMediaCatalog(profile)&&value?`data-unavailable-model="${h(value)}"`:''} aria-label="${capability?labels[capability]+'模型':'默认模型'}"><option value="">${capability?'使用默认模型':'请选择模型'}</option>${removedModel(value,profile)?'<option value="" disabled selected>原型号已移除，请选择模型</option>':value&&!strictMediaCatalog(profile)?`<option value="${h(value)}" selected>${h(modelLabel(value))}</option>`:''}</select>`;
  const textAgent=profile.channel==='text'||profile.channel==='multimodal'&&(!profile.id||profileChannels(profile).includes('text'));
  const multimodalFields=profile.channel==='multimodal'?'<fieldset class="model-capability-fields"><legend>可用能力与模型映射</legend>'+['text','image','video','audio'].map(key=>`<div class="model-capability-field"><span>${labels[key]}</span><div class="model-capability-row">${modelSelect('model_'+key,profile.capabilityModels?.[key]||'',key)}<input type="checkbox" name="capability_${key}" aria-label="启用${labels[key]}能力" ${profileChannels(profile).includes(key)?'checked':''}></div></div>`).join('')+'</fieldset>':'';
  const engineSelect=`<label>任务运行器<select name="agentEngine">${engines.map(([engine,label])=>`<option value="${engine}" ${(profile.agentEngine||(profile.adapter==='api'?'codex_api':'codex'))===engine?'selected':''}>${label}</option>`).join('')}</select></label><label>权限范围<select name="agentPermissionMode">${permissions.map(([mode,label])=>`<option value="${mode}" ${(profile.agentPermissionMode||'shensi_only')===mode?'selected':''}>${label}</option>`).join('')}</select></label><label>Codex 凭据来源<select name="credentialSource"><option value="" ${!profile.credentialSource?'selected':''}>隔离运行环境</option><option value="codex_session" ${profile.credentialSource==='codex_session'?'selected':''}>已登录的 Codex 会话</option></select></label><p class="model-form-note">神思运行器使用当前 API 配置；其他运行器调用对应的本地 Agent。选择“已登录的 Codex 会话”会使用本机现有 Codex 登录，不复制凭据。白板和文档任务共用此配置。</p>`;
  const mediaFields=textAgent?'':field('比例','aspectRatio')+field('分辨率','resolution')+field('时长（秒）','durationSeconds','number')+field('音色 ID（自定义语音接口必填）','voice');
  const pending=context.modal(id?'编辑'+labels[profile.channel]+'模型':'新增'+labels[profile.channel]+'模型',`<div class="model-form">${field('配置名称','name')}${browserBinding}${field('服务商凭证网页（自定义接口可填写）','credentialPageUrl')}${multimodalFields}<label>提供商<select name="provider">${data.providers.map(provider=>`<option value="${h(provider.id)}" ${provider.id===profile.provider?'selected':''}>${h(provider.id)}</option>`).join('')}</select></label><label>连接方式<select name="adapter"><option value="api" ${profile.adapter==='api'?'selected':''}>API</option><option value="cli" ${profile.adapter==='cli'?'selected':''}>CLI</option></select></label><label>协议<select name="protocol">${[...new Set(['chat_completions','responses','anthropic_messages','audio_speech','videos',profile.protocol].filter(Boolean))].map(protocol=>`<option value="${protocol}" ${protocol===profile.protocol?'selected':''}>${protocol}</option>`).join('')}</select></label>${field('接口地址','baseUrl')}<label>默认模型${modelSelect('model',profile.model)}</label><div class="model-catalog-controls"><button type="button" data-model-catalog-refresh>读取连接模型目录</button><output data-model-catalog-status role="status"></output></div><label>API 密钥<input name="apiKey" type="password" autocomplete="new-password" placeholder="${profile.hasSecret?'留空保留已有密钥':'输入此配置的 API 密钥'}"></label>${field('CLI 路径或命令','cliPath')}${field('CLI 参数','cliArgs')}${field('推理等级','reasoningEffort')}${field('温度','temperature','number')}${field('最大输出 Token','maxOutputTokens','number')}${field('超时（毫秒）','timeoutMs','number')}${textAgent?engineSelect:mediaFields}<label>状态<select name="enabled"><option value="true" ${profile.enabled!==false?'selected':''}>启用</option><option value="false" ${profile.enabled===false?'selected':''}>停用</option></select></label></div><p>仅修改此配置；更换提供商不会自动覆盖已填写的接口或模型。</p>`,[['取消','cancel'],['保存模型配置','save']],true);
  const form=document.querySelector('#dialog');let suspended=false;
  const lane=document.createElement('label');lane.innerHTML='即梦执行方式<input name="dreaminaCanvasMode" type="hidden"><span>画布 CLI（同一白板共用画布）</span>';form.querySelector('[name=cliPath]').closest('label').after(lane);
  const laneVisibility=()=>{
   const canvas=form.querySelector('[name=provider]').value==='即梦'&&!profile.memberRef;lane.hidden=!canvas;lane.querySelector('input').value=canvas?'canvas':'';
   for(const key of ['adapter','cliPath','cliArgs'])form.querySelector('[name='+key+']').disabled=canvas||!!profile.memberRef;
   if(canvas){form.querySelector('[name=adapter]').value='cli';form.querySelector('[name=cliPath]').value='shensi-dreamina-canvas';form.querySelector('[name=cliArgs]').value='';}
   const cli=form.querySelector('[name=adapter]').value==='cli';
   for(const key of ['protocol','baseUrl','apiKey','cliPath','cliArgs']){const field=form.querySelector('[name='+key+']');if(field)field.closest('label').hidden=canvas||(!cli&&['cliPath','cliArgs'].includes(key));}
   const binding=form.querySelector('[name=browserProfileId]'),external=canvas&&binding.value===EXTERNAL_BROWSER,source=form.querySelector('[name=dreaminaCliProfile]'),box=form.querySelector('[data-browser-source-field]');
   box.hidden=!cli;box.nextElementSibling.hidden=!cli;binding.disabled=!cli||!!profile.memberRef;binding.required=cli;
   source.closest('label').hidden=!external;source.required=external;source.disabled=!external;
   for(const key of ['credentialPageUrl','credentialSource']){const field=form.querySelector('[name='+key+']');if(field){field.closest('label').hidden=!cli;field.disabled=!cli||!!profile.memberRef;}}
   const note=form.querySelector('.model-form-note');
   if(note){
    note.dataset.cliNote??=note.textContent;
    const deepSeekApi=!cli&&form.querySelector('[name=agentEngine]')?.value==='deepseek_opencode';
    note.textContent=deepSeekApi?'OpenCode 使用此配置的 DeepSeek API 密钥执行白板和文档任务。':cli?note.dataset.cliNote:'神思运行器使用当前 API 配置；白板和文档任务共用此配置。';
   }
   const credentialActions=form.querySelector('.model-credential-actions');if(credentialActions){credentialActions.querySelector('p').textContent=cli?'核验与凭证页面使用已保存的配置，不使用尚未保存的接口或密钥。':'核验已保存的供应商接口与密钥，不需要浏览器授权。';const open=credentialActions.querySelector('[data-model-credential-action=open]');if(open)open.hidden=!cli||!hasCredentialPage(profile);credentialActions.querySelector('[data-model-credential-action=verify]').textContent=cli?'核验':'核验接口';}
  };laneVisibility();form.addEventListener('change',laneVisibility);
  if(id){const box=document.createElement('section');box.className='setting-block model-credential-actions';box.innerHTML='<p>核验与凭证页面使用已保存的配置，不使用尚未保存的接口或密钥。</p><div class="setting-inline"></div>';for(const [label,action]of [['核验','verify'],...(hasCredentialPage(profile)?[['打开凭证页面','open']]:[])]){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.modelCredentialAction=action;b.onclick=()=>void openModelVerification(context,profile,{action,onBrowserOpened:result=>{if(!profile.browserProfileId&&result.browserProfileId)form.querySelector('[name=browserProfileId]').value=result.browserProfileId;editDrafts.set(id,Object.fromEntries([...form.querySelectorAll('[name]')].map(el=>[el.name,el.type==='checkbox'?el.checked:el.value])));suspended=true;form.querySelector('[data-choice=cancel]').click();}}).catch(error=>context.toast(error.message));box.lastElementChild.append(b);}form.querySelector('h2').after(box);}
  const draft=editDrafts.get(id);if(draft)for(const el of form.querySelectorAll('[name]'))if(Object.hasOwn(draft,el.name)){
   const value=draft[el.name];
   if(el.type==='checkbox'){el.checked=value;continue;}
   if(el.hasAttribute('data-catalog-model')&&removedModel(value,{...profile,...draft})){el.dataset.retiredModel=value;el.value='';continue;}
   if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===value)){
    if(el.hasAttribute('data-catalog-model')&&strictMediaCatalog(profile))el.dataset.unavailableModel=value;else el.add(new Option(value,value));
   }
   el.value=value;
  }
  const mediaOnly=()=>{const checkbox=form.querySelector('[name=capability_text]');if(checkbox){const canvas=form.querySelector('[name=provider]').value==='即梦';checkbox.disabled=canvas;form.querySelector('[name=model_text]').disabled=canvas;if(canvas)checkbox.checked=false;}};mediaOnly();form.addEventListener('change',mediaOnly);
  laneVisibility();mountExternalBrowser(form,{profile:{...profile,...draft},sources:authorizationSources,call,toast:context.toast});const catalog=mountModelCatalog(form,{profile,call});
  if(profile.memberRef)for(const key of ['provider','adapter','protocol','baseUrl','model','apiKey','cliPath','cliArgs','agentEngine','credentialSource','dreaminaCliProfile','browserProfileId','credentialPageUrl']){const input=form.querySelector(`[name=${key}]`);if(input){input.disabled=true;input.title='会员模型接口及密钥由账号服务管理';}}
  form.querySelector('[name=provider]').onchange=event=>{laneVisibility();const preset=data.providers.find(item=>item.id===event.target.value);if(!id){for(const key of ['baseUrl','protocol']){const input=form.querySelector(`[name=${key}]`);if((!input.value||event.target.value==='DeepSeek')&&preset?.api?.[key])input.value=preset.api[key];}}void catalog.load();};
  if(textAgent){
   const engine=form.querySelector('[name=agentEngine]'),adapter=form.querySelector('[name=adapter]');
   adapter.onchange=()=>{engine.value=adapter.value==='api'?'codex_api':'codex';};
   engine.onchange=()=>{
    adapter.value=['codex_api','deepseek_opencode'].includes(engine.value)?'api':'cli';
    if(engine.value==='deepseek_opencode'){
     form.querySelector('[name=provider]').value='DeepSeek';
     form.querySelector('[name=baseUrl]').value='https://api.deepseek.com/v1';
     form.querySelector('[name=protocol]').value='chat_completions';
    }
    laneVisibility();
    void catalog.load();
   };
  }
  const answer=await pending;if(answer.value!=='save'){if(!suspended)editDrafts.delete(id);return;}
  const next=modelAuthorizationFields({...profile,...Object.fromEntries(Object.entries(answer).filter(([key])=>!['value','apiKey'].includes(key))),channel:profile.channel,enabled:answer.enabled==='true'});
  if(profile.channel==='multimodal'){next.channels=['text','image','video','audio'].filter(key=>answer['capability_'+key]==='on');next.capabilityModels=Object.fromEntries(next.channels.map(key=>[key,answer['model_'+key]||'']));for(const key of ['text','image','video','audio']){delete next['capability_'+key];delete next['model_'+key];}}
  for(const key of ['temperature','maxOutputTokens','timeoutMs','durationSeconds']){if(answer[key]==='')delete next[key];else if(answer[key]!==undefined)next[key]=Number(answer[key]);}
  data={...data,...await call('/save',{profile:next,expectedRevision:data.revision,...(answer.apiKey?{apiKey:answer.apiKey}:{})})};editDrafts.delete(id);render();await context.changed?.();context.toast('模型配置已保存');
 }
 return {mount};
}
