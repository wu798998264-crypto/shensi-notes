import {escapeHtml as h,cleanEditorHtml,htmlToMarkdown,documentCharacterCount} from './editor.js';
import {contextMenu} from './context-menu.js';
import {uiGlyph} from './ui-glyph.js';

const modeFor=instruction=>/(?:前|之前|前面).{0,10}(?:补写|插入|补充|增加)|(?:补写|插入|补充|增加).{0,12}(?:前|之前|前面)/u.test(instruction)?'insert_before':/补写|插入|插写|增补|补充|增加|添加|加入|续写/u.test(instruction)?'insert_after':'replace';
const modeLabel=mode=>({replace:'局部修改',insert_before:'在选区前补写',insert_after:'在选区后补写',insert_at_caret:'从此处补写'})[mode];
const sameDoc=(a,b)=>a&&b&&JSON.stringify([a.markdown??'',a.html??''])===JSON.stringify([b.markdown??'',b.html??'']);
const glyph=uiGlyph;
export function createSelectionEditor(context){
 let toolbar=null,saved=null,jobs=[],pollTimer,request=0,dragging=false,retargetInstruction='',busy=false,paintSignature='',pendingSubmission;
 const api=(path,body)=>context.api('/api/official/selection/'+path,body);
 const editor=()=>document.querySelector('.editor'),source=()=>document.querySelector('.markdown-source');
 const scope=()=>({id:context.libraryId(),documentId:context.current()?.id});
 const active=()=>context.enabled()&&!!context.current()&&!context.current().canvas&&context.mode()!=='read'&&!!(editor()||source());
 function clearPreview(root=editor()){
  if(root===editor()&&CSS.highlights)CSS.highlights.delete('shensi-local-edit');
  if(!root?.querySelector('[data-local-edit]'))return;
  root?.querySelectorAll('.inline-edit-suggestion[data-local-edit]').forEach(el=>el.remove());
  root?.querySelectorAll('.inline-edit-original[data-local-edit]').forEach(el=>el.replaceWith(...el.childNodes));root?.normalize();
 }
 function textRange(root,start,end){
  const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),range=document.createRange();let node,offset=0,found=false;
  while(node=walk.nextNode()){const length=node.nodeValue.length;if(!found&&start<=offset+length){range.setStart(node,Math.max(0,start-offset));found=true;}if(found&&end<=offset+length){range.setEnd(node,Math.max(0,end-offset));return range;}offset+=length;}
  if(!start&&!end&&!root.textContent){range.selectNodeContents(root);range.collapse(true);return range;}return null;
 }
 function markup(){return `<div class="selection-command-row"><span class="selection-count"></span><span class="selection-divider"></span><button class="selection-change-button" data-selection-change>要求更改<kbd>${h(context.shortcuts().selectionChange||'Ctrl+K')}</kbd></button><button class="selection-format-button" data-local-format="bold" title="加粗" aria-label="加粗"><strong>B</strong></button><button class="selection-format-button" data-local-format="italic" title="斜体" aria-label="斜体"><em>I</em></button><div class="selection-style-picker"><button data-selection-style-toggle aria-expanded="false">文本 ${glyph('\uE70D')}</button><div class="selection-style-menu" hidden>${[['formatBlock','p','文本','Ctrl+Alt+0'],['formatBlock','h1','标题 1','Ctrl+Alt+1'],['formatBlock','h2','标题 2','Ctrl+Alt+2'],['formatBlock','h3','标题 3','Ctrl+Alt+3'],['insertOrderedList','','编号列表','Ctrl+Alt+4'],['insertUnorderedList','','项目符号列表','Ctrl+Alt+5'],['checklist','','核对清单','Ctrl+Alt+6']].map(([command,value,label,key])=>`<button data-local-format="${command}" data-value="${value}">${label}<kbd>${key}</kbd></button>`).join('')}</div></div><button data-local-format="removeFormat" title="清除格式">${glyph('\uE75C')}清除格式<kbd>Ctrl+\\</kbd></button></div><form class="selection-edit-form" hidden><input maxlength="10000" placeholder="描述更改；输入补写时默认在选区后新增" aria-label="描述局部修改或补写要求" autocomplete="off"><button type="submit" title="发送局部修改" aria-label="发送局部修改">${glyph('\uE74A')}</button></form>`;}
 function ensureToolbar(){
  if(toolbar?.isConnected)return;toolbar=document.createElement('div');toolbar.className='selection-toolbar';toolbar.hidden=true;toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','局部编辑');toolbar.innerHTML=markup();document.body.append(toolbar);
  toolbar.onpointerdown=event=>{if(event.target.closest('button'))event.preventDefault();};
  toolbar.onclick=event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-selection-change'))openInput();else if(button.hasAttribute('data-selection-style-toggle')){const menu=toolbar.querySelector('.selection-style-menu');menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));}else if(button.dataset.localFormat)format(button);};
  toolbar.querySelector('form').onsubmit=event=>{event.preventDefault();void submit().catch(error=>context.toast(error.message));};
 }
 function position(rect){
  if(!toolbar||!rect)return;toolbar.hidden=false;const bounds=toolbar.getBoundingClientRect(),area=(source()||editor()).getBoundingClientRect();toolbar.style.left=Math.max(12,Math.min(window.innerWidth-bounds.width-12,rect.left))+'px';toolbar.style.top=Math.max(area.top,Math.min(window.innerHeight-bounds.height-12,rect.bottom+10))+'px';
 }
 function capture({caret=false,rect}={}){
  if(!active()||busy)return false;const el=editor(),md=source();let range,start,end,text,selectionText,anchor;
  if(md){if(document.activeElement!==md&&!caret)return false;start=md.selectionStart;end=md.selectionEnd;text=md.value;selectionText=text.slice(start,end);anchor=rect||md.getBoundingClientRect();}
  else{const selection=getSelection();if(!selection?.rangeCount||!el?.contains(selection.getRangeAt(0).commonAncestorContainer))return false;range=selection.getRangeAt(0).cloneRange();if(range.commonAncestorContainer.parentElement?.closest('[data-local-edit]'))return false;
   const clean=el.cloneNode(true);clearPreview(clean);text=clean.textContent;const before=range.cloneRange();before.selectNodeContents(el);before.setEnd(range.startContainer,range.startOffset);const host=document.createElement('div');host.append(before.cloneContents());clearPreview(host);start=host.textContent.length;end=start+range.toString().length;selectionText=text.slice(start,end);anchor=rect||range.getBoundingClientRect();
  }
  if(!caret&&!selectionText.trim())return false;
  saved={...scope(),format:md?'markdown':'rich',start,end,selectedText:selectionText,documentText:text,range,rect:anchor,caret};ensureToolbar();toolbar.querySelector('.selection-command-row').hidden=false;toolbar.querySelector('form').hidden=true;toolbar.querySelector('.selection-style-menu').hidden=true;toolbar.querySelector('.selection-count').textContent=caret?'从此处补写':'已选 '+documentCharacterCount(selectionText)+' 字';toolbar.querySelectorAll('[data-local-format],[data-selection-style-toggle]').forEach(button=>button.disabled=!!md||caret);position(anchor);return true;
 }
 function selectionChanged(){
  if(!active()){hide();return;}if(dragging||toolbar?.contains(document.activeElement)||busy)return;
  const md=source(),selection=getSelection();if((md&&document.activeElement===md&&md.selectionEnd>md.selectionStart)||(!md&&selection&&!selection.isCollapsed&&editor()?.contains(selection.anchorNode))){capture();}else hide();
 }
 function hide(){if(toolbar)toolbar.hidden=true;saved=null;}
 function openInput(){if(!saved&&!capture())return;toolbar.querySelector('.selection-command-row').hidden=true;const form=toolbar.querySelector('form');form.hidden=false;const input=form.querySelector('input');input.value=retargetInstruction;input.placeholder=saved.caret?'描述要在此处补写的内容':'描述更改；输入补写时默认在选区后新增';position(saved.rect);input.focus();}
 function format(button){
  if(!saved?.range||context.mode()!=='rich')return;const el=editor();el.focus({preventScroll:true});const selection=getSelection();selection.removeAllRanges();selection.addRange(saved.range);const command=button.dataset.localFormat;
  if(command==='checklist'){document.execCommand('insertUnorderedList');const list=selection.anchorNode?.parentElement?.closest('ul');if(list)for(const item of list.children)if(!/^[☐☑] /.test(item.textContent))item.prepend(document.createTextNode('☐ '));}
  else document.execCommand(command,false,button.dataset.value||null);el.oninput();capture();
 }
 async function submit(){
  const instruction=toolbar.querySelector('input').value.trim();if(!instruction||!saved||busy)return;const selection=saved;busy=true;toolbar.querySelector('button[type=submit]').disabled=true;
  try{if(!await context.flush())throw Error('正文尚未保存，请先处理保存冲突');await context.settleModelSelection?.();if(selection.id!==context.libraryId()||selection.documentId!==context.current()?.id)throw Error('文档已切换，请重新选择');
   const key=JSON.stringify([selection.id,selection.documentId,selection.start,selection.end,selection.documentText,instruction]);if(pendingSubmission?.key!==key)pendingSubmission={key,requestId:'selection-'+crypto.randomUUID()};
   const generation=++request,result=await api('start',{...selection,range:undefined,rect:undefined,instruction,mode:selection.caret?'insert_at_caret':modeFor(instruction),expectedStateStamp:context.stamp(),requestId:pendingSubmission.requestId});if(generation===request)jobs=result.jobs;else await refresh();pendingSubmission=null;retargetInstruction='';hide();paint();schedule();
  }finally{busy=false;if(toolbar?.isConnected)toolbar.querySelector('button[type=submit]').disabled=false;}
 }
 function paint(){
  const signature=JSON.stringify([scope(),context.mode(),context.current()?.markdown,context.current()?.html,jobs]);if(signature===paintSignature)return;paintSignature=signature;
  const el=editor();if(!active()){clearPreview(el);document.querySelector('.markdown-local-candidates')?.remove();return;}
  const visible=jobs.filter(j=>j.documentId===context.current().id&&!['applied','cancelled'].includes(j.status));
  const existing=[...document.querySelectorAll('.inline-edit-suggestion[data-local-edit]')],reuse=visible.length>0&&visible.length===existing.length&&visible.every(job=>existing.some(panel=>panel.dataset.localEdit===job.id&&(panel.dataset.localFloating||!el||!sameDoc(context.current(),job.document)||!!el.querySelector('.inline-edit-original[data-local-edit="'+CSS.escape(job.id)+'"]'))));
  if(!reuse){clearPreview(el);document.querySelector('.markdown-local-candidates')?.remove();}
  const occupied=[];
  for(const job of [...visible].sort((a,b)=>b.start-a.start)){
   const controls=job.status==='ready'?'<button data-local-action="cancel">取消</button><button class="accept" data-local-action="apply">确认应用</button>':'<button data-local-action="cancel">'+(job.status==='running'?'停止':'关闭')+'</button>';
   const html=`<span class="inline-edit-actions" data-core-copy>${controls}</span><span class="inline-edit-preview-label" data-core-copy>${h(modeLabel(job.mode))} · ${job.status==='ready'?'确认前正文保持不变':job.status==='running'?'正在生成候选…':h(job.error||'任务已停止')}</span>${job.candidate?'<span class="inline-edit-replacement">'+h(job.candidate).replaceAll('\n','<br>')+'</span>':''}${job.events?.length?'<span class="local-edit-progress" role="status">'+h(job.events.at(-1).text||job.events.at(-1).name||'正在处理')+'</span>':''}`;
   if(reuse){const panel=existing.find(panel=>panel.dataset.localEdit===job.id);panel.innerHTML=html;panel.classList.toggle('pending',job.status==='running');continue;}
   const panel=document.createElement('span');panel.className='inline-edit-suggestion'+(job.status==='running'?' pending':'');panel.dataset.localEdit=job.id;panel.contentEditable='false';panel.innerHTML=html;panel.onclick=event=>{const button=event.target.closest('[data-local-action]');if(button){event.stopPropagation();void act(job.id,button.dataset.localAction).catch(error=>context.toast(error.message));}};
   if(el&&sameDoc(context.current(),job.document)&&!occupied.some(([start,end])=>job.start<end&&job.end>start)){const range=textRange(el,job.start,job.end);if(range){occupied.push([job.start,job.end]);const block=node=>(node.nodeType===Node.ELEMENT_NODE?node:node.parentElement)?.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote'),first=block(range.startContainer),last=block(range.endContainer);
    if(first&&last&&first!==last){panel.dataset.localFloating='true';last.after(panel);if(CSS.highlights&&globalThis.Highlight){const highlight=CSS.highlights.get('shensi-local-edit')||new Highlight();highlight.add(range);CSS.highlights.set('shensi-local-edit',highlight);}continue;}
    const original=document.createElement('span');original.className='inline-edit-original'+(job.mode==='replace'?'':' protected');original.dataset.localEdit=job.id;original.contentEditable='false';original.append(range.extractContents());range.insertNode(original);if(job.mode==='insert_before')original.before(panel);else original.after(panel);continue;}}
   let list=document.querySelector('.markdown-local-candidates');if(!list){list=document.createElement('div');list.className='markdown-local-candidates';(source()||el)?.after(list);}list.append(panel);
  }
 }
 async function act(jobId,action){
  const job=jobs.find(j=>j.id===jobId);if(!job)return;
  if(action==='cancel'){const generation=++request,previous=jobs;jobs=jobs.map(j=>j.id===jobId?{...j,status:'cancelled'}:j);paint();try{const result=await api('cancel',{id:context.libraryId(),jobId});if(generation===request){jobs=result.jobs;paint();}else await refresh();}catch(error){if(generation===request){jobs=previous;paint();}throw error;}return;}
  const applyScope=scope();if(!await context.flush())return;if(scope().id!==applyScope.id||scope().documentId!==applyScope.documentId)throw Error('文档已切换，请重新选择');
  let richText;if(job.format==='rich'&&sameDoc(context.current(),job.document)){
   const host=document.createElement('div');host.innerHTML=cleanEditorHtml(editor());let start=job.start,end=job.end;if(job.mode==='insert_before')end=start;else if(job.mode==='insert_after')start=end;
   const range=textRange(host,start,end);if(!range)throw Error('原文位置已变化，候选仍保留');range.deleteContents();const fragment=document.createDocumentFragment();job.candidate.split('\n').forEach((line,index)=>{if(index)fragment.append(document.createElement('br'));fragment.append(document.createTextNode(line));});range.insertNode(fragment);const html=cleanEditorHtml(host);richText={html,markdown:htmlToMarkdown(html)};
  }
  try{const result=await api('apply',{id:applyScope.id,jobId,richText,expectedStateStamp:context.stamp()});jobs=jobs.map(j=>j.id===jobId?{...j,status:'applied'}:j);if(scope().id===applyScope.id&&scope().documentId===applyScope.documentId)context.applyResult(result);context.toast('局部修改已保存，修改前后历史版本已保留');}
  catch(error){if(!['SELECTION_ANCHOR_CONFLICT','WORKSPACE_STATE_CONFLICT'].includes(error.code)&&!/原文位置|基线|文档已变化/.test(error.message))throw error;
   const answer=await context.modal('原文位置已变化',`<p>候选已保留，原文未修改。请重新确认位置后再应用。</p><pre class="local-conflict-candidate">${h(job.candidate)}</pre>`,[['保留候选并关闭','keep'],['重新选择位置','retarget'],['重新检查原位置','retry']]);if(answer.value==='retarget'){retargetInstruction=job.instruction;context.toast('请重新拖选后点击“要求更改”，原指令会自动带入；旧候选仍保留。');}else if(answer.value==='retry')await act(jobId,'apply');
  }
 }
 function schedule(){clearTimeout(pollTimer);if(jobs.some(j=>j.status==='running'))pollTimer=setTimeout(()=>void refresh(),450);}
 async function refresh(){if(!context.enabled())return;const selectedScope=scope(),generation=++request;try{const result=await api('read',{id:selectedScope.id});if(generation!==request||scope().id!==selectedScope.id)return;jobs=result.jobs;paint();schedule();}catch(error){if(context.enabled())context.toast(error.message);}}
 function mount(){hide();paintSignature='';clearTimeout(pollTimer);if(!active()){clearPreview();document.querySelector('.markdown-local-candidates')?.remove();return;}ensureToolbar();void refresh();}
 document.addEventListener('selectionchange',selectionChanged);
 document.addEventListener('pointerdown',event=>{if((editor()?.contains(event.target)||source()===event.target)&&event.button===0){dragging=true;if(toolbar)toolbar.hidden=true;}else if(!toolbar?.contains(event.target))hide();});
 document.addEventListener('pointerup',()=>{if(dragging){dragging=false;selectionChanged();}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&toolbar&&!toolbar.hidden){event.preventDefault();event.stopImmediatePropagation();hide();(source()||editor())?.focus();}},true);
 document.addEventListener('contextmenu',event=>{
  const root=editor(),md=source(),blank=root&&event.target.matches('.editor-scroll,.note-page');
  if(!(root?.contains(event.target)||md===event.target||blank))return;
  if(event.target.closest('img,video,audio,[data-local-edit],.document-image-sizing'))return;
  const selection=getSelection(),readText=md?md.value.slice(md.selectionStart,md.selectionEnd):selection?.rangeCount&&root.contains(selection.getRangeAt(0).commonAncestorContainer)?selection.toString():'',canRead=context.readerEnabled?.()&&readText?.trim();
  event.preventDefault();const selected=!!readText;if(active())capture();
  if(!selected&&!source()){const range=document.caretRangeFromPoint(event.clientX,event.clientY);if(range&&editor().contains(range.commonAncestorContainer)){range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);capture({caret:true,rect:range.getBoundingClientRect()});}}
  else if(!selected&&source()){capture({caret:true,rect:{left:event.clientX,bottom:event.clientY}});}
  let range;if(root){const selection=getSelection();if(selection?.rangeCount&&root.contains(selection.getRangeAt(0).commonAncestorContainer))range=selection.getRangeAt(0).cloneRange();if(!selected&&!range){range=document.createRange();range.selectNodeContents(root);range.collapse(false);}}
  const target=md||root,contents=md?md.value:root.innerHTML,text=md?md.value.slice(md.selectionStart,md.selectionEnd):range?.toString()||'',start=md?.selectionStart,end=md?.selectionEnd,editable=()=>target.isConnected&&(md?!md.readOnly:root.isContentEditable),unchanged=()=>editable()&&(md?md.value===contents:root.innerHTML===contents&&root.contains(range?.commonAncestorContainer));
  const restore=()=>{target.focus({preventScroll:true});if(md)md.setSelectionRange(start,end);else if(range){getSelection().removeAllRanges();getSelection().addRange(range);}};
  const bookmark=saved;hide();void contextMenu([...(active()?[{value:'change',label:selected?'要求更改':'从此处补写'}]:[]),...(canRead?[{value:'read',label:'朗读选中文字'}]:[]),{value:'copy',label:'复制',disabled:!text},{value:'cut',label:'剪切',disabled:!text||!editable()||!!range?.cloneContents().querySelector?.('[contenteditable=false]')},...root?[{value:'upload',label:'上传',disabled:!editable()||!context.upload}]:[],{value:'select',label:'全选正文'}],event).then(async answer=>{
   if(answer.value==='read')return context.readSelection?.();
   if(answer.value==='change'&&bookmark){saved=bookmark;ensureToolbar();position(bookmark.rect);openInput();}
   else if(answer.value==='copy'||answer.value==='cut'){
    await navigator.clipboard.writeText(text);
    if(answer.value==='cut'){if(!unchanged())throw Error('文字已复制；正文已变化，未剪切');restore();if(!document.execCommand(md?'insertText':'delete',false,md?'':undefined))throw Error('文字已复制，但未能剪切');target.oninput?.();}
   }else if(answer.value==='upload'){if(!unchanged())throw Error('文档已变化，请重新选择上传位置');restore();context.upload();}
   else if(answer.value==='select'){target.focus({preventScroll:true});if(md)md.select();else{const all=document.createRange();all.selectNodeContents(root);getSelection().removeAllRanges();getSelection().addRange(all);}}
  }).catch(error=>context.toast(error.message));
 });
 window.addEventListener('resize',()=>{if(toolbar&&!toolbar.hidden&&saved)position(saved.rect);});
 document.addEventListener('scroll',event=>{if(!toolbar?.contains(event.target)&&toolbar)toolbar.hidden=true;},true);
 return {mount,reset:()=>{request++;clearTimeout(pollTimer);hide();},change:()=>{if(!saved)capture();openInput();}};
}
