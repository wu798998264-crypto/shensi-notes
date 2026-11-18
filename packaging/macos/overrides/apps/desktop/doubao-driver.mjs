import {doubaoPageAction} from '../../packages/thirdparty/doubao-page.mjs';
import {doubaoBrainPageCore} from '../../packages/thirdparty/vendor/doubao-brain/page-core.mjs';
import {doubaoOriginalMedia} from './doubao-original-media.mjs';
import {isDoubaoPageUrl} from '../../packages/thirdparty/doubao-readiness.mjs';
import {confirmationReplies,pendingStatusInquiry} from '../../packages/thirdparty/doubao-confirmations.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {get as httpsGet} from 'node:https';
import {Readable} from 'node:stream';
import * as navigation from './browser-navigation.mjs';
// Independent updates preserve compatibility with the installed host's native
// navigation. Shared browser chrome upgrades remain owned by the host.
export const attachBrowserNavigation=navigation.attachBrowserNavigation;
export const createBrowserWindowWithNavigation=navigation.createBrowserWindowWithNavigation||((Window,options)=>new Window(options));
const focusBrowserNativeInput=navigation.focusBrowserNativeInput||(async()=>{});
const withBrowserNativeInput=navigation.withBrowserNativeInput||((_win,operation)=>operation(null));
const withBrowserDebugger=navigation.withBrowserDebugger||(async(win,operation)=>{
 const debug=win.webContents.debugger;if(debug.isAttached())throw Error('网页正在调试，未抢占输入');debug.attach('1.3');
 try{return await operation(debug);}finally{if(!win.webContents.isDestroyed()&&debug.isAttached())debug.detach();}
});
const fail=(message,code='DOUBAO_PAGE_CHANGED')=>Object.assign(Error(message),{code});
// Observe only this task's own outgoing request; no retry, cookie capture or
// successful response-body capture. Keep this in the existing extension file
// so an independent update can run on a host without new module paths.
export async function watchDoubaoSubmission(debug,task){
 const requests=new Map();let closed=false;
 const failureText=value=>String(value||'').replaceAll(task.prompt||'\0','[提示词]').replace(/https?:\/\/\S+/g,'[网页地址]').replace(/(?:Bearer\s+|sk-)[\w.-]+/g,'[已隐藏]').slice(0,400);
 const listener=(_event,method,p)=>{
  if(closed)return;
  if(method==='Network.requestWillBeSent'){
   let url,body;try{url=new URL(p.request.url);body=JSON.parse(p.request.postData||'');}catch{return;}
   if(url.origin!=='https://www.doubao.com'||url.pathname!=='/chat/completion'||p.request.method!=='POST')return;
   const text=body.messages?.[0]?.content_block?.[0]?.content?.text_block?.text,prefix={text:'',image:'生成图片：',video:'生成视频：'}[task.kind];
   if(prefix===undefined||!task.prompt||body.messages?.length!==1||text!==task.prompt&&text!==prefix+task.prompt)return;
   if(requests.size>=8||requests.has(p.requestId))return;
   requests.set(p.requestId,{state:'pending',startedAt:new Date().toISOString()});
  }
  const row=requests.get(p.requestId);if(!row)return;
  if(method==='Network.responseReceived')Object.assign(row,{httpStatus:p.response.status,...p.response.status>=400?{state:'failed',reason:'豆包请求返回 HTTP '+p.response.status}:{}});
  if(method==='Network.loadingFailed')Object.assign(row,{state:'failed',reason:'豆包请求连接失败：'+failureText(p.errorText)});
  if(method==='Network.loadingFinished'){
   if(row.state!=='failed')row.state='received';
   // Only a bounded JSON error envelope, never a streamed answer body.
   if(row.httpStatus>=400)void debug.sendCommand('Network.getResponseBody',{requestId:p.requestId}).then(result=>{
    if(closed||result.base64Encoded||typeof result.body!=='string'||result.body.length>16000)return;
    try{const v=JSON.parse(result.body),message=v.message||v.msg||v.error?.message||v.error_msg;if(typeof message==='string')row.reason+='：'+failureText(message);}catch{}
   }).catch(()=>{});
  }
 };
 // Detached observers cannot establish that an old request is still pending.
 const close=()=>{closed=true;debug.removeListener('message',listener);debug.removeListener('detach',close);requests.clear();};
 debug.on('message',listener);debug.on('detach',close);
 try{await debug.sendCommand('Network.enable');}catch{close();}
 return {read:()=>{const rows=[...requests.values()],last=rows.at(-1);return last?{...last,attempts:rows.length,owned:true}:null;},close};
}
export const allowedDoubaoMedia=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['doubao.com','byteimg.com','douyin.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}};
// Only a previously verified signed CDN URL, no Cookie export, redirects or
// alternate asset. Some CDN edges fail Chromium HTTP/2 but accept HTTP/1.1.
export const doubaoHttp1MediaResponse=(url,{signal}={})=>new Promise((resolve,reject)=>{
 if(!allowedDoubaoMedia(url)){reject(fail('原成品地址未核验','DOUBAO_MEDIA_ORIGIN'));return;}
 const request=httpsGet(url,{signal,ALPNProtocols:['http/1.1'],headers:{Referer:'https://www.doubao.com/','Accept-Encoding':'identity'}},response=>resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,Array.isArray(value)?value.join(', '):value]))})));
 request.on('error',reject);
});
export function createDoubaoDriver({getWindow,open,reopenEmptyWorkPage,mediaIdleMs=30000,refreshAfterMs=120000,pendingAckRefreshAfterMs=5000,creationBootstrapReloadAfterMs=10000,creationWakeIntervalMs=1500,http1Fetch=doubaoHttp1MediaResponse}){
 const staleOriginals=new Map(),pendingAcks=new Map(),submissionTransports=new Map();
 const transportKey=t=>t.id||t.accountId;
 const win=id=>{const w=getWindow(id);if(!w||w.isDestroyed()||!isDoubaoPageUrl(w.webContents.getURL()))throw fail('原账号网页不可用，请打开账号后台');return w;};
 const creationRoute=url=>/^https:\/\/(www\.)?doubao\.com\/chat\/create-(image|video)\/?$/.exec(url||'')?.[2]||'';
 async function action(id,op,arg,dismissed=false){const w=win(id),url=w.webContents.getURL();let timer;try{const result=await Promise.race([w.webContents.executeJavaScript('('+doubaoPageAction.toString()+')('+JSON.stringify(op)+','+JSON.stringify(arg||{})+',('+doubaoBrainPageCore.toString()+'))',true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(fail('网页操作超时（'+op+'）；未自动重复操作'),{operation:op})),10000);})]);const current=w.webContents.getURL(),modeTransition=op==='mode'&&creationRoute(url)&&creationRoute(current)===arg?.kind;if(!isDoubaoPageUrl(current)||op!=='new'&&op!=='send'&&!modeTransition&&current!==url)throw Object.assign(fail('任务页面已切换'),{navigation:{operation:op,from:isDoubaoPageUrl(url)?url:'',to:isDoubaoPageUrl(current)?current:''}});if(result.error)throw fail(result.error,result.code||'DOUBAO_PAGE_CHANGED');
  if(result.gate==='page_blocked'&&!dismissed&&!['observe-readonly','diagnostics','send','confirm'].includes(op)){
   const promotion=await action(id,'dismiss-desktop-promotion',{},true);if(promotion.dismissed)return action(id,op,arg,true);
  }
  if(result.gate&&!['observe','observe-readonly'].includes(op))throw fail('账号页面需要处理：'+result.gate,result.gate);return result;}finally{clearTimeout(timer);}}
 async function until(fn,signal,ms=10000,notReady='网页未在时限内就绪'){const end=Date.now()+ms;while(Date.now()<end){signal?.throwIfAborted();const value=await fn();if(value)return value;await delay(150,undefined,{signal});}throw fail(notReady);}
 async function attention(task){const w=win(task.accountId);return {requiresUserAttention:true,url:w.webContents.getURL(),message:'请点击任务中的打开原网页，完成登录或人工核验后继续原任务。'};}
 async function prepare(task,{signal,files=[],previousCompleted}={}){
  signal?.throwIfAborted();
  // Observed live: a new hidden window can mount the creation page directly,
  // but entering the Work homepage first can leave its media route unusable.
  // Only choose this route for a NEW window/new media task. Existing windows
  // and preparation retries still inspect/preserve their current draft first.
  const existingWindow=getWindow(task.accountId),newWindow=!existingWindow||existingWindow.isDestroyed(),wasVisible=!newWindow&&existingWindow.isVisible?.()===true;
  await open({accountId:task.accountId,visible:false,...(newWindow&&!task.retryPreparation&&['image','video'].includes(task.kind)?{url:'https://www.doubao.com/chat/create-image'}:{})});
  signal?.throwIfAborted();await action(task.accountId,'inspect');signal?.throwIfAborted();
  if(task.retryPreparation){
   const draft=await action(task.accountId,'draft-ready',{prompt:task.prompt,kind:task.kind});
   if(draft.ready&&!files.length){
    if(task.kind==='video'&&Number(task.durationSeconds)===15&&!(await action(task.accountId,'video-duration',{kind:'video',prompt:task.prompt,phase:'read'})).ready)throw fail('原视频草稿时长不符合 15 秒，未发送，请先核对原参数','DOUBAO_DURATION_MISMATCH');
    let stableSince=0;await until(async()=>{const current=await action(task.accountId,'draft-ready',{prompt:task.prompt,kind:task.kind});
     if(!current.ready)throw fail('原任务草稿已改变，未覆盖内容或提交','DOUBAO_DRAFT_CHANGED');
     if(!(await action(task.accountId,'send-ready',{prompt:task.prompt,kind:task.kind})).ready){stableSince=0;return false;}
     stableSince||=Date.now();return Date.now()-stableSince>=300;
    },signal,10000,'原任务草稿发送控件未就绪，未提交');
    return {url:win(task.accountId).webContents.getURL(),preparedMode:task.kind,reusedUnsentDraft:true};
   }
   if(draft.hasDraft||draft.uploads)throw fail('输入区仍有不能精确归属于本任务的草稿或附件；请保留并处理原内容后重试，未清空或发送','DOUBAO_DRAFT_CONFLICT');
  }
  // Native media creation pages can finish without any New conversation
  // control. Leave one only when its exact prior receipt is durable AND the
  // original reply is still complete. Never navigate an unknown/user page.
  const prior=previousCompleted,current=win(task.accountId),priorUrl=prior?.url;
  if(!wasVisible&&reopenEmptyWorkPage&&['image','video'].includes(task.kind)&&prior?.id!==task.id&&prior?.accountId===task.accountId&&prior.status==='complete'&&prior.completedAt&&!prior.remoteMayBeRunning&&/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(priorUrl||'')&&current.webContents.getURL()===priorUrl&&current.isVisible?.()===false&&!(await action(task.accountId,'new-ready')).ready){
   const ready=await action(task.accountId,'refresh-ready');
   if(!ready.ready)throw fail('上个已完成任务页面仍有草稿、附件或活动回复；未离开或清空','DOUBAO_DRAFT_CONFLICT');
   const seen=await observe(prior,{readOnly:true});signal?.throwIfAborted();
   const returned=prior.kind==='text'?seen.answer===prior.result?.text&&!!seen.answer:seen.artifacts?.length>0&&prior.result?.artifacts?.length>0&&seen.artifacts.every(a=>prior.result.artifacts.some(p=>p.messageId===a.messageId));
   if(!seen.ack||seen.userId!==prior.userId||seen.url!==priorUrl||seen.gate||seen.waiting||seen.stopping||seen.confirmation||!returned)throw fail('上个任务原结果无法完整核对；未新建或重发','DOUBAO_PREVIOUS_RESULT_NOT_VERIFIED');
   // Recheck after the read-only history lookup, before destroying a window.
   if(!(await action(task.accountId,'refresh-ready')).ready||current.isVisible?.()!==false||current.webContents.getURL()!==priorUrl)throw fail('原页面已变化，未离开或清空','DOUBAO_DRAFT_CONFLICT');
   await reopenEmptyWorkPage({accountId:task.accountId,url:'https://www.doubao.com/chat/create-image'});
  }
  const entryFailure='未找到可用的新对话入口或空白输入区；原网页内容保留，未提交';let entry,creationReloaded=false,creationWakeCount=0,lastCreationWakeAt=0;const entryStarted=Date.now();
  // The navigation sidebar mounts before the media editor. A New button by
  // itself is not readiness; wait for the usable editor before leaving this phase.
  try{entry=await until(async()=>{const state=await action(task.accountId,'new-ready');
   if(state.pendingComposer&&creationWakeCount<3&&Date.now()-lastCreationWakeAt>=creationWakeIntervalMs&&newWindow&&!task.retryPreparation&&!task.submittedAt){
    const w=win(task.accountId);if(w.isVisible?.()===false&&creationRoute(w.webContents.getURL())){
     creationWakeCount++;lastCreationWakeAt=Date.now();signal?.throwIfAborted();await withBrowserNativeInput(w,async()=>{signal?.throwIfAborted();w.webContents.invalidate?.();});return null;
    }
   }
   if(state.unavailable){const w=win(task.accountId),url=w.webContents.getURL();
    if(!creationReloaded&&newWindow&&!task.retryPreparation&&w.isVisible?.()===false&&creationRoute(url)){creationReloaded=true;signal?.throwIfAborted();await w.loadURL(url);return null;}
    throw fail('豆包创作页提示暂时不可用，未填写或发送；请稍后重试或打开原网页检查','DOUBAO_CREATION_PAGE_UNAVAILABLE');
   }
   if(state.emptyBootstrap&&!creationReloaded&&newWindow&&!task.retryPreparation&&!task.submittedAt&&Date.now()-entryStarted>=creationBootstrapReloadAfterMs){
    const w=win(task.accountId),url=w.webContents.getURL();
    if(w.isVisible?.()===false&&creationRoute(url)){creationReloaded=true;signal?.throwIfAborted();await w.loadURL(url);return null;}
   }
   return state.composer&&(state.ready||state.empty)?state:null;},signal,30000,entryFailure);}
  catch(error){
   if(error.message===entryFailure&&!signal?.aborted){
    // Preserve only structural readiness, never chat text, drafts or identity.
    // This is a diagnostic read, not another navigation/preparation attempt.
    try{const d=await action(task.accountId,'diagnostics',{prompt:task.prompt,kind:task.kind});error.message+=`（输入区：${d.composer?'已出现':'未出现'}；新对话候选：${d.newConversation?.candidates?.length??0}；历史消息：${d.messageCount??0}）`;error.code='DOUBAO_NEW_CONVERSATION_NOT_READY';}catch{}
   }
   throw error;
  }
  let workEntry=false;
  if(entry.ready&&!entry.empty)try{workEntry=(await action(task.accountId,'new')).workEntry===true;}catch(error){const fresh=await action(task.accountId,'fresh');if(error.message!=='未找到新对话入口'||!fresh.empty||!fresh.composer)throw error;}
  // A new conversation can finish its /chat/ -> /chat redirect after the
  // click resolves. Retry only this read-only, pre-send freshness check;
  // never relax the URL guard around mode selection, filling or observing.
  await until(async()=>{try{const p=await action(task.accountId,'fresh');return p.empty&&p.composer;}catch(error){if(error.code==='DOUBAO_PAGE_CHANGED'&&error.message==='任务页面已切换')return false;throw error;}},signal,10000,'新对话未变为空白可编辑状态，可能仍有草稿、附件或消息；未清空原内容、未提交');
  // Work's SPA keeps stale editor/virtual-list state across completed chats.
  // Only after its explicit New action has produced a proven EMPTY page,
  // recreate our hidden window in the SAME persistent account partition.
  // Visible windows, drafts, uploads, old/unknown jobs and retries are untouched.
  if(workEntry&&!task.retryPreparation&&reopenEmptyWorkPage&&win(task.accountId).isVisible?.()===false){
   signal?.throwIfAborted();const fresh=await action(task.accountId,'fresh');
   if(!fresh.empty||!fresh.composer)throw fail('新工作任务已有草稿，未重开','DOUBAO_DRAFT_CONFLICT');
   await reopenEmptyWorkPage({accountId:task.accountId,url:'https://www.doubao.com/chat'+(['image','video'].includes(task.kind)?'/create-image':'/')});
   await until(async()=>{const p=await action(task.accountId,'fresh');return p.empty&&p.composer;},signal,10000,'独立空白任务输入区未就绪，未发送');
  }
  const mode={kind:task.kind};
  if(!(await action(task.accountId,'mode-ready',mode)).ready){
   await action(task.accountId,'mode-reset',mode);
   await until(async()=>!(await action(task.accountId,'mode-ready',mode)).chip,signal,10000,'上一个生成模式未退出，未修改提示词或提交');
   // Composer mounting can precede an enabled capability button. Wait only
   // on the read-only entry check, then select the requested mode once.
   const missingMode='未找到对应的生成能力入口，网页未在时限内就绪';
   try{await until(async()=>(await action(task.accountId,'mode-ready',mode)).ready||(await action(task.accountId,'mode-entry-ready',mode)).ready,signal,10000,missingMode);}
   catch(error){
    if(error.message!==missingMode||!['image','video'].includes(task.kind)||signal?.aborted)throw error;
    // Only this observed landing route is a fallback. Never leave a formal
    // conversation, an attached reference or a draft while looking for it.
    const fresh=await action(task.accountId,'fresh');
    if(!fresh.empty||!fresh.composer||!/^https:\/\/(www\.)?doubao\.com\/chat\/?$/.test(win(task.accountId).webContents.getURL()))throw error;
    signal?.throwIfAborted();
    const destination={accountId:task.accountId,visible:false,url:'https://www.doubao.com/chat/create-image'};
    // The Work homepage can leave stale SPA editor state even after loadURL.
    // Recreate only our proven empty hidden page, in the same account partition.
    if(reopenEmptyWorkPage&&win(task.accountId).isVisible?.()===false)await reopenEmptyWorkPage(destination);else await open(destination);
    await until(async()=>{const fresh=await action(task.accountId,'fresh');return fresh.empty&&fresh.composer&&creationRoute(win(task.accountId).webContents.getURL())==='image';},signal,30000,'新版生成入口未变为空白可编辑状态，未提交');
    await until(async()=>(await action(task.accountId,'mode-entry-ready',mode)).ready,signal,10000,missingMode);
   }
   if(!(await action(task.accountId,'mode-ready',mode)).ready)await action(task.accountId,'mode',mode);
   const creationSelection=!!creationRoute(win(task.accountId).webContents.getURL());
   await until(async()=>{try{return (await action(task.accountId,'mode-ready',mode)).ready;}catch(error){if(creationSelection&&error.code==='DOUBAO_PAGE_CHANGED'&&error.message==='任务页面已切换'&&creationRoute(win(task.accountId).webContents.getURL())===task.kind)return false;throw error;}},signal,10000,'所选生成模式未就绪，未写入提示词或提交');
  }
  if(task.kind==='video'&&Number(task.durationSeconds)===15){
   await until(async()=>(await action(task.accountId,'video-duration',{...mode,phase:'entry-ready'})).ready,signal,10000,'视频时长入口未就绪，未发送任务');
   if(!(await action(task.accountId,'video-duration',{...mode,phase:'read'})).ready){
    await action(task.accountId,'video-duration',{...mode,phase:'open'});
    // Opening the menu schedules React rendering. Wait on its exact owned
    // duration slider without opening it again or retrying a send.
    await until(async()=>(await action(task.accountId,'video-duration',{...mode,phase:'focus-ready'})).ready,signal,10000,'视频时长参数未就绪，未发送任务');
    const w=win(task.accountId),wc=w.webContents;await withBrowserNativeInput(w,async debug=>{
     await action(task.accountId,'video-duration',{...mode,phase:'focus'});
     const key=async(value,number)=>{if(debug){for(const type of ['rawKeyDown','keyUp'])await debug.sendCommand('Input.dispatchKeyEvent',{type,key:value,code:value,windowsVirtualKeyCode:number,nativeVirtualKeyCode:number});}else{wc.sendInputEvent({type:'keyDown',keyCode:value});wc.sendInputEvent({type:'keyUp',keyCode:value});}};
     await key('End',35);await until(async()=>(await action(task.accountId,'video-duration',{...mode,phase:'read'})).ready,signal,10000,'视频时长未切换为15秒，未发送');await key('Escape',27);
    });
   }
  }
  if(files.length){
   for(const file of files){const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(file.path)){signal?.throwIfAborted();hash.update(chunk);size+=chunk.length;}if(hash.digest('hex')!==file.sha256||size!==file.size)throw fail('排队期间参考附件已改变，未上传或发送','DOUBAO_REFERENCE_CHANGED');}
   // Validate the whole reference set first, then upload in authored order.
   // One file per selection avoids the website dropping a tail of a large batch.
   await action(task.accountId,'reference-input',{kind:task.kind,files:files.map(f=>({name:f.name})),sequential:true});
   const images=files.filter(f=>/\.(?:png|jpe?g|webp|apng|gif)$/i.test(f.name));let uploadState;
   const checkUpload=state=>{if(state.failure)throw fail('参考附件上传失败：'+state.failure,'DOUBAO_REFERENCE_UPLOAD_FAILED');if(state.imageLimit>0&&images.length>state.imageLimit)throw fail(`当前豆包网页明确最多支持 ${state.imageLimit} 张参考图，本次选择 ${images.length} 张；未发送或消耗生成额度。请减少参考图后重试。`,'DOUBAO_REFERENCE_COUNT_UNSUPPORTED');return state.ready;};
   checkUpload(await action(task.accountId,'uploads',{names:[]}));
   for(let index=0;index<files.length;index++){
    signal?.throwIfAborted();const file=files[index],names=files.slice(0,index+1).map(f=>f.name);
    const uploader=await action(task.accountId,'reference-input',{kind:task.kind,files:[{name:file.name}]});
    const w=win(task.accountId);await withBrowserDebugger(w,async debug=>{const {root}=await debug.sendCommand('DOM.getDocument');const {nodeId}=await debug.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:uploader.selector});if(!nodeId)throw fail('原参考文件上传入口已变化，未上传','DOUBAO_REFERENCE_UPLOADER_CHANGED');await debug.sendCommand('DOM.setFileInputFiles',{nodeId,files:[file.path]});});
    try{await until(async()=>{uploadState=await action(task.accountId,'uploads',{names});return checkUpload(uploadState);},signal,30000,'参考附件未完成上传，未发送');}
    catch(error){if(error.message==='参考附件未完成上传，未发送'){error.code='DOUBAO_REFERENCE_UPLOAD_NOT_READY';error.message+=`（第 ${index+1}/${files.length} 项，已核对 ${uploadState?.matched??0}/${names.length}；${uploadState?.pending?'网页仍在上传':'网页未确认全部附件'}）`+(uploadState?.missing?.length?'；未确认：'+uploadState.missing.join('、'):'')+'。未发送，不会静默丢弃参考或重复上传。';}throw error;}
   }
  }
  // Write exactly once. Controlled editors may commit asynchronously; immediate
  // readback is not proof of truncation. Never retry a write or relax equality.
  await action(task.accountId,'fill',{prompt:task.prompt,kind:task.kind});
  let stableSince=0,readback;
  await until(async()=>{readback=await action(task.accountId,'send-ready',{prompt:task.prompt,kind:task.kind});
   if(!readback.ready){stableSince=0;return false;}stableSince||=Date.now();return Date.now()-stableSince>=300;
  },signal,10000,'提示词未完整写入或发送控件未稳定就绪，未提交');
  return {url:win(task.accountId).webContents.getURL(),preparedMode:task.kind};
 }
 async function send(task,{signal}={}){
  signal?.throwIfAborted();const args={prompt:task.prompt,kind:task.kind,durationSeconds:task.durationSeconds};
  const w=win(task.accountId),url=w.webContents.getURL();
  if(url!==task.url)throw fail('原发送页面正在变化，未点击发送');
  // One trusted click, never a DOM click followed by a native retry. Some
  // creation pages ignore synthetic clicks but still return from click().
  await withBrowserDebugger(w,async debug=>{await focusBrowserNativeInput(w,debug);signal?.throwIfAborted();if(w.isDestroyed()||w.webContents.getURL()!==url)throw fail('发送页面已切换，未继续点击');
   const key=transportKey(task);submissionTransports.get(key)?.close();
   const monitor=await watchDoubaoSubmission(debug,task);submissionTransports.set(key,monitor);
   w.webContents.once?.('destroyed',()=>{monitor.close();if(submissionTransports.get(key)===monitor)submissionTransports.delete(key);});
   // Focus can reflow the hidden creation page. Verify the exact draft and
   // current hit target AFTER focusing, before this one trusted click.
   const point=async()=>{const {sendPoint}=await action(task.accountId,'send',{...args,nativeInput:true});if(!sendPoint||!Number.isSafeInteger(sendPoint.x)||!Number.isSafeInteger(sendPoint.y))throw fail('原发送控件位置不可核验，未提交');return sendPoint;};
   const active=()=>{signal?.throwIfAborted();if(w.isDestroyed()||w.webContents.getURL()!==url)throw fail('发送页面已切换，未继续点击');};
   let sendPoint=await point(),stable=false;
   // Hover can reflow the button or update a controlled editor. Recheck the
   // exact draft/mode and current hit after moving, before the sole press.
   // Only pointer movement may be adjusted; an uncertain press is never retried.
   for(let move=0;move<2;move++){active();await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...sendPoint});active();const current=await point();if(current.x===sendPoint.x&&current.y===sendPoint.y){stable=true;break;}sendPoint=current;}
   if(!stable)throw fail('发送按钮持续移动，未点击发送；请稍后重新生成','DOUBAO_SEND_POINT_UNSTABLE');
   for(const event of [{type:'mousePressed',button:'left',clickCount:1},{type:'mouseReleased',button:'left',clickCount:1}]){active();await debug.sendCommand('Input.dispatchMouseEvent',{...event,...sendPoint});}});
  return {clicked:true};
 }
 async function observe(task,{manualReplies,readOnly=false,inquireStatus=false}={}){
  const formal=url=>/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(url||'');
  const current=win(task.accountId).webContents.getURL(),args={prompt:task.prompt,kind:task.kind,referenceNames:(task.files||[]).map(f=>f.name),preparedMode:task.preparedMode,durationSeconds:task.durationSeconds,confirmation:task.confirmation,confirmationReplies:confirmationReplies(task),recoverHistory:true,userId:task.userId,renderedPromptUrl:task.submittedAt?(formal(task.url)?task.url:formal(task.observedPageUrl)?task.observedPageUrl:null):null};
  const op=manualReplies===undefined&&!readOnly?'observe':'observe-readonly';if(manualReplies!==undefined)Object.assign(args,{manualReplies,userId:task.userId});
  args.inquireStatus=inquireStatus||pendingStatusInquiry(task);
  // Only an active, submitted media task may initialize its own lazy player.
  // Diagnostics/legacy recovery never click Play. Hidden playback stays silent.
  if(op==='observe'&&task.kind==='video'&&task.submittedAt&&!task.stoppedAt&&task.status!=='stopped'){
   const w=win(task.accountId);if(!w.isVisible?.()){w.webContents.setAudioMuted?.(true);args.activateMedia=true;args.nativeMediaInput=true;}
  }
  if(task.url&&/\/chat\/\d+/.test(task.url)&&current!==task.url)throw fail('当前窗口已离开原任务，请打开原任务继续观察','DOUBAO_ORIGINAL_TASK_REQUIRED');
  if(formal(task.observedPageUrl)&&current!==task.observedPageUrl)throw fail('当前窗口已离开首次观察的会话，未读取其他任务','DOUBAO_ORIGINAL_TASK_REQUIRED');
  // The first send can pass through /chat -> /chat/ -> /chat/<id>.
  // Re-read only these provisional transitions, bounded to three reads. Once
  // a formal route has appeared, any different conversation is still fatal.
  const awaitingReceipt=(task.status==='submit_intent'||task.status==='waiting'&&task.referenceAuthorizationAcceptedAt)&&!!task.submittedAt&&!task.userId&&!formal(task.url)&&!formal(task.observedPageUrl);
  const local=url=>/^https:\/\/(www\.)?doubao\.com\/chat\/local_[0-9]+\/?$/.test(url||'');
  let localRoute=awaitingReceipt&&local(current)?current:'';
  const temporary=url=>/^https:\/\/(www\.)?doubao\.com\/chat\/?$/.test(url||'')||task.preparedMode===task.kind&&(creationRoute(url)===task.kind||task.kind==='video'&&creationRoute(url)==='image'&&url===task.url)||awaitingReceipt&&local(url)&&(!localRoute||url===localRoute);
  let pinned=formal(current)?current:null;
  for(let attempt=0;attempt<3;attempt++){
   const before=win(task.accountId).webContents.getURL();
   if(pinned&&before!==pinned)throw fail('任务页面已切换');
   try{
    const seen=await action(task.accountId,op,{...args,...(attempt&&pinned&&task.submittedAt?{renderedPromptUrl:pinned}:{})});
    if(attempt&&(seen.url!==before||seen.ack&&!seen.userId||task.userId&&task.userId!==seen.userId))throw fail('首次跳转后无法唯一确认原消息，请打开原任务核对；未重新发送');
    // Observed live: creation -> formal chat can leave an empty mounted list
    // although the send succeeded (sometimes only its assistant row mounts).
    // Refresh that durably pinned route once,
    // only while this fresh submission is still owned and has no reply/draft.
    // No timeout extension, send, parameter confirmation or stopped-task revival.
    const pendingWindow=win(task.accountId),pendingKey=task.accountId,pendingSignature=JSON.stringify([task.id,task.observedPageUrl]);
    if(op==='observe'&&task.status==='submit_intent'&&task.submittedAt&&!task.stoppedAt&&!task.userId&&pendingWindow.isVisible?.()===false&&formal(task.observedPageUrl)&&seen.url===task.observedPageUrl&&!seen.ack&&!seen.gate&&(seen.historyRecovery?.userMessageCount??seen.historyRecovery?.messageCount)===0){
     let pending=pendingAcks.get(pendingKey);
     if(pending?.signature!==pendingSignature){pending={signature:pendingSignature,since:Date.now(),refreshed:false};pendingAcks.set(pendingKey,pending);}
     if(!pending.refreshed&&Date.now()-pending.since>=pendingAckRefreshAfterMs){
      const ready=await action(task.accountId,'pending-ack-refresh-ready',{renderedPromptUrl:task.observedPageUrl});
      if(ready.ready&&pendingWindow.isVisible?.()===false&&pendingWindow.webContents.getURL()===task.observedPageUrl){pending.refreshed=true;await pendingWindow.loadURL(task.observedPageUrl);return {ack:false,url:task.observedPageUrl,refreshingOriginal:true};}
     }
    }else if(seen.ack||task.status!=='submit_intent')pendingAcks.delete(pendingKey);
    // Native pointer sequence targets only a verified unique visible Play in
    // this owned answer. New players no longer react to DOM .click alone.
    // No desktop cursor, foreground window or generic button fallback.
    if(args.activateMedia&&seen.ack&&!seen.gate&&seen.mediaActivations?.length){
     const w=win(task.accountId);if(w.isVisible()||w.webContents.getURL()!==seen.url)throw fail('原后台播放器已变化，未操作');
     await withBrowserDebugger(w,async debug=>{await focusBrowserNativeInput(w,debug);for(const point of seen.mediaActivations){if(!Number.isSafeInteger(point.x)||!Number.isSafeInteger(point.y))throw fail('原播放器位置无效');if(w.isVisible()||w.webContents.getURL()!==seen.url)throw fail('原后台播放器已变化，未操作');await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await debug.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}});
    }
    // A completed acceptance message can remain stale after a background
    // reconnect. Re-read only its pinned original route after two unchanged
    // minutes; never reload drafts, visible windows, active replies or players.
    const key=task.accountId,w=win(key),eligible=op==='observe'&&task.kind!=='text'&&task.submittedAt&&task.userId&&task.status==='waiting'&&w.isVisible?.()===false&&formal(task.url)&&seen.url===task.url&&seen.userId===task.userId&&seen.ack&&!seen.gate&&seen.waiting&&seen.completed&&!seen.stopping&&!seen.confirmation&&!seen.pendingMedia&&!seen.artifacts?.length;
    if(!eligible)staleOriginals.delete(key);
    else{
     const signature=JSON.stringify([task.id,task.url,seen.userId,seen.providerMessage]),prior=staleOriginals.get(key);
     if(prior?.signature!==signature)staleOriginals.set(key,{signature,since:Date.now()});
     else if(Date.now()-prior.since>=refreshAfterMs){
      const ready=await action(key,'refresh-ready');prior.since=Date.now();
      if(ready.ready&&w.isVisible?.()===false&&w.webContents.getURL()===task.url){await w.loadURL(task.url);staleOriginals.delete(key);return {ack:false,url:task.url,refreshingOriginal:true};}
     }
    }
    const transport=submissionTransports.get(transportKey(task));
    // A local_<id> bubble is optimistic UI, not a provider receipt. Keep the
    // exact outgoing request observable while waiting for its formal route.
    if(seen.ack&&formal(seen.url)){transport?.close();submissionTransports.delete(transportKey(task));return seen;}
    if(task.kind==='text'&&seen.ack&&!formal(seen.url))return {ack:false,url:seen.url,gate:seen.gate,submissionTransport:transport?.read()};
    return {...seen,...seen.ack&&local(seen.url)?{ack:false}:{},...(transport?.read()?{submissionTransport:transport.read()}:{})};
   }catch(error){
    const destination=win(task.accountId).webContents.getURL();
    if(attempt===2||pinned||!temporary(task.url)||!temporary(before)||error.code!=='DOUBAO_PAGE_CHANGED'||error.message!=='任务页面已切换'||!temporary(destination)&&!formal(destination))throw error;
    if(awaitingReceipt&&local(destination))localRoute||=destination;
    if(formal(destination))pinned=destination;
   }
  }
 }
 async function recoverPreparedResult(task){
  const current=win(task.accountId).webContents.getURL(),formal=url=>/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(url||'');
  if(!formal(current)||formal(task.url)&&task.url!==current||task.files?.length)throw fail('请在原账号打开对应的已生成会话；未切换网页或重发','DOUBAO_ORIGINAL_TASK_REQUIRED');
  // Explicit result-only operation: no navigation, editor, send or confirmation.
  return action(task.accountId,'observe-readonly',{prompt:task.prompt,kind:task.kind,renderedPromptUrl:current,recoverHistory:true});
 }
 async function confirm(task,{assertActive=async()=>{}}={}){
  if(task.confirmationDetails?.kind==='reference_authorization'){
   if(!task.referenceAuthorizationIntentAt||!task.confirmationExecuting||task.userId)throw fail('缺少本次素材声明的明确确认，未操作','DOUBAO_REFERENCE_AUTHORIZATION_REQUIRED');
   const w=win(task.accountId),url=w.webContents.getURL();if(url!==task.url)throw fail('原素材声明页面已切换，未确认');
   const args={kind:task.kind,prompt:task.prompt,referenceNames:(task.files||[]).map(f=>f.name),expected:task.confirmationDetails,userConfirmed:true};
   const click=async sendPoint=>{if(!Number.isSafeInteger(sendPoint?.x)||!Number.isSafeInteger(sendPoint?.y))throw fail('原控件位置不可核验，未点击');await assertActive();await withBrowserDebugger(w,async debug=>{await focusBrowserNativeInput(w,debug);for(const event of [{type:'mouseMoved'},{type:'mousePressed',button:'left',clickCount:1},{type:'mouseReleased',button:'left',clickCount:1}]){await assertActive();if(w.isDestroyed()||w.webContents.getURL()!==url)throw fail('原素材声明页面已变化，未继续点击');await debug.sendCommand('Input.dispatchMouseEvent',{...event,...sendPoint});}});};
   const state=await action(task.accountId,'reference-authorization-state',args);
   if(!state.ready)throw fail('本次素材声明已失效，原草稿或参考顺序无法核对；请使用卡片重试，不会自动重发','DOUBAO_REFERENCE_AUTHORIZATION_EXPIRED');
   if(!state.present){
    // The first click was durably observed at the authorization gate, before
    // any receipt existed. Restore ONLY that unchanged creation draft once;
    // the durable confirmation intent prevents replay after interruption.
    if(task.observedPageUrl||task.referenceAuthorizationAcceptedAt||task.confirmationSentAt||task.status!=='confirmation_required')throw fail('原请求可能已受理，未重新打开声明','DOUBAO_REFERENCE_AUTHORIZATION_EXPIRED');
    await click((await action(task.accountId,'send',{...args,durationSeconds:task.durationSeconds,nativeInput:true})).sendPoint);
    const restored=await until(async()=>{
     const next=await action(task.accountId,'reference-authorization-state',args);if(next.present)return {declaration:true};
     const seen=await observe({...task,status:'waiting',referenceAuthorizationAcceptedAt:task.referenceAuthorizationIntentAt},{readOnly:true});if(seen.ack&&seen.userId&&!seen.gate)return {accepted:true};return false;
    },undefined,10000,'本次声明未重新出现，原请求状态待核对；不会重复点击发送');
    if(restored.accepted)return {confirmed:true};
   }
   await click((await action(task.accountId,'authorize-reference',args)).sendPoint);
   return {confirmed:true};
  }
  const args={prompt:task.prompt,kind:task.kind,preparedMode:task.preparedMode,durationSeconds:task.durationSeconds,confirmation:task.confirmation,confirmationReplies:confirmationReplies(task),replyOnly:task.confirmationReplyOnly===true,userId:task.userId,expected:task.confirmationDetails,recoverHistory:true,renderedPromptUrl:task.submittedAt?task.url:null};
  args.inquireStatus=task.confirmationDetails?.statusOnly===true;
  const original=()=>{if(!task.url||win(task.accountId).webContents.getURL()!==task.url)throw fail('当前窗口已离开原任务，未确认','DOUBAO_ORIGINAL_TASK_REQUIRED');};
  original();await assertActive();
  const prepared=await action(task.accountId,'confirm',{...args,prepareOnly:true});if(!prepared.prepared)throw fail('原任务参数未准备就绪，未确认');
  // React may enable Send only after processing the input event. Write once,
  // then poll read-only readiness; never rewrite or retry a confirmation click.
  await until(async()=>{original();await assertActive();return (await action(task.accountId,'confirm-ready',args)).ready;},undefined,5000,'网页确认参数控件未就绪，未发送确认');
  original();await assertActive();return action(task.accountId,'confirm',{...args,commitPrepared:true});
 }
 async function download(task,artifact,{signal}={}){
  if(!allowedDoubaoMedia(artifact.url))throw fail('成品地址不在已核对的豆包媒体域名内，请从原任务检查','DOUBAO_MEDIA_ORIGIN');
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;let timer,finished=false;
  const progress=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(fail('豆包原成品下载停滞，原任务保留；可继续取回结果，不会重新生成','DOUBAO_DOWNLOAD_TIMEOUT')),mediaIdleMs);timer.unref?.();};
  try{
   progress();const url=await doubaoOriginalMedia({window:win(task.accountId),task,artifact,signal:combined,allowed:allowedDoubaoMedia,readOriginal:()=>observe(task,{readOnly:task.kind!=='video'||task.status!=='complete'}),refreshOriginal:async verified=>{
    const w=win(task.accountId);if(w.isVisible?.()!==false||task.status!=='complete'||!task.completedAt||task.remoteMayBeRunning)return null;
    const ready=await action(task.accountId,'refresh-ready');combined.throwIfAborted();
    if(!ready.ready||w.isVisible?.()!==false||w.webContents.getURL()!==task.url)return null;
    await w.loadURL(task.url);combined.throwIfAborted();
    return until(async()=>{const seen=await observe(task,{readOnly:task.kind!=='video'});if(seen.gate||seen.waiting||seen.stopping||seen.confirmation)throw fail('原成品页面已变化，未下载其他内容');return verified(seen)?seen:null;},combined,10000,'原成品页面重读后仍无法核验');
   }});combined.throwIfAborted();
   const read=async response=>{
   if(!response.ok)throw fail('原任务成品下载失败：HTTP '+response.status,'DOUBAO_DOWNLOAD_FAILED');
   const mimeType=(response.headers.get('content-type')||'').split(';')[0].toLowerCase(),prefix=task.kind==='video'?'video/':'image/';
   if(!mimeType.startsWith(prefix))throw fail('下载内容不是本次需要的媒体类型','DOUBAO_INVALID_MEDIA');
   const chunks=[],limit=task.kind==='video'?128*1024*1024:32*1024*1024;let size=0;
   if(Number(response.headers.get('content-length'))>limit)throw fail('媒体超过安全下载大小，请打开原任务下载','DOUBAO_MEDIA_TOO_LARGE');
   if(!response.body)throw fail('下载成品为空，不会回写卡片','DOUBAO_EMPTY_MEDIA');
   progress();for await(const chunk of response.body){combined.throwIfAborted();progress();size+=chunk.length;if(size>limit)throw fail('媒体超过安全下载大小，请打开原任务下载','DOUBAO_MEDIA_TOO_LARGE');chunks.push(chunk);}
   if(!size)throw fail('下载成品为空，不会回写卡片','DOUBAO_EMPTY_MEDIA');
   return {bytes:Buffer.concat(chunks),mimeType};
   };
   let output;progress();try{output=await read(await win(task.accountId).webContents.session.fetch(url,{credentials:'include',redirect:'error',signal:combined}));}
   catch(error){combined.throwIfAborted();if(!/ERR_HTTP2_PROTOCOL_ERROR/.test(String(error.message||'')+' '+String(error.cause?.message||'')))throw error;progress();output=await read(await http1Fetch(url,{signal:combined}));}
   finished=true;return output;
  }catch(error){if(combined.aborted)throw combined.reason;throw error;}
  finally{clearTimeout(timer);if(!finished)controller.abort();}
 }
 async function diagnostics(task,{recoverHistory=false,manualReplies}={}){
  if(manualReplies!==undefined&&(!Array.isArray(manualReplies)||manualReplies.length<1||manualReplies.length>8||manualReplies.some(s=>typeof s!=='string'||!s.trim()||s.length>500)))throw fail('只读手动上下文需提供1至8条完整回复，每条不超过500字','DOUBAO_DIAGNOSTIC_CONTEXT_INVALID');
  const details=await action(task.accountId,'diagnostics',{prompt:task.prompt,kind:task.kind}),transport=submissionTransports.get(transportKey(task))?.read();if(transport)details.submissionTransport=transport;if(!recoverHistory&&manualReplies===undefined)return details;
  // Observe only: virtualized history may be recovered without resuming the
  // scheduler, reconciling a journal, or enabling automatic confirmation.
  const seen=await observe(task,{manualReplies,readOnly:true});
  return {...details,originalObservation:{readOnly:true,ack:seen.ack===true,sameMessage:!!task.userId&&seen.userId===task.userId,gate:seen.gate||null,completed:!!seen.completed,waiting:!!seen.waiting,stopping:!!seen.stopping,artifactCount:seen.artifacts?.length||0,ignoredReferenceReplies:seen.ignoredReferenceReplies||0,generationNotStarted:!!seen.generationNotStarted,confirmationRequired:!!seen.confirmation,acknowledgedConfirmationCount:seen.confirmationAcknowledgements?.length||0,answerCharacters:seen.answer?.length||0,definitiveFailure:seen.failure?.definitive===true,failureCode:seen.failure?.code||'',quotaRejected:seen.quota?.exhausted===true&&seen.quota?.rejected===true,...(seen.manualTrace?{manualTrace:seen.manualTrace}:{}),...(seen.historyRecovery?{historyRecovery:seen.historyRecovery}:{})}};
 }
 return {prepare,send,observe,recoverPreparedResult,confirm,download,open,attention,diagnostics};
}
