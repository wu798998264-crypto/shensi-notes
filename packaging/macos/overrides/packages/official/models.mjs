import {MODEL_CHANNELS,profileChannels,profileSupports,profileForChannel} from '../ui/model-capabilities.js';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {jsonStore,failure,identity} from './store.mjs';
import {PROVIDER_PRESETS,getProviderPreset,getProviderModelOptions,imageModelCapabilities,videoModelCapabilities} from './legacy/model-presets.js';
import {createGenerationProfile} from './legacy/generation-profiles.js';
import {publicGenerationModels} from './generation-models.mjs';
import {localModelCatalog,fetchModelCatalog,cliModelCatalog} from './model-catalog.mjs';
import {findTextModel,textModelSelection} from '../ui/text-model-selection.js';
import {currentGptCatalog,currentGptModels,removedModel,gptCatalogChannels} from '../ui/gpt-model-policy.js';
import {usesVideoApiReadiness,checkVideoApiReadiness} from './video-api-readiness.mjs';
import {unifiedCanvasProfile,usesUnifiedCanvas,canvasAccountId} from '../ui/media-model-policy.js';
import {originalCanvasSource,originalCanvasSources} from './dreamina-canvas-source.mjs';
import {mergeDreaminaAccounts,canvasProfileAliases} from './dreamina-account-migration.mjs';
import {mergeLegacyMultimodalAccounts,mergedProfileAliases,updateMergedChannelProfiles,carryMergedCatalogs} from './multimodal-account-migration.mjs';
import {createExternalBrowsers} from './external-browsers.mjs';
import {verifyDeepSeekApi} from './deepseek-api.mjs';
import {isOfficialDeepSeekEndpoint} from './legacy/cli/deepseek-opencode-config.mjs';
import {apiKeyAuthorization} from '../ui/model-authorization-source.js';
export const legacyImportFields=Object.freeze(['name','provider','adapter','protocol','baseUrl','model','cliPath','cliArgs','reasoningEffort','speedMode','temperature','maxOutputTokens','timeoutMs','aspectRatio','resolution','durationSeconds','voice','dreaminaCliProfile','agentEngine','agentPermissionMode','credentialSource','webSearchEnabled','executionMode','executionModes','agentModelId','chatModelId','agentReasoningEffort','agentSpeedMode','modelPolicy','providerId','runnerId','runtimeProfileId','runtimeConfigPath','credentialSharing','credentialSharedFromChannel','credentialSharedFromProfileId','chatAdapter','chatProtocol','chatBaseUrl','systemManaged','reserved']);

