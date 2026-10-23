# HyMemory local service and adapters

This directory contains Laurentina's local service wrapper and original adapters. The HyMemory library and Qdrant client are installed from declared Python packages; whole upstream repositories and runtime data are not bundled.

Run the repository root Setup.cmd to create `.venv/`. Run this directory's Start.cmd for the local memory configuration page. The service binds to `127.0.0.1`, normally at port 8765, choosing another local port if needed.

Public setup creates a standalone scope only on a fresh installation, with local Ollama defaults. The existing status field `hermes_connected` means a memory profile scope exists; in a standalone installation it does **not** prove that Hermes is installed or connected. Actual work connectivity is checked separately.

Shared/private Core namespaces are derived server-side from this profile. The shared-memory MCP exposes only shared facts. The Hermes provider queues turns and retrieves facts in the owning profile. Credentials are Windows-DPAPI protected; memories and pending queues are local unencrypted files.

Optional adapters:

- `shared_memory.py --mcp`: stdio shared-memory search, remember and status.
- `hermes_plugin/`: original Hermes memory provider.
- `desktop_plugin/`: optional local desktop-conversation bridge.
- `install_hermes.py --home PATH`: explicitly install memory integration in a target profile, backing up settings.
- `install_shared_bridge.py`: optional legacy helper for the standard Windows Hermes/Codex layout; it edits integration settings and is not run by base setup.

See the repository's `docs/INTEGRATIONS.md`. No personal configuration, credentials, chats, recordings or model files are included.
