import {uiGlyph} from './ui-glyph.js';
import {escapeHtml as h} from './editor.js';

export function generationDropupPlacement(control,viewport,{maxHeight=320,width=control.width}={}){
 width=Math.max(1,Math.min(width,viewport.width-20));
 return {left:Math.max(10,Math.min(control.left,viewport.width-width-10)),bottom:viewport.height-control.top+6,width,maxHeight:Math.min(maxHeight,Math.max(72,control.top-16))};
}

// Keep real selects for FormData and use the original always-upward menu.
export function createGenerationPickers(form){
 const controls=new Map();let opened=null,disposed=false,frame=0;
 function close({focus=false}={}){if(!opened)return;const current=opened;opened=null;if(current.menu.matches(':popover-open'))current.menu.hidePopover();current.menu.hidden=true;current.button.setAttribute('aria-expanded','false');if(focus&&current.button.isConnected)current.button.focus({preventScroll:true});}
 function position(){frame=0;if(!form.isConnected){dispose();return;}if(!opened)return;const rect=(opened.shell.closest('label')||opened.shell).getBoundingClientRect(),placement=generationDropupPlacement(rect,{width:innerWidth,height:innerHeight},{maxHeight:opened.select.name==='generationMode'?260:320});Object.assign(opened.menu.style,{position:'fixed',inset:'auto',top:'auto',right:'auto',margin:'0',...Object.fromEntries(Object.entries(placement).map(([key,value])=>[key,value+'px']))});}
 function schedule(){if(!frame)frame=requestAnimationFrame(position);}
 function focusOption(index){const items=[...opened.menu.querySelectorAll('button:not(:disabled)')];if(items.length)items[(index+items.length)%items.length].focus({preventScroll:true});}
 function open(control){if(opened===control){close();return;}close();for(const details of form.querySelectorAll('.generation-parameter-picker[open]'))details.open=false;opened=control;control.menu.hidden=false;control.button.setAttribute('aria-expanded','true');if(control.menu.showPopover)control.menu.showPopover();position();const items=[...control.menu.querySelectorAll('button:not(:disabled)')],selected=items.findIndex(item=>item.getAttribute('aria-selected')==='true');focusOption(Math.max(0,selected));}
 function sync(control){const {select,button,menu}=control,options=[...select.options],current=options.find(item=>item.value===select.value),userLabel=item=>!!item&&(item.hasAttribute('data-user-content')||select.name==='profileId'&&!!item.value);button.querySelector('[data-picker-value]').textContent=current?.textContent||'请选择';button.querySelector('[data-picker-value]').toggleAttribute('data-user-content',userLabel(current));button.toggleAttribute('data-user-title',userLabel(current));button.title=current?.textContent||'请选择';button.disabled=select.disabled||!options.length;menu.innerHTML=options.map((item,index)=>(item.parentElement.tagName==='OPTGROUP'&&(index===0||options[index-1].parentElement!==item.parentElement)?`<div class="generation-picker-group">${h(item.parentElement.label)}</div>`:'')+`<button type="button" role="option" tabindex="-1" ${userLabel(item)?'data-user-content':''} data-picker-option="${h(item.value)}" aria-selected="${item.value===select.value}" ${item.disabled?'disabled':''} title="${h(item.title||item.textContent)}"><span>${h(item.textContent)}</span><span aria-hidden="true">${item.value===select.value?'✓':''}</span></button>`).join('');}
 function refresh(){
  for(const [select,control] of controls)if(!form.contains(select)||!control.shell.isConnected){if(opened===control)close();control.select.removeEventListener('change',control.onchange);controls.delete(select);}
  for(const select of form.querySelectorAll('select[data-generation-dropup]')){
   let control=controls.get(select);
   if(!control){const shell=document.createElement('span');shell.className='generation-select-shell';select.before(shell);shell.append(select);select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const button=document.createElement('button'),menu=document.createElement('section'),title=select.getAttribute('aria-label')||select.name;button.type='button';button.className='generation-picker-trigger';button.setAttribute('aria-label',title);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.innerHTML='<span data-picker-value></span>'+uiGlyph('E70D','original-icon')+'';menu.id='generation-picker-'+crypto.randomUUID();button.setAttribute('aria-controls',menu.id);menu.className='generation-picker-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',title);menu.setAttribute('popover','manual');menu.hidden=true;shell.append(button,menu);
    control={select,shell,button,menu,onchange:()=>sync(control)};controls.set(select,control);select.addEventListener('change',control.onchange);
    button.onclick=event=>{event.preventDefault();event.stopPropagation();open(control);};button.onkeydown=event=>{if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();if(opened!==control)open(control);if(event.key==='Home')focusOption(0);if(event.key==='End')focusOption(-1);}};
    menu.onclick=event=>{const option=event.target.closest('[data-picker-option]');if(!option||option.disabled)return;event.preventDefault();event.stopPropagation();const value=option.dataset.pickerOption;close({focus:true});if(select.value!==value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}};
    menu.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close({focus:true});return;}if(event.key==='Tab'){close();return;}if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();const items=[...menu.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);focusOption(event.key==='Home'?0:event.key==='End'?-1:index+(event.key==='ArrowUp'?-1:1));}};
   }
   sync(control);
  }
  schedule();
 }
 const outside=event=>{if(opened&&!opened.shell.contains(event.target))close();};
 const escape=event=>{if(event.key==='Escape'&&opened){event.preventDefault();event.stopPropagation();close({focus:true});}};
 const resize=new ResizeObserver(schedule);resize.observe(form);
 const removed=new MutationObserver(()=>{if(!form.isConnected)dispose();});removed.observe(form.parentElement,{childList:true});
 const movement=new MutationObserver(schedule);movement.observe(form,{attributes:true,attributeFilter:['style','class']});
 document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);window.addEventListener('resize',schedule);document.addEventListener('shensi:board-layout',schedule);
 function dispose(){if(disposed)return;disposed=true;close();cancelAnimationFrame(frame);resize.disconnect();removed.disconnect();movement.disconnect();for(const {select,onchange} of controls.values())select.removeEventListener('change',onchange);controls.clear();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',schedule);document.removeEventListener('shensi:board-layout',schedule);}
 return {refresh,close,dispose};
}

