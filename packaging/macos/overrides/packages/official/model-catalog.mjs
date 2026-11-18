import {getProviderPreset,getProviderModelOptions,getProviderImageModelOptions,getProviderVideoModelOptions,getProviderAudioModelOptions,supportedSpeedModes} from './legacy/model-presets.js';
import {freePublicModels,modelDisplayName} from './legacy/public-model-catalog.js';
import {join,resolve,dirname} from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {readWorkBuddyDesktopCatalog} from './legacy/server/workbuddy-model-catalog.mjs';
import {loadOpenCodeFreeModelCatalog} from './legacy/server/opencode-free-model-catalog.mjs';
import {readLibTvDirectory,readDreaminaDirectory} from './cli-model-directory.mjs';
import {currentGptModels,currentGptCatalog} from '../ui/gpt-model-policy.js';
import {isGptImageModel,isGptImageVariant,isGptImage26,gptImageModelAllowed} from '../ui/gpt-image-options.js';
import {resolveCodexOpenAiApiKey} from './legacy/cli/codex-image-auth.mjs';
import {strictMediaCatalog,canvasAccountId} from '../ui/media-model-policy.js';
import {canvasModels} from '../ui/dreamina-canvas-models.js';
import {canvasClient} from './dreamina-canvas-driver.mjs';
import {readCanvasVoices} from './dreamina-canvas-audio.mjs';

