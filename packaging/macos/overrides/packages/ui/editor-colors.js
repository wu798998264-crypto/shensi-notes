import {uiGlyph} from './ui-glyph.js';
// Presets and glyph swatches follow the original Shensi note color picker.
export const NOTE_COLOR_PRESETS=['#000000','#5b5b5b','#8b0000','#c62828','#e65100','#ef6c00','#f9a825','#827717','#2e7d32','#00897b','#00695c','#0277bd','#1565c0','#283593','#4527a0','#6a1b9a','#ad1457','#795548','#607d8b','#ffffff','#d32f2f','#388e3c','#1976d2','#fdd835'];
export function createEditorColors(context){
 const key='core-editor-colors',labels={foreColor:'文字颜色',hiliteColor:'高光颜色'};
 let stored;try{stored=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
 const valid=value=>/^#[0-9a-f]{6}$/i.test(value||'');
 const colors={foreColor:valid(stored?.foreColor)?stored.foreColor:'#000000',hiliteColor:valid(stored?.hiliteColor)?stored.hiliteColor:''};
 let menu=null,trigger=null;
 function sync(){for(const button of document.querySelectorAll('[data-note-color-toggle]')){const command=button.dataset.noteColorToggle,value=colors[command];button.style.setProperty('--note-control-color',value||'transparent');button.dataset.noteColorValue=value;button.dataset.noteColorEmpty=String(!value);button.title=labels[command]+'：左键应用上次颜色，右键选择颜色';button.setAttribute('aria-label',labels[command]+' · '+(value||'无高光'));}}
 function close(){if(trigger)trigger.setAttribute('aria-expanded','false');menu?.remove();menu=null;trigger=null;}
 function apply(command,value){if(!context.isEditable())return;colors[command]=value;localStorage.setItem(key,JSON.stringify(colors));sync();context.restoreSelection();const editor=context.editor(),selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;if(!range||range.collapsed||!editor?.contains(range.commonAncestorContainer))return;document.execCommand('styleWithCSS',false,true);document.execCommand(command,false,value||'transparent');context.changed();context.rememberSelection();}
 function open(button){close();trigger=button;const command=button.dataset.noteColorToggle;button.setAttribute('aria-expanded','true');menu=document.createElement('div');menu.className='note-color-menu';menu.setAttribute('role','dialog');menu.setAttribute('aria-label',labels[command]+'色板');
  const swatch=(value,index)=>`<button type="button" class="note-color-swatch ${value?'':'note-color-none'}" data-note-color-value="${value}" style="--note-color:${value||'transparent'}" aria-label="${value?labels[command]+'预设 '+String(index+1).padStart(2,'0')+' '+value:'无高光'}" aria-pressed="${colors[command]===value}">${value?'':'<svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="14" height="14"><path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'}</button>`;
  menu.innerHTML='<div class="note-color-presets">'+(command==='hiliteColor'?swatch('',-1):'')+NOTE_COLOR_PRESETS.map(swatch).join('')+'</div><label class="note-custom-color"><span>自定义颜色</span><input type="color" aria-label="'+labels[command]+'自定义颜色" value="'+(colors[command]||'#ffffff')+'"></label>';
  document.body.append(menu);const r=button.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,r.right-menu.offsetWidth))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,r.bottom+5))+'px';
  menu.onpointerdown=e=>{if(e.target.closest('button'))e.preventDefault();};
  menu.onclick=e=>{const choice=e.target.closest('[data-note-color-value]');if(choice){apply(command,choice.dataset.noteColorValue);close();}};
  menu.querySelector('input').oninput=e=>apply(command,e.target.value);
  menu.onkeydown=e=>{const buttons=[...menu.querySelectorAll('button,input')],index=buttons.indexOf(document.activeElement);let next;if(e.key==='ArrowRight')next=buttons[(index+1)%buttons.length];if(e.key==='ArrowLeft')next=buttons[(index+buttons.length-1)%buttons.length];if(e.key==='ArrowDown')next=buttons[Math.min(buttons.length-1,index+8)];if(e.key==='ArrowUp')next=buttons[Math.max(0,index-8)];if(next){e.preventDefault();next.focus();}};
 }
 document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target)&&!e.target.closest('[data-note-color-toggle]'))close();},true);
 addEventListener('resize',close);
 document.addEventListener('keydown',e=>{if(menu&&e.key==='Escape'){const button=trigger;close();button?.focus();e.preventDefault();e.stopImmediatePropagation();}},true);
 return {close,markup:(command,glyph)=>`<button type="button" class="note-color-trigger" data-note-color-toggle="${command}" aria-haspopup="dialog" aria-expanded="false" aria-label="${labels[command]}">${uiGlyph(glyph,'note-legacy-icon note-color-icon')}</button>`,bind:()=>{close();for(const button of document.querySelectorAll('[data-note-color-toggle]')){button.disabled=!context.isEditable();button.onpointerdown=e=>{context.rememberSelection();e.preventDefault();};button.onclick=()=>apply(button.dataset.noteColorToggle,colors[button.dataset.noteColorToggle]);button.oncontextmenu=e=>{e.preventDefault();if(!button.disabled)open(button);};button.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='F10'&&e.shiftKey){e.preventDefault();context.rememberSelection();open(button);menu.querySelector('button').focus();}};}sync();}};
}