export function createModelService({dataRoot,desktop={},consolidateLegacyAccounts=false}){
 const externalBrowsers=createExternalBrowsers({dataRoot,desktop});
 const store=jsonStore(join(dataRoot,'machine','official-models.json'),{revision:0,profiles:[]}),vault=jsonStore(join(dataRoot,'machine','official-secrets.json'),{}),session=new Map();
 const catalogs=jsonStore(join(dataRoot,'machine','official-model-catalogs.json'),{}),catalogKey=p=>createHash('sha256').update(JSON.stringify([p.id,p.updatedAt,p.adapter,p.provider,p.protocol,p.baseUrl,p.dreaminaCanvasMode,p.browserProfileId,p.dreaminaCliProfile])).digest('hex');
 const secure=!!desktop.encryptSecret;let profileStopper,memberResolver,memberAccess=async()=>({id:'official-compute',name:'官方算力',locked:true,status:'login_required',message:'请先登录神思账号并购买算力积分套餐。',enabled:false}),externalStatus=async()=>false;const blockedProviders=new Set(),blockedProfiles=new Set(),builtinSources=new Map();
 const activeSource=id=>builtinSources.has(id)?builtinSources.get(id)():externalStatus(id);
 const memberActive=(p,access)=>access.entitled&&access.issuer===p.memberRef.issuer&&access.memberId===p.memberRef.memberId&&access.activeKeys?.includes(p.memberRef.keyId);
 let browserAvailable=async()=>false,speechMetadata=async()=>null,browserPool=async()=>null;
 let canvasUpgrade;
 const aliases=s=>[...canvasProfileAliases(s),...mergedProfileAliases(s)];
 const ensureCanvasAccounts=()=>canvasUpgrade??=(async()=>{const sources=await originalCanvasSources(dataRoot).catch(()=>[]);await store.update(async s=>{if(sources.length)mergeDreaminaAccounts(s,sources);if(consolidateLegacyAccounts&&await mergeLegacyMultimodalAccounts(s,{sameCredentials:async items=>{try{const values=await Promise.all(items.map(p=>secret('model.'+p.id)));return new Set(values).size===1&&(items[0].adapter!=='api'||!!values[0]);}catch{return false;}}}))await catalogs.update(cache=>carryMergedCatalogs(s,cache,catalogKey));return s;});})().catch(error=>{canvasUpgrade=null;throw error;});
 const profileById=async id=>{await ensureCanvasAccounts();const state=await store.read(),p=[...state.profiles,...aliases(state)].find(p=>p.id===id)||((await browserPool())?.id===id?await browserPool():null);return p&&unifiedCanvasProfile(p);};
 const sourceActive=async p=>!blockedProfiles.has(p.id)&&(p.adapter!=='browser'||await browserAvailable(p))&&(!p.memberRef||memberActive(p,await memberAccess()))&&(p.provider!=='本地 H3'||await activeSource('thirdparty.local-h3'))&&(!p.externalRef||!blockedProviders.has(p.externalRef.pluginId)&&await activeSource(p.externalRef.pluginId));
 const secret=async(key,snapshot)=>{if(session.has(key))return session.get(key);const value=(snapshot||await vault.read())[key];if(!value)return '';if(!desktop.decryptSecret)throw failure('此配置的密钥已加密保存，但当前宿主没有解密能力。请从原桌面账号空间打开；尚未向服务商提交请求。','CREDENTIAL_STORE_LOCKED');try{const plain=await desktop.decryptSecret(value);if(typeof plain!=='string'||!plain)throw Error('unreadable');return plain;}catch{throw failure('无法读取此配置的已保存密钥。请使用原账号空间打开或在模型设置中核验；原密钥未改动，尚未向服务商提交请求。','CREDENTIAL_DECRYPT_FAILED');}};
 const hasSecret=async(key,snapshot)=>session.has(key)?!!session.get(key):!!(snapshot||await vault.read())[key];
 const putSecret=async(key,value,{remember=true}={})=>{identity(key);if(typeof value!=='string'||value.length>(key.startsWith('member-state')?768*1024:32000))throw failure('凭据格式无效');if(secure){const sealed=value&&remember?await desktop.encryptSecret(value):'';await vault.update(s=>{if(sealed)s[key]=sealed;else delete s[key];return s;});}session.set(key,value);};
 const authoritativeFreeCatalog=(p,catalog)=>getProviderPreset(p.provider)?.public===true&&catalog?.source==='remote'&&catalog.complete===true;
 const exactTextCatalog=(p,catalog)=>catalog?.complete===true&&(authoritativeFreeCatalog(p,catalog)||
  p.adapter==='api'&&['DeepSeek','OpenAI','自定义兼容接口'].includes(p.provider)&&catalog.source==='remote'||
  p.agentEngine==='workbuddy'&&catalog.source==='desktop-cache'||
  p.adapter==='cli'&&p.provider==='OpenAI'&&['codex-local-catalog','codex-images-api'].includes(catalog.source)&&catalog.completeChannels?.includes('text')!==false);
 const textModelsFor=(p,catalog)=>{
  const known=localModelCatalog(p), presets=new Map(known.map(item=>[item.id,item]));
  const authoritative=exactTextCatalog(p,catalog);
  const options=new Map(authoritative?[]:presets);
  for(const remote of catalog?.models||[]){
   if(!remote?.id)continue;
   const preset=presets.get(remote.id);
   const declared=gptCatalogChannels(remote);
   const channels=declared.length?declared:preset?.channels?.length?preset.channels:p.channel==='text'?['text']:[];
   options.set(remote.id,{...preset,...remote,label:remote.label||preset?.label||remote.id,channels});
  }
  return currentGptModels([...options.values()],p)
   .filter(item=>item.available!==false&&item.selectable!==false&&item.channels.includes('text'))
   .map(item=>({id:item.id,label:item.label||item.id,reasoningLevels:item.reasoningLevels||[],defaultReasoningLevel:item.defaultReasoningLevel||'',speedModes:item.speedModes||[]}));
 };
 const exactImageCatalog=(p,catalog)=>p.channel==='multimodal'&&profileSupports(p,'text')&&profileSupports(p,'image')&&catalog?.complete===true&&(
  p.adapter==='api'&&['OpenAI','自定义兼容接口'].includes(p.provider)&&catalog.source==='remote'||
  p.adapter==='cli'&&p.provider==='OpenAI'&&(catalog.source==='codex-images-api'||catalog.source==='codex-local-catalog'&&catalog.models.some(item=>gptCatalogChannels(item).includes('image')))
 );
 const publicProfile=async(p,snapshot)=>{p=unifiedCanvasProfile(p);const catalog=(snapshot?.catalogs||await catalogs.read())[catalogKey(p)],mediaModels=publicGenerationModels({...p,modelCatalogModels:catalog?.models,exactImageCatalog:exactImageCatalog(p,catalog)}),textModels=profileSupports(p,'text')?textModelsFor(p,catalog):[],speech=await speechMetadata(p);return {...p,enabled:p.enabled!==false&&await sourceActive(p),...(p.adapter==='browser'?{capabilities:{}}:p.channel==='image'?{capabilities:imageModelCapabilities(p.provider,p.model)}:p.channel==='video'?{capabilities:videoModelCapabilities(p.provider,p.model)}:{}),...(speech?{speechCapabilities:speech.capabilities}:{}),mediaModels,textModels,textModelCatalogExact:exactTextCatalog(p,catalog),modelCatalogStatus:catalog?{source:catalog.source,complete:catalog.complete,checkedAt:catalog.checkedAt}:{source:'preset',complete:false},hasSecret:p.memberRef?true:await hasSecret('model.'+p.id,snapshot?.vault)||!!p.mergedCredentialId&&await hasSecret('model.'+p.mergedCredentialId,snapshot?.vault),credentialStorage:secure?'encrypted':desktop.decryptSecret?'encrypted-readonly':'session'};};
 const list=async({includeManagedBindings=false}={})=>{await ensureCanvasAccounts();const [state,pool,localH3Visible,access,catalogSnapshot,vaultSnapshot]=await Promise.all([store.read(),browserPool(),activeSource('thirdparty.local-h3'),memberAccess(),catalogs.read(),vault.read()]);const snapshot={catalogs:catalogSnapshot,vault:vaultSnapshot};const {canvasAccountMigration,multimodalAccountMigration,profileAliases,...visibleState}=state;return {...visibleState,officialConfiguration:Object.fromEntries(['id','name','status','locked','entitled','message','enabled','credit','creditUpdatedAt'].map(key=>[key,access[key]])),profiles:await Promise.all([...state.profiles,...aliases(state)].filter(p=>includeManagedBindings||!pool||p.externalRef?.pluginId!=='thirdparty.doubao').concat(pool?[pool]:[]).filter(p=>(p.provider!=='本地 H3'||localH3Visible)&&(!p.memberRef||access.enabled&&memberActive(p,access))).map(p=>publicProfile(p,snapshot))),credentialStorage:secure?'encrypted':desktop.decryptSecret?'encrypted-readonly':'session',providers:PROVIDER_PRESETS.filter(p=>p.id!=='本地 H3'||localH3Visible).map(p=>({id:p.id,label:p.label,api:p.api,cli:p.cli,models:getProviderModelOptions(p.id)}))};};
 let browserRuntime,browserProfileResolver=async()=>{throw failure('浏览器配置授权接口尚未接入','BROWSER_PROFILE_UNAVAILABLE');};
 const ready=p=>p.enabled!==false&&!!p.model&&(p.adapter==='tts'?p.externalRef?.pluginId==='thirdparty.text-reader'&&!!p.externalRef.sourceId:p.adapter==='browser'?p.externalRef?.pluginId==='thirdparty.doubao'&&(!!p.externalRef.accountId||p.externalRef.accountPool===true):p.adapter==='cli'?!!p.cliPath:!!p.baseUrl);
 async function bindBrowser({profileId,browserProfileId,expectedUpdatedAt}){
  if((await profileById(profileId))?.adapter!=='cli')throw failure('只有 CLI 连接使用浏览器授权','CLI_AUTHORIZATION_ONLY');
  const selected=await profileById(profileId);if(!selected||selected.memberRef||selected.externalRef)throw failure('此配置不能修改浏览器绑定');
  await browserProfileResolver({...selected,browserProfileId:identity(browserProfileId)});
  await store.update(state=>{const p=state.profiles.find(p=>p.id===profileId);if(!p||p.updatedAt!==expectedUpdatedAt)throw failure('配置已被修改，请重新打开核验','SETTINGS_CONFLICT');
   if(p.browserProfileId)throw failure('此配置已有浏览器绑定，请在模型设置中修改','SETTINGS_CONFLICT');
   // Bind only the explicitly selected account. Never migrate endpoint/model/key
   // fields or copy credentials from a similarly named profile.
   Object.assign(p,updateMergedChannelProfiles(p,{...p,browserProfileId,authorizationSource:'browser_profile',updatedAt:new Date().toISOString()}));state.revision++;return state;
  });return profileById(profileId);
 }
 async function save({profile:input,apiKey,expectedRevision},externalOwner){
  await ensureCanvasAccounts();
  if((await store.read()).profileAliases?.[input?.id])throw failure('此旧配置已合并，请编辑对应的多模态配置','SETTINGS_CONFLICT');
  input=input&&apiKeyAuthorization(unifiedCanvasProfile(input));
  if(!input||!['text','image','video','audio','multimodal'].includes(input.channel))throw failure('请选择文本、图片、视频、音频或多模态配置');
  const id=identity(input.id||'model-'+randomUUID()),channel=input.channel;
  if(id.startsWith('external-')&&!externalOwner)throw failure('插件算力配置由所属插件管理');
  const channels=channel==='multimodal'?[...new Set(input.channels||[])]:[channel];if(!channels.length||channels.some(c=>!MODEL_CHANNELS.includes(c)))throw failure('请选择有效的多模态能力');
  const capabilityModels=channel==='multimodal'?Object.fromEntries(channels.filter(c=>String(input.capabilityModels?.[c]||'').trim()).map(c=>[c,String(input.capabilityModels[c]).trim()])):{};if(Object.values(capabilityModels).some(v=>v.length>4000))throw failure('能力模型名称过长');
  const allowed=['name','provider','adapter','protocol','baseUrl','model','cliPath','cliArgs','reasoningEffort','speedMode','temperature','maxOutputTokens','timeoutMs','aspectRatio','resolution','durationSeconds','voice','dreaminaCliProfile','dreaminaCanvasMode','enabled','agentEngine','agentPermissionMode','credentialSource','webSearchEnabled','browserProfileId','credentialPageUrl','authorizationSource','externalBrowserId','externalBrowserProfile'];
  const clean=Object.fromEntries(allowed.filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]));
  if(Object.values(clean).some(v=>!['string','number','boolean'].includes(typeof v)||typeof v==='string'&&v.length>4000))throw failure('配置字段无效');
  if(!String(clean.name||'').trim()||!String(clean.model||'').trim())throw failure('请填写配置名称与模型');
  if(!['api','cli','browser','tts'].includes(clean.adapter))throw failure('请选择 API 或 CLI 连接');
  if(clean.adapter==='tts'&&(externalOwner!=='thirdparty.text-reader'||channel!=='audio'||!input.speechSourceId))throw failure('TTS 配置只能由朗读插件登记');
  if(clean.adapter==='browser'&&(externalOwner!=='thirdparty.doubao'||!/^doubao-[a-f0-9-]{36}$/.test(input.browserAccountId||'')))throw failure('网页算力只能由对应的内置账号插件提供');
  if(clean.adapter==='api'){let url;try{url=new URL(clean.baseUrl);}catch{throw failure('接口地址无效');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw failure('接口地址必须是 HTTP 或 HTTPS，凭据请放入密钥框');}
  if(clean.adapter==='cli'&&!clean.cliPath)throw failure('请填写 CLI 路径');
  if(clean.authorizationSource&&!['external_browser','browser_profile','cli','api_key'].includes(clean.authorizationSource))throw failure('授权来源无效');
  if(clean.externalBrowserId){if(clean.authorizationSource!=='external_browser'||clean.browserProfileId)throw failure('外部浏览器与当前凭证来源不一致');await externalBrowsers.validate(clean.externalBrowserId,clean.externalBrowserProfile);}
  if(clean.dreaminaCanvasMode==='canvas'&&(clean.provider!=='即梦'||clean.adapter!=='cli'||!canvasAccountId(clean)))throw failure('即梦画布模式需要明确的原 CLI 账号或浏览器配置');
  if(clean.dreaminaCanvasMode==='canvas'&&!clean.browserProfileId)await originalCanvasSource(clean,dataRoot);
  if(clean.browserProfileId)await browserProfileResolver(clean);
  if(clean.credentialPageUrl){let url;try{url=new URL(clean.credentialPageUrl);}catch{throw failure('凭证网页地址无效');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw failure('凭证网页地址应为不含授权参数的 HTTPS 页面');}
  // Keep the legacy field contract, but never seed profiles or inherit old credentials.
  if(channels.includes('text')){
   clean.agentEngine??=clean.adapter==='browser'?'doubao_browser':clean.adapter==='api'?'codex_api':'codex';
   clean.agentPermissionMode??='shensi_only';
   if(!['codex_api','codex','opencode','deepseek_opencode','claude_code','workbuddy','custom','doubao_browser'].includes(clean.agentEngine)||!['shensi_only','approval_required','full_access'].includes(clean.agentPermissionMode))throw failure('运行器或权限模式无效');
   const deepSeekApi=clean.agentEngine==='deepseek_opencode'&&clean.adapter==='api';
   if(deepSeekApi&&(clean.provider!=='DeepSeek'||channel!=='text'||!isOfficialDeepSeekEndpoint(clean.baseUrl)||clean.protocol!=='chat_completions'))throw failure('OpenCode + DeepSeek 需要使用 DeepSeek 官方 API 地址和 Chat Completions 协议');
   if((clean.agentEngine==='doubao_browser')!==(clean.adapter==='browser')||(!deepSeekApi&&(clean.agentEngine==='codex_api')!==(clean.adapter==='api')))throw failure('运行器与连接类型不匹配');
  }
  const normalized=createGenerationProfile(channel==='multimodal'?channels[0]:channel,{...clean,id});
  const profile={...Object.fromEntries(allowed.filter(k=>normalized[k]!==undefined).map(k=>[k,normalized[k]])),...clean,id,channel,...(externalOwner?{externalRef:{pluginId:externalOwner,...(clean.adapter==='browser'?{accountId:input.browserAccountId}:{} ),...(clean.adapter==='tts'?{sourceId:identity(input.speechSourceId)}:{})}}:{}),...(channel==='multimodal'?{channels,capabilityModels}:{}),updatedAt:new Date().toISOString()};
  if(clean.adapter==='browser')for(const key of ['baseUrl','cliPath','cliArgs','temperature','maxOutputTokens','resolution','aspectRatio','durationSeconds','voice'])delete profile[key];
  await store.update(async s=>{if(expectedRevision!==s.revision)throw failure('模型配置已在其他窗口修改，请重新打开','SETTINGS_CONFLICT');const old=s.profiles.find(p=>p.id===id);if(old&&old.channel!==channel)throw failure('已有配置不能改变类型');let next=profile;if(id.startsWith('member-')){if(!old?.memberRef||apiKey!==undefined||['channel','provider','adapter','protocol','baseUrl','model','agentEngine'].some(k=>input[k]!==undefined&&input[k]!==old[k]))throw failure('会员模型的接口、身份和密钥由账号服务管理');const controls=['name','enabled','reasoningEffort','speedMode','temperature','maxOutputTokens','timeoutMs','aspectRatio','resolution','durationSeconds','voice','agentPermissionMode','webSearchEnabled'];next={...old,...Object.fromEntries(controls.filter(k=>clean[k]!==undefined).map(k=>[k,clean[k]])),updatedAt:profile.updatedAt};}else {next=updateMergedChannelProfiles(old||{},{...old,...profile});if(old?.channelProfiles&&apiKey!==undefined)next.mergedCredentialId='';if(old?.channelProfiles&&old.adapter==='api'&&(next.baseUrl!==old.baseUrl||next.provider!==old.provider)&&apiKey===undefined)throw failure('变更合并配置的服务地址或提供商时，请明确填写对应密钥；不会转发原密钥','CREDENTIAL_ENDPOINT_CHANGED');if(apiKey!==undefined)await putSecret('model.'+id,apiKey);}s.profiles=s.profiles.filter(p=>p.id!==id);s.profiles.push(next);s.revision++;return s;});return list();
 }
 async function remove({profileId,expectedRevision,retire=false},externalOwner){let removed=[];await store.update(async s=>{if(expectedRevision!==s.revision)throw failure('模型配置已变化','SETTINGS_CONFLICT');const target=s.profileAliases?.[profileId]||profileId,p=s.profiles.find(p=>p.id===target);removed=[target,...Object.keys(s.profileAliases||{}).filter(id=>s.profileAliases[id]===target)];if(p?.externalRef&&p.externalRef.pluginId!==externalOwner)throw failure('插件算力配置由所属插件管理');if(p&&profileStopper){removed.forEach(id=>blockedProfiles.add(id));const stopped=await profileStopper(removed);if(stopped?.pending)throw failure('任务停止尚未确认，配置和凭据保留，请稍后重试','STOP_PENDING');}if(retire===true&&p&&!p.externalRef){s.retiredProfileIds=[...new Set([...(s.retiredProfileIds||[]),...removed])];}s.profiles=s.profiles.filter(p=>p.id!==target);for(const id of removed)if(s.profileAliases)delete s.profileAliases[id];s.revision++;return s;});for(const id of removed){await putSecret('model.'+identity(id),'');blockedProfiles.delete(id);}return list();}
 async function assertAvailable(id){const p=await profileById(id);if(!p||p.enabled===false||!await sourceActive(p))throw failure(p?.memberRef?'会员账号所属的官方算力权益或密钥核验未通过':'模型配置或算力来源已停用或尚未启动','MODEL_SOURCE_DISABLED');}
 async function resolve(id,channel,context={}){
  const candidate=await profileById(id),p=candidate&&profileSupports(candidate,channel)?profileForChannel(candidate,channel):null;
  if(!p||!ready(p))throw failure('请在模型设置中配置并启用对应模型','MODEL_NOT_CONFIGURED');
  if(usesUnifiedCanvas(p)&&!canvasAccountId(p))throw failure('此即梦配置缺少原账号来源，请在模型设置中核验。','DREAMINA_CANVAS_PROFILE_REQUIRED');
  const browserSettings=p.adapter==='cli'&&p.browserProfileId?await browserProfileResolver(p):usesUnifiedCanvas(p)?await originalCanvasSource(p,dataRoot):{};
  if(!context.allowInactiveProvider)await assertAvailable(id);
  const catalog=(await catalogs.read())[catalogKey(candidate)],catalogModels=catalog?.models,textModels=channel==='text'?textModelsFor(candidate,catalog):[],requestedModel=String(context.model||'').trim(),model=requestedModel||profileForChannel(p,channel).model;
  if(removedModel(model,p))throw failure('此型号已从可选目录移除，请在当前配置中重新选择模型','MODEL_RETIRED');
  if(channel==='text'&&authoritativeFreeCatalog(p,catalog)&&!textModels.some(item=>item.id===model))throw failure('此免费模型已不在最新免费目录中，请刷新目录并选择可用模型；未发送生成请求','MODEL_NO_LONGER_FREE_OR_AVAILABLE');
  const option=findTextModel(p,textModels,model);
  if(channel==='text'&&exactTextCatalog(candidate,catalog)&&!option)throw failure('此型号已不在当前配置的完整文字目录中，请重新选择；未改动保存的默认模型','MODEL_SELECTION_INVALID');
  if(requestedModel&&!option)throw failure('所选模型不在当前配置目录中','MODEL_SELECTION_INVALID');
  const requestedReasoning=String(context.reasoningEffort??'').trim(),requestedSpeed=String(context.speedMode??'').trim();
  const defaults=channel==='text'?textModelSelection({...p,textModels},{model}):{reasoningEffort:p.reasoningEffort||'',speedMode:p.speedMode||'default'};
  // An explicit automatic choice must stay automatic. Connection defaults only
  // apply when omitted, and only to capabilities declared by this text model.
  const reasoningEffort=channel==='text'?(context.reasoningEffort===undefined?defaults.reasoningEffort:requestedReasoning):requestedReasoning||defaults.reasoningEffort;
  const speedMode=channel==='text'?(context.speedMode===undefined?defaults.speedMode:requestedSpeed||'default'):requestedSpeed||defaults.speedMode;
  if(requestedReasoning&&option?.reasoningLevels?.length&&!option.reasoningLevels.includes(requestedReasoning))throw failure('所选模型不支持该推理强度','MODEL_REASONING_INVALID');
  if(requestedSpeed&&requestedSpeed!=='default'&&option?.speedModes?.length&&!option.speedModes.includes(requestedSpeed))throw failure('所选模型不支持该响应速度','MODEL_SPEED_INVALID');
  const selection={model,reasoningEffort,speedMode};
  if(p.memberRef){if(!memberResolver)throw failure('会员凭据服务不可用');return {...p,...selection,connectionId:p.id,...await memberResolver(p,context)};}
  return {...profileForChannel(p,channel),...selection,...browserSettings,modelCatalogModels:catalogModels,exactImageCatalog:exactImageCatalog(candidate,catalog),connectionId:p.id,apiKey:await secret('model.'+p.id)||p.mergedCredentialId&&await secret('model.'+p.mergedCredentialId)||''};
 }
 async function provide(pluginId,{id,profile,apiKey,remove:erase=false}){identity(pluginId);identity(id);const key='external-'+createHash('sha256').update(pluginId+':'+id).digest('hex').slice(0,40),revision=(await store.read()).revision;if(erase){await remove({profileId:key,expectedRevision:revision},pluginId);return {id:key,removed:true};}if(!profile||typeof profile!=='object')throw failure('插件需要提供完整模型配置');await save({profile:{...profile,id:key},apiKey,expectedRevision:revision},pluginId);return {id:key};}
 async function installMemberProfiles(items){await store.update(s=>{for(const item of items){const old=s.profiles.find(p=>p.id===item.id);if(old&&!old.memberRef)throw failure('会员配置不能覆盖普通模型');const controls=Object.fromEntries(['name','enabled','speedMode','webSearchEnabled','reasoningEffort','temperature','maxOutputTokens','timeoutMs','aspectRatio','resolution','durationSeconds','voice','agentPermissionMode'].filter(k=>old?.[k]!==undefined).map(k=>[k,old[k]]));const p={...item.profile,...controls,id:item.id,adapter:'api',enabled:controls.enabled!==false,agentEngine:item.profile.channel==='text'?'codex_api':undefined,agentPermissionMode:controls.agentPermissionMode||'shensi_only',memberRef:structuredClone(item.memberRef),updatedAt:new Date().toISOString()};s.profiles=s.profiles.filter(p=>p.id!==item.id);s.profiles.push(p);}s.revision++;return s;});return list();}
 async function browserText(options){if(!browserRuntime)throw failure('网页执行器不可用');return browserRuntime(options);}
 async function authorizationSources(){return {externalBrowsers:await originalCanvasSources(dataRoot),...await externalBrowsers.list()};}
 async function text({profileId,messages,system,signal,cwd,requestId}){const settings=await resolve(profileId,'text',{signal});if(settings.adapter==='browser')return browserText({settings,messages,system,signal,requestId:requestId||'model-text-'+randomUUID()});const {runModelAdapter}=await import('./legacy/server/adapters.mjs');return runModelAdapter({settings,messages,system,signal,cwd});}
 async function test({profileId}){const p=await profileById(profileId);if(!p)throw failure('配置不存在');const settings=await resolve(profileId,profileSupports(p,'text')?'text':profileChannels(p)[0]);if(settings.adapter==='api'&&settings.agentEngine==='deepseek_opencode')return verifyDeepSeekApi(settings);if(settings.adapter==='browser')return {ok:ready(settings),message:'账号绑定有效；请在豆包插件中明确试用，不会在连接检查中偷偷生成'};if(usesVideoApiReadiness(settings))return checkVideoApiReadiness(settings);if(!profileSupports(p,'text'))return {ok:ready(settings),message:'配置字段检查通过；媒体执行与计费验证未运行'};const {testModelAdapter}=await import('./legacy/server/adapters.mjs');return testModelAdapter({settings,cwd:dataRoot});}

 async function catalog({profileId,profile:draft,apiKey,refresh=false}){
  const saved=profileId?await profileById(profileId):null;
  if(profileId&&!saved)throw failure('配置不存在');
  const profile=unifiedCanvasProfile({...saved,...draft});if(!profile.channel)throw failure('请选择配置类型');
  if(profile.adapter==='cli'&&profile.browserProfileId)Object.assign(profile,await browserProfileResolver(profile));
  if(refresh&&usesUnifiedCanvas(profile)&&!profile.browserProfileId)Object.assign(profile,await originalCanvasSource(profile,dataRoot));
  if(saved?.memberRef||saved?.externalRef)return {models:localModelCatalog(saved).filter(m=>m.id===saved.model||Object.values(saved.capabilityModels||{}).includes(m.id)),source:'managed',complete:true};
  // Cache metadata only; never alter the saved connection or its default model.
  // Empty optional form controls and absent persisted fields describe the same
  // connection. Endpoint/provider/account changes must still withhold its key.
  const sameConnection=saved&&['adapter','baseUrl','provider','protocol','agentEngine','cliPath','model','dreaminaCanvasMode'].every(key=>(profile[key]??'')===(saved[key]??''))&&(profile.adapter!=='cli'||(profile.browserProfileId||'')===(saved.browserProfileId||'')&&(!!profile.browserProfileId||(profile.dreaminaCliProfile||'')===(saved.dreaminaCliProfile||'')));
  if(refresh&&profile.adapter==='cli'){const result=currentGptCatalog(await cliModelCatalog(profile),profile);if(sameConnection&&apiKey===undefined)await catalogs.update(state=>({...state,[catalogKey(saved)]:result}));return result;}
  if(!refresh){const cached=sameConnection&&(await catalogs.read())[catalogKey(saved)];return cached?currentGptCatalog(cached,profile):{models:localModelCatalog(profile),source:'preset',complete:false,message:'已知模型目录。读取连接目录可获得该接口返回的模型。'};}
  // Never send a saved credential to an edited endpoint or another provider.
  const key=apiKey||(sameConnection?await secret('model.'+saved.id)||saved.mergedCredentialId&&await secret('model.'+saved.mergedCredentialId)||'':'');
  const result=await fetchModelCatalog(profile,key);
  if(sameConnection&&apiKey===undefined)await catalogs.update(state=>({...state,[catalogKey(saved)]:result}));
  return result;
 }

 // Explicit real free-model checks only. Refreshing /models restores the full
 // current directory; transient quota/service failures are not permanent bans.
 async function recordPublicModelChecks({profileId,checkedAt,results}){
  const p=await profileById(profileId);if(!p||getProviderPreset(p.provider)?.public!==true)throw failure('仅用于免费模型目录');
  const key=catalogKey(p);await catalogs.update(state=>{const current=state[key];if(!authoritativeFreeCatalog(p,current)||current.checkedAt!==checkedAt)throw failure('模型目录已变化，请重新核对','SETTINGS_CONFLICT');
   if(!Array.isArray(results)||results.length!==current.models.length||new Set(results.map(r=>r.id)).size!==results.length||results.some(r=>!current.models.some(m=>m.id===r.id)||!['passed','temporarily_unavailable'].includes(r.status)))throw failure('免费模型双边核验结果不完整');
   const good=new Set(results.filter(r=>r.status==='passed').map(r=>r.id));if(!good.size)throw failure('本轮没有双边通过的免费模型，未清空原目录');
   state[key]={...current,models:current.models.filter(m=>good.has(m.id)),unavailableModels:current.models.filter(m=>!good.has(m.id)).map(m=>({...m,status:'temporarily_unavailable'})),availabilityCheckedAt:new Date().toISOString(),message:'当前显示本轮文档/白板均真实通过的免费模型。暂时限流或服务失败项保留记录，重新读取目录可恢复候选。'};return state;});return list();
 }

 async function importLegacy(records,secrets={}){
  if(!secure)throw failure('真实配置迁移需要桌面安全存储，不会把凭据保存为明文');
  const receipts=[];
  await store.update(async state=>{
   for(const {channel,original,binding,sourceId} of records){
    const id='legacy-'+channel+'-'+createHash('sha256').update(sourceId+':'+String(original.id)).digest('hex').slice(0,40);
    if(state.profileAliases?.[id]){receipts.push({id,channel,status:'已合并至多模态配置，保留旧引用'});continue;}
    if(state.retiredProfileIds?.includes(id)){receipts.push({id,channel,status:'用户已永久移除，不再恢复'});continue;}
    const settings={...original,...binding},existing=state.profiles.find(p=>p.id===id);if(existing){const backfilledFields=[];for(const key of legacyImportFields)if(key!=='name'&&existing[key]===undefined&&settings[key]!==undefined){existing[key]=structuredClone(settings[key]);backfilledFields.push(key);}receipts.push({id,channel,status:'保留新版已有配置',parameterBackfill:backfilledFields.length>0,backfilledFields});continue;}
    const allowed=legacyImportFields;
    const profile={...Object.fromEntries(allowed.filter(key=>settings[key]!==undefined).map(key=>[key,settings[key]])),id,channel,name:original.remarkName||original.name||original.id,legacyImport:{sourceId,profileId:original.id},legacyDraft:original.draft===true,enabled:original.enabled!==false&&original.draft!==true,updatedAt:new Date().toISOString()};
    if(channel==='text'){profile.agentEngine||=profile.adapter==='api'?'codex_api':'codex';profile.agentPermissionMode||='shensi_only';}
    if(!ready(profile))profile.enabled=false;
    let key=secrets[channel]?.[original.id];if(!key&&original.credentialSharedFromChannel&&original.credentialSharedFromProfileId)key=secrets[original.credentialSharedFromChannel]?.[original.credentialSharedFromProfileId];
    if(key)await putSecret('model.'+id,key);
    state.profiles.push(profile);receipts.push({id,channel,status:'已导入',ready:ready(profile),credentialImported:!!key});
   }
   if(receipts.some(r=>r.status==='已导入'||r.parameterBackfill))state.revision++;return state;
  });
  return receipts;
 }

 return {externalBrowsers,authorizationSources,setBrowserProfileResolver:fn=>{browserProfileResolver=fn;},setBrowserPool:fn=>{browserPool=fn;},setSpeechMetadata:fn=>{speechMetadata=fn;},setBrowserAvailability:fn=>{browserAvailable=fn;},setBrowserRuntime:fn=>{browserRuntime=fn;},browserText,setBuiltinSource:(id,resolve)=>builtinSources.set(id,resolve),importLegacy,list,bindBrowser,save,remove,resolve,text,test,catalog,recordPublicModelChecks,secret,putSecret,ready,installMemberProfiles,provide,assertAvailable,hasSecret,setProfileStopper:fn=>{profileStopper=fn;},setExternalStatus:fn=>{externalStatus=fn;},blockProvider:id=>blockedProviders.add(id),unblockProvider:id=>blockedProviders.delete(id),setMemberResolver:fn=>{memberResolver=fn;},setMemberAccess:fn=>{memberAccess=fn;}};
}
