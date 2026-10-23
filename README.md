# Laurentina Core Test1

<img src="https://raw.githubusercontent.com/Esbmango/Laurentina-Core/main/laurentina-core/assets/icon.png" width="80" height="80" alt="Laurentina L logo">

**中文** · [English](#english)

可自定义形象、声音和长期记忆的个人桌面 AI 助手，把日常聊天、本地私聊、共享记忆和工作任务集中在一个界面里。

**0.9.2 · Windows 10/11 x64 源码预览版。** 其他系统尚未完成适配；仓库不附带模型、个人数据、账号或 API 额度。

## 功能

- 中文 / English 界面、明暗主题、新对话、项目与置顶管理。
- 在同一对话中切换日常 / 私聊；私密记录与共享记忆分开保存，秘密记忆需要确认。
- 连接本机 Ollama 或自己配置的兼容模型 API。
- 可选的本地语音输入、自动朗读开关、参考音频声线；语音组件独立安装。
- 透明桌宠、动态球、图片与动态图片；可选 Live2D / Spine 播放器，人物独立缩放和触碰动画。
- 通过 Hermes 工作接口派活，保留状态、审批和结果；另有可选的本机 Codex / ChatGPT 对话桥。
- 导入技能文档；实际工作能力取决于连接的执行器和工具。

这是开发中的预览版。连接器、模型与操作系统的兼容性需要在目标环境验证；隔离测试不等于已经在所有第三方版本上验收。

## 快速开始

1. 从 [GitHub](https://github.com/Esbmango/Laurentina-Core) 下载完整源码，解压到自己可写的目录，例如 `D:\Apps\LaurentinaCore`。保留两个子目录的相邻关系。
2. 安装 [Python 3.12 x64](https://www.python.org/downloads/)（含 Python Launcher）与 [Node.js 22 LTS](https://nodejs.org/)（含 npm）。
3. 双击仓库根目录的 **Setup.cmd**。它创建项目自己的 Python 环境，安装 HyMemory 依赖和 Electron；不会安装 Hermes，也不会下载聊天或语音模型。
4. 安装 [Ollama](https://ollama.com/)，然后运行：

   ```powershell
   ollama pull qwen3.5:9b
   ollama pull qwen3-embedding:0.6b
   ```

5. 双击根目录 **Start.cmd**。默认选择本机 Qwen；使用其他已安装模型时，在界面中选择。记忆默认使用上述聊天 / 嵌入模型。

模型需要相应磁盘、内存和计算资源。资源不足时可先关闭自定义声线、选择较小的聊天模型。云端聊天需自行填写服务地址、模型和密钥，按服务商规则计费。

只想先看界面，可以先执行前 3 步并启动；未配置的聊天、记忆、语音和工作功能会显示未就绪。

## 可选功能

| 功能 | 安装 / 配置 |
| --- | --- |
| 基础离线语音 | `laurentina-core\SetupVoice.cmd`，首次下载 ASR / TTS 模型 |
| 自定义声线 | 基础语音完成后运行 `laurentina-core\SetupCustomVoice.cmd`，下载和资源需求较大 |
| Live2D / Spine | [第三方组件](docs/THIRD_PARTY.md)中的独立安装命令；公开包不内附 SDK 运行文件 |
| Hermes 工作 / 共享记忆 | [连接说明](docs/INTEGRATIONS.md)，需另行安装 Hermes 和配置执行器 |
| Codex / ChatGPT 本机对话桥 | 依赖已安装且支持相应工具的本机应用；不是任意网页账号的通用登录接口 |

详见 [使用指南](docs/USAGE.md)、[安装与排错](docs/SETUP.md)、[架构](docs/ARCHITECTURE.md)和[源码打包](docs/RELEASING.md)。

## 数据与许可

聊天、记忆、导入形象、录音、密钥和模型都在各子项目的 `.local/` 等运行目录中，**不随源码发布**。密钥使用当前 Windows 账户的 DPAPI 保存；聊天和记忆数据库不会因此自动加密，请保护本机账户和备份。

私聊使用本地模型与私密记忆；日常云端聊天和工作任务会把明确提交的内容发送到对应服务。私密原文不应作为共享内容发送。

原项目目前保持 **UNLICENSED**：作者尚未指定面向公众的一般使用许可。源码公开可查阅，不代表所有文件都按 MIT 或其他通用开源许可授权。第三方组件分别遵循原始条款，见 [THIRD_PARTY.md](docs/THIRD_PARTY.md)。

## English

Laurentina Core is a customizable personal desktop AI assistant with local/private chat, shared long-term memory, optional voice, avatars, and delegated work in one interface.

**0.9.2 · Windows 10/11 x64 source preview.** Models, accounts, API credits, personal data and optional avatar SDK binaries are not included. Other operating systems have not been validated.

### Quick start

1. Download the complete source from [GitHub](https://github.com/Esbmango/Laurentina-Core) and extract it to a writable directory. Keep `laurentina-core/` and `hy-memory-starter/` beside each other.
2. Install [Python 3.12 x64](https://www.python.org/downloads/), including the Python Launcher, and [Node.js 22 LTS](https://nodejs.org/), including npm.
3. Run the repository root **Setup.cmd**. It creates a local Python environment and installs HyMemory dependencies and Electron. No existing Codex or Hermes installation is required.
4. For local chat and memory, install [Ollama](https://ollama.com/) and run:

   ```powershell
   ollama pull qwen3.5:9b
   ollama pull qwen3-embedding:0.6b
   ```

5. Run **Start.cmd**. Choose another installed chat model in the interface if preferred. Cloud providers require your own endpoint, model and API key.

You can open the interface before installing models; those features remain unavailable until configured. Voice uses optional, separate environments. On constrained hardware, start with basic voice and a smaller chat model.

### Optional components

- **Base voice:** `laurentina-core\SetupVoice.cmd` installs offline ASR/TTS models.
- **Reference voice:** after base voice, run `laurentina-core\SetupCustomVoice.cmd`; downloads and resource requirements are substantially larger.
- **Live2D / Spine:** install separately using [THIRD_PARTY.md](docs/THIRD_PARTY.md). SDK binaries are omitted from the public source package; upstream notices are retained.
- **Hermes:** install and configure separately; see [INTEGRATIONS.md](docs/INTEGRATIONS.md). Work requires a compatible native Runs API and a real executor.
- **Codex / ChatGPT conversation bridge:** optional, compatible installed local tools are required. It does not turn web subscriptions into unrestricted API access.

See [USAGE.md](docs/USAGE.md), [SETUP.md](docs/SETUP.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [RELEASING.md](docs/RELEASING.md).

### Privacy and licensing

No chat history, memory database, credentials, recordings, voice references, imported avatars, model weights, virtual environments or whole third-party repositories are shipped. DPAPI protects saved secrets; local chat and memory databases are not automatically encrypted. Cloud providers receive content explicitly sent to them.

The original project remains **UNLICENSED** until the author selects a general public-use license. Public source availability does not imply an MIT license. Third-party packages, SDKs and models retain their own terms; see [THIRD_PARTY.md](docs/THIRD_PARTY.md).
