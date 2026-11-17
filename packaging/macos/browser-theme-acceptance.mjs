import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Use the actual host theme function and browser UI, with isolated profiles.
export async function verifyBrowserThemes({owner,run,wait,evidence,nativeTheme}){
 const customThemes=[
  {id:'custom-browser-violet',name:'紫夜',colors:{topbar:'#211c30',sidebar:'#211c30',editor:'#181421',chat:'#181421',text:'#f0eaf8',accent:'#bb9eef'}},
  {id:'custom-browser-blue',name:'浅蓝',colors:{topbar:'#e1edf5',sidebar:'#e1edf5',editor:'#f2f8fc',chat:'#f2f8fc',text:'#203748',accent:'#235d96'}}
 ];
 await run('(async()=>{window.browserThemePresentation=(await import("/preferences.js")).applyPresentation;window.browserThemeRoot=document.querySelector(".browser-workspace");window.browserThemeAddress=document.querySelector(".browser-address");})()');
 const rows=[],initialSource=nativeTheme.themeSource;
 const screenshot=async name=>{await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await new Promise(r=>setTimeout(r,150));await writeFile(join(evidence,name),(await owner.webContents.capturePage()).toPNG());};
 const palette=()=>run(`(()=>{const s=getComputedStyle(document.documentElement),resolve=v=>{const c=document.createElement('span');c.style.color=v;document.body.append(c);const value=getComputedStyle(c).color;c.remove();return value;};return {side:resolve(s.getPropertyValue('--topbar').trim()||s.getPropertyValue('--side')),bg:resolve(s.getPropertyValue('--bg')),scheme:s.colorScheme};})()`);
 const sample=async(selector,pseudo='')=>run(`(()=>{
  const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing browser theme sample');
  const css=getComputedStyle(el,${JSON.stringify(pseudo)}||null),numbers=value=>value.match(/[0-9.]+/g).map(Number);
  let background;for(let p=el;p;p=p.parentElement){const v=getComputedStyle(p).backgroundColor;if(numbers(v)[3]!==0){background=v;break;}}
  const lum=value=>numbers(value).slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
  const a=lum(css.color),b=lum(background);return {selector:${JSON.stringify(selector)},pseudo:${JSON.stringify(pseudo)},color:css.color,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 })()`);
 try{
  for(const theme of ['light','dark','stone','mist','ember','ink','custom-browser-violet','custom-browser-blue','system-light','system-dark']){
   if(theme.startsWith('system-')){
    nativeTheme.themeSource=theme.slice(7);
    // OS/CDP media updates arrive asynchronously. Let the application's media
    // listener finish before applying the synthetic system-theme selection.
    await wait(()=>run('matchMedia("(prefers-color-scheme: dark)").matches==='+String(theme==='system-dark')));
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   }
   await run(`browserThemeAddress.focus();browserThemeAddress.value='https://example.com/unsaved';browserThemeAddress.setSelectionRange(8,15);browserThemePresentation(${JSON.stringify({theme:theme.startsWith('system-')?'system':theme,customThemes})});void 0`);
   const p=await palette();assert.equal(await run('getComputedStyle(document.querySelector(".browser-toolbar")).backgroundColor'),p.side,theme+' toolbar surface');
   assert.equal(await run('getComputedStyle(document.querySelector(".browser-tabs")).backgroundColor'),p.side,theme+' tab surface');
   assert.equal(await run('getComputedStyle(document.querySelector(".browser-page")).backgroundColor'),p.bg,theme+' blank page surface');
   assert(await run('browserThemeRoot===document.querySelector(".browser-workspace")&&browserThemeAddress===document.querySelector(".browser-address")&&browserThemeAddress.value==="https://example.com/unsaved"&&browserThemeAddress.selectionStart===8&&browserThemeAddress.selectionEnd===15&&document.activeElement===browserThemeAddress'),theme+' theme switch must keep drafts/caret/DOM');
   const samples=[];
   for(const selector of ['[data-browser-action=reload]','[data-browser-action=bookmarks]','[data-browser-action=downloads]','.browser-avatar-placeholder','.browser-address','.browser-tab.active','.browser-start h2','.browser-start p','.browser-start button','.browser-status'])samples.push(await sample(selector));
   samples.push(await sample('.browser-address','::placeholder'));
   const point=await run('(()=>{const r=document.querySelector("[data-browser-action=downloads]").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
   owner.webContents.sendInputEvent({type:'mouseMove',...point});await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');samples.push(await sample('[data-browser-action=downloads]'));
   for(const kind of ['accounts','bookmarks','downloads']){
    await run(`document.querySelector('[data-browser-action=${kind}]').click()`);await wait(()=>run('!!document.querySelector(".browser-popover")'));
    assert.equal(await run('getComputedStyle(document.querySelector(".browser-popover")).backgroundColor'),p.bg);
    for(const selector of ['.browser-popover header strong','.browser-popover header button',...(kind==='accounts'?['.browser-account.active strong','.browser-account.active>span:not(.browser-avatar)','.browser-accounts footer button']:kind==='bookmarks'?['.browser-bookmarks summary']:['.browser-downloads>p'])])samples.push(await sample(selector));
    if(kind==='accounts'&&['light','dark','custom-browser-violet'].includes(theme))await screenshot('browser-'+theme+'-profiles.png');
    owner.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});owner.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(()=>run('!document.querySelector(".browser-popover")'));
   }
   for(const row of samples)assert(row.ratio>=4.5,theme+' '+row.selector+' contrast '+row.ratio.toFixed(2));
   rows.push({theme,scheme:p.scheme,minContrast:Math.min(...samples.map(s=>s.ratio)),samples});console.log('PASS browser theme '+theme);
   if(['light','dark','custom-browser-violet'].includes(theme))await screenshot('browser-'+theme+'.png');
  }
  await writeFile(join(evidence,'browser-themes.json'),JSON.stringify({passed:true,themes:rows,liveSwitchPreservedInput:true,realProviderRequests:0,installedAcceptance:false},null,2));
 }finally{nativeTheme.themeSource=initialSource;await run('browserThemePresentation({theme:"light"});browserThemeAddress.blur();browserThemeAddress.value="";void 0');}
 return rows;
}