export function mountGenerationParameterPanel(details,{closePickers}){
 const panel=details.querySelector('.generation-parameter-surface'),trigger=details.querySelector('summary'),form=details.closest('form');let frame=0,disposed=false;
 function close(){details.open=false;if(panel.matches(':popover-open'))panel.hidePopover();trigger.setAttribute('aria-expanded','false');}
 function position(){frame=0;if(!form.isConnected){dispose();return;}if(!details.open)return;const rect=trigger.getBoundingClientRect(),width=Math.min(410,innerWidth-20);Object.assign(panel.style,{position:'fixed',inset:'auto',bottom:'auto',right:'auto',margin:'0',width:width+'px',maxHeight:'none'});const height=Math.min(Math.max(panel.scrollHeight+2,panel.getBoundingClientRect().height),innerHeight-20),above=rect.top-8-height,below=rect.bottom+8;Object.assign(panel.style,{maxHeight:height+'px',left:Math.round(Math.max(10,Math.min(rect.right-width,innerWidth-width-10)))+'px',top:Math.round(above>=10?above:below+height<=innerHeight-10?below:Math.max(10,Math.min(rect.bottom-height,innerHeight-height-10)))+'px'});}
 function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(position);}
 function toggle(){trigger.setAttribute('aria-expanded',String(details.open));if(details.open){closePickers();if(panel.showPopover&&!panel.matches(':popover-open'))panel.showPopover();position();}else if(panel.matches(':popover-open'))panel.hidePopover();}
 const outside=event=>{if(details.open&&!details.contains(event.target))close();},escape=event=>{if(details.open&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close();trigger.focus({preventScroll:true});}};
 details.addEventListener('toggle',toggle);document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);window.addEventListener('resize',schedule);document.addEventListener('shensi:board-layout',schedule);
 const movement=new MutationObserver(schedule);movement.observe(form,{attributes:true,attributeFilter:['style','class']});
 const resize=new ResizeObserver(schedule);resize.observe(panel);
 const removed=new MutationObserver(()=>{if(!form.isConnected)dispose();});removed.observe(form.parentElement,{childList:true});
 function dispose(){if(disposed)return;disposed=true;close();cancelAnimationFrame(frame);resize.disconnect();movement.disconnect();removed.disconnect();details.removeEventListener('toggle',toggle);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',schedule);document.removeEventListener('shensi:board-layout',schedule);}
 toggle();return {dispose};
}
