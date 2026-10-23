# Mac preview / Mac 预览

首版目标：**Apple Silicon（M 系列），macOS 15 或以上**。Intel 和较低系统版本没有完成验收。

## 预览应用

从本仓库 Release 下载 `macOS-arm64-preview.dmg`，将 Laurentina.app 拖入 Applications 后打开。也可下载对应 ZIP 解压。

应用内置 Electron、独立 Python 3.12 和基础依赖，不要求先安装 Node/Python。聊天与记忆模型、个人声线、角色资源和 Hermes 不内附；本地聊天需要另行安装 Ollama 并准备模型，也可以在 AI 连接中配置自己的服务。

这是 **ad-hoc 本地签名预览**，尚未经过 Apple Developer ID 签名和公证。首次打开可能需要在系统「隐私与安全性」中确认允许该应用；按 [Apple 的应用打开说明](https://support.apple.com/102445)操作，不需要关闭系统全局保护。

主窗口关闭后，Mac 版本保留后台与桌宠；从 Dock 可重新打开，退出应用使用菜单 Quit / Command+Q。首次语音输入时系统会询问麦克风权限。

## 源码运行

1. 下载完整源码，保持 `laurentina-core/`、`hy-memory-starter/` 相邻。
2. 安装原生 arm64 Python 3.12 和 Node.js 22 或以上。
3. 双击根目录 `Setup.command`，然后 `Start.command`。从 Git 克隆时若脚本没有执行权限，可在终端运行 `bash laurentina-core/scripts/setup_macos.sh`，再用项目 Python 启动 `launch.pyw`。
4. 本地模型示例：`ollama pull qwen3.5:9b` 和 `ollama pull qwen3-embedding:0.6b`。也可以选择已安装的较小聊天模型。

源代码安装脚本不下载聊天、嵌入或语音模型；启动前先看界面也可以。

## 数据、密钥与可选组件

- Core 数据：`~/Library/Application Support/LaurentinaCore/Core/`。
- HyMemory 数据：`~/Library/Application Support/LaurentinaCore/HyMemory/`。
- Mac 密钥使用系统 Keychain。Windows DPAPI 文件和 Mac Keychain 引用不能直接跨电脑解密，迁移时在新机器重新配置凭据。
- 可选语音环境位于 Core 数据的 `runtimes/`，模型位于 `models/`。源码安装可运行 `SetupVoice.command`、`SetupCustomVoice.command`。此版本保留 CPU 回退，未承诺 MPS 加速或与 NVIDIA 相同性能。
- Live2D/Spine 运行组件仍独立安装，见 [THIRD_PARTY.md](THIRD_PARTY.md)。Mac 安装器把运行文件放到 Core 数据的 `avatar-runtimes/`，不会写入已签名的应用包；目前 Cubism Framework 构建步骤需要 Node/npm。
- Hermes 工作接口和本机对话桥需要在这台 Mac 上单独配置；Windows 的真实工作流通过不能代替 Mac Hermes 安装验收。

对于应用包，可用其 `Contents/Resources/python/bin/python3 -B` 执行 `Contents/Resources/app/scripts/install_avatar_runtimes.py --kind all` 安装角色运行组件。首次使用时实际语音、Retina、多屏、全屏 Spaces、拖动和系统权限仍应在目标 Mac 验收。

## 构建与自动检查

在目标 Mac 运行 `npm ci` 后，用项目 Python 执行：

```sh
python scripts/build_macos.py --output "$HOME/Laurentina-Mac-Build"
```

构建器只复制源码白名单，校验独立 Python 的固定 SHA-256，安装基础依赖并验证，生成本地签名的 `.app`、ZIP、DMG 和校验报告。没有模型下载。GitHub Mac job 还启动最终应用，检查真实 UI、会话持久化、私聊切换、关窗/重开、数据位置及运行前后的包完整性。

正式广泛分发可另行配置 Developer ID 签名和 Apple 公证。此预览不使用任何个人 Apple 账号或证书。

## English

The first Mac preview targets **Apple Silicon, macOS 15+**. Download the DMG or app ZIP from Releases. The application includes Electron, standalone Python 3.12 and base dependencies; models and personal data are excluded. It is ad-hoc signed, not Developer ID notarized. Follow Apple's per-app opening instructions when needed.

For source installs, keep both project folders together, install native arm64 Python 3.12 and Node 22+, then run Setup.command and Start.command. Data is stored under `~/Library/Application Support/LaurentinaCore/`; secrets use Keychain. Voice is optional, with CPU fallback and no verified MPS acceleration. Physical audio, multi-display/Retina/Spaces behavior and a complete Mac Hermes installation still require device acceptance.
