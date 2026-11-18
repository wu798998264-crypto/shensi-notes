import {escapeHtml as h} from './editor.js';
const english={
 'thirdparty.browser':['Browser','Browse sites with separate profiles, bookmarks and downloads.'],
 'official.nutstore':['Nutstore sync','Sync notebooks with Nutstore and review file conflicts.'],
 'thirdparty.doubao':['Doubao accounts','Manage Doubao accounts for chat and media generation.'],
 'thirdparty.novel-publisher':['Novel publisher','Prepare chapters and publish novels.'],
 'thirdparty.glyph-workshop':['Glyph workshop','Create and organize glyphs and alphabets.'],
 'thirdparty.text-reader':['Document reader','Read documents aloud with a selected voice.'],
 'thirdparty.map-workshop':['Map workshop','Draw and edit maps for your work.'],
 'thirdparty.character-chat':['Character parlor','Talk to characters in the context of your work.'],
 'thirdparty.local-h3':['Local H3','Run H3 video generation on this computer.'],
 'thirdparty.depth-explorer':['Depth explorer','Explore depth in whiteboard images.'],
 'thirdparty.fenjue':['Fenjue','Writing skills and reference documents.'],
 'thirdparty.calendar':['Calendar and tasks','Calendar, task reminders and date-linked documents across notebooks.'],
 'official.works':['Work mode','Organize novels and screenplays with manuscript, outline, setting, memory and reference sections.'],
 'official.graph':['3D knowledge graph','Explore real documents and their incoming and outgoing links in a draggable graph.'],
 'official.conversation-control':['Conversation control','Context-aware document, whiteboard, workshop and declared extension commands.'],
 'official.document-chat':['Document chat','Notebook conversations with task-driven document access and protected version history.'],
 'official.whiteboard-generation':['Whiteboard generation','Chat, skills and media generation with shared text, image, video and audio configurations.'],
 'official.editor-toolbar':['Text formatting toolbar','Formatting, colors, lists and media insertion. Search, backlinks and editor modes remain available when disabled.']
};
export function pluginCopy(plugin,language){const native=plugin.translations?.[language];if(native)return {name:native.name||plugin.name,description:native.description||plugin.description};const translated=language==='en-US'?english[plugin.id]:null;return {name:translated?.[0]||plugin.name,description:translated?.[1]||plugin.description};}
export function pluginSwitch(plugin,attribute='data-plugin-toggle',language='zh-CN'){
 return `<button type="button" role="switch" class="plugin-switch" ${attribute}="${h(plugin.id)}" aria-label="${h(pluginCopy(plugin,language).name)}" title="${plugin.available?(language==='en-US'?'Install and enable':'安装并启用'):(plugin.enabled?(language==='en-US'?'Disable':'停用'):(language==='en-US'?'Enable':'启用'))}" aria-checked="${!plugin.available&&plugin.enabled===true}"><span></span></button>`;
}
// Keep the actual control and its ancestors: replacing a settings page loses its
// scroll position, search input, expanded details and keyboard focus.
export function updatePluginSwitch(control,plugin,language='zh-CN'){
 if(!control||!plugin)return;
 const available=!!plugin.available;
 control.className='plugin-switch';
 control.setAttribute('aria-label',pluginCopy(plugin,language).name);
 control.title=available?(language==='en-US'?'Install and enable':'安装并启用'):(plugin.enabled?(language==='en-US'?'Disable':'停用'):(language==='en-US'?'Enable':'启用'));
 control.setAttribute('role','switch');control.setAttribute('aria-checked',String(!available&&plugin.enabled===true));
 const content='<span></span>';
 if(control.innerHTML!==content)control.innerHTML=content;
}
export const hasPluginSettings=p=>!!p?.id&&!p.managedBy;
export const pluginRailVisible=p=>!p.managedBy&&p.package?.format!=='shensi-skill-plugin-v1'&&!['thirdparty.depth-explorer','thirdparty.local-h3','thirdparty.doubao','official.nutstore'].includes(p.id)&&p.rail!==false&&p.package?.rail!==false;
export function pluginSymbol(p){if(p.id==='thirdparty.browser')return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><text x="12" y="19" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="25" font-weight="600">e</text></svg>';const path=p.package?.icon==='calendar'?'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16M8 15h2M14 15h2M8 18h2"/>':p.id==='thirdparty.novel-publisher'?'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h4v15h-3a4 4 0 0 0-4 2"/>':p.id==='thirdparty.text-reader'?'<path d="M11 5 6 9H3v6h3l5 4zM15 8q6 4 0 8M18 4q10 8 0 16"/>':p.id==='thirdparty.map-workshop'?'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/>':p.id==='thirdparty.character-chat'?'<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5h5v9l-4-2h-1"/>':p.id==='thirdparty.glyph-workshop'?'<path d="M5 4h14M12 4v16M7 20h10M8 9h8M8 14h5"/>':'';return path?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>':'';}
