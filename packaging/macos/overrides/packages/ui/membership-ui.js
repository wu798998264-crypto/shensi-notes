import {createAccountSecurity} from './account-security.js';
import {mountAccountAuth} from './account-auth.js';
import {escapeHtml as h} from './editor.js';
import {openCloudNotebooks} from './cloud-notebooks.js';

// Desktop remembers only account identifiers, never the password or session.
const rememberStore={get:async()=>{try{return JSON.parse(localStorage.getItem('shensi-account-name')||'null');}catch{return null;}},set:async value=>{if(value)localStorage.setItem('shensi-account-name',JSON.stringify(value));else localStorage.removeItem('shensi-account-name');}};

export function createMembershipPanel(context){
 let root,data,auth,busy=false;
 const call=(name,body={})=>context.api('/api/official/membership/'+({status:'account-status',refresh:'account-refresh'}[name]||name),['login','register','email-login'].includes(name)?{...body,accountOnly:true}:body);
 const reload=async()=>{data=await call('refresh');render();};
 const security=createAccountSecurity({call,user:()=>data.user,toast:context.toast,updated:reload});
 async function mount(target){root=target;root.dataset.coreLocalize='';root.textContent='正在读取账号状态…';try{data=await call('status');render();}catch(error){root.textContent=error.message;}}
 function render(){
  auth?.dispose();auth=null;const user=data.user;
  root.classList.add('account-settings-page');
  root.innerHTML=`<section class="account-overview setting-block"><div class="account-avatar" aria-hidden="true">${user?.avatar?'<img src="'+h(user.avatar)+'" alt="账户头像">':(user?.displayName||user?.account)?'<span data-user-content>'+h((user.displayName||user.account).slice(0,1))+'</span>':'<span data-core-copy data-core-english="S">神</span>'}</div><div><h3 ${data.authenticated?'data-user-content':''}>${data.authenticated?h(user.displayName||user.account):'登录神思账号'}</h3><p class="muted">${data.authenticated?'账号：'+h(user.account||user.id)+(data.cached?' · 本机登录状态，待联网核验':' · 已登录'):'使用原版神思账号，支持密码登录、注册和邮箱验证码'}</p></div><div class="spacer"></div>${data.authenticated?'<button data-member="refresh">刷新登录状态</button><button data-member="logout">退出账号</button>':''}</section>`;
  if(data.authenticated){
   root.insertAdjacentHTML('beforeend',`<section class="setting-block account-profile"><h3>个人信息<button data-account-security="profile">编辑</button></h3><div class="setting-row"><span>笔名</span><strong>${h(user.displayName||user.account)}</strong></div><div class="setting-row"><span>账户 ID</span><span class="muted">${h(user.id)}</span></div></section><section class="setting-block account-security"><h3>账户安全</h3><div class="setting-row"><div><strong>验证邮箱</strong><p>${h(user.emailVerifiedAt?user.email:'尚未验证邮箱')}</p></div><span>${user.emailVerifiedAt?'已验证':'未验证'}</span><button data-account-security="bindEmail" ${user.emailVerifiedAt?'disabled':''}>验证绑定</button></div><div class="setting-row"><div><strong>账户密码</strong><p>验证邮箱后设置密码，可使用账号或已验证邮箱登录。</p></div><span>${user.hasPassword?'已设置':'未设置'}</span><button data-account-security="password">设置 / 修改</button></div><div class="setting-row"><div><strong>合并已有账号</strong><p>分别核验已有账号后合并资料。</p></div><button data-account-security="merge">核验并合并</button></div></section>`);
  }else root.insertAdjacentHTML('beforeend','<section class="setting-block account-login"></section>');
  root.insertAdjacentHTML('beforeend','<section class="setting-block account-services"><h3>云端服务</h3><div class="setting-row"><strong>官方云端同步</strong><span data-cloud-service-state>'+h(data.cloudSyncStatus?.message||'云空间尚未联网核验')+'</span><button data-cloud-notebooks '+(data.authenticated?'':'disabled')+'>查看空间与同步</button></div><div class="setting-row"><strong>AI 模型算力积分</strong><span>'+h(data.officialConfiguration?.enabled?'已连接官方算力':'暂未提供服务')+'</span></div></section><p data-member-status role="status">'+h(data.lastError||'')+'</p>');
  root.querySelector('[data-cloud-notebooks]').onclick=()=>openCloudNotebooks(context);
  if(data.authenticated){root.querySelector('.account-overview h3').dataset.userContent='';for(const el of root.querySelectorAll('.account-profile .setting-row strong,.account-profile .setting-row .muted'))el.dataset.userContent='';}
  root.onclick=event=>{const action=event.target.closest('[data-account-security]')?.dataset.accountSecurity;if(action&&action!=='plans'&&security[action]){event.stopPropagation();void security[action]().catch(error=>context.toast(error.message));return;}void onClick(event);};
  if(!data.authenticated)auth=mountAccountAuth(root.querySelector('.account-login'),{call,rememberStore,authenticated:async()=>{document.dispatchEvent(new Event('shensi:account-changed'));data=await call('status');render();await context.changed?.();}});
 }
 async function onClick(event){const button=event.target.closest('[data-member]');if(!button||busy)return;const name=button.dataset.member;if(!['refresh','logout'].includes(name))return;event.stopPropagation();busy=true;button.disabled=true;try{const result=await call(name);if(name==='logout')document.dispatchEvent(new Event('shensi:account-changed'));data=await call('status');render();const message=result.lastError||(name==='logout'?'已退出账号':'账号登录状态已更新');root.querySelector('[data-member-status]').textContent=message;await context.changed?.();context.toast(message);}catch(error){root.querySelector('[data-member-status]').textContent=error.message;}finally{busy=false;if(button.isConnected)button.disabled=false;}}
 return {mount};
}
