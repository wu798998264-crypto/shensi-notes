import {failure} from './store.mjs';
import {profileChannels} from '../ui/model-capabilities.js';
import {listDreaminaProfileAccountStatuses,startDreaminaProfileOAuth,completeDreaminaProfileOAuth,openDreaminaProfilePage} from './legacy/server/dreamina-profile-oauth.mjs';
import {probeLibTvAccountStatus} from './legacy/server/libtv-account-status.mjs';
import {resolveMediaProviderDriver} from './legacy/server/media-provider-drivers.mjs';
import {verifyOpenAiCliConnection} from './cli-connection-verification.mjs';
import {usesVideoApiReadiness,checkVideoApiReadiness} from './video-api-readiness.mjs';
import {libTvLogin} from './libtv-login.mjs';
import {canvasAccountId} from '../ui/media-model-policy.js';
import {canvasClient} from './dreamina-canvas-driver.mjs';
import {openDreaminaCanvasAuthorization} from './legacy/server/dreamina-profile-oauth.mjs';

// Inspection and interactive authorization are separate. Neither path submits,
// resumes, releases, switches, or retries a generation job.
export function createModelVerification({models,desktop={},vault,browser,doubao,cwd,dreamina={list:listDreaminaProfileAccountStatuses,start:startDreaminaProfileOAuth,complete:completeDreaminaProfileOAuth,open:openDreaminaProfilePage},libTvProbe=probeLibTvAccountStatus,libTvAuth=libTvLogin,codexProbe=verifyOpenAiCliConnection,originalCanvasClient=canvasClient,originalCanvasOpen}){
 const flights=new Map(),originalClients=new Map();
 async function profile(id){const p=(await models.list({includeManagedBindings:true})).profiles.find(p=>p.id===id);if(!p)throw failure('配置不存在或已停用，未改用其他配置','MODEL_NOT_CONFIGURED');return p;}
 async function run(action,body={}){
  const p=await profile(body.profileId),key=JSON.stringify([p.id,action,body.accountId||'',body.browserProfileId||'']);
  if(body.expectedUpdatedAt&&p.updatedAt!==body.expectedUpdatedAt)throw failure('配置已被修改，请重新打开配置页后核验','SETTINGS_CONFLICT');
  if(flights.has(key))return flights.get(key);
  const pending=execute(action,body,p).finally(()=>flights.delete(key));flights.set(key,pending);return pending;
 }
 async function execute(action,body,p){
  if(!['verify','open','authorize','complete','bind'].includes(action))throw failure('未知配置核验操作');
  const checkedAt=new Date().toISOString(),result=value=>({profileId:p.id,profileName:p.name,profileUpdatedAt:p.updatedAt,checkedAt,paidGenerationTested:false,credentialMode:p.adapter==='api'?'api_key':'cli',...value});
  if(p.adapter==='api'&&action!=='verify')throw failure('API 连接使用供应商接口和密钥，无需浏览器授权','CLI_AUTHORIZATION_ONLY');
  if(action==='bind'){
   if(p.browserProfileId||body.confirmBinding!==true)throw failure('请明确选择尚未绑定配置的浏览器账号');
   const saved=await models.bindBrowser({profileId:p.id,browserProfileId:body.browserProfileId,expectedUpdatedAt:p.updatedAt});
   return result({bound:true,browserProfileId:saved.browserProfileId,profileUpdatedAt:saved.updatedAt});
  }
  const bound=p.adapter==='cli'&&p.browserProfileId?await browser?.modelSettings(p):null;if(p.adapter==='cli'&&p.browserProfileId&&!bound)throw failure('浏览器授权接口尚未就绪');
  const external=p.adapter==='cli'&&!bound&&(p.authorizationSource==='external_browser'||p.externalBrowserId),openAuthorization=bound?url=>browser.openInProfile(bound.browserProfileId,url):external&&models.externalBrowsers?url=>models.externalBrowsers.openForProfile(p,url):undefined;
  if(p.provider==='即梦'&&p.adapter==='cli'&&p.dreaminaCanvasMode==='canvas'&&action!=='open'){
   if(!canvasAccountId(p))return result({ok:false,needsBinding:true,code:'DREAMINA_CANVAS_PROFILE_REQUIRED',message:'此配置没有保存原账号来源，请选择对应账号后授权。'});
   let client=browser?.canvas,openPage=openAuthorization,source;
   if(!bound){
    source=await models.resolve(p.id,profileChannels(p)[0]);const key=JSON.stringify([canvasAccountId(p),source.dreaminaCanvasRoot,source.dreaminaExpectedIdentity]);
    if(!originalClients.has(key))originalClients.set(key,originalCanvasClient(source));client=originalClients.get(key);
    openPage=originalCanvasOpen?url=>originalCanvasOpen({requestedProfileId:p.dreaminaCliProfile,url}):openAuthorization||(models.externalBrowsers?url=>models.externalBrowsers.openForProfile(p,url):url=>openDreaminaCanvasAuthorization({requestedProfileId:p.dreaminaCliProfile,url}));
   }
   if(!client)throw failure('即梦画布授权服务尚未就绪','BROWSER_PROFILE_UNAVAILABLE');
   if(action==='authorize'&&body.confirmAuthorization!==true)throw failure('请明确点击授权');
   const value=await client.auth(canvasAccountId(p),{login:action==='authorize'});let opened;if(value.url&&action==='authorize')opened=await openPage(value.url);
   const loggedIn=value.data?.loggedIn===true||value.data?.status==='logged_in';
   return result({ok:loggedIn,...opened,authorizationBrowser:source?.authorizationBrowser,needsAuthorization:!loggedIn&&!value.authorizationPending,needsCompletion:!loggedIn&&value.authorizationPending===true,message:loggedIn?'即梦画布授权有效；图片、视频和音频共用此账号授权，未提交生成。':'请在原账号浏览器完成画布授权，程序会自动检查结果。'});
  }
  if((bound||external)&&action==='open'){
   const url=p.credentialPageUrl||({'即梦':'https://jimeng.jianying.com/',LibTV:'https://www.liblib.tv/',OpenAI:'https://platform.openai.com/'}[p.provider]);if(!url)throw failure('请在模型设置填写此服务商的凭证网页地址');
   return result({...await openAuthorization(url),message:'已打开所选浏览器配置的凭证网页；登录与 CLI/API 授权分别核验。'});
  }
  if(p.externalRef?.pluginId==='thirdparty.doubao'){
   if(p.externalRef.accountPool&&!body.accountId)return result({ok:false,sourcePlugin:'thirdparty.doubao',message:'此配置是豆包账号池，请在来源插件选择具体账号核验；不会擅自打开第一个账号。'});
   const accountId=p.externalRef.accountPool?body.accountId:p.externalRef.accountId;if(!accountId)throw failure('配置缺少明确的豆包账号绑定');
   if(action==='open')return result({...await doubao.handle('open',{accountId}),opened:true});
   const state=await doubao.handle('probe',{accountId}),account=state.accounts.find(a=>a.id===accountId);
   return result({ok:account?.loginState==='authenticated',needsCredentialPage:account?.loginState!=='authenticated',message:account?.message||'请在原账号页面完成登录核验；未提交生成。'});
  }
  // Only persisted, explicit account binding is usable, never a name/provider match.
  const accountId=p.adapter==='cli'&&!bound&&!external&&(p.credentialBinding?.accountId||p.credentialAccountId);
  if(accountId){
   const state=await vault.handle('read'),account=state.accounts.find(a=>a.id===accountId&&!a.archivedAt);
   const platform=p.provider==='即梦'?'dreamina':p.provider==='LibTV'?'libtv':'custom';
   if(!account||account.platform!==platform)throw failure('配置绑定的凭证账号不存在或平台不符，未打开其他账号','CREDENTIAL_ACCOUNT_MISMATCH');
   if(!['verify','open'].includes(action))throw failure('请在已绑定的凭证库原网页完成核验');
   const opened=await vault.handle(action==='open'?'open':'verify',{accountId});
   return result({...opened,ok:false,needsCredentialPage:true,message:opened.message+' 网页登录不代表 CLI 授权；CLI 桥接状态须单独通过核验。'});
  }
  if(p.provider==='即梦'&&p.adapter==='cli'){
   const requestedProfileId=bound?.dreaminaCliProfile||p.dreaminaCliProfile;if(!requestedProfileId)throw failure('此配置未指定即梦账号身份，不会回退默认账号','DREAMINA_PROFILE_REQUIRED');
   if(action==='verify'){
    const status=(await dreamina.list({profileId:requestedProfileId,verifyLive:true})).find(s=>s.profileId===requestedProfileId);
    if(!status)return result({ok:false,needsAuthorization:true,message:'原账号身份记录缺失，请核验原账号；未提交生成。'});
    const ok=status.state==='verified'&&status.liveVerified===true;
    return result({ok,needsAuthorization:!ok,browserId:status.browser?.id||'',credit:status.credit,cliGenerationEligible:status.cliGenerationEligible,message:[ok?'当前配置账号身份已实时核验。':'账号核验未通过：'+(status.error||status.state),status.credit===0?'账号积分为0，生成可能受限。':'',status.cliGenerationEligible===false?'当前会员未具备 CLI 生成资格，请检查会员状态。':'','未提交生成，核验成功不会重发旧任务。'].filter(Boolean).join('\n')});
   }
   if(!desktop.openExternal&&!openAuthorization)throw failure('请在神思桌面版打开对应账号浏览器','DESKTOP_REQUIRED');
   if(action==='open')return result(await dreamina.open({requestedProfileId,requestedBrowserId:body.browserId||''}));
   if(action==='authorize'){
    if(body.confirmAuthorization!==true)throw failure('授权前需要用户明确点击核验，不会自动更换凭据');
    const value=await dreamina.start({requestedProfileId,requestedBrowserId:body.browserId||'',...(openAuthorization?{openAuthorization}:{})});
    return result({...value,message:value.message||value.openError||'已打开原配置的账号授权页面，完成后点击“检查核验结果”。',needsCompletion:!value.startDeferred});
   }
   const value=await dreamina.complete({requestedProfileId,pollSeconds:0});return result({...value,ok:value.complete===true,message:value.message||(value.complete?'原账号核验完成；未恢复或重发生成。':'尚未完成网页核验，请在对应账号页面确认。'),needsCompletion:value.complete!==true&&!value.needsAuthorization});
  }
  if(p.provider==='LibTV'&&p.adapter==='cli'&&action!=='open'){
   const channel=profileChannels(p).find(c=>['image','video','audio'].includes(c)),settings=await models.resolve(p.id,channel),driver=resolveMediaProviderDriver({channel,settings});
   if(action==='authorize'){
    if(body.confirmAuthorization!==true)throw failure('授权前需要用户明确点击核验，不会自动更换凭据');
    let opened;const authorization=await libTvAuth.start({driver,settings,cwd,openExternal:openAuthorization?async url=>{opened=await openAuthorization(url);}:desktop.openExternal});return result({...authorization,...opened});
   }
   try{const status=await libTvProbe({driver,settings,cwd});
    return result({ok:status.loggedIn&&status.activeAccountAvailable,needsAuthorization:!status.activeAccountAvailable,accountId:status.accountId,accountName:status.accountName,credit:status.credit,message:(status.activeAccountAvailable?'已读取当前 CLI 登录账号：'+(status.accountName||status.accountId||'已核验'):'CLI 未返回有效的当前登录账号。')+'\n'+status.membership+'\n'+(status.creditReason||'余额：'+status.credit)+'\n未提交生成、未切换账号。'});
   }catch(error){if(error.providerErrorCode!=='LIBTV_AUTH_REQUIRED')throw error;return result({ok:false,needsAuthorization:true,code:error.providerErrorCode,message:error.message});}
  }
  if(action==='open'){
   if(!desktop.openExternal)throw failure('请在桌面版打开凭证页面','DESKTOP_REQUIRED');
   const known={LibTV:'https://www.liblib.tv/',OpenAI:'https://platform.openai.com/',Anthropic:'https://console.anthropic.com/',DeepSeek:'https://platform.deepseek.com/'};
   // An arbitrary API base URL is not necessarily a vendor's login site.
   const url=p.credentialPageUrl||known[p.provider];if(!url)throw failure('此自定义连接未提供可信的账号网页登录地址，请在服务商页面管理 API 密钥；不会猜测登录地址','CREDENTIAL_PAGE_UNAVAILABLE');
   const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)throw failure('凭证页面地址无效');
   await desktop.openExternal(parsed.href);return result({opened:true,message:'已打开服务商页面；CLI 登录与网页登录是独立状态，请返回核验当前配置。'});
  }
  if(action!=='verify')throw failure('此连接不使用即梦网页授权，请使用对应运行器或凭证来源的登录功能');
  if(p.provider==='OpenAI'&&p.adapter==='cli'){
   const checks=[];for(const channel of profileChannels(p)){const settings=await models.resolve(p.id,channel);checks.push({channel,...await codexProbe({settings,cwd})});}
   return result({ok:checks.every(c=>c.ok),checks,scope:'cli-capabilities',generationPermissionChecked:false,message:checks.map(c=>c.channel+'：'+c.message).join('\n')});
  }
  if(p.adapter==='api'){
   if(p.agentEngine==='deepseek_opencode')return result(await models.test({profileId:p.id}));
   if(usesVideoApiReadiness(p)){await models.assertAvailable(p.id);return result(await checkVideoApiReadiness(await models.resolve(p.id,'video')));}
   await models.assertAvailable(p.id);const catalog=await models.catalog({profileId:p.id,refresh:true});
   const selectedModels=[...new Set([p.model,...Object.values(p.capabilityModels||{})].filter(Boolean))],selectedModel=selectedModels.filter(id=>!catalog.models.some(m=>m.id===id)).join('、'),selectedModelListed=selectedModels.length?!selectedModel:null;
   if(selectedModelListed===false&&catalog.complete)return result({ok:false,code:'MODEL_NOT_IN_REMOTE_CATALOG',scope:'model-directory',modelCount:catalog.models.length,catalogComplete:true,selectedModelListed:false,message:`已连接接口，但完整实时目录中没有当前选择的模型 ${selectedModel}。目录可访问不代表该模型可用，请刷新模型选项后手动选择；未改动原模型、地址或凭据，未提交生成。`});
   return result({ok:true,scope:'model-directory',modelCount:catalog.models.length,catalogComplete:catalog.complete,message:`已真实读取此连接的 ${catalog.models.length} 个模型${catalog.complete?'':'（目录可能不完整）'}。仅证明目录可访问；具体模型生成权限、余额和计费未实测。`});
  }
  const catalog=await models.catalog({profileId:p.id,refresh:true});
  return result({ok:false,scope:'catalog-only',modelCount:catalog.models.length,message:`已读取 ${catalog.models.length} 个模型；此运行器没有接入安全的免生成身份核验，不能据此判定账号可用。请在来源运行器确认登录，或手动执行已有“测试连接”。`});
 }
 return {run};
}
