import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,verify,createPublicKey} from 'node:crypto';
import {registerHooks} from 'node:module';
import {jsonStore} from './json-store.mjs';
import {comparePluginVersions} from './plugin-artifacts.mjs';
import {NATIVE_EXTENSION_SPECS,NATIVE_EXTENSION_FORMAT,NATIVE_EXTENSION_LIMIT,NATIVE_EXTENSION_HOST_FILES,nativeExtensionForPath} from './native-extension-specs.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const validPath=p=>typeof p==='string'&&/^[A-Za-z0-9_./-]+$/.test(p)&&!p.split('/').some(v=>!v||v==='.'||v==='..')&&!isAbsolute(p);
export const nativeExtensionPayload=p=>Buffer.from(JSON.stringify({format:p.format,id:p.id,name:p.name,version:p.version,repository:p.repository,hostVersion:p.hostVersion,dependencies:p.dependencies,files:p.files,...p.platform!==undefined?{platform:p.platform}:{}}));
export async function validateNativeExtension(raw,{root,keys,platform=process.platform}){
 const spec=NATIVE_EXTENSION_SPECS.find(s=>s.id===raw?.id);
 if(!spec||raw.format!==NATIVE_EXTENSION_FORMAT||raw.name!==spec.name||raw.repository!==spec.repository||!/^\d+\.\d+\.\d+$/.test(raw.version||''))throw Error('扩展插件包身份无效');
 const payload=nativeExtensionPayload(raw);if(payload.length>NATIVE_EXTENSION_LIMIT)throw Error('扩展插件包超过16 MB限制');
 const key=keys[raw.signature?.keyId];
 if(!key||raw.signature?.algorithm!=='Ed25519'||!verify(null,payload,createPublicKey(key),Buffer.from(raw.signature?.value||'','base64url')))throw Error('扩展插件发布签名无效，未安装');
 if(raw.platform!==undefined&&(!['win32','darwin','linux'].includes(raw.platform)||raw.platform!==platform))throw Error('扩展插件不适用于当前操作系统，未安装');
 const host=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 if(raw.hostVersion!==host.version)throw Error('扩展插件需要神思 '+raw.hostVersion+'，当前版本不兼容');
 if(!raw.files||typeof raw.files!=='object'||Array.isArray(raw.files)||!Object.keys(raw.files).length||Object.keys(raw.files).length>250)throw Error('扩展插件文件清单无效');
 const names=new Set();for(const [path,source]of Object.entries(raw.files)){
  if(!validPath(path)||nativeExtensionForPath(path)?.id!==spec.id||typeof source!=='string'||Buffer.byteLength(source)>8*1024*1024||names.has(path.toLowerCase()))throw Error('扩展插件试图替换自身范围之外的文件');
  names.add(path.toLowerCase());
 }
 if(!raw.dependencies||typeof raw.dependencies!=='object'||Array.isArray(raw.dependencies)||Object.keys(raw.dependencies).length>500)throw Error('缺少宿主兼容清单');
 if(NATIVE_EXTENSION_HOST_FILES.some(path=>!Object.hasOwn(raw.dependencies,path)))throw Error('缺少桌面宿主兼容摘要');
 for(const [path,expected]of Object.entries(raw.dependencies)){
  if(!validPath(path)||nativeExtensionForPath(path)?.id===spec.id||!path.match(/^(?:packages|apps\/desktop|resources)\//)||!/^[a-f0-9]{64}$/.test(expected))throw Error('宿主依赖清单无效');
  const info=await lstat(join(root,path));if(!info.isFile()||info.isSymbolicLink()||hash(await readFile(join(root,path)))!==expected)throw Error('宿主依赖已变化，请使用适配当前神思的扩展插件包');
 }
 return {package:structuredClone(raw),hash:hash(payload)};
}

let currentRuntime=null;
// Called only before desktop imports are loaded. Source remains at its original
// module URL, so relative host dependencies resolve to one shared implementation.
export async function activateNativeExtensions({root,dataRoot,keys}={}){
 if(currentRuntime)throw Error('扩展插件运行时已初始化，需要重新启动才能切换');
 root=resolve(root);dataRoot=resolve(dataRoot);const directory=join(dataRoot,'plugins','native'),registry=jsonStore(join(directory,'registry.json'),{active:{},pending:{}});
 keys??=JSON.parse(await readFile(join(root,'resources/plugins/native-extension-trust.json'),'utf8')).keys;
 let state=await registry.read(),rolledBack=false;
 if(!state.active||!state.pending||Array.isArray(state.active)||Array.isArray(state.pending))throw Error('扩展安装记录无效，请保留资料并恢复记录');
 if(state.startup){state=await registry.update(s=>({...s,active:s.startup.previous,pending:{},startup:null,lastError:'上次扩展启动未完成，已恢复之前版本；笔记和设置保留。'}));rolledBack=true;}
 const selected={...state.active,...state.pending},sources=new Map(),records={},errors=[],packages=[];
 for(const [id,ref]of Object.entries(selected)){
  // Retired package metadata is retained for rollback; it must never override browser-owned files.
  if(id==='thirdparty.credential-vault')continue;
  try{
   if(!NATIVE_EXTENSION_SPECS.some(p=>p.id===id)||!/^[a-f0-9]{64}$/.test(ref.hash))throw Error('已安装扩展记录无效');
   const pkg=JSON.parse(await readFile(join(directory,ref.hash+'.json'),'utf8')),checked=await validateNativeExtension(pkg,{root,keys});
   if(checked.hash!==ref.hash||pkg.id!==id||pkg.version!==ref.version)throw Error('已安装扩展内容已变化');
   records[id]={version:pkg.version,hash:ref.hash};packages.push(pkg);
   const filesRoot=join(directory,ref.hash);
   for(const [path,source]of Object.entries(pkg.files)){
    const target=join(filesRoot,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,source,{mode:0o600});
    sources.set(resolve(root,path),{source,target,hash:hash(source)});
   }
  }catch(error){errors.push(id+'：'+error.message);}
 }
 for(const pkg of packages)for(const [path,expected]of Object.entries(pkg.dependencies)){const entry=sources.get(resolve(root,path));if(entry&&entry.hash!==expected)errors.push(pkg.id+'：另一扩展改变了本包依赖，请安装兼容版本');}
 // A pending batch activates together; a broken sibling cannot produce a half update.
 if(errors.length&&Object.keys(state.pending).length){await registry.update(s=>({...s,pending:{},lastError:errors.join('\n')}));return activateWithoutPending();}
 if(errors.length){sources.clear();for(const id of Object.keys(records))delete records[id];await registry.update(s=>({...s,lastError:errors.join('\n')}));}
 async function activateWithoutPending(){currentRuntime=null;return activateNativeExtensions({root,dataRoot,keys});}
 const changes=Object.keys(state.pending).length>0;
 if(changes)await registry.update(s=>({...s,active:records,pending:{},startup:{previous:s.active,versions:records},lastError:''}));
 const hook=registerHooks({load(url,context,next){
  if(url.startsWith('file:')){const entry=sources.get(resolve(fileURLToPath(url)));if(entry&&/\.[mc]?js$/.test(fileURLToPath(url)))return {format:url.endsWith('.cjs')?'commonjs':'module',source:entry.source,shortCircuit:true};}
  return next(url,context);
 }});
 let flight=Promise.resolve();
 const runtime={root,dataRoot,records,errors,rolledBack,
  bytes(path){const found=sources.get(resolve(path));return found?Buffer.from(found.source):null;},
  resource(path){const found=sources.get(resolve(path));if(!found)return path;if(hash(readFileSync(found.target))!==found.hash)throw Error('扩展资源被修改，请重新安装');return found.target;},
  async snapshot(){const saved=await registry.read();return {active:records,installed:saved.active,pending:saved.pending||{},lastError:saved.lastError||errors.join('\n'),restartRequired:!!Object.keys(saved.pending||{}).length};},
  async healthy(){if(changes)await registry.update(s=>({...s,startup:null}));},
  install(input){const task=flight.catch(()=>{}).then(async()=>{
   if(input.grantFullAccess!==true)throw Error('此扩展包含本地代码，请先允许本地代码权限');
   const checked=await validateNativeExtension(input.package,{root,keys}),pkg=checked.package;
   const saved=await registry.read(),previous=saved.pending[pkg.id]||saved.active[pkg.id],version=previous?.version||'0.1.0';
   if(previous&&(input.replace!==true||input.expectedVersion!==version))throw Error('插件版本已存在或发生变化，请刷新后更新');
   if(comparePluginVersions(pkg.version,version)<=0)throw Error('扩展更新版本必须高于已安装版本');
   await mkdir(directory,{recursive:true});const path=join(directory,checked.hash+'.json');
   await writeFile(path,JSON.stringify(pkg),{flag:'wx',mode:0o600}).catch(async e=>{if(e.code!=='EEXIST')throw e;const found=await validateNativeExtension(JSON.parse(await readFile(path,'utf8')),{root,keys});if(found.hash!==checked.hash)throw Error('缓存中的扩展包不一致');});
   await registry.update(s=>{const live=s.pending[pkg.id]||s.active[pkg.id];if(JSON.stringify(live)!==JSON.stringify(previous))throw Error('扩展版本已变化，请重试');s.pending[pkg.id]={version:pkg.version,hash:checked.hash};return s;});
   return {id:pkg.id,version:pkg.version,restartRequired:true};
  });flight=task;return task;},
  close(){hook.deregister();if(currentRuntime===runtime)currentRuntime=null;}
 };currentRuntime=runtime;return runtime;
}
export const nativeExtensionRuntime=()=>currentRuntime;
export const nativeExtensionBytes=path=>currentRuntime?.bytes(path)||null;
export const nativeExtensionResource=path=>currentRuntime?.resource(path)||path;
