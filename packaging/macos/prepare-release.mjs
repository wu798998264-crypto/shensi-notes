// Adapt the verified public Windows payload in a new staging directory only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,readdir,rm} from 'node:fs/promises';
import {resolve,join,relative,sep,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const [sourceArg,workArg,arch]=process.argv.slice(2),source=resolve(sourceArg),work=resolve(workArg),app=join(work,'app');assert(['arm64','x64'].includes(arch));
const hash=b=>createHash('sha256').update(b).digest('hex');
assert(isAbsolute(relative(source,app))||relative(source,app).startsWith('..'+sep),'Output must be outside the original application');
await mkdir(app,{recursive:false});
for(const name of ['apps','packages','resources','package.json','release-build.json'])await cp(join(source,name),join(app,name),{recursive:true,errorOnExist:true,force:false});
const pkg=JSON.parse(await readFile(join(app,'package.json')));assert.equal(pkg.version,'0.0.41');assert.equal(pkg.name,'shensi-notes');
pkg.version='0.0.42';
// These are retired Windows integrations, never macOS executables.
for(const name of ['resources/thirdparty','resources/yunx/runtime/runtime','resources/dreamina-canvas/dreamina-canvas.exe'])await rm(join(app,name),{recursive:true,force:true});
async function prune(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const p=join(folder,entry.name);assert(!entry.isSymbolicLink(),'Unexpected link in public source');if(entry.isDirectory())await prune(p);else if(/\.(?:exe|dll|pyd|ps1|bat|cmd|cs)$/i.test(entry.name))await rm(p);}}
await prune(app);
const changes=[];
async function replace(file,old,next){const p=join(app,file),text=await readFile(p,'utf8');assert.equal(text.split(old).length-1,1,'Unexpected source boundary: '+file);const result=text.replace(old,next);await writeFile(p,result);changes.push({file,sha256:hash(Buffer.from(result))});}
await replace('apps/desktop/yunx-engine.mjs',"'runtime','bin','java.exe'","'runtime','bin',process.platform==='win32'?'java.exe':'java'");
await replace('apps/desktop/main.mjs',"filters:[{name:'浏览器程序',extensions:['exe']}]","filters:[{name:'浏览器程序',extensions:process.platform==='darwin'?['app']:['exe']}]" );
await replace('packages/ui/model-external-browser.js','选择浏览器 .exe','选择浏览器程序');
// Even the version probe must not write bytecode into a signed application.
await replace('packages/official/chushou-executor.mjs',"[...prefix,'-I','-c','import sys;","[...prefix,'-I','-B','-c','import sys;");
await replace('packages/official/external-browsers.mjs',"const profileRoots={edge:join(homedir(),'AppData/Local/Microsoft/Edge/User Data'),chrome:join(homedir(),'AppData/Local/Google/Chrome/User Data')};",`const profileRoots={edge:join(homedir(),'Library/Application Support/Microsoft Edge'),chrome:join(homedir(),'Library/Application Support/Google/Chrome')};
const macBrowsers={edge:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',chrome:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'};
async function browserExecutable(value){if(!value.endsWith('.app'))return value;const {stdout}=await new Promise((accept,reject)=>{const child=spawn('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',join(value,'Contents/Info.plist')],{stdio:['ignore','pipe','ignore']});let stdout='';child.stdout.on('data',d=>stdout+=d);child.once('error',reject);child.once('exit',code=>code===0?accept({stdout}):reject(Error('无法读取浏览器应用信息')));});const name=stdout.trim();if(!name||/[\\\\/]/.test(name)||name==='.'||name==='..')throw failure('浏览器应用信息无效');return join(value,'Contents/MacOS',name);}`);
await replace('packages/official/external-browsers.mjs',"AUTH_BROWSERS[entry.browserId]?.candidates||[]","[macBrowsers[entry.browserId]].filter(Boolean)");
await replace('packages/official/external-browsers.mjs',"const name=String(input.name||'').trim(),executable=String(input.executable||'').trim(),profileRoot=String(input.profileRoot||'').trim();","const name=String(input.name||'').trim(),executable=await browserExecutable(String(input.executable||'').trim()),profileRoot=String(input.profileRoot||'').trim();");
await replace('packages/official/external-browsers.mjs',"extname(executable).toLowerCase()!=='.exe'||",'');
await replace('packages/official/external-browsers.mjs','请选择有效的浏览器 .exe 程序','请选择有效的浏览器应用');
const patch=JSON.parse(await readFile(join(work,'doubao.plugin.json')));assert.equal(patch.id,'thirdparty.doubao');assert.equal(patch.version,'0.1.34');
for(const p of ['apps/desktop/doubao-driver.mjs','packages/thirdparty/doubao-tasks.mjs']){await writeFile(join(app,p),patch.files[p]);changes.push({file:p,sha256:hash(Buffer.from(patch.files[p]))});}
const overrides=JSON.parse(await readFile(resolve('packaging/macos/overrides.json'),'utf8'));
for(const entry of overrides){assert(/^(?:packages\/ui\/[a-z-]+\.(?:js|css)|packages\/core\/src\/(?:native-extensions|public-extension-catalog)\.mjs|packages\/official\/(?:catalog|host|selection-edits)\.mjs|packages\/thirdparty\/speech-engine\.mjs)$/.test(entry.path));const bytes=await readFile(resolve('packaging/macos/overrides',entry.path));assert.equal(hash(bytes),entry.sha256);await writeFile(join(app,entry.path),bytes);changes.push({file:entry.path,sha256:entry.sha256});}
await writeFile(join(app,'apps/desktop/main-macos.mjs'),`import {join} from 'node:path';
const resources=process.resourcesPath;
process.env.SHENSI_LIBTV_CLI_PATH ||= join(resources,'cli/libtv');
process.env.SHENSI_DREAMINA_CANVAS_EXECUTABLE ||= join(resources,'cli/dreamina-canvas');
process.env.SHENSI_NOTES_UPDATE_FEED ||= 'https://raw.githubusercontent.com/wu798998264-crypto/shensi-notes/main/catalog/macos-update.json';
await import('./main.mjs');\n`);
pkg.main='apps/desktop/main-macos.mjs';await writeFile(join(app,'package.json'),JSON.stringify(pkg,null,2)+'\n');
await writeFile(join(work,'adaptations.json'),JSON.stringify({version:pkg.version,arch,changes,containsUserData:false,limits:['Windows-only local SenseVoice ASR and H3 helpers are unavailable; no automatic audio upload','Website and paid-generation checks require the user to authorize accounts on the Mac']},null,2));
let checked=0;async function syntax(folder){for(const e of await readdir(folder,{withFileTypes:true})){const p=join(folder,e.name);if(e.isDirectory())await syntax(p);else if(/\.[mc]?js$/.test(e.name)){const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);checked++;}}}await syntax(join(app,'apps'));await syntax(join(app,'packages'));
const config={appId:'com.shensi.notes',productName:'神思',electronVersion:'42.4.0',asar:false,npmRebuild:false,nodeGypRebuild:false,compression:'normal',directories:{app,output:join(work,'dist-'+arch)},files:['**/*'],extraResources:[{from:join(work,'runtime'),to:'.'}],afterSign:resolve('packaging/macos/after-sign.cjs'),mac:{icon:resolve('build/mac/icon.icns'),category:'public.app-category.productivity',identity:'-',hardenedRuntime:false,gatekeeperAssess:false,target:[{target:'dmg',arch:[arch]},{target:'zip',arch:[arch]}],artifactName:'Shensi-${version}-${arch}.${ext}'},dmg:{artifactName:'Shensi-${version}-${arch}.dmg'},publish:null};
await writeFile(join(work,'builder.json'),JSON.stringify(config,null,2));console.log(JSON.stringify({prepared:true,arch,checked,changes:changes.map(v=>v.file)}));
