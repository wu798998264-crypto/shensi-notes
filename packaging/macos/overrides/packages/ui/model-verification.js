const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sessions=new Map(),reminders=new Map(),verified=new Map(),storageKey='shensi-model-verifications';
const verificationKey=(id,accountId)=>accountId?id+':'+accountId:id;
function readVerified(){try{for(const [id,value]of JSON.parse(localStorage.getItem(storageKey)||'[]'))if(Number.isFinite(value?.at))verified.set(id,value);}catch{}}
function rememberVerified(id,result){
 readVerified();verified.set(id,{at:Date.now(),version:result.profileUpdatedAt||''});
 try{localStorage.setItem(storageKey,JSON.stringify([...verified].slice(-500)));}catch{}
 document.dispatchEvent(new CustomEvent('shensi:model-verified',{detail:{profileId:id,...result}}));
}
export function needsCredentialVerification(job){
 const code=String(job?.providerErrorCode||job?.code||'');
 if(code)return /(?:^|_)(?:AUTH_REQUIRED|AUTH_SOURCE_REQUIRED|UNAUTHORIZED|NOT_AUTHENTICATED|LOGIN_REQUIRED|HUMAN_VERIFICATION_REQUIRED|PROFILE_UNVERIFIED|CANVAS_PROFILE_REQUIRED|TOKEN_EXPIRED|MISSING_CREDENTIALS|ACCOUNT_ID_MISSING)$/.test(code)||/^CREDENTIAL(?:S)?_(?:INVALID|EXPIRED|MISSING)$/.test(code);
 return /(?:尚未|未完成|没有)(?:登录|授权|核验)|(?:登录|凭据|授权)(?:已)?(?:失效|过期)|请先(?:登录|核验|授权)/.test([job?.failureReason,job?.error,job?.message].filter(Boolean).join(' '));
}
export function verificationReminderNeeded(profileId,failureAt,accountId){
 readVerified();const at=Date.parse(failureAt||'');return !Number.isFinite(at)||at>(verified.get(verificationKey(profileId,accountId))?.at||0);
}
export async function remindModelVerification(context,{profileId,message,failureAt,accountId}={}){
 const key=verificationKey(profileId,accountId);
 if(!profileId||!verificationReminderNeeded(profileId,failureAt,accountId)||sessions.has(key))return;
 if(reminders.has(key))return reminders.get(key);
 const pending=(async()=>{const answer=await context.modal('需要核验账号','<p>'+h(message)+'</p><p>核验完成后可手动重新生成；不会自动重发这条任务。</p>',[['取消','cancel'],['核验','verify']]);
  if(answer.value==='verify')await openModelVerification(context,profileId,{accountId});
 })().finally(()=>reminders.delete(key));reminders.set(key,pending);return pending;
}
export async function openModelVerification(context,profile,{action='verify',onBrowserOpened,accountId}={}){
 const id=typeof profile==='string'?profile:profile.id,key=verificationKey(id,accountId);
 if(sessions.has(key)){const active=sessions.get(key);if(!active.background)return active.pending;active.finish();}
 const session={};sessions.set(key,session);
 let version=typeof profile==='object'?profile.updatedAt:undefined,latest={},timer,background=false;
 const call=(next,extra={})=>context.api('/api/official/models/credentials/'+next,{profileId:id,...(version?{expectedUpdatedAt:version}:{}),...(accountId?{accountId}:{}),...extra});
 const finish=()=>{session.cancelled=true;clearTimeout(timer);if(sessions.get(key)===session)sessions.delete(key);};session.finish=finish;
 const mark=result=>rememberVerified(key,{...result,profileId:id,accountId});
 const deadline=Date.now()+15*60_000;
 function watch(){
  if(session.cancelled)return;
  timer=setTimeout(async()=>{
   if(session.cancelled)return;
   if(Date.now()>=deadline){finish();context.toast('核验等待已结束，完成网页登录后可再次点击核验。');return;}
   try{
    latest=await call(latest.needsCompletion?'complete':'verify');
    if(session.cancelled)return;
    if(latest.ok===true){mark(latest);finish();context.toast('账号核验已完成；可返回原卡片手动生成。');return;}
    if(latest.needsBinding||latest.sourcePlugin){finish();context.toast(latest.message);return;}
   }catch(error){
    if(['SETTINGS_CONFLICT','DREAMINA_CANVAS_ACCOUNT_MISMATCH','DREAMINA_AUTH_SOURCE_REQUIRED'].includes(error.code)){finish();context.toast(error.message);return;}
   }
   watch();
  },3000);
 }
 async function run(next){
  let result;
  try{result=await call(next);}catch(error){
   if(next==='verify'&&needsCredentialVerification(error))result={ok:false,needsCredentialPage:true,message:error.message};else throw error;
  }
  if(result.needsBinding){
   version=result.profileUpdatedAt||version;
   const {profiles=[]}=await context.api('/api/official/browser-profiles/read',{});
   const answer=await context.modal('选择原账号的浏览器配置','<p>此配置没有保存账号来源。请选择已登录原账号的浏览器配置；不会按名称猜测账号。</p><label>浏览器配置<select name="browserProfileId" required><option value="">请选择</option>'+profiles.filter(p=>!p.deletedAt).map(p=>'<option value="'+h(p.id)+'">'+h(p.name)+'</option>').join('')+'</select></label>',[['取消','cancel'],['核验','verify']]);
   if(answer.value!=='verify')return result;
   const saved=await call('bind',{browserProfileId:answer.browserProfileId,confirmBinding:true});version=saved.profileUpdatedAt;await context.changed?.();return run('verify');
  }
  if(result.sourcePlugin){context.toast(result.message);if(context.openPlugin)await context.openPlugin(result.sourcePlugin);else context.openSettings?.('plugin:'+result.sourcePlugin);return result;}
  // Authorization is triggered only by the user's button, never by a poll.
  if(next==='verify'&&profile?.adapter!=='api'&&result.credentialMode!=='api_key'&&!result.ok){
   if(result.needsAuthorization||result.needsCompletion)result=await call('authorize',{confirmAuthorization:true});
   else if(result.needsCredentialPage)result=await call('open');
  }
  latest=result;version=result.profileUpdatedAt||version;
  if(result.ok===true)mark(result);
  if(result.browserOpened||result.opened){
   await onBrowserOpened?.(result);
   if(result.browserOpened)document.dispatchEvent(new CustomEvent('shensi:open-browser',{detail:{profileId:result.browserProfileId}}));
   context.toast(result.message||'已打开对应账号网页，完成后会自动检查核验结果。');
   background=true;session.background=true;watch();
  }else context.toast(result.message||(result.ok?'核验完成':'核验尚未完成'));
  return result;
 }
 session.pending=run(action).catch(error=>{background=false;throw error;}).finally(()=>{if(!background)finish();});
 return session.pending;
}
