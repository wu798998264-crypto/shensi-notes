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
  await js(`(async()=>{(await import('/preferences.js')).applyPresentation(${JSON.stringify({theme,customThemes})});const {uiGlyph,uiGlyphCodes}=await import('/ui-glyph.js');document.querySelector('#icon-matrix')?.remove();const matrix=document.createElement('div');matrix.id='icon-matrix';matrix.style.cssText='display:flex;gap:8px;flex-wrap:wrap;padding:10px;color:var(--text);background:var(--bg)';matrix.innerHTML=uiGlyphCodes.map(c=>uiGlyph(c)).join('');document.querySelector('.chat-messages').append(matrix);})()`);
  const sample=await js(`(()=>{const selectors=['[data-action=official-control]','[data-chat-new]','[data-chat-history]','[data-chat-export]','[data-chat-workspace-history]','[data-chat-upload]','[data-chat-web]','[data-chat-supplement]','.send-button'];const rgb=c=>c.match(/[0-9.]+/g).map(Number),lum=c=>rgb(c).slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);return {icons:[...document.querySelectorAll('[data-ui-glyph]')].filter(e=>e.getClientRects().length).map(e=>{const svg=e.querySelector('svg'),b=svg.getBBox(),r=e.getBoundingClientRect();return {code:e.dataset.uiGlyph,visible:b.width+b.height>0&&r.width>0&&r.height>0};}),buttons:selectors.map(selector=>{const e=document.querySelector(selector),s=getComputedStyle(e);let p=e,bg;while(p){bg=getComputedStyle(p).backgroundColor;if(rgb(bg)[3]!==0)break;p=p.parentElement;}const a=lum(s.color),b=lum(bg);return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),visible:e.getClientRects().length>0&&!!e.querySelector('svg')};})};})()`);
  assert(sample.icons.length>=40);for(const icon of sample.icons)assert(icon.visible,theme+' '+icon.code);for(const b of sample.buttons){assert(b.visible,theme+' '+b.selector);assert(b.ratio>=3,theme+' contrast '+b.selector+' '+b.ratio);}
  await click('[data-chat-model-toggle]');assert(await js('!document.querySelector("[data-chat-model-panel]").hidden'));await click('[data-chat-model-close]');
  await click('[data-chat-history]');assert(await js('!document.querySelector(".chat-history").hidden'));await click('[data-chat-history-close]');
  await click('[data-chat-workspace-history]');assert(await js('!document.querySelector(".chat-history").hidden'));await click('[data-chat-history-close]');
  await click('[data-chat-references]');await wait(()=>js('!document.querySelector("[data-chat-reference-panel]").hidden'),'references');await click('[data-chat-references]');
  const old=await js('document.querySelector("[data-chat-web]").getAttribute("aria-pressed")');await click('[data-chat-web]');await wait(()=>js('document.querySelector("[data-chat-web]").getAttribute("aria-pressed")!=='+JSON.stringify(old)),'web setting');
  await screenshot('theme-'+platform+'-'+theme+'.png');rows.push({theme,minimumButtonContrast:Math.min(...sample.buttons.map(b=>b.ratio)),icons:sample.icons.length,interactiveButtons:true});
 }
 await js(`(async()=>{(await import('/preferences.js')).applyPresentation({theme:'light'});document.querySelector('#icon-matrix')?.remove();})()`);
 const count=async()=>{let n=0;for(const pluginId of ['official.document-chat','official.whiteboard-generation','official.conversation-control'])n+=(await api('official/chat/read',{id,pluginId})).conversations.length;return n;};const before=await count();await click('[data-chat-new]');await wait(async()=>await count()>before,'new chat persisted');
 await click('[data-action="plugin:menu"]');await wait(()=>js('!!document.querySelector("[data-plugin-manager]")'),'plugin menu');
 assert(await js('!document.querySelector("[data-plugin-settings=\\"official.document-chat\\"],[data-plugin-settings=\\"official.whiteboard-generation\\"]")'));
 await screenshot('unified-plugin-menu-'+platform+'.png');
 await click('[data-plugin-settings="official.conversation-control"]');await wait(()=>js('!document.querySelector("#settings-screen").hidden&&document.querySelectorAll("[data-generation-default]").length===4'),'unified settings');
 await screenshot('unified-control-settings-'+platform+'.png');await click('[data-setting-action="plugin-back"]');
 assert(await js('!document.querySelector("[data-setting-action=\\"plugin-page:official.document-chat\\"],[data-setting-action=\\"plugin-page:official.whiteboard-generation\\"]")'));
 await screenshot('unified-core-plugins-'+platform+'.png');await click('[data-setting-action="close"]');
 const report={passed:true,platform,themes:rows,newConversationPersisted:true,oneChatPlugin:true,unifiedDefaultSettings:true,paidCalls:0};fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'ui-'+platform+'.json'),JSON.stringify(report,null,2));return report;
};
