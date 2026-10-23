# Architecture / 模块边界

```text
Desktop UI
    │ validated Electron IPC
    ▼
Core backend (loopback + process token)
    ├─ conversations / projects / tasks / privacy decisions
    ├─ model providers → local Ollama or configured cloud API
    ├─ MemoryBridge → sibling HyMemory → shared/private namespaces
    ├─ WorkBridge → compatible Hermes Runs API → configured tools
    ├─ optional voice worker → isolated ASR / TTS runtimes
    └─ resource coordinator → inference admission / memory pressure

Desktop companion
    └─ modular Avatar Renderer → image/video, optional Cubism or Spine
```

`desktop.cjs` owns windows, file dialogs and trusted IPC. Renderers have no direct Node access. `core_backend.py` persists conversations and dispatches actions; `core_providers.py` manages models and separately encrypted credentials. Saved settings are distinct from a verified model connection.

`core_memory.py` uses a single local database owner process. The server selects namespaces; recalled text is historical content, not instructions. Secret confirmation is separate from normal chat, and private content is withheld from cloud work dispatch.

`core_work.py`, `core_tasks.py` and `core_work_validation.py` retain receipts, status, approvals and artifact validation. Unknown submissions are not blindly retried. Work availability depends on the actual executor.

Voice workers isolate heavier inference dependencies. References, caches and model weights are runtime data excluded from source packaging. Avatar adapters use a bounded pixel budget and camera framing for character zoom and oversized presentation; SDKs and user resources remain separate.

Optional `desktop_link.py` / `codex_rpc.py` adapters require compatible installed local tools and explicit task destinations. They do not provide generic account login, borrow API credits or promise compatibility with every future desktop version.
