const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
exports.verifyUi=async({js,api,screenshot,evidence,platform})=>{
 const wait=async(fn,label)=>{const end=Date.now()+20000;while(!await fn()){assert(Date.now()<end,'UI timed out: '+label);await new Promise(r=>setTimeout(r,100));}},click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
 await wait(()=>js('globalThis.shensiWorkspaceReady===true'),'workspace');
 await click('[data-action=official-control]');await wait(()=>js('!!document.querySelector(".chat-compose")'),'chat');
 const id=await js('document.querySelector("#library-select").value');
 const customThemes=[{id:'custom-mac-violet',name:'紫夜',colors:{topbar:'#211c30',sidebar:'#211c30',editor:'#181421',chat:'#181421',text:'#f0eaf8',accent:'#bb9eef'}},{id:'custom-mac-blue',name:'浅蓝',colors:{topbar:'#e1edf5',sidebar:'#e1edf5',editor:'#f2f8fc',chat:'#f2f8fc',text:'#203748',accent:'#235d96'}}];
 const rows=[];
 for(const theme of ['light','dark','stone','mist','ember','ink','custom-mac-violet','custom-mac-blue']){
  console.log('UI theme: '+theme);
  // The glyph specimen is test content, so it must not live inside a product
  // container whose contents are replaced by normal workspace refreshes.
  await js(`(async()=>{(await import('/preferences.js')).applyPresentation(${JSON.stringify({theme,customThemes})});const {uiGlyph,uiGlyphCodes}=await import('/ui-glyph.js');document.querySelector('#icon-matrix')?.remove();const matrix=document.createElement('div');matrix.id='icon-matrix';matrix.style.cssText='position:fixed;left:280px;top:150px;width:400px;display:flex;gap:8px;flex-wrap:wrap;padding:10px;color:var(--text);background:var(--bg);pointer-events:none;z-index:999';matrix.innerHTML=uiGlyphCodes.map(c=>uiGlyph(c)).join('');document.body.append(matrix);})()`);
  const sample=await js(`(()=>{const selectors=['[data-action=official-control]','[data-chat-new]','[data-chat-history]','[data-chat-export]','[data-chat-workspace-history]','[data-chat-upload]','[data-chat-web]','[data-chat-supplement]','.send-button'];const rgb=c=>c.match(/[0-9.]+/g).map(Number),lum=c=>rgb(c).slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);return {icons:[...document.querySelectorAll('[data-ui-glyph]')].filter(e=>e.getClientRects().length).map(e=>{const svg=e.querySelector('svg'),b=svg.getBBox(),r=e.getBoundingClientRect();return {code:e.dataset.uiGlyph,visible:b.width+b.height>0&&r.width>0&&r.height>0};}),buttons:selectors.map(selector=>{const e=document.querySelector(selector),s=getComputedStyle(e);let p=e,bg;while(p){bg=getComputedStyle(p).backgroundColor;if(rgb(bg)[3]!==0)break;p=p.parentElement;}const a=lum(s.color),b=lum(bg);return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),visible:e.getClientRects().length>0&&!!e.querySelector('svg')};})};})()`);
  assert(sample.icons.length>=40);for(const icon of sample.icons)assert(icon.visible,theme+' '+icon.code);for(const b of sample.buttons){assert(b.visible,theme+' '+b.selector);assert(b.ratio>=3,theme+' contrast '+b.selector+' '+b.ratio);}
  await click('[data-chat-model-toggle]');assert(await js('!document.querySelector("[data-chat-model-panel]").hidden'));await click('[data-chat-model-close]');
  await click('[data-chat-history]');assert(await js('!document.querySelector(".chat-history").hidden'));await click('[data-chat-history-close]');
  await click('[data-chat-workspace-history]');assert(await js('!document.querySelector(".chat-history").hidden'));await click('[data-chat-history-close]');
  await click('[data-chat-references]');await wait(()=>js('!document.querySelector("[data-chat-reference-panel]").hidden'),'references');await click('[data-reference-close]');await wait(()=>js('document.querySelector("[data-chat-reference-panel]").hidden'),'references closed');
  const old=await js('document.querySelector("[data-chat-web]").getAttribute("aria-pressed")');await click('[data-chat-web]');await wait(()=>js('document.querySelector("[data-chat-web]").getAttribute("aria-pressed")!=='+JSON.stringify(old)),'web setting');
  await screenshot('theme-'+platform+'-'+theme+'.png');rows.push({theme,minimumButtonContrast:Math.min(...sample.buttons.map(b=>b.ratio)),icons:sample.icons.length,interactiveButtons:true});
 }
 await js(`(async()=>{(await import('/preferences.js')).applyPresentation({theme:'light'});document.querySelector('#icon-matrix')?.remove();})()`);
 const count=async()=>{let n=0;for(const pluginId of ['official.document-chat','official.whiteboard-generation','official.conversation-control'])n+=(await api('official/chat/read',{id,pluginId})).conversations.length;return n;};const before=await count();await click('[data-chat-new]');await wait(async()=>await count()>before,'new chat persisted');
 await click('[data-action="plugin:menu"]');await wait(()=>js('!!document.querySelector("[data-plugin-manager]")'),'plugin menu');
 assert(await js('!document.querySelector("[data-plugin-settings=\\"official.document-chat\\"],[data-plugin-settings=\\"official.whiteboard-generation\\"]")'));
 await screenshot('unified-plugin-menu-'+platform+'.png');
 const priorModels=await api('official/models'),modelId='model-ui-default-test';
 await api('official/models/save',{expectedRevision:priorModels.revision,profile:{id:modelId,channel:'text',name:'默认模型保存验收（离线）',provider:'自定义兼容接口',adapter:'api',protocol:'chat_completions',baseUrl:'https://synthetic.invalid/v1',model:'synthetic-text'},apiKey:'synthetic-only'});
 const modelsBefore=await api('official/models'),runPath=path.join(evidence,'existing-workdir');
 await api('plugins/update',{pluginId:'official.conversation-control',settings:{defaultRunPath:runPath}});
 await click('[data-plugin-settings="official.conversation-control"]');await wait(()=>js('!document.querySelector("#settings-screen").hidden&&document.querySelectorAll("[data-generation-default]").length===4'),'unified settings');
 assert(await js(`(()=>{const e=document.querySelector('#settings-screen');return !e.querySelector('[data-plugin-pref],#plugin-storage-settings,[data-settings-plugin-toggle],[data-setting-action="save"],[data-setting-action^="plugin-save-inline:"]')&&!e.querySelector('.settings-content').textContent.includes('凭证')&&e.querySelectorAll('[data-save-generation-defaults]').length===1;})()`),'control settings contains only model defaults');
 await js(`document.querySelector('[data-generation-default="text"]').value=${JSON.stringify(modelId)}`);await click('[data-save-generation-defaults]');
 await wait(()=>js(`document.querySelector('#official-plugin-settings [role="status"]').textContent==='默认模型已保存'`),'model defaults saved');
 assert.deepEqual(await api('official/models'),modelsBefore,'default selection does not alter model configuration or authorization');
 const configured=(await api('plugins')).plugins;assert.equal(configured.find(p=>p.id==='official.conversation-control').settings.defaultRunPath,runPath);assert.equal(configured.find(p=>p.id==='official.conversation-control').settings.textProfileId,modelId);assert.notEqual((await api('official/models')).defaultProfiles.text,modelId,'conversation default must not become the manual card default');
 await click('[data-setting-action="plugin-back"]');await click('[data-setting-action="plugin-page:official.conversation-control"]');
 await wait(()=>js(`document.querySelector('[data-generation-default="text"]')?.value===${JSON.stringify(modelId)}`),'saved default readback');
 await screenshot('unified-control-settings-'+platform+'.png');await click('[data-setting-action="plugin-back"]');
 assert(await js('!document.querySelector("[data-setting-action=\\"plugin-page:official.document-chat\\"],[data-setting-action=\\"plugin-page:official.whiteboard-generation\\"]")'));
 await screenshot('unified-core-plugins-'+platform+'.png');
 await click('[data-settings-section=models]');await wait(()=>js('!!document.querySelector("[data-model-edit=model-ui-default-test]")'),'models');
 await click('[data-model-edit="model-ui-default-test"]');await wait(()=>js('document.querySelector("#dialog").open'),'API form');
 assert(await js('document.querySelector("[data-browser-source-field]").hidden'),'API hides credential source');await click('[data-choice=cancel]');
 const beforeCli=await api('official/models');await api('official/models/save',{expectedRevision:beforeCli.revision,profile:{id:'cli-source-ui-test',channel:'text',name:'CLI 来源显示验收',provider:'OpenAI',adapter:'cli',cliPath:'codex',model:'gpt-6.1-sol',agentEngine:'codex'}});
 await click('[data-settings-section=basic]');await click('[data-settings-section=models]');await wait(()=>js('!!document.querySelector("[data-model-edit=cli-source-ui-test]")'),'CLI list');await click('[data-model-edit="cli-source-ui-test"]');await wait(()=>js('document.querySelector("#dialog").open'),'CLI form');
 assert(await js('document.querySelector("[name=browserProfileId]").closest("label").firstChild.textContent==="凭证来源"&&document.querySelector("[name=browserProfileId]").value==="__external_browser__"&&!document.querySelector("[data-external-browser-controls]").hidden'),'explicit external source');
 await api('plugins/update',{pluginId:'thirdparty.browser',install:true});
 const embedded=(await api('official/browser-profiles/add',{name:'内置来源切换验收'})).profile;await click('[data-choice=cancel]');await click('[data-model-edit="cli-source-ui-test"]');await wait(()=>js('document.querySelector("#dialog").open'),'CLI reopen');
 await js(`document.querySelector('[name=browserProfileId]').value=${JSON.stringify(embedded.id)};document.querySelector('[name=browserProfileId]').dispatchEvent(new Event('change',{bubbles:true}));`);assert(await js('document.querySelector("[data-external-browser-controls]").hidden'),'embedded source hides external controls');await screenshot('credential-source-embedded-'+platform+'.png');await click('[data-choice=cancel]');await click('[data-setting-action="close"]');
 const report={passed:true,platform,themes:rows,newConversationPersisted:true,oneChatPlugin:true,unifiedDefaultSettings:true,modelDefaultsOnly:true,defaultModelSaveReadback:true,modelConfigurationUnchanged:true,existingRunPathPreserved:true,paidCalls:0};fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'ui-'+platform+'.json'),JSON.stringify(report,null,2));return report;
};
