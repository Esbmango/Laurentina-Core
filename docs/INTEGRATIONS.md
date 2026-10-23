# 连接其他系统 / Integrations

## 模型

在界面中选择本地 Ollama，或添加兼容服务地址、模型与 API key，测试后再设默认。账号会员与 API key 不一定共享额度；此项目不提供免费额度或绕过限制。

私聊走本地模型，记忆桥要求本地聊天与嵌入端点。云端聊天配置不应改变私密记忆的本地边界。

## Hermes 工作执行

另行安装 [Hermes Agent](https://github.com/NousResearch/hermes-agent)，配置模型和工具，再启用本机认证 API。当前适配需要原生 Runs API，含能力探测、任务 / 事件 / 取消 / 审批；只有聊天兼容端点不足以执行工作流。

`setup_work.py` 支持标准 Windows 布局 `%LOCALAPPDATA%\hermes\bin\hermes.exe`，安装原创密钥来源适配并启动回环网关。它备份改动配置，不覆盖身份 / 认证不匹配的接口，也不强停已有网关。阅读脚本后，从 Core 目录运行：

```powershell
..\hy-memory-starter\.venv\Scripts\python.exe -E -s -X utf8 setup_work.py
```

其他安装位置可自行运行兼容网关，在启动 Core 的同一环境设置 `LAURENTINA_HERMES_URL`、`LAURENTINA_HERMES_API_KEY` 与可选的 `LAURENTINA_HERMES_MODEL_NAME`。不要把密钥提交仓库。

目标机仍需验收 Hermes 版本、API、工具与模型。公共测试覆盖隔离接口和适配器行为，不代表已在任意新安装或未来版本上重验真实派活。

## Hermes 共享记忆

先备份两个项目的 `.local/` 和 Hermes profile。首次使用前选定 profile 最方便；独立 Core 范围改绑其他 profile 后命名空间不同，已有记忆不会自动合并。

对于未产生记忆的新安装：

```powershell
laurentina-core\Setup.cmd -SkipMemoryDefaults
hy-memory-starter\.venv\Scripts\python.exe -E -s -X utf8 laurentina-core\scripts\configure_local_memory.py --initialize --hermes-home "D:\Apps\HermesProfile"
hy-memory-starter\.venv\Scripts\python.exe -E -s -X utf8 hy-memory-starter\install_hermes.py --home "D:\Apps\HermesProfile"
```

目标须为含 `config.yaml` 与适用 `bin/hermes.exe` 的真实 profile。初始化脚本保留已有配置；迁移时不要删配置覆盖原数据库。

## Shared-memory MCP

支持 stdio MCP 的客户端可添加下面的示例，替换路径；它不会自动改应用设置。

```json
{
  "mcpServers": {
    "laurentina_memory": {
      "command": "D:/Apps/LaurentinaCore/hy-memory-starter/.venv/Scripts/python.exe",
      "args": ["-E", "-s", "-X", "utf8", "D:/Apps/LaurentinaCore/hy-memory-starter/shared_memory.py", "--mcp"]
    }
  }
}
```

只导出共享范围：`shared_memory_search`、`shared_memory_remember`、`shared_memory_status`。历史记忆不是新指令，保存成功应以工具返回为准，不保存密钥或原始工具日志。

## Codex / ChatGPT 本机对话桥

需要兼容且已登录的本机客户端工具 / App Server，不适用于任意网页和所有账号。基础 Core 无需安装它们。

`install_shared_bridge.py` 是标准 Windows 布局的可选助手，会备份并改写当前用户 Codex MCP、AGENTS 和 Hermes 插件配置；检查源代码与目标 profile 后再手动运行，不由基础 Setup 执行。复制另一台机器的认证上下文不会建立有效连接。

派活须明确目标。历史读取、记忆召回、消息提交与任务完成是不同阶段，旧回复不能作为新任务完成证据。

## English

Provide your own model endpoints and credentials. Hermes work requires a compatible native Runs API, not just chat completions. Standard Windows helpers are optional; custom installations can supply an existing endpoint through environment variables. The memory MCP exports shared scope only. Desktop adapters require compatible signed-in local tools and explicit destinations. Base setup never edits third-party account settings or imports private chats.
