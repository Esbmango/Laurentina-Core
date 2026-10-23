# 安装与配置 / Installation and configuration

支持 Windows 10/11 x64，Python 3.12、Node.js 22 或更高版本。基础安装不需要已有 Codex / Hermes，不下载聊天和语音模型，也不会关闭运行中的服务。

## 目录与基础安装

```text
LaurentinaCore/
  Setup.cmd
  Start.cmd
  README.md
  docs/
  laurentina-core/       # Electron、Core、界面、可选语音安装器
  hy-memory-starter/     # 记忆服务、MCP 与 Hermes 原创适配器
```

不要单独下载其中一个目录。Start.cmd 按自身位置寻找 sibling 服务，不需要作者电脑路径。

运行根目录 Setup.cmd。它创建 `hy-memory-starter/.venv/`，按随附锁文件约束安装 `hy-memory==2.0.4`、`qdrant-client==1.19.1` 与 PyYAML 并运行 `pip check`；通过 npm 在 Core 内安装锁定版本的 Electron；仅在不存在旧记忆配置时，生成独立本地记忆范围和 Ollama 默认配置。已有配置不会覆盖。

首次安装需要访问 Python 包仓库、npm 和 Electron 下载源。下载失败时保留错误信息并重试。高级安装可运行 `laurentina-core/scripts/setup_portable.ps1`：`-SkipNpm` 用于自行准备 Electron，`-SkipMemoryDefaults` 用于手动配置记忆，`-PythonExe "D:\Apps\Python312\python.exe"` 用于显式选择自己的便携 Python 3.12。

## 模型和记忆

默认聊天模型为 `qwen3.5:9b`，嵌入模型为 `qwen3-embedding:0.6b`、维度 1024。先用 `ollama list` 确认实际安装名称。Core 聊天模型和记忆配置是不同设置；换聊天模型不会自动下载嵌入模型。

双击 `hy-memory-starter/Start.cmd` 可打开记忆配置页。Core 记忆桥要求聊天和嵌入端点都是本机回环 IP；默认 `http://127.0.0.1:11434/v1`，兼容字段中的 `ollama` 是本机占位值，不是云端密钥。日常聊天的云端配置不会将私密记忆改走云端。

如需 Hermes 共用记忆，最好在首次使用之前按 [连接说明](INTEGRATIONS.md) 绑定最终 profile。已有独立范围不会自动合并到新 profile；不要覆盖数据库来迁移。

## 语音和形象

`SetupVoice.cmd` 建立 `.voice-venv/`，安装固定版本依赖，下载锁定的 Whisper / Piper 模型与模型说明。完成后开启语音输入 / 自动朗读；自动朗读可关闭。

`SetupCustomVoice.cmd` 建立 `.custom-voice-venv/`，下载 Qwen3-TTS Base 等较大文件。安装器包含 PyTorch/CUDA 依赖，下载量与运行需求高于基础语音；没有合适显卡可先用基础语音，或自行准备兼容 CPU PyTorch。安装前可检查脚本和清单。

参考音频和参考文字应对应同一段内容。参考录音语言与输出发音语言分别设置；跨语言效果由模型决定，首次加载通常较慢。

图片、GIF/APNG/WebP 与透明 WebM 不需要骨骼 SDK。Live2D 和 Spine 是不同格式；按 [THIRD_PARTY.md](THIRD_PARTY.md) 安装对应运行时，再上传含完整模型、纹理、动作 / 表情的 ZIP。整体桌宠和人物缩放独立保存；超出屏幕的整体放大将裁切部分画面。

## 环境覆盖 / Environment overrides

仅在自定义安装位置时使用。程序读取启动环境，不会自动载入 `.env`。无密钥示例在 `laurentina-core/examples/`。

| Variable | Meaning |
| --- | --- |
| `LAURENTINA_ELECTRON` | 可选 Electron 可执行文件完整路径 / optional executable |
| `LAURENTINA_CORE_PYTHON` | 可选 Core 后端 Python；仍需保留 HyMemory 项目环境 / optional backend interpreter |
| `LAURENTINA_CORE_DATA` | Core 数据目录；不移动 HyMemory 的 `.local/` / Core data only |
| `LAURENTINA_HERMES_URL` | 已运行的兼容 Hermes API 地址 / existing compatible API |
| `LAURENTINA_HERMES_API_KEY` | 对应认证值，只在本机设置，勿提交 Git / endpoint secret |
| `LAURENTINA_HERMES_MODEL_NAME` | 可选 API 暴露的模型名 / API-facing model name |
| `LAURENTINA_WORK_AUTO_START` | `0` 禁止自动尝试启动 Hermes / disable auto-start |

## 备份与排错

- 退出 Core 后备份两个目录的 `.local/`。DPAPI 绑定保存时的 Windows 账户，复制到其他账户不代表能解密。
- 启动失败：查看 Core `.local/launch-error.txt`、`launch.log`，确认 Setup 与 Python / Node 版本。
- 聊天失败：检查 Ollama 运行状态和 `ollama list`。
- 记忆未就绪：检查记忆页的模型、维度与本地地址。
- 工作未连接：检查 Hermes 能力和认证。没有另装 Hermes不代表 Core 安装失败。
- 卸载：退出后删除安装目录。另装的 Ollama、Hermes、Python、Node 由各自卸载器管理。

## English notes

Run Setup.cmd once, then Start.cmd, keeping both directories adjacent. Setup creates local dependencies using Python 3.12 and npm, preserves existing memory settings, and does not stop services. Install models separately. Voice and skeletal avatar SDKs have separate opt-in installers. Web subscriptions and API access may use different credentials and billing.

Environment overrides above are optional and are not loaded from `.env`. Local databases are not automatically encrypted; DPAPI-protected secrets remain tied to their Windows account.
