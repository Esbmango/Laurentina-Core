# HyMemory for Hermes

This user memory provider connects Hermes to the separately managed local HyMemory service. It has no Python dependencies inside the Hermes-managed environment.

The installer writes `sidecar.json` with the local HyMemory workspace location. Start Hermes normally after installation. The provider starts the local service when necessary, retrieves historical facts before replies, and queues completed user/assistant turns for fact extraction.

Each Hermes profile has its own namespace, derived from the actual `hermes_home` passed at initialization. Its write queue is stored at `<hermes_home>/hymemory-bridge/pending.sqlite3`. Inference failures retain queued writes for a later retry. Completed writes are deduplicated by stable turn identifiers. Background writers inherit Hermes profile context through `spawn_context_thread`.

The backend keeps one HyMemory runtime under the workspace `.local/m/`, with every write and search explicitly bound to that profile's unique user namespace. It never changes a global current profile during calls. Short storage directory names keep paths within Windows limits. For the installed primary profile, the existing local browser page displays the same namespace. The page is optional; ordinary Hermes use needs no browser.

The model APIs must point at local Ollama for fully local operation. Both user and assistant text can reach the configured model endpoints. Raw tool traces are not automatically imported. Oversized turns above 12000 user / 24000 assistant characters are skipped with a log warning. Local memory and queue contents are not encrypted; API settings are protected by Windows DPAPI.

Tools: `hymemory_search(query)` and `hymemory_remember(content)`. A queued response is not a saved-memory confirmation. Hermes' own MEMORY.md / USER.md settings are left as configured.

Set `memory.provider` back to its previous value to disable this provider. The installer backs up the previous configuration before activation.
