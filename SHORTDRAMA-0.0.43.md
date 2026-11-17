# 神思 0.0.43 短剧下载

触手短剧下载使用 guoapp 2.0.1+113 的公开 GPL-3.0 红果模块（模块1.0.3）。来源与原始文件摘要见 `packaging/macos/shortdrama/resources/skills/chushou/scripts/hongguo_vendor/UPSTREAM.json`，对应适配源码与许可同目录提供。

保留指定集数、逐集落盘、完整音视频解码、SHA-256、失败保留和重复调用复用。匿名设备缓存保存在本机运行目录，不随安装包发布。遇明确拒绝或限流时停止，不轮换设备重试。

## 真实验收

《困兽之战》第1集，1920×1080、30fps、339.685秒、HEVC、有音轨、28,088,487字节。SHA-256：`4ba7f093e9eb6e81752cf4f5089277f035c42fd021ed0ec2818ebf42778e464a`。

| 冻结版本 | 下载及完整解码 | 含白板导入与持久化回读的全程 |
| --- | ---: | ---: |
| Windows x64 | 68.864秒 | 233.706秒 |
| Mac Apple Silicon | 49.700秒 | 166.332秒 |
| Mac Intel | 31.811秒 | 93.124秒 |

Windows验收与完整回归并行，存在额外磁盘和解码负载；不能将这些时间视作网络传输时间。三平台内容摘要一致。指定一集成功不等于全部作品和上游未来始终可用。

[Mac构建与真实验收](https://github.com/wu798998264-crypto/shensi-notes/actions/runs/44069290038)包括两个架构的实际下载、完整解码、白板附件保存、新服务读取，以及操作后应用签名核验。Windows冻结包125项回归、安装器3787文件比对通过。

Codex触手独立发布为 [v1.8.2](https://github.com/wu798998264-crypto/chushou-skill/releases/tag/v1.8.2)，独立CI的Windows、Mac和Linux真实下载均通过。

本轮没有覆盖开发电脑的神思安装，没有迁移用户笔记或账号，没有提交付费生成。Mac安装包为ad-hoc签名，未做Apple Developer ID公证。
