import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {downloadReleaseFile} from './release-download.cjs';
import {readLimited,validRepository} from './plugin-artifacts.mjs';

export const NOTES_UPDATE_REPOSITORY='wu798998264-crypto/shensi-notes';
const macCatalog='https://raw.githubusercontent.com/'+NOTES_UPDATE_REPOSITORY+'/main/catalog/macos-update.json';
export const NOTES_PACKAGE_VERSION=JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8')).version;
export const NOTES_UPDATE_INTERVAL_MS=60*60*1000;
export const NOTES_UPDATE_MIN_CHECK_MS=60*1000;
const packageVersion=NOTES_PACKAGE_VERSION;
const versionParts=value=>typeof value==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
export function compareNotesVersions(left,right){
 const a=versionParts(left),b=versionParts(right);if(!a||!b)throw Error('更新版本格式无效');
 for(let i=1;i<4;i++){const d=Number(a[i])-Number(b[i]);if(d)return d;}
 if(!a[4]||!b[4])return a[4]===b[4]?0:a[4]?-1:1;
 const x=a[4].split('.'),y=b[4].split('.');for(let i=0;i<Math.max(x.length,y.length);i++){if(x[i]===undefined)return -1;if(y[i]===undefined)return 1;if(x[i]===y[i])continue;const xn=/^\d+$/.test(x[i]),yn=/^\d+$/.test(y[i]);return xn&&yn?Number(x[i])-Number(y[i]):xn?-1:yn?1:x[i]<y[i]?-1:1;}return 0;
}

