# Changes / 更新

## 0.9.1 — source preview

- The sidebar uses the isolated navy L with a lighter wordmark. The Windows desktop icon retains a warm-white rounded app tile, with transparent outer corners and no surrounding gray margin.
- Chinese/English/Japanese speech output language is separate from reference audio language. Automatic output language selection is recommended for multilingual text.
- Optional speaker-only reference conditioning is available for testing cross-language voices; the original transcript-based reference method remains the default. Results depend on the model and recording.
- Low-memory mode postpones automatic speech for local chat until the text answer is complete. Balanced mode and cloud replies retain incremental playback.
- Background profile extraction in low-memory mode waits for voice/chat to be idle, retains a message-ID queue across restarts, and can yield after an attached local extraction request is interrupted.
- Portable Windows setup, configuration examples, optional avatar-runtime download, source-only packaging and independent regression tests are included.
- A touch animation completes one full cycle before returning to idle, even when its short audio ends first. Repeated clicks advance touch replies without immediately repeating the same line; real answers and active user tasks retain priority.

本版主要修正透明 L 标志、字体和快捷方式；区分输出发音语言与参考音频语言，并提供跨语言参考方式试用。省内存模式让本地回复生成后再朗读；平衡模式保留原流式体验。安装包是源码预览，需要按说明安装运行环境及所需模型。

## 0.9.0

Blue light/dark UI, unified character and voice settings, shared/private/profile memory tabs, 800% companion size, Spine touch action fixes, transparent mouse pass-through, native speech timer fix, and bounded voice caches.

蓝色明暗主题、角色与声音统一入口、共享/私密/关于你记忆页签、桌宠整体800%、Spine触碰与透明穿透、语音计时器修复及有界缓存。

## Earlier foundations

Local/private Qwen chat, HyMemory integration, explicit Hermes/external-agent work handoff, project and conversation management, avatar ZIP imports, microphone input, custom voices, and imported GitHub skills. The project remains a Windows development preview; it does not promise universal agent-account login, arbitrary game-format support, or cloud-assistant-level latency on all hardware.
