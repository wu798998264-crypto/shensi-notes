# 神思

神思官方软件下载与更新仓库。

## 按设备下载

**[打开最新桌面版下载表](https://github.com/wu798998264-crypto/shensi-notes/releases/latest)**，点击与你的电脑对应的下载按钮。下面的桌面入口始终指向最新正式版，具体版本和更新内容以发布页为准。

| 你的设备 | 下载入口 | 应选择的安装包 |
| --- | --- | --- |
| Windows 电脑，Intel / AMD 64 位处理器 | [Windows 下载页](https://github.com/wu798998264-crypto/shensi-notes/releases/latest) | `Shensi-Setup-版本号-构建编号-x64.exe` |
| Mac，Apple 芯片（M 系列） | [Apple 芯片 Mac 下载页](https://github.com/wu798998264-crypto/shensi-notes/releases/latest) | `Shensi-版本号-arm64.dmg` |
| Mac，Intel 处理器 | [Intel Mac 下载页](https://github.com/wu798998264-crypto/shensi-notes/releases/latest) | `Shensi-版本号-x64.dmg` |
| Android 手机 / 平板 | [已发布的 Android 测试版 0.0.13-test.13](https://github.com/wu798998264-crypto/shensi-notes-mobile/releases/tag/v0.0.13-test.13) | `.apk`；这是测试版，版本号与桌面端独立 |
| iPhone / iPad | 暂未发布，待完成 Apple 签名 | 暂无可安装包 |

不确定 Mac 类型：点击左上角 **苹果菜单 → 关于本机**；“芯片”为 Apple M 系列就选 **arm64**，“处理器”为 Intel 就选 **x64**。Mac 安装包不能用于 iPhone 或 iPad。

Windows 可在 **设置 → 系统 → 系统信息（关于）→ 系统类型** 查看处理器类型；当前提供 Intel / AMD x64 安装包，暂无 Windows ARM 原生安装包。

## 扩展插件（可选）

先安装主程序。需要独立扩展包时，在 [最新桌面版下载页](https://github.com/wu798998264-crypto/shensi-notes/releases/latest) 选择与你的系统和神思版本匹配的文件：

| 使用平台 | 扩展插件合集 |
| --- | --- |
| Windows | `Shensi-版本号-Extensions-Windows.zip` |
| macOS（Apple 芯片 / Intel） | `Shensi-版本号-Extensions-macOS.zip` |

扩展插件 ZIP 不是主程序安装包；Windows 和 macOS 专用扩展不能交叉安装。单个扩展也可查看 [官方扩展插件发布页](https://github.com/wu798998264-crypto/shensi-plugins/releases)。

## 哪些文件不用手动下载

普通安装只需上表对应的 `.exe`、`.dmg` 或 Android `.apk`。

- `shensi-notes-update.json`、`shensi-notes-macos-update.json` 和 `.blockmap`：供软件更新使用。
- `SHA256SUMS*.txt`：文件完整性校验信息。
- GitHub 自动生成的 `Source code (zip / tar.gz)`：源码归档，不是安装包。

软件内仍可检查更新、手动下载并安装。当前版本的验证结果、已知限制及系统信任提示，请查看 [最新发布说明](https://github.com/wu798998264-crypto/shensi-notes/releases/latest)。
