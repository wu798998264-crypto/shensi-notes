import {escapeHtml as h} from './editor.js';
import {modelFieldsMarkup,chatIcon} from './chat-layout.js';
import {pickerProfileId} from './model-capabilities.js';
import {defaultTextProfile,textModelSelection,textModelSummary} from './text-model-selection.js';

async function readTextProfiles(){
 const token=document.querySelector('meta[name="shensi-session"]')?.content;
 if(!token)throw Error('当前页面没有可用的模型目录会话，请重新打开设置');
 const response=await fetch('/api/official/models',{headers:{'X-Shensi-Token':token},signal:AbortSignal.timeout(10000)}),result=await response.json();
 if(!response.ok)throw Error(result.message||'模型目录读取失败');
 return result.profiles;
}

// Retain the selected identity if its source becomes temporarily unavailable.
export function mountTaskModelPicker(host,{profiles,selection={},changed=()=>{},loadProfiles=readTextProfiles}){
 let value={...selection},opened=false,disposed=false,loading=false,refreshError='',refreshEpoch=0;
 const available=()=>profiles.filter(p=>(!p.aliasFor||p.id===value.profileId)&&p.enabled!==false&&(p.channel==='text'||p.channels?.includes('text')));
 function normalize(){value.profileId=pickerProfileId(profiles,value.profileId);const profile=value.profileId?available().find(p=>p.id===value.profileId):defaultTextProfile(profiles);if(profile)value={profileId:profile.id,...textModelSelection(profile,value)};return profile;}
 function snapshot(){return Object.fromEntries(['profileId','model','reasoningEffort','speedMode'].map(k=>[k,value[k]||'']));}
 function render(){
  const profile=normalize(),items=available(),unavailable=!!value.profileId&&!profile;
  host.classList.add('task-model-picker','shensi-chat');
  host.innerHTML=`<button type="button" class="quick-model-button" data-task-model-toggle aria-label="切换本次任务模型" aria-expanded="${opened}"><span>${h(unavailable?'原配置暂不可用':textModelSummary(profile,value))}</span>${chatIcon('\uE70D')}</button><section class="chat-model-panel" data-task-model-panel popover="manual" role="dialog" aria-label="本次任务模型" ${opened?'':'hidden'}><header><strong>本次任务模型</strong><button type="button" data-task-model-close aria-label="关闭模型选择">×</button></header><div class="chat-model-fields"><label class="chat-profile-field">模型配置<select data-task-profile aria-label="任务模型配置" ${!items.length?'disabled':''}>${unavailable?`<option value="${h(value.profileId)}" selected disabled>原配置暂不可用，请核对设置</option>`:!items.length?'<option value="" disabled selected>暂无可用文字配置</option>':''}${items.map(p=>`<option value="${h(p.id)}" ${p.id===value.profileId?'selected':''}>${h(p.name)}</option>`).join('')}</select></label><div class="chat-model-mapping">${modelFieldsMarkup(profile,value)}</div></div><p data-task-model-status role="status" ${loading||refreshError?'':'hidden'}>${h(loading?'正在刷新模型目录…':refreshError)}</p></section>`;
  const note=host.querySelector('.chat-model-note');
  note.textContent=profile?'仅用于本次任务，按模型支持的参数显示。':unavailable?'保留原配置选择，未改用其他账号。请在设置 → 模型设置中核对连接及插件状态。':'请在设置 → 模型设置中添加或启用文字配置，再展开此面板刷新。';
  const row=document.createElement('div');row.className='task-model-parameters';for(const label of host.querySelectorAll('.chat-model-mapping>label:not(.chat-concrete-model-field)'))row.append(label);note.before(row);
  if(opened){host.querySelector('[data-task-model-panel]').showPopover();position();}
 }
 function position(){if(!opened||disposed)return;const panel=host.querySelector('[data-task-model-panel]'),r=host.querySelector('[data-task-model-toggle]').getBoundingClientRect();Object.assign(panel.style,{position:'fixed',margin:'0',inset:'auto',width:'max-content',minWidth:Math.min(240,innerWidth-20)+'px',maxWidth:Math.min(420,innerWidth-20)+'px',maxHeight:Math.max(100,innerHeight-20)+'px'});const {width,height}=panel.getBoundingClientRect(),above=r.top-10,below=innerHeight-r.bottom-10,up=above>=height||above>below;panel.style.maxHeight=Math.max(100,up?above:below)+'px';panel.style.left=Math.max(10,Math.min(r.left,innerWidth-width-10))+'px';panel.style.top=Math.max(10,up?r.top-6-Math.min(height,above):r.bottom+6)+'px';}
 async function refresh(){const epoch=++refreshEpoch;loading=true;refreshError='';render();try{const next=await loadProfiles();if(disposed||epoch!==refreshEpoch)return;if(!Array.isArray(next))throw Error('模型目录返回格式无效');profiles=next;normalize();changed(snapshot());}catch(error){if(disposed||epoch!==refreshEpoch)return;refreshError='目录刷新失败，保留当前选择：'+error.message;}finally{if(!disposed&&epoch===refreshEpoch){loading=false;render();}}}
 function close(){if(!opened)return;opened=false;const panel=host.querySelector('[data-task-model-panel]');if(panel.matches(':popover-open'))panel.hidePopover();panel.hidden=true;host.querySelector('[data-task-model-toggle]').setAttribute('aria-expanded','false');}
 host.onclick=e=>{if(e.target.closest('[data-task-model-toggle]')){if(opened)close();else{opened=true;void refresh();}}else if(e.target.closest('[data-task-model-close]'))close();};
 host.onchange=e=>{e.stopPropagation();const t=e.target;if(t.matches('[data-task-profile]'))value={profileId:t.value};else if(t.matches('[data-chat-model]'))value={profileId:value.profileId,model:t.value};else if(t.matches('[data-chat-reasoning]'))value.reasoningEffort=t.value;else if(t.matches('[data-chat-speed]'))value.speedMode=t.value;else return;++refreshEpoch;loading=false;render();changed(snapshot());};
 const outside=e=>{if(!host.contains(e.target))close();},escape=e=>{if(e.key==='Escape'&&opened){e.preventDefault();e.stopPropagation();close();}};
 document.addEventListener('pointerdown',outside,true);host.addEventListener('keydown',escape);window.addEventListener('resize',position);render();
 return {snapshot,set:next=>{value={...next};render();},refresh,dispose:()=>{close();disposed=true;++refreshEpoch;window.removeEventListener('resize',position);document.removeEventListener('pointerdown',outside,true);host.removeEventListener('keydown',escape);host.onclick=host.onchange=null;}};
}
