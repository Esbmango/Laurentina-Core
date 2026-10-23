# Source release process

The allowlist builder never uploads or reads runtime configuration and databases. From the Core directory with Python 3.12:

```powershell
..\hy-memory-starter\.venv\Scripts\python.exe -E -s -X utf8 scripts\pack_release.py --list
..\hy-memory-starter\.venv\Scripts\python.exe -E -s -X utf8 scripts\pack_release.py --output "D:\Releases\LaurentinaCore-0.9.2"
```

Use a new destination outside the live workspace. The default is a timestamped directory under the current account's `.codex/releases/`. A standalone tree and ZIP contain relative paths and SHA-256 file records. Existing targets are refused.

Included: original Core / UI / setup / tests / brand assets / public docs, original HyMemory wrapper and adapters, declared dependencies, retained notices and optional-download locks.

Excluded: `.local`, `.runtime`, virtual environments, node_modules, chats, memories, credentials, account context, recordings, voice references, imported characters, model weights, synced reference sources, local delivery/verification/research artifacts, whole third-party repositories, and avatar runtime JS.

The explicit list is `scripts/release_manifest.json`. New source must be allowlisted before release. A second audit rejects forbidden directories, escaping paths, links/junctions, large unexpected files, personal Windows home paths, synced project IDs, common token patterns and private-key markers. This is a guard, not a guarantee against arbitrary personal text in future code; review the final diff and inventory before publishing.

Freeze concurrent edits, rerun packaging, verify manifest hashes and test installation from staging without live user data. Publish only that tree, never the live working directory wholesale. The project remains UNLICENSED; public availability does not select a general license or replace third-party terms.

## Optional brand asset rebuild

Ready-to-use PNG/ICO assets are included; normal installation does not rebuild them. To intentionally regenerate desktop sizes from the included transparent mark and desktop SVG, use the project-local Electron for `render_brand_icon.cjs`, then run `build_brand_assets.py` with a Python environment containing Pillow. These development tools preserve the original source PNG and write the derived brand assets and fingerprint manifest. Pillow is not required to run the application or its source-only tests.
