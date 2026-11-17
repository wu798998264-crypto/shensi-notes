# shensi-notes
神思笔记官方软件发布与更新仓库

## macOS 0.0.42

GitHub Actions 原生构建 Apple Silicon（arm64）和 Intel（x64）版本。
构建内容来自已发布、SHA-256 固定的 Windows 0.0.41 程序载荷，
包含豆包 0.1.34 修复，并替换为对应 Mac 架构的 Node、FFmpeg、
Java、Python、即梦画布 CLI 与 LibTV CLI。不包含开发机账号、笔记或 Cookie。

工作流验证签名、DMG 完整性、实际应用启动、界面加载、文档保存回读、
笔记本回收与恢复，以及内置运行库。本轮增加跨平台 SVG 图标、8 种主界面主题与 10 种浏览器主题实测、独立扩展安装和重启持久化、四角圆角 Dock 图标。全部通过后才发布 v0.0.42 DMG/ZIP；
Windows 下载文件保持不变。

平台边界：

- 使用 ad-hoc 签名，尚无 Apple Developer ID 公证；首次打开可能需要在系统设置中允许。
- Windows 专用的本地 SenseVoice 语音识别及 H3 辅助程序未提供 Mac 版本。
- 提供 10 个 macOS 原生扩展独立签名包与日历通用包；安装前校验操作系统、宿主版本、文件摘要和签名。Mac 和 Windows 使用各自目录。
- Windows 专用 CosyVoice 模型环境不能直接用于 Mac；系统参考音色改用 macOS 自带声音，API 朗读仍需有效供应商配置。
- Mac 账号需要在本机重新授权；云端构建不提交付费生成，不能替代账号和生成实测。

发布后在 [Releases](https://github.com/wu798998264-crypto/shensi-notes/releases/tag/v0.0.42)
选择 `Shensi-0.0.42-arm64.dmg` 或 `Shensi-0.0.42-x64.dmg`。
