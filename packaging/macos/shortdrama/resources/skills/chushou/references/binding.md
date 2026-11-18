# 原生参考绑定

在神思白板界面核对生成卡的提示词与参考图后，单击白板空白处，让生成操作栏自动收起；继续编辑时单击原生成卡，已保存的提示词和参考图会随栏展开。切换或交付卡片时请使用这一操作，底部「关闭」会停用这张卡的单击展开。

先 board.read 取最新基线和节点身份。每个草稿提供 channel、prompt、references；prompt 在真实插入位置写 `{{asset:nodeId}}`，references 是明确选定的实际输入。宿主按 references 顺序编号，产生原生 @ 引用、promptReferenceSequence 和 promptMentions，并同步当前 channel 快照。

重复引用复用同一节点而保留每次出现的位置，音频/视频/图片都要有真实附件。引用未知、缺失或未在 references 中的素材即失败，不静默丢失。生成前再次读取所选保存稿、草稿和缩略图；prepared（齐备）、bound（绑定）、submitted（平台接单）、verified（成品验收）不得混用。

原片与源帧保留来源关系和实际解码时间；不把来源边自动当生成参考。来源节点以独立边或说明显示，生成输入需显式白名单；保存时一并记录已排除的其他入边，防止打开生成栏时自动加回。

图片资产自身的生成栏也要可编辑。新生成走board.generate，宿主保存实际提交稿；导入已生成的图片时，board.append_media提供drafts，以新增图片节点ID为键，保存channel:image、原完整prompt、实际references及已知配置/比例等参数。没有参考传[]，不能用来源分析边代替参考列表。图片文件和草稿同次事务保存，引用只允许真实节点与附件，支持{{asset:nodeId}}编译、重复引用及顺序回读。普通上传参考图/源帧没有生成稿时不编造。

已落板资产先board.read，使用board.bind_references保存原提示词和真实参考，或board.prepare_segments传nodes:[]与drafts批量补齐。先从本轮确认稿或该资产的真实生成记录恢复，缺失时明确缺项，不按图片内容猜原提示词。其他通道草稿、用户修改、历史和素材身份仍按原保护规则保留；操作不重新生图。
