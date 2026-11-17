import {readFile} from 'node:fs/promises';
import {createPublicKey,verify,createHash} from 'node:crypto';
import {NATIVE_EXTENSION_SPECS,NATIVE_EXTENSION_FORMAT,NATIVE_EXTENSION_LIMIT} from './native-extension-specs.mjs';
import {readLimited,comparePluginVersions,downloadGitHubArtifact} from './plugin-artifacts.mjs';
import {validatePluginPackage} from './plugin-package.mjs';
import {ProxyAgent,EnvHttpProxyAgent,fetch as networkFetch} from 'undici';
export const PUBLIC_EXTENSION_REPOSITORY='wu798998264-crypto/shensi-plugins';
// Older hosts reject unfamiliar plugin identities; preserve their directory.
export const PUBLIC_EXTENSION_CATALOG_PATH=process.platform==='darwin'?'catalog/extensions-macos.json':'catalog/extensions-v2.json';
export const PUBLIC_EXTENSION_CATALOG_URL='https://raw.githubusercontent.com/'+PUBLIC_EXTENSION_REPOSITORY+'/main/'+PUBLIC_EXTENSION_CATALOG_PATH;
// Desktop updates follow OS/PAC routing. Undici keeps redirects explicit and
// does not share Electron account cookies or browser authentication.
const updateAgents=new Map();
export async function publicExtensionFetch(url,options={}){
 let route='DIRECT';if(process.versions.electron){const {session}=await import('electron');route=String(await session.fromPartition('shensi-public-extension-updates',{cache:false}).resolveProxy(url)).split(';')[0].trim();}
 let dispatcher=updateAgents.get(route);if(!dispatcher){if(!route||route==='DIRECT')dispatcher=new EnvHttpProxyAgent();else{const match=route.match(/^(PROXY|HTTPS)\s+([^\s/@]+:\d+)$/i);if(!match)throw Error('当前系统代理协议无法用于扩展下载，请检查系统代理');dispatcher=new ProxyAgent({uri:(match[1]==='HTTPS'?'https':'http')+'://'+match[2],connections:3});}updateAgents.set(route,dispatcher);}
 return networkFetch(url,{...options,dispatcher});
}
export async function downloadPublicExtension(item,{fetchImpl=publicExtensionFetch}={}){
 if(item.mirrorUrl){assertPublicMirror(item);try{const response=await fetchImpl(item.mirrorUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('GitHub 下载未完成（HTTP '+response.status+'）');const bytes=await readLimited(response,item.sizeBytes);if(bytes.length!==item.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('下载插件的大小或 SHA256 与审核制品不一致，原版本未改动');return bytes;}catch(error){if(!/(?:HTTP (?:408|500|502|503|504)|fetch failed|ECONNRESET|ETIMEDOUT|timed out|timeout)/i.test(error.message))throw error;}}
 for(let attempt=0;;attempt++)try{return await downloadGitHubArtifact(item,{fetchImpl});}catch(error){if(attempt>=2||!/(?:HTTP (?:408|500|502|503|504)|fetch failed|ECONNRESET|ETIMEDOUT|timed out|timeout)/i.test(error.message))throw error;await new Promise(r=>setTimeout(r,500*(attempt+1)));}
}
function assertPublicMirror(item){const prefix='https://raw.githubusercontent.com/'+PUBLIC_EXTENSION_REPOSITORY+'/',commit=String(item.mirrorUrl).slice(prefix.length).split('/')[0];if(!/^[a-f0-9]{40}$/.test(commit)||item.mirrorUrl!==prefix+commit+'/packages/'+item.pluginId+'-'+item.version+'.plugin.json')throw Error('公共扩展备用下载来源不符');}
export const publicCatalogPayload=v=>Buffer.from(JSON.stringify({format:v.format,publishedAt:v.publishedAt,items:v.items}));
export const publicExtensionId=id=>NATIVE_EXTENSION_SPECS.some(p=>p.id===id)||id==='thirdparty.calendar';
export function verifyPublicCatalog(raw,keys){
 if(raw?.format!=='shensi-public-extension-catalog-v1'||!Array.isArray(raw.items)||raw.items.length>200||raw.signature?.algorithm!=='Ed25519'||!keys[raw.signature.keyId]||!verify(null,publicCatalogPayload(raw),createPublicKey(keys[raw.signature.keyId]),Buffer.from(raw.signature.value||'','base64url')))throw Error('公共扩展目录签名无效');
 const seen=new Set();for(const item of raw.items){const retired=item.pluginId==='thirdparty.credential-vault'&&/^0\.0\.(?:[0-9]|[12][0-9]|3[0-6])$/.test(item.hostVersion),spec=NATIVE_EXTENSION_SPECS.find(s=>s.id===item.pluginId)||(retired?{repository:'wu798998264-crypto/shensi-plugin-credential-vault'}:null),native=item.packageFormat===NATIVE_EXTENSION_FORMAT;
  if((!publicExtensionId(item.pluginId)&&!retired)||(native?!spec:!(!spec&&item.pluginId==='thirdparty.calendar'&&item.packageFormat==='shensi-script-plugin-v1')))throw Error('公共扩展目录身份无效');
  const identity=[item.pluginId,item.version,item.hostVersion].join('@');if(seen.has(identity)||!/^\d+\.\d+\.\d+$/.test(item.version)||!/^\d+\.\d+\.\d+$/.test(item.hostVersion)||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<1||item.sizeBytes>(native?NATIVE_EXTENSION_LIMIT:2*1024*1024))throw Error('公共扩展目录版本或大小无效');seen.add(identity);
  if(item.repository!==(spec?.repository||PUBLIC_EXTENSION_REPOSITORY)||item.downloadUrl!=='https://github.com/'+PUBLIC_EXTENSION_REPOSITORY+'/releases/download/plugin-'+item.pluginId+'-v'+item.version+'/'+item.pluginId+'-'+item.version+'.plugin.json')throw Error('公共扩展下载来源不符');
  if(item.mirrorUrl)assertPublicMirror(item);
 }
 return raw;
}
export function createPublicExtensionCatalog({fetchImpl=publicExtensionFetch,hostVersion,keys,cacheMs=60000,platform=process.platform}={}){
 let cached,checkedAt=0,flight;
 async function config(){keys??=JSON.parse(await readFile(new URL('../../../resources/plugins/native-extension-trust.json',import.meta.url))).keys;hostVersion??=JSON.parse(await readFile(new URL('../../../package.json',import.meta.url))).version;}
 async function read({fresh=false}={}){await config();if(!fresh&&cached&&Date.now()-checkedAt<cacheMs)return cached;if(flight)return flight;flight=(async()=>{const r=await fetchImpl(PUBLIC_EXTENSION_CATALOG_URL,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});if(!r.ok)throw Error('公共扩展目录暂不可读取（HTTP '+r.status+'）');const raw=JSON.parse((await readLimited(r,1024*1024)).toString());cached=verifyPublicCatalog(raw,keys);checkedAt=Date.now();return cached;})().finally(()=>flight=null);return flight;}
 function project(raw){const latest=new Map();for(const item of raw.items.filter(i=>i.hostVersion===hostVersion&&(i.packageFormat!==NATIVE_EXTENSION_FORMAT||i.platform===platform||!i.platform&&platform==='win32'))){const prior=latest.get(item.pluginId);if(!prior||comparePluginVersions(item.version,prior.version)>0)latest.set(item.pluginId,item);}return [...latest.values()].map(item=>({...item,source:'public-extension',author:'神思',permissions:item.packageFormat===NATIVE_EXTENSION_FORMAT?['local-code']:item.permissions||[],platforms:['desktop'],publishedAt:item.publishedAt||raw.publishedAt}));}
 async function list(){return project(await read());}
 async function peek(){await config();if(cached)return project(cached);try{return project(verifyPublicCatalog(JSON.parse(await readFile(new URL('../../../resources/plugins/public-extension-catalog.json',import.meta.url),'utf8')),keys));}catch(error){if(error.code!=='ENOENT')throw error;return [];}}
 async function check(record,{fresh=false}={}){if(!publicExtensionId(record?.id))return null;if(fresh)await read({fresh:true});const found=(await list()).find(i=>i.pluginId===record.id),currentVersion=record.pendingVersion||record.nativeInstalledVersion||record.version,available=!!found&&comparePluginVersions(found.version,currentVersion)>0;
  return {pluginId:record.id,currentVersion,checkedAt:new Date().toISOString(),source:found?.packageFormat===NATIVE_EXTENSION_FORMAT?'public-native':'public-script',available,status:found?available?'available':'up_to_date':'unavailable',latestVersion:found?.version||'',...(available?{update:{...found,installedVersion:currentVersion}}:{}),message:found?available?'发现新版本 '+found.version:'当前已是此渠道的最新版本':'尚无适配当前神思版本的公共安装包'};
 }
 async function install(record,body,{runtime,plugins}={}){if(body.grantFullAccess!==true)throw Error('请先明确允许此扩展插件运行本地代码');const removed=record?.available&&record.nativeUninstalledVersion&&(record.nativeAvailableVersion||record.nativeUninstalledVersion),current=removed?{...record,version:removed,updateChannel:{...record.updateChannel,currentVersion:removed}}:record,result=await check(current,{fresh:true});let item=result?.update;
  if(!item&&removed){const found=(await list()).find(p=>p.pluginId===record.id),saved=await runtime?.snapshot();if(found?.version===removed&&found.version===body.version&&found.sha256===body.expectedSha256&&body.expectedVersion===removed&&(saved?.pending[record.id]?.version===removed||saved?.active[record.id]?.version===removed))return {id:record.id,version:removed,reactivated:true,restartRequired:!!saved.pending[record.id]};}
  if(!item||item.pluginId!==body.pluginId||item.version!==body.version||result.currentVersion!==body.expectedVersion||item.sha256!==body.expectedSha256)throw Error('插件版本或安装包已变化，请重新检查更新');const pkg=JSON.parse(await downloadPublicExtension(item,{fetchImpl}));if(pkg.id!==item.pluginId||pkg.version!==item.version||pkg.format!==item.packageFormat)throw Error('下载包与公共目录不匹配');
  if(pkg.format===NATIVE_EXTENSION_FORMAT){if(!runtime)throw Error('请在神思桌面版安装扩展');return runtime.install({package:pkg,grantFullAccess:true,replace:true,expectedVersion:body.expectedVersion});}
  validatePluginPackage(pkg);return plugins.install({package:pkg,grantFullAccess:true,replace:true,expectedVersion:body.expectedVersion,trustedDistribution:true});
 }
 return {read,list,peek,check,install};
}
