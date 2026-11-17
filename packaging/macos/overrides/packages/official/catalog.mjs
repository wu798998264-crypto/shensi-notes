const pluginRepositories={
 'thirdparty.browser':'shensi-plugin-browser',
 'thirdparty.novel-publisher':'shensi-plugin-novel-publisher',
 'thirdparty.glyph-workshop':'shensi-plugin-glyph-workshop',
 'thirdparty.credential-vault':'shensi-plugin-credential-vault',
 'thirdparty.text-reader':'shensi-plugin-text-reader',
 'thirdparty.map-workshop':'shensi-plugin-map-workshop',
 'thirdparty.doubao':'shensi-plugin-doubao',
 'thirdparty.local-h3':'shensi-plugin-local-h3',
 'thirdparty.depth-explorer':'shensi-plugin-depth-explorer',
 'thirdparty.character-chat':'shensi-plugin-character-chat',
 'official.nutstore':'shensi-plugin-nutstore'
};
const pluginUpdateChannel=p=>pluginRepositories[p.id]?{
 repository:'wu798998264-crypto/'+pluginRepositories[p.id],
 currentVersion:'0.1.0',tagPrefix:'plugin-'+p.id+'-v'
}:undefined;
export const OFFICIAL_PLUGINS=[
 {id:'thirdparty.browser',name:'浏览器',description:'多配置独立登录空间、跨网站账号、书签与下载管理；支持对话操作网页画布。',category:'third-party',enabled:false,installed:false,settings:[]},
 {id:'thirdparty.novel-publisher',name:'小说发布',description:'内置作者后台入口，双向读取作品、卷和章节目录，透传建书、分卷和章节资料。可主动提交创建或发布，已发布以官网回读为准；未识别页面会明确提示，各站实网适配仍需验收。',category:'third-party',enabled:false,installed:false,settings:[]},
 {id:'thirdparty.glyph-workshop',name:'文字工坊',description:'在独立签页中手绘、矢量造字与创作表音字母，组合单词；自动保存、历史恢复、SVG 导出和回收站。',category:'third-party',enabled:false,installed:false,settings:[]},

 {id:'thirdparty.text-reader',name:'文档朗读',description:'右侧栏朗读全文、选区或章节队列；本地 CosyVoice2 与语音 API 共用音色库，并向模型设置提供音频生成配置。',category:'third-party',enabled:false,installed:false,settings:[]},
 {id:'thirdparty.map-workshop',name:'地图工坊',description:'在签页中绘制分层地图，编辑矢量对象与路径，导出 PNG、JPG、分层 PSD，并通过已有图片配置逐层精修。',category:'third-party',enabled:false,installed:false,settings:[]},
 {id:'thirdparty.doubao',name:'豆包多开',description:'独立持久账号空间。文本、图片和视频分别试用通过后接入模型设置；遇到验证或参数确认时可打开对应原任务。',category:'third-party',enabled:false,installed:false,rail:false,settings:[]},
 {id:'thirdparty.character-chat',name:'人物会客室',description:'跨笔记本选择小说、剧本或笔记中的人物，在独立签页对谈或对戏；沿用神思模型和主题。',category:'third-party',enabled:false,settings:[],updateChannel:{repository:'wu798998264-crypto/shensi-plugin-character-chat',currentVersion:'0.1.0'}},
 {id:'thirdparty.local-h3',name:'本地 H3',description:'优先复用本机 H3；缺失时下载独立 Python、ComfyUI 和模型，安装后接入白板视频生成。',category:'third-party',enabled:false,installed:false,rail:false,settings:[]},
 {id:'official.editor-toolbar',name:'文本编辑工具栏',description:'正文格式、颜色、列表和媒体插入工具；停用后保留查找、双向链接与编辑模式。',settings:[]},
 {id:'thirdparty.depth-explorer',name:'深度摸索',description:'在白板中分析图片或视频的空间深度，保留原素材并创建下游结果。',category:'third-party',settings:[]},
 {id:'official.works',name:'作品模式',description:'将当前笔记切换为长篇小说或剧本，集中管理设定、大纲、正文和资料库。',settings:[]},
 {id:'official.nutstore',name:'坚果云同步',description:'坚果云 WebDAV 双向增量同步、首次同步预览和冲突中心。',settings:[]},
 {id:'official.graph',name:'三维关系图谱',description:'双向链接索引、入链与出链、可旋转的三维发光关系图谱。',settings:[]},
 {id:'official.conversation-control',name:'对话控制',description:'统一文档、白板和工坊对话，按发送时的目标执行；兼容原对话记录与配置。',settings:[{key:'defaultRunPath',label:'默认运行路径',type:'string',default:''}]},
 {id:'official.document-chat',managedBy:'official.conversation-control',name:'文档对话',description:'兼容原文档对话记录与默认配置；统一入口为对话控制。',rail:false,settings:[{key:'defaultRunPath',label:'默认运行路径',type:'string',default:''}]},
 {id:'official.whiteboard-generation',managedBy:'official.conversation-control',rail:false,name:'白板生成',description:'对话控制内部的白板生成与历史兼容模块。',settings:[{key:'defaultRunPath',label:'默认运行路径',type:'string',default:''}]}
].map(p=>({...p,...(pluginUpdateChannel(p)?{updateChannel:pluginUpdateChannel(p)}:{}),version:'0.1.0',category:p.category||(p.id==='official.nutstore'?'third-party':'official'),builtin:true,enabled:p.enabled!==false,...(['official.conversation-control','official.graph','official.document-chat','official.whiteboard-generation','thirdparty.text-reader'].includes(p.id)?{windowCapabilities:{detached:true}}:{}),package:{settings:p.settings,templates:[]},settings:Object.fromEntries(p.settings.map(f=>[f.key,f.default]))}));