export async function readCodexModelCatalog({home=process.env.CODEX_HOME||join(homedir(),'.codex')}={}){
 const files=[];try{const config=await readFile(join(home,'config.toml'),'utf8'),top=config.split(/^\s*\[/m)[0],value=top.match(/^\s*model_catalog_json\s*=\s*["']([^"']+)["']/m)?.[1];if(value)files.push(resolve(home,value));}catch(error){if(error.code!=='ENOENT')throw error;}
 files.push(join(home,'models_cache.json'));
 for(const file of [...new Set(files)]){try{const metadata=await stat(file);if(metadata.size>8*1024*1024)throw Error('Codex 模型目录超过 8 MB');const data=JSON.parse(await readFile(file,'utf8')),models=(data.models||[]).filter(m=>m.visibility!=='hidden'&&m.available!==false&&m.selectable!==false).map(m=>({id:m.slug||m.id,label:m.display_name||m.name||m.slug||m.id,channels:['text'],reasoningLevels:(m.supported_reasoning_levels||[]).map(v=>typeof v==='string'?v:v.effort).filter(Boolean),defaultReasoningLevel:m.default_reasoning_level||'',speedModes:[...new Set([...(m.service_tiers||[]),...(m.additional_speed_tiers||[])].map(v=>typeof v==='string'?v:v.id).filter(v=>['priority','fast','flex','ultrafast'].includes(v)))]})).filter(m=>m.id);if(models.length)return {models:currentGptModels(models),source:'codex-local-catalog',complete:true,checkedAt:new Date().toISOString(),catalogUpdatedAt:metadata.mtime.toISOString(),message:'Codex 当前本机配置指向的模型目录；目录可见不代表账号授权已实测。'};}catch(error){if(error.code!=='ENOENT')throw error;}}
 return null;
}

export async function cliModelCatalog(profile){
 if(profile.provider==='即梦'&&profile.dreaminaCanvasMode==='canvas'){
  const c=canvasClient(profile),models=[];
  for(const channel of ['image','video','audio']){
   const r=await c.execute(canvasAccountId(profile),{command:'model list',flags:{type:channel}});if(!r.ok)throw Error(r.error?.message||'即梦画布模型目录读取失败');
   for(const item of canvasModels(channel))if(r.data.items.some(m=>m.model===item.slug))models.push({id:item.slug,label:item.label,channels:[channel],...(channel==='audio'?{audioCapabilities:{...item.capabilities,...(item.capabilities.audioMode==='tts'?{voices:await readCanvasVoices(c,canvasAccountId(profile))}:{})}}:{})});
  }
  return {models,source:'dreamina-canvas',complete:true,checkedAt:new Date().toISOString(),message:'当前官方画布目录与已接通参数；付费生成的实测范围单独记录，未猜测其他型号。'};
 }
 if(profile.provider==='LibTV')return readLibTvDirectory(profile);
 if(profile.provider==='即梦')return readDreaminaDirectory();
 if(profile.agentEngine==='codex'||profile.provider==='OpenAI'&&profile.adapter==='cli'){
  const catalog=await readCodexModelCatalog();
  if(profile.provider==='OpenAI'&&(profile.channel==='image'||profile.channel==='multimodal'&&profile.channels?.includes('image'))){
   const auth=await resolveCodexOpenAiApiKey();
   if(auth.apiKey){const remote=await fetchModelCatalog({provider:'OpenAI',baseUrl:process.env.OPENAI_BASE_URL||'https://api.openai.com/v1'},auth.apiKey);return {...remote,source:'codex-images-api',completeChannels:[...(catalog?['text']:[]),...(remote.complete?['image']:[])],models:[...(catalog?.models||[]).filter(m=>!isGptImageModel(m.id)),...remote.models.filter(m=>isGptImageModel(m.id)||m.channels.includes('image'))],message:'Codex 图片使用现有 API 密钥对应的实时目录；未更换连接或默认模型。'};}
   if(catalog){catalog.models=catalog.models.filter(m=>!isGptImageVariant(m.id)&&!isGptImage26(m.id));catalog.message='当前 Codex 登录工具未提供 GPT Image 2.6 的精确选型；目录保留现有生图能力，不以通用型号替代 2.6。';}
  }
  if(catalog){catalog.models=currentGptModels(catalog.models).map(m=>isGptImageModel(m.id)?{...m,channels:['image'],reasoningLevels:[],defaultReasoningLevel:'',speedModes:[]}:m);return catalog;}
 }
 if(profile.agentEngine==='workbuddy'){
  const catalog=await readWorkBuddyDesktopCatalog(process.env.WORKBUDDY_CONFIG_DIR||process.env.CODEBUDDY_CONFIG_DIR||join(homedir(),'.workbuddy'));
  if(!catalog.models.length)throw Error('WorkBuddy 本机没有可读取的模型目录；未读取登录凭据或启动推理');
  return {models:currentGptModels(catalog.entries.map(item=>({id:item.id,label:item.name,channels:['text']})),profile),source:'desktop-cache',complete:true,message:'WorkBuddy 当前本机产品目录（只读缓存）'};
 }
 if(profile.agentEngine==='opencode'&&String(profile.model).startsWith('opencode/')){
  const catalog=await loadOpenCodeFreeModelCatalog();return {models:Object.entries(catalog.opencode.models).map(([id,item])=>({id:'opencode/'+id,label:item.name||id,channels:['text']})),source:'public-catalog',complete:true,message:'OpenCode 当前官方免费模型目录'};
 }
 return {models:localModelCatalog(profile),source:'preset',complete:false,message:'此 CLI 的已知模型目录；可用范围由运行器和账户决定，尚未实时核验。'};
}

export function localModelCatalog(profile){
 if(profile.provider==='即梦'&&profile.dreaminaCanvasMode==='canvas')return ['image','video','audio'].flatMap(c=>canvasModels(c).map(m=>({id:m.slug,label:m.label,channels:[c]})));
 if(profile.adapter==='browser')return profile.model?[{id:profile.model,label:profile.model,channels:[profile.channel],reasoningLevels:[],speedModes:[]}]:[];
 const items=new Map();
 const add=(item,channel)=>{const id=item.slug||item.id;if(!id||item.available===false||item.selectable===false)return;const old=items.get(id),reasoningLevels=[...new Set(item.reasoningLevels?.length?item.reasoningLevels:old?.reasoningLevels||[])],declaredSpeedModes=item.speedModes?.length?item.speedModes:supportedSpeedModes(item),speedModes=[...new Set(declaredSpeedModes.length?declaredSpeedModes:old?.speedModes||[])];items.set(id,{id,label:item.label||old?.label||id,channels:[...new Set([...(old?.channels||[]),...(channel?[channel]:[])])],reasoningLevels,defaultReasoningLevel:item.defaultReasoningLevel||old?.defaultReasoningLevel||reasoningLevels[0]||'',speedModes});};
 for(const item of getProviderModelOptions(profile.provider))if(!item.capabilities?.some(c=>c.endsWith('_generation')))add(item,'text');
 for(const [channel,catalog] of Object.entries({image:getProviderImageModelOptions,video:getProviderVideoModelOptions,audio:getProviderAudioModelOptions}))for(const item of catalog(profile.provider,profile.adapter))if(gptImageModelAllowed(profile,item.slug))add(item,channel);
 if(profile.model&&!strictMediaCatalog(profile))add({id:profile.model},profile.channel==='multimodal'?undefined:profile.channel);
 for(const [channel,id] of Object.entries(profile.capabilityModels||{}))if(id&&!strictMediaCatalog(profile))add({id},channel);
 return currentGptModels([...items.values()],profile);
}

export async function fetchModelCatalog(profile,apiKey,{fetchImpl=fetch}={}){
 const base=new URL(profile.baseUrl);if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error('模型目录需要有效的 HTTP 接口地址');
 base.pathname=base.pathname.replace(/\/(?:chat\/completions|responses|messages|images\/generations)\/?$/,'').replace(/\/$/,'')+'/models';
 const headers=profile.protocol==='anthropic_messages'?{'anthropic-version':'2023-06-01',...(apiKey?{'x-api-key':apiKey}:{})}:apiKey?{Authorization:'Bearer '+apiKey}:{};
 const pages=[],seen=new Set();let url=base,totalBytes=0,complete=true;
 for(let page=0;url;page++){
 if(page>=100||seen.has(url.href)){complete=false;break;}seen.add(url.href);
 if(url.origin!==base.origin||url.pathname!==base.pathname||url.username||url.password)throw Error('拒绝向其他地址转发模型目录凭据');
 const response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!response.ok){await response.body?.cancel();throw Error('模型目录读取失败（HTTP '+response.status+'）'+([401,403].includes(response.status)?'，当前连接未获授权':'，连接可能不提供 /models 接口'));}
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;totalBytes+=chunk.length;if(size>4*1024*1024||totalBytes>24*1024*1024)throw Error('模型目录超过安全读取上限，已停止读取');chunks.push(chunk);}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8')),raw=Array.isArray(data)?data:data.data||data.models;
 if(!Array.isArray(raw))throw Error('服务未返回有效的模型目录');
 pages.push(...raw);const next=data.next_page??data.next??data.links?.next;
 if(data.nextPageToken){url=new URL(base);url.searchParams.set('pageToken',data.nextPageToken);}
 else if(next){if(typeof next==='string'&&/^(?:https?:|\/|\?)/.test(next))url=new URL(next,url);else{url=new URL(base);url.searchParams.set('page',String(next));}}
 else if(data.has_more&&data.last_id){url=new URL(base);url.searchParams.set('after_id',data.last_id);}
 else{if(data.has_more)complete=false;url=null;}
 }
 const publicOnly=getProviderPreset(profile.provider)?.public===true,items=new Map();for(const value of publicOnly?freePublicModels(pages):pages){const item=typeof value==='string'?{id:value}:value,id=String(item.id||item.slug||item.name||item.baseModelId||'').replace(/^models\//,'');if(!id||id.length>4000)continue;const tags=item.output_modalities||item.architecture?.output_modalities||item.channels||item.capabilities||item.modalities||[],controls={};for(const key of ['reasoningLevels','speedModes'])if(Array.isArray(item[key]))controls[key]=[...new Set(item[key].filter(v=>typeof v==='string'&&v.length>0&&v.length<=64))].slice(0,32);if(typeof item.defaultReasoningLevel==='string'&&controls.reasoningLevels?.includes(item.defaultReasoningLevel))controls.defaultReasoningLevel=item.defaultReasoningLevel;items.set(id,{id,label:modelDisplayName(item),...(item.available===false?{available:false}:{}),...(item.selectable===false?{selectable:false}:{}),channels:Array.isArray(tags)?['text','image','video','audio'].filter(c=>tags.includes(c)||tags.includes(c+'_generation')):[],...controls});}
 if(!items.size)throw Error('此连接返回的模型目录为空');
 return currentGptCatalog({models:[...items.values()],source:'remote',complete,pages:seen.size,checkedAt:new Date().toISOString(),...(!complete?{message:'连接目录分页信息不完整，保留已取得的模型；未宣称目录完整。'}:{})});
}
