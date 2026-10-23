# Third-party components / 第三方组件

Original Laurentina code remains UNLICENSED until the author selects a public-use license. Dependencies retain their upstream licenses; they are not relicensed as original code.

## Separate avatar SDK installation

The public source package omits `ui/avatars/vendor/*.js`. Original adapters, exact upstream source/version/hash manifests, and unmodified notices are included. Images and videos work without skeletal SDKs.

- **Spine:** the Spine Runtimes License applies, referring to the Spine Editor License Agreement and alternatives for product users. This is not MIT. Read [upstream licensing](https://esotericsoftware.com/spine-runtimes-license) and `assets/vendor/SPINE-*-LICENSE.txt`.
- **Live2D Core:** Live2D Proprietary Software License.
- **Live2D Framework:** Live2D Open Software License and the release-license conditions in its notice. See [SDK licensing](https://www.live2d.com/en/download/cubism-sdk/) and retained `LIVE2D-*` files.

After reviewing the terms, install the family needed from the repository root:

```powershell
hy-memory-starter\.venv\Scripts\python.exe -E -s -X utf8 laurentina-core\scripts\install_avatar_runtimes.py --kind spine
# Or: --kind live2d / --kind all
```

The installer downloads pinned upstream sources, verifies the output SHA-256 and writes the local vendor file. Cubism Framework is built from its pinned source archive using `esbuild@0.25.12` through npm. Installation needs network access; rendering uses local files. A mismatch fails instead of accepting unverified replacement code.

Installation does not replace upstream terms or grant rights to character art. User character models and recordings are not distributed.

## Other components

| Component | Scope / notice |
| --- | --- |
| Electron | MIT; npm-installed distribution and dependency notices |
| HyMemory / Qdrant client | Declared Python dependencies; licenses in installed distributions |
| PyYAML | MIT; configuration helpers |
| faster-whisper / Piper / models | Optional packages and separate downloads; retain each license/model card |
| Qwen3-TTS | Optional; Apache-2.0 notice in `assets/licenses/` |
| Faster-Qwen3-TTS | Optional; MIT notice in `assets/licenses/` |
| PyTorch / other voice dependencies | Installed distributions retain their own notices and hardware requirements |
| Hermes / Codex / cloud services | Separate installations/services, not bundled source repositories |

`assets/vendor/avatar-runtimes.json`, `voice-models-lock.json` and setup scripts record pinned sources. Those manifests do not mean weights, SDK binaries or whole upstream repositories are included.