// All windows share checks/downloads. Checking never downloads or runs an installer.
export function createNotesUpdateService({dataRoot,now=Date.now,fetchImpl=fetch,...options}){
 const currentVersion=options.currentVersion||packageVersion,controller=new AbortController();
 let result={currentVersion,status:'unchecked',available:false,message:''},lastCheck=null,retryAt=0,checkFlight,downloadFlight,downloadState={status:'idle'},verifiedPath='';
 const snapshot=()=>({...result,available:result.status==='available',downloadState:{...downloadState},pollIntervalMs:NOTES_UPDATE_INTERVAL_MS});
 async function check({automatic=false}={}){
  if(checkFlight)return checkFlight;
  if(downloadFlight)return snapshot();
  if(now()<retryAt||lastCheck!==null&&now()-lastCheck<(automatic?NOTES_UPDATE_INTERVAL_MS:NOTES_UPDATE_MIN_CHECK_MS))return snapshot();
  checkFlight=(async()=>{lastCheck=now();const next=await checkNotesUpdate({...options,currentVersion,fetchImpl,now});if(downloadFlight)return snapshot();retryAt=Date.parse(next.retryAt)||0;
   // A transient outage cannot dismiss a known, verified newer release.
   if(next.status==='error'&&result.status==='available')result={...result,checkedAt:next.checkedAt,message:next.message,code:next.code,retryAt:next.retryAt};
   else{if(result.latestVersion!==next.latestVersion||next.status!=='available'){downloadState={status:'idle'};verifiedPath='';}result=next;}
   return snapshot();
  })().finally(()=>{checkFlight=null;});return checkFlight;
 }
 async function download(){
  if(downloadFlight)return downloadFlight;
  if(result.status!=='available'||!result.download)throw Error('没有可下载的新版，请先检查更新');
  const release=structuredClone(result),entry=release.download;
  downloadState={status:'downloading',version:release.latestVersion,bytes:0,total:entry.sizeBytes};
  downloadFlight=(async()=>{
   try{
    const suffix=extname(new URL(entry.url).pathname);if(!['.exe','.dmg','.zip','.AppImage','.deb'].includes(suffix)||entry.sizeBytes>2*1024**3)throw Error('安装包类型或大小不受支持');
    const directory=join(dataRoot,'machine','updates');await mkdir(directory,{recursive:true});
    const destination=join(directory,'ShensiNotes-'+release.latestVersion+'-'+entry.sha256.slice(0,16)+suffix);
    downloadState={status:'downloading',version:release.latestVersion,bytes:0,total:entry.sizeBytes};verifiedPath='';
    await downloadReleaseFile({url:entry.url,destination,size:entry.sizeBytes,digest:entry.sha256,fetchImpl,signal:controller.signal,
     onProgress:bytes=>{downloadState={...downloadState,bytes};}});
    verifiedPath=destination;downloadState={status:'downloaded',version:release.latestVersion,bytes:entry.sizeBytes,total:entry.sizeBytes,fileName:destination.split(/[\\/]/).at(-1)};
    return snapshot();
   }catch(error){downloadState={...downloadState,status:'error',message:error.message};throw error;}
  })().finally(()=>{downloadFlight=null;});return downloadFlight;
 }
 function startDownload(){
  if(result.status!=='available'||!result.download)throw Error('没有可下载的新版，请先检查更新');
  void download().catch(()=>{}); // The pollable state retains the transfer error.
  return snapshot();
 }
 return {snapshot,check,download,startDownload,async reveal(openFolder){if(!verifiedPath||downloadState.status!=='downloaded')throw Error('尚无校验通过的安装包');if(!openFolder)throw Error('请在桌面版中打开下载目录');await openFolder(join(dataRoot,'machine','updates'));return {opened:true};},async close(){controller.abort();await Promise.allSettled([checkFlight,downloadFlight]);}};
}
export async function checkNotesUpdate({currentVersion=packageVersion,feed=process.env.SHENSI_NOTES_UPDATE_FEED||'',repository=NOTES_UPDATE_REPOSITORY,platform=process.platform,arch=process.arch,fetchImpl=fetch,now=Date.now}={}){
 const checkedAt=new Date(now()).toISOString(),base={currentVersion,checkedAt,repository};
 const responseError=async response=>{
  await response.body?.cancel();
  if(response.status===429||response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||response.headers.has('retry-after'))){
   const after=response.headers.get('retry-after'),seconds=after!==null&&/^\d+$/.test(after)?Number(after):0,date=seconds?now()+seconds*1000:Date.parse(after)||0,reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
   const times=[now()+NOTES_UPDATE_MIN_CHECK_MS,date,reset].filter(v=>Number.isFinite(v)&&v<8.64e15),retryAt=new Date(Math.max(...times)).toISOString();
   return Object.assign(Error('更新服务暂时限流，将在 '+new Date(retryAt).toLocaleString('zh-CN',{hour12:false})+' 后允许重试；本地功能不受影响'),{code:'UPDATE_RATE_LIMITED',retryAt});
  }
  return Object.assign(Error('更新服务返回 '+response.status),{httpStatus:response.status});
 };
 const json=async url=>{const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/json','User-Agent':'Shensi-Notes-Updater'}});if(!response.ok)throw await responseError(response);return JSON.parse((await readLimited(response,128*1024)).toString('utf8'));};
 try{
  let info,tag;
  if(feed){const url=new URL(feed);if(url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('更新源必须使用 HTTPS');info=await json(url.href);}
  else{
   if(!validRepository(repository))throw Error('更新仓库无效');
   // GitHub's documented latest-asset link avoids the shared anonymous REST quota.
   // Resolve its fixed release tag before trusting the manifest or any CDN redirect.
   const latest='https://github.com/'+repository+'/releases/latest/download/shensi-notes-update.json',prefix='/'+repository+'/releases/download/';
   let url=latest;
   for(let i=0;i<5;i++){
    const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname))throw Error('更新清单来源不可信');
    if(parsed.hostname==='github.com'){
     if(i!==0||url!==latest){const match=parsed.pathname.startsWith(prefix)&&/^([^/]+)\/shensi-notes-update\.json$/.exec(parsed.pathname.slice(prefix.length)),parts=match&&versionParts(match[1].replace(/^v/,''));if(!parts||parts[4]||parsed.search||parsed.hash||tag&&tag!==match[1])throw Error('官方更新发布身份无效');tag=match[1];}
    }else if(!tag)throw Error('更新清单缺少官方固定版本');
    const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{Accept:'application/octet-stream','User-Agent':'Shensi-Notes-Updater'}});
    if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('更新清单重定向无效');url=new URL(next,url).href;continue;}
    if(response.status===404){await response.body?.cancel();return {...base,status:'unavailable',message:'神思官方渠道尚未提供可用的更新清单。'};}
    if(!response.ok)throw await responseError(response);
    if(!tag){await response.body?.cancel();throw Error('更新清单缺少官方固定版本');}
    info=JSON.parse((await readLimited(response,128*1024)).toString('utf8'));break;
   }
   if(!info)throw Error('更新清单重定向过多');
  }
  if(info.appId!=='shensi-notes'||!versionParts(info.version)||tag&&tag.replace(/^v/,'')!==info.version)throw Error('更新信息不属于神思或版本不符');
  const newer=compareNotesVersions(info.version,currentVersion)>0;
  let download;if(info.downloads!==undefined){if(!Array.isArray(info.downloads))throw Error('更新下载清单无效');for(const entry of info.downloads){const url=new URL(entry.url);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.hostname!=='github.com'||!url.pathname.startsWith('/'+repository+'/releases/download/'+(tag||'v'+info.version)+'/')||!/^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname)||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.sizeBytes)||entry.sizeBytes<1)throw Error('软件包必须绑定官方 GitHub 固定版本及校验值');if(entry.platform===platform&&entry.arch===arch){if(download)throw Error('当前系统存在重复软件包');download=entry;}}}
  if(newer&&!download)return {...base,status:'unavailable',latestVersion:info.version,message:'发现 '+info.version+'，当前系统尚未提供可核验的安装包。'};
  return {...base,status:newer?'available':'up_to_date',latestVersion:info.version,...(download?{download}:{}),message:newer?'发现新版本 '+info.version:'当前已是该更新渠道的最新版本'};
 }catch(error){
  const unavailable=error.name==='TimeoutError'||error instanceof TypeError&&/fetch failed|network/i.test(error.message)||
   /net::ERR_|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(error.message)||[404,408,500,502,503,504].includes(error.httpStatus);
  if(platform==='darwin'&&repository===NOTES_UPDATE_REPOSITORY&&feed===macCatalog&&unavailable){
   const alternate=await checkNotesUpdate({currentVersion,feed:'',repository,platform,arch,fetchImpl,now});
   return {...alternate,usedReleaseManifestFallback:true};
  }
  return {...base,status:'error',message:'更新检查未完成：'+error.message,...error.code==='UPDATE_RATE_LIMITED'?{code:error.code,retryAt:error.retryAt}:{}};
 }
}
