import {escapeHtml as h} from './editor.js';
import {mediaDialog} from './media-dialog.js';
import {EXTERNAL_BROWSER} from './model-authorization-source.js';

export function mountExternalBrowser(form,{profile,sources,call,toast}){
 let state=sources,selected=profile.externalBrowserId||'',directory=profile.externalBrowserProfile||'';
 const account=form.querySelector('[name=dreaminaCliProfile]'),binding=form.querySelector('[name=browserProfileId]'),provider=form.querySelector('[name=provider]');
 const originalId=()=>{const source=state.externalBrowsers?.find(s=>s.profileId===account.value);return source?['edge','chrome'].includes(source.browserId)?source.browserId:'custom-'+source.browserId:'';};
 if(!selected)selected=originalId();
 const section=document.createElement('div');section.dataset.externalBrowserControls='';
 section.innerHTML='<label>外部浏览器<div class="setting-inline"><select name="externalBrowserId" style="flex:1;min-width:0"><option value="">请选择浏览器</option></select><button type="button" data-external-browser-edit>设置</button></div></label><details data-external-browser-advanced><summary>用户配置与测试</summary><label data-browser-user-profile>浏览器用户配置<select name="externalBrowserProfile"></select></label><div class="setting-inline"><button type="button" data-external-browser-test>测试打开</button><button type="button" data-external-browser-refresh>刷新</button></div><small data-external-browser-status role="status"></small></details>';
 account.closest('label').before(section);
 const select=section.querySelector('[name=externalBrowserId]'),profiles=section.querySelector('[name=externalBrowserProfile]'),status=section.querySelector('[role=status]');
 function render(){
  const browsers=state.browsers||[];
  select.innerHTML='<option value="">请选择授权所用的浏览器</option>'+[['default','默认'],['custom','自定义']].map(([kind,label])=>'<optgroup label="'+label+'">'+browsers.filter(b=>b.kind===kind).map(b=>'<option value="'+h(b.id)+'">'+h(b.name)+(b.available?'':' · 未找到程序')+'</option>').join('')+'</optgroup>').join('')+(selected&&!browsers.some(b=>b.id===selected)?'<option value="'+h(selected)+'">原浏览器配置不可用</option>':'')+'<option value="__add__">＋ 添加自定义浏览器…</option>';
  select.value=selected;renderProfiles();visible();
 }
 function renderProfiles(){
  const entry=state.browsers?.find(b=>b.id===selected),items=entry?.profiles||[];
  profiles.innerHTML='<option value="">浏览器默认配置</option>'+items.map(p=>'<option value="'+h(p.directory)+'">'+h(p.name+' · '+p.directory)+'</option>').join('')+(directory&&!items.some(p=>p.directory===directory)?'<option value="'+h(directory)+'">'+h(directory)+' · 请核对目录</option>':'');profiles.value=directory;
  profiles.closest('label').hidden=!items.length&&!directory;
  section.querySelector('[data-external-browser-edit]').disabled=!entry;
  section.querySelector('[data-external-browser-test]').disabled=!entry;
  status.textContent=entry?.profileError||(!entry?.available&&entry?'未找到程序，可点“设置”重新选择路径。':'');
 }
 function visible(){const active=form.querySelector('[name=adapter]').value==='cli'&&binding.value===EXTERNAL_BROWSER;section.hidden=!active;select.required=active;select.disabled=!active;profiles.disabled=!active;}
 async function refresh(){state={...state,...await call('/authorization-sources')};render();}
 async function configure(entry){
  const body=mediaDialog(entry?'设置外部浏览器':'添加自定义浏览器'),dialog=body.closest('dialog');dialog.style.width='560px';
  body.innerHTML='<div class="model-form"><label style="grid-column:1/-1">备注名称<input name="browserName" maxlength="100" value="'+h(entry?.name||'')+'" '+(entry?.kind==='default'?'readonly':'')+'></label><label style="grid-column:1/-1">浏览器程序<div class="setting-inline"><input name="browserExecutable" placeholder="选择浏览器 .exe" value="'+h(entry?.executable||'')+'"><button type="button" data-browse-executable>选择程序</button></div></label><details style="grid-column:1/-1"><summary>用户配置（可选）</summary><label><input name="browserChromium" type="checkbox" '+(entry?.chromium?'checked':'')+' '+(entry?.kind==='default'?'disabled':'')+'>此浏览器支持 Chromium 用户配置参数</label><label>用户数据目录<div class="setting-inline"><input name="browserProfileRoot" placeholder="含 Local State 的目录，默认可留空" value="'+h(entry?.profileRoot||'')+'"><button type="button" data-browse-profile-root>选择目录</button></div></label><small>仅读取配置名称；不复制 Cookie 或登录资料。</small></details></div><p role="status"></p><div class="dialog-actions"><button type="button" data-browser-cancel>取消</button><button type="button" data-browser-save class="primary">保存浏览器</button></div>';
  const error=body.querySelector('[role=status]'),save=body.querySelector('[data-browser-save]');
  body.querySelector('[data-browser-cancel]').onclick=()=>{dialog.close();dialog.remove();};
  for(const [selector,action,name]of [['[data-browse-executable]','choose-executable','browserExecutable'],['[data-browse-profile-root]','choose-profile-root','browserProfileRoot']])body.querySelector(selector).onclick=async()=>{try{const result=await call('/external-browsers/'+action,{});if(result.path)body.querySelector('[name='+name+']').value=result.path;}catch(e){error.textContent=e.message;}};
  save.onclick=async()=>{save.disabled=true;error.textContent='';try{
   const result=await call('/external-browsers/save',{expectedRevision:state.revision,entry:{...(entry?{id:entry.id}:{}),name:body.querySelector('[name=browserName]').value,executable:body.querySelector('[name=browserExecutable]').value,chromium:body.querySelector('[name=browserChromium]').checked,profileRoot:body.querySelector('[name=browserProfileRoot]').value}});
   state={...state,...result};if(selected!==result.savedId)directory='';selected=result.savedId;render();dialog.close();dialog.remove();toast('浏览器已保存；保存模型配置后用于核验。');
  }catch(e){error.textContent=e.message;}finally{save.disabled=false;}};
 }
 select.onchange=()=>{if(select.value==='__add__'){select.value=selected;void configure();return;}selected=select.value;directory='';renderProfiles();};
 profiles.onchange=()=>{directory=profiles.value;};
 account.addEventListener('change',()=>{selected=originalId();directory='';render();});
 form.addEventListener('change',visible);
 section.querySelector('[data-external-browser-edit]').onclick=()=>configure(state.browsers?.find(b=>b.id===selected));
 section.querySelector('[data-external-browser-refresh]').onclick=()=>refresh().catch(e=>{status.textContent=e.message;});
 section.querySelector('[data-external-browser-test]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await call('/external-browsers/test',{browserId:selected,profileDirectory:directory});status.textContent='已打开所选浏览器的空白页，请核对用户配置。';}catch(e){status.textContent=e.message;}finally{button.disabled=false;}};
 render();
}
