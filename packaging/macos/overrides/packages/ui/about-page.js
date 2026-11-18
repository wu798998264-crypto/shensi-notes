import {escapeHtml as h} from './editor.js';
import {openTutorial} from './tutorial.js';

export function createAboutPage(context){
 const screen=document.createElement('section');
 screen.id='about-screen';
 screen.className='about-screen';
 screen.hidden=true;
 screen.setAttribute('role','dialog');
 screen.setAttribute('aria-modal','true');
 screen.setAttribute('aria-labelledby','about-title');
 screen.setAttribute('aria-describedby','about-intro');
 document.body.append(screen);
 let info=null,checking=false,status='',returnFocus=null;
 const button=(action,label,extra='')=>`<button type="button" data-about-action="${action}" ${extra}>${label}</button>`;
 function render(){
  screen.innerHTML=`<section class="about-popup"><header class="about-page-header"><span id="about-title">软件信息</span>${button('close','×','aria-label="关闭软件信息"')}</header><main class="about-page-content"><div class="about-page-brand"><img src="/logo.png" alt="神思"><div><p>LOCAL KNOWLEDGE WORKSPACE</p><h1>神思</h1><span>${h(info?.version||'')} · <span>本地桌面版</span></span></div></div><p id="about-intro" class="about-page-intro">留一处，给正在发生的想法。让工具负责整理、执行和检查，让创作者保留方向、审美与最终判断。</p><section class="about-page-details"><div><span>已加载插件</span><strong>${(info?.plugins??[]).filter(plugin=>plugin.enabled).length} / ${(info?.plugins??[]).length}</strong></div></section><section class="about-page-update"><div><h2>使用教程</h2><p>基本操作、主软件与插件结构、核心插件用法。</p></div>${button('tutorial','使用教程')}</section><section class="about-page-update"><div><h2>软件更新</h2><p>每小时自动检查，仅提示红点；点击后下载，不自动安装。</p></div>${button('check-update','检查更新')}</section><p class="about-page-status" role="status">${h(status)}</p>${button('open-update-folder','打开下载目录','hidden')}</main></section>`;
  syncUpdate();
 }
 function syncUpdate(){const state=context.updates?.state,download=state?.downloadState,control=screen.querySelector('[data-about-action="check-update"]');if(!control)return;
  const loading=download?.status==='downloading';control.disabled=checking||loading;control.textContent=loading?'正在下载…':checking?'正在检查…':state?.available?'更新版本':'检查更新';
  screen.querySelector('[data-about-action="open-update-folder"]').hidden=download?.status!=='downloaded';
  screen.querySelector('.about-page-status').textContent=loading?'正在下载更新'+(download.total?' · '+Math.floor(download.bytes/download.total*100)+'%':''):download?.status==='downloaded'?'安装包已下载并通过完整性校验。请保存工作、退出神思后运行安装包；安装新版后红点自动消失。':download?.status==='error'?'下载失败：'+download.message:status|| (state?.available?'发现新版本 '+state.latestVersion:'');
 }
 context.updates?.subscribe(syncUpdate);
 async function close(){screen.hidden=true;document.body.classList.remove('about-open');returnFocus?.focus?.();returnFocus=null;}
 async function open(){if(!screen.hidden)return;if(!(await context.flush()))return;returnFocus=document.activeElement;try{info=await context.api('/api/settings/info?id='+encodeURIComponent(context.libraryId()));await context.updates?.refresh();status='';}catch(error){status=error.message;info={};}render();const notices=document.createElement('section');notices.className='about-page-update';notices.innerHTML='<div><h2>系统通知</h2><p>查看收到的全部历史通知。</p></div>'+button('notices','系统通知');screen.querySelector('.about-page-content').insertBefore(notices,screen.querySelector('.about-page-status'));screen.hidden=false;document.body.classList.add('about-open');screen.querySelector('[data-about-action="close"]').focus();}
 screen.addEventListener('click',async event=>{if(event.target===screen)return close();const target=event.target.closest('[data-about-action]');if(!target||target.disabled)return;const action=target.dataset.aboutAction;if(action==='close')return close();if(action==='tutorial')return openTutorial();if(action==='notices'){await close();document.dispatchEvent(new Event('shensi:open-system-notices'));return;}if(action==='open-update-folder'){try{await context.api('/api/settings/open-update-folder',{});}catch(error){screen.querySelector('.about-page-status').textContent=error.message;}return;}if(action==='check-update'){if(checking)return;checking=true;syncUpdate();try{const result=context.updates?await(context.updates.state.available?context.updates.download():context.updates.check()):await context.api('/api/settings/check-update',{});status=result.message||'检查完成。';}catch(error){status=error.message;}finally{checking=false;syncUpdate();}}});
 screen.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key==='Tab'){const focusable=[...screen.querySelectorAll('button:not(:disabled)')],first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
 return {open,close,get isOpen(){return !screen.hidden;}};
}
