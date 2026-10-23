'use strict';

// UI text only: chat, memory, persona, imported skills and model names are
// explicitly excluded. Language changes never rewrite stored user content.
(() => {
  const english = {
    '劳纶缇娜 V1 标志':'Laurentina V1 logo',
    '角色形象与声音':'Character & voice',
    '管理共享记忆、私密记忆和关于你的资料。':'Manage shared memories, private memories, and your personal profile.',
    '记忆分类':'Memory sections',
    '调整本地模型、运行资源和数据；声音设置已移到「角色形象与声音」。':'Manage local models, resources, and data. Voice settings are in Character & voice.',
    '桌宠大小可设置为 50% 到 800%。':'Desktop companion size must be between 50% and 800%.',
    '超过屏幕可用大小时，人物继续放大，部分画面会被裁切。':'Beyond the available screen size, the character keeps growing and parts of the image are cropped.',
    "人物缩放可设置为 50% 到 800%。": "Character zoom must be between 50% and 800%.",
    "删除这个角色？": "Delete this character?",
    "角色将从资源库移除，并保留在本机回收区。原始 ZIP 不会删除。": "The character will be removed from the library and kept in a local recovery folder. The original ZIP is preserved.",
    "删除角色": "Delete character",
    "角色已移至本机回收区。": "Character moved to local recovery.",
    "不播放触摸动画": "No touch animation",
    "触摸动画": "Touch animation",
    "桌宠语音输入后打开主面板": "Open the main panel after desktop voice input",
    "默认留在桌面直接问答；需要检查文字或处理任务时可双击桌宠打开面板。": "Stay on the desktop for voice replies by default. Double-click the companion to review text or tasks.",
    "收起主面板": "Hide main panel",
    "触碰回应": "Touch responses",
    "单击桌宠随机播放一条回应，双击打开面板。录音直接在本机播放；仅有台词时使用当前声音朗读。": "Click the companion to play a random response; double-click to open chat. Recordings play locally. Text-only responses use the selected voice.",
    "开启触碰回应": "Enable touch responses",
    "回应台词（导入录音时可选）": "Response text (optional with audio)",
    "填写一句触碰时说的话": "Enter a touch response",
    "导入回应录音": "Import response audio",
    "添加台词": "Add response text",
    "支持 0.15–60 秒的 WAV、MP3、FLAC、OGG，最大 20 MB。不读取聊天或写入记忆。": "WAV, MP3, FLAC or OGG, 0.15–60 seconds, up to 20 MB. Does not read chat or write memory.",
    "尚未添加回应，触碰时会朗读“我在”。": "No responses yet. Touch will say “I’m here” using the selected voice.",
    "仅播放录音": "Audio only",
    "触碰回应已添加。": "Touch response added.",
    "正在播放触碰回应": "Playing touch response",
    "回应录音无法播放。": "Cannot play response audio.",
    "单击轻触 · 双击聊天 · 拖动移动": "Click to interact · Double-click to chat · Drag to move",
    "单击轻触，双击打开聊天，拖动移动；回车轻触，Shift加回车打开聊天": "Click to interact, double-click to chat, drag to move; Enter to interact, Shift+Enter to chat",
    "已发送，正在等待回答": "Sent, waiting for a reply",
    "暂时无法回应轻触": "Touch response is unavailable",
    "按住球体或立绘拖动，单击触碰回应，双击打开面板。图片与角色模型保持透明背景，角色包的动画设置在资源库管理。": "Drag the orb or character to move, click to interact, and double-click to open chat. Artwork stays transparent. Configure model animations in the library.",
    '人物缩放': 'Character zoom', '重置人物缩放': 'Reset character zoom',
    '人物缩放可设置为 50% 到 300%。': 'Character zoom must be between 50% and 300%.',
    '仅调整人物，不改变桌宠窗口大小；放大后部分特效可能超出画面。': 'Zooms the character without resizing the desktop window. Some effects may extend beyond the frame.',
    '朗读语言': 'Speech language', '自动识别': 'Automatic', '中文': 'Chinese',
    '声线参考方式': 'Voice reference mode',
    '完整参考（默认）': 'Full reference (default)',
    '仅保留音色（跨语言试用）': 'Speaker only (cross-language trial)',
    '适用于本应用的自定义声音。跨语言不自然时可试仅保留音色，声音相似度可能下降；原录音和逐字稿不变。': 'For this app’s custom voice service. If cross-language speech sounds unnatural, try speaker only; voice similarity may decrease. The reference audio and transcript stay unchanged.',
    '连续语音期间保持声音就绪。节省内存模式下，本地回答生成完再自动朗读，文字仍逐步显示；释放后下次发声可能重新加载，不会关闭其他应用。': 'Voices stay ready during voice conversations. Save memory mode starts auto-read after local replies finish; text still streams. Released voices may need to reload. Other apps stay open.',
    '输出文字发音语言': 'Pronunciation language of the output text',
    '自动跟随文字（推荐）': 'Follow the text automatically (recommended)',
    '决定待朗读文字怎么发音，不是参考录音的语言。日语参考声线读中英文时请选择自动跟随文字；录音原文保持原语言，不要翻译。': 'Controls how the output text is pronounced, not the reference recording language. For a Japanese reference voice reading Chinese or English, choose automatic. Keep the reference transcript in its original language; do not translate it.',
    '用于自定义声线。录音原文保持原语言；朗读语言不会翻译回答内容。': 'For custom voices. Keep the reference transcript in its original language. This setting does not translate replies.',
    '运行资源': 'System resources', '查看内存与显存，闲置时释放本应用的语音模型。': 'Monitor RAM and GPU memory, and release this app’s idle voice models.',
    '刷新状态': 'Refresh status', '运行偏好': 'Resource preference',
    '平衡：保留常用声音，减少等待': 'Balanced: keep voices ready for faster replies',
    '节省内存：更早释放闲置声音': 'Save memory: release idle voices sooner',
    '连续语音期间保持声音就绪。释放后下次发声可能需要重新加载；不会切换聊天模型或关闭其他应用。': 'Voices stay ready during voice conversations. Released models need to reload before speaking again. Chat models and other apps are unchanged.',
    '保存运行偏好': 'Save resource preference', '运行偏好已保存': 'Resource preference saved',
    '可用内存': 'Available RAM', '可用显存': 'Available GPU memory',
    '资源紧张，建议减少同时运行的本地模型。': 'Resources are low. Consider running fewer local models at once.',
    '连续语音保持就绪': 'Voice conversation stays ready', '暂未取得硬件状态': 'Hardware status is unavailable',
    '执行结束': 'Execution ended', '成果核验': 'Verify outputs', '成果目录': 'Output folder',
    '任务执行结束不代表结果正确。选择本机成果目录，填写预期文件；只读取检查，不会运行文件。': 'Execution ending does not confirm correctness. Select the local output folder and expected files. Verification only reads files.',
    '选择任务将保存成果的文件夹': 'Select the folder where the task will save outputs', '选择文件夹': 'Choose folder',
    '预期文件（每行一个相对路径）': 'Expected files (one relative path per line)',
    '核对 expenses.csv 与 summary.json 的行数、分类和金额': 'Compare row counts, categories and amounts in expenses.csv and summary.json',
    '勾选金额核验时，CSV 使用 category、amount_cents 列；JSON 使用 row_count、grand_total_cents、by_category_cents 字段。': 'Amount checks expect CSV columns category and amount_cents, and JSON fields row_count, grand_total_cents and by_category_cents.',
    '核验当前任务': 'Verify current task', '请选择成果目录，并填写预期文件或勾选金额核验。': 'Choose an output folder, then add expected files or enable amount checks.',
    '成果检查通过': 'Output checks passed', '成果检查未通过': 'Output checks failed', '正在核验成果': 'Checking outputs', '成果未验证': 'Outputs unverified',
    '仅确认列出的检查项；内容质量仍需按任务目标验收。': 'Only the listed checks are confirmed. Review content quality against the task goal.',
    '开始连续语音': 'Start voice conversation', '结束连续语音': 'End voice conversation',
    '正在准备语音…': 'Preparing voice…',
    '正在聆听…': 'Listening…', '正在听你说…': 'Listening to you…',
    '语速': 'Speaking speed', '自定义声线': 'Custom voices',
    '聊天输入框旁可开启连续语音。说完会自动发送，开口可打断；使用耳机时更稳定。': 'Start a voice conversation beside the chat box. Speech is sent when you finish, and you can interrupt. Headphones improve reliability.',
    '导入参考录音，在本机生成并使用自己的声音档案。': 'Import reference audio to create and use a voice profile locally.',
    '首次发声可能需要几十秒；准备期间可停止。': 'The first response may take tens of seconds to prepare. You can stop it while it loads.',
    '刷新声音档案': 'Refresh voice profiles', '启动本地声线服务': 'Start local voice service', '停止声线服务': 'Stop voice service',
    '声音名称': 'Voice name', '为这条声线取名': 'Name this voice', '参考录音': 'Reference audio',
    '3–30 秒清晰的单人录音，最大 8 MB。原文应与录音一致；录音和声音档案只保存在本机。': 'Clear single-speaker audio, 3–30 seconds, up to 8 MB. The transcript must match. Audio and profiles stay on this computer.',
    '录音原文': 'Reference transcript', '准确填写这段录音说了什么': 'Enter the exact words spoken in this recording',
    '保存声音档案': 'Save voice profile', '本地声线服务已就绪': 'Local voice service is ready',
    '服务已启动，首次试听会准备声音模型': 'Service started. The first preview loads the voice model.',
    '模型已准备好，使用时启动本地服务': 'Model installed. Start the local service when needed.',
    '本地自定义声音尚未准备好。': 'The local custom voice is not ready.', '正在使用': 'In use', '使用这条声线': 'Use this voice',
    '声音已切换，可点击试听。': 'Voice selected. Use Preview to listen.', '删除声音档案': 'Delete voice profile',
    '删除后无法继续使用这条声线；若正在使用，将恢复内置声音。': 'This voice will be removed. If selected, the built-in voice will be restored.',
    '还没有声音档案，导入一段参考录音即可添加。': 'No voice profiles yet. Import a reference recording to add one.',
    '请选择 8 MB 以内的参考录音。': 'Choose a reference recording up to 8 MB.',
    '正在准备本地声音档案…': 'Preparing the local voice profile…', '声音档案已保存，选择使用后可试听。': 'Voice profile saved. Select it, then preview.',
    '本地声线服务已启动。': 'Local voice service started.', '本地声线服务已停止。': 'Local voice service stopped.',
    '请先切回聊天，再开始连续语音。': 'Switch back to chat before starting a voice conversation.',
    '含私聊': 'Contains private messages', '此对话含私聊内容，私聊原文仅存本地': 'Contains private messages; private text stays local',
    '已切换到私聊模式': 'Switched to private mode', '已切换到日常模式': 'Switched to daily mode',
    '在当前对话中切换到日常': 'Switch this conversation to daily mode', '在当前对话中切换到私聊': 'Switch this conversation to private mode',
    '请等当前回答结束，再切换模式。': 'Wait for this reply to finish before switching modes.',
    '关闭自动朗读': 'Turn off automatic speech', '开启自动朗读': 'Turn on automatic speech',
    '自动朗读已开启，点击关闭': 'Automatic speech is on; click to turn off', '自动朗读已关闭，点击开启': 'Automatic speech is off; click to turn on',
    '自动朗读已开启': 'Automatic speech is on', '自动朗读已关闭': 'Automatic speech is off',

    '窗口控制': 'Window controls', '最小化': 'Minimize', '最大化或还原': 'Maximize or restore', '关闭窗口': 'Close window', '关闭': 'Close',
    '导航': 'Navigation', '返回聊天': 'Back to chat', '你的个人助手': 'Personal assistant', '新对话': 'New chat', '项目': 'Projects', '新建项目': 'New project',
    '创建项目': 'Create project', '项目名称': 'Project name', '最近对话': 'Recent chats', '历史对话': 'Chat history', '正在读取对话…': 'Loading chats…', '管理': 'Manage',
    '工作': 'Work', '角色与形象': 'Character', '记忆': 'Memory', '关于你': 'About you', 'AI 连接': 'AI connections', '技能': 'Skills', '设置': 'Settings',
    '切换明暗主题': 'Switch light or dark theme', '浅色模式': 'Light mode', '深色模式': 'Dark mode', '切换界面语言': 'Switch interface language',
    '正在连接本地服务': 'Connecting to local services', '聊天': 'Chat', '交办任务': 'Assign task', '任务执行目标': 'Task destination', '任务技能': 'Task skill',
    '不使用技能': 'No skill', '只交接这条任务，不附带私聊。': 'Only this task is shared; private chat is excluded.', '对话模式': 'Chat mode', '日常': 'Daily', '私聊': 'Private',
    '本地模型': 'Local model', '日常聊天模型': 'Daily chat model', '选择日常聊天模型': 'Choose daily chat model', '停止朗读': 'Stop speaking',
    '录音输入': 'Voice input', '录音输入，识别后可编辑': 'Voice input; review the transcript', '录音输入，识别后直接发送': 'Voice input; send after transcription',
    '发送消息': 'Send message', '发送 (Enter)': 'Send (Enter)', '停止回答': 'Stop reply',
    '本地对话 · Enter 发送，Shift + Enter 换行': 'Local chat · Enter to send, Shift + Enter for a new line',
    '名字、形象和人设，共同组成你熟悉的她。': 'Configure your assistant’s name, avatar and persona.', '助手名字': 'Assistant name', '导入形象': 'Import avatar', '恢复默认': 'Reset',
    '支持 PNG、JPG、WebP 原图，最大 20 MB。裁剪后保存为轻量头像。': 'PNG, JPG and WebP originals up to 20 MB. The cropped avatar is saved at a smaller size.',
    '人设文档': 'Persona document', '她如何表达、怎样陪伴你，以及你希望她遵循的习惯。': 'Set personality, tone and preferred behavior.', '导入文档': 'Import document', '人设内容': 'Persona content',
    '在这里写下她的性格、说话方式和陪伴习惯，也可以导入已有的人设文档。': 'Describe personality, speaking style and habits, or import an existing persona document.',
    '保存时，人设摘要会同步到共享记忆，让其他已接入的助手也能了解。': 'Saving also shares a persona summary with connected assistants through shared memory.', '保存角色': 'Save character',
    '桌面陪伴': 'Desktop companion', '动态球体与独立立绘，随时回到同一个聊天窗口。': 'Choose an animated orb or a separate character on your desktop.', '打开陪伴': 'Show companion',
    '展示方式': 'Display mode', '动态球体': 'Particle orb', '桌面立绘 / 动图': 'Illustration / animated image', '角色模型资源库': 'Character model library',
    '导入立绘 / 动图': 'Import illustration / animation', '移除立绘': 'Remove illustration',
    '与聊天头像分别设置。支持透明 PNG、JPG、GIF 和 WebP 动图，最大 25 MB。': 'Separate from the chat avatar. Supports transparent PNG, JPG, GIF and animated WebP, up to 25 MB.',
    '角色资源库': 'Character library', '导入角色包 / 动图': 'Import character / animation',
    '上传 ZIP 角色包，或 WebM、GIF、APNG、WebP。支持透明背景；Live2D 与 Spine 分别加载。': 'Upload a ZIP character package, WebM, GIF, APNG or WebP. Transparency is supported; Live2D and Spine use separate players.',
    '待机动画': 'Idle animation', '说话动画': 'Speaking animation', '思考动画': 'Thinking animation', '跟随待机动画': 'Follow idle animation', '保存动画设置': 'Save animation settings', '大小': 'Size', '在桌面显示陪伴': 'Show companion on desktop',
    '按住球体或立绘拖动，点击开始聊天。图片与角色模型保持透明背景，角色包的动画设置在资源库管理。': 'Drag the orb or character to move it; click to chat. Transparent artwork and models are supported. Manage model animations in the library.',
    '保存陪伴设置': 'Save companion settings', '记忆管理': 'Memory manager', '值得记住的事': 'Memories', '查看、补充和整理她记住的信息。': 'Review, add and organize remembered information.',
    '记忆范围': 'Memory scope', '共享记忆': 'Shared memory', '私密记忆': 'Private memory', '添加记忆': 'Add memory',
    '已连接的助手可以读取共享记忆。': 'Connected assistants can read shared memory.', '搜索记忆': 'Search memories', '搜索记住的事情…': 'Search memories…', '搜索': 'Search', '清空搜索': 'Clear search',
    '从你亲口分享的事实与偏好开始。你随时可以纠正或移除。': 'Facts and preferences you have shared. You can correct or remove them.',
    '称呼、语言、长期偏好、习惯和目标的变化可同步共享；私聊原文留在本地。明确告诉她的秘密优先保密，确认后只入本地私密库。': 'Changes to your name, language, lasting preferences, habits and goals may be shared. Private chat stays local. Explicit secrets are saved only to local private memory after confirmation.',
    '配置一次，以后直接在聊天框切换。私聊始终留在本地。': 'Set up once, then switch in the composer. Private chats always use a local model.', '我的模型': 'My models', '添加': 'Add', '接入指引': 'Setup guide',
    '在官方平台获取 API 密钥。': 'Get an API key from the official provider.', '填写模型 ID 和密钥，保存连接。': 'Enter the model ID and key, then save.', '测试通过后，设为日常模型。': 'Test the connection, then select it for daily chat.',
    '选择本机已有模型并保存，即可开始聊天。': 'Select an installed local model and save to start chatting.', '获取官方密钥 ↗': 'Get official API key ↗', '接入说明 ↗': 'Setup documentation ↗', '查看额度与费用 ↗': 'Usage and pricing ↗',
    '服务类型': 'Provider type', '本地 Qwen / Ollama': 'Local Qwen / Ollama', '兼容服务（Gemini、豆包等）': 'Compatible service (Gemini, Doubao, etc.)', '连接名称': 'Connection name', '模型 ID': 'Model ID',
    '从官方控制台复制模型 ID': 'Copy the model ID from the provider console', '服务地址': 'Service URL', 'API 密钥': 'API key', '填写新密钥；留空保留已有密钥': 'Enter a new key; leave blank to keep the saved key',
    '移除已保存的密钥': 'Remove saved key', '测试连接': 'Test connection', '保存连接': 'Save connection', '用于日常聊天': 'Use for daily chat', '删除连接': 'Delete connection', '返回聊天 →': 'Back to chat →',
    '在这里调整本地模型、声音和数据；日常云端模型请到「AI 连接」配置。': 'Configure local models, voice and data here. Configure cloud chat models in AI connections.',
    '用于私聊，以及选择本地服务时的日常聊天。': 'Used for private chats and daily chats when a local provider is selected.', '刷新服务状态': 'Refresh service status', '刷新状态': 'Refresh status',
    '本地聊天模型': 'Local chat model', '保存': 'Save', '本地模型服务': 'Local model service', '正在检查': 'Checking', '记忆服务': 'Memory service', '声音与录音': 'Voice and recording',
    '在本机听清你的话，也用声音回应。': 'Transcribe locally and hear spoken replies.', '刷新语音状态': 'Refresh voice status', '发声方式': 'Voice provider', '本地中英文声音': 'Local Chinese / English voices',
    '自定义本地语音服务': 'Custom local voice service', '声音': 'Voice', '本地语音服务地址': 'Local voice service URL', 'http://127.0.0.1:端口/v1/audio/speech': 'http://127.0.0.1:port/v1/audio/speech',
    '语音模型': 'Voice model', '服务中的模型名称': 'Model name in the service', '声音名称': 'Voice name', '服务中的声音名称': 'Voice name in the service',
    '连接已运行的本地语音服务。自定义声音由该服务提供。': 'Connect an existing local voice service. Custom voices are supplied by that service.', '自动朗读新回答': 'Speak new replies automatically',
    '语音输入模式': 'Voice input mode', '识别后直接发送': 'Send after transcription', '先检查文字再发送': 'Review transcript before sending', '试听声音': 'Preview voice', '保存声音设置': 'Save voice settings',
    '本地语音识别': 'Local speech recognition', '本地发声': 'Local speech synthesis', '本地数据': 'Local data', '对话、角色配置和用户画像保存在这台电脑。': 'Chats, character settings and your profile are stored on this computer.',
    '打开文件夹': 'Open folder', '私聊不会调用云端模型。你明确表达的个人资料和长期偏好，可按共享规则同步。': 'Private chats use local models. Explicit personal facts and lasting preferences may sync under your sharing rules.',
    '工作记录': 'Task history', '新任务': 'New task', '由 Hermes 执行任务，进度与结果留在这里。': 'Delegate tasks and review their progress and results.', '交给谁': 'Assign to', '刷新可用助手': 'Refresh available assistants',
    '使用技能': 'Use skill', '需要完成什么': 'Task', '描述任务、目标和需要使用的资料…': 'Describe the task, goal and relevant materials…',
    '只发送你在这里填写的任务和相关共享记忆；不会附带私聊记录。': 'Only this task and relevant shared memory are sent; private chats are excluded.', '开始任务': 'Start task', '停止任务': 'Stop task',
    '从 GitHub 导入技能文档，在交办任务时选择使用。': 'Import skills from GitHub and choose them when assigning tasks.', 'GitHub 仓库或技能目录链接': 'GitHub repository or skill directory URL', '导入技能': 'Import skills',
    '导入技能文档和资源，不会运行仓库中的安装脚本。实际工具调用由执行助手完成。': 'Imports skill instructions and resources without running repository installers. The assigned assistant uses the available tools.',
    '关闭技能预览': 'Close skill preview', '正在唤醒劳纶缇娜': 'Starting Laurentina', '准备本地对话与记忆…': 'Preparing local chat and memory…', '重新连接': 'Reconnect', '取消': 'Cancel', '确定': 'Confirm',
    '添加聊天模型': 'Add chat model', '关闭添加模型': 'Close model setup', '先选服务，我会带你完成配置。': 'Choose a provider to begin setup.', '本地 Qwen': 'Local Qwen', '本机运行 · 已安装模型': 'Local · Installed models',
    '部分模型提供有限免费额度': 'Limited free quota for some models', 'API 接入 · 按用量计费': 'API · Usage-based billing', '官方 API 接入': 'Official API', '豆包 / 火山方舟': 'Doubao / Volcengine Ark',
    'API 接入 · 试用以账户为准': 'API · Account-specific trial', '其他兼容服务': 'Other compatible service', '填写自己的服务地址': 'Enter your service URL', '裁剪聊天头像': 'Crop chat avatar', '取消头像裁剪': 'Cancel avatar crop',
    '拖动调整位置，缩放后确认；原图不受影响。': 'Drag and zoom, then confirm. The original image is preserved.', '头像裁剪预览，可用方向键移动': 'Avatar crop preview; use arrow keys to move', '缩放': 'Zoom', '使用这个头像': 'Use this avatar',
    '所有对话': 'All chats', '管理对话': 'Manage chat', '管理当前对话': 'Manage current chat', '管理项目': 'Manage project', '已置顶': 'Pinned', '最近': 'Recent', '项目中还没有对话': 'No chats in this project', '还没有对话': 'No chats yet',
    '取消置顶项目': 'Unpin project', '置顶项目': 'Pin project', '重命名项目': 'Rename project', '在项目中新建对话': 'New chat in project', '取消置顶': 'Unpin chat', '置顶对话': 'Pin chat', '移动到项目': 'Move to project', '不属于项目': 'No project',
    '重命名对话': 'Rename chat', '对话名称': 'Chat name', '删除对话': 'Delete chat', '删除这段对话？': 'Delete this chat?', '这段聊天记录将从本机移除。已整理的长期记忆可以在记忆页单独管理。': 'This chat will be removed from this computer. Long-term memories can be managed separately on the Memory page.',
    '请先停止这段对话的回答，再删除。': 'Stop the current reply before deleting this chat.', '对话已删除': 'Chat deleted', '还没有导入技能': 'No imported skills', '粘贴 GitHub 仓库或技能目录链接即可添加。': 'Paste a GitHub repository or skill directory URL to add skills.', '查看文档': 'View instructions',
    '正在导入技能…': 'Importing skills…', '已导入 {count} 个技能': 'Imported {count} skills', '还没有角色资源，先导入一个角色包或动态图片。': 'Import a character package or animated image to get started.',
    '当前角色': 'Current character', '使用角色': 'Use character', '自动选择待机': 'Choose idle automatically', '在桌面打开陪伴，即可播放当前角色。': 'Show the desktop companion to play the selected character.',
    '角色已选择，可在桌面打开陪伴查看。': 'Character selected. Show the desktop companion to view it.', '角色资源已导入。': 'Character imported.', '动画设置已保存': 'Animation settings saved', '请先导入并选择角色。': 'Import and select a character first.',
    '桌面陪伴设置已保存': 'Companion settings saved', '桌面立绘预览': 'Desktop illustration preview', '导入一张独立的桌面立绘': 'Import a separate desktop illustration', '请先导入桌面立绘。': 'Import a desktop illustration first.',
    '这段先留在本地 · 记忆待确认': 'Kept local · Memory unconfirmed', '发现一件秘密 · 要记住吗？': 'A private detail · Remember it?', '这件事先留在本地': 'This stays local for now', '要替你记住这个秘密吗？': 'Remember this privately?', '收起秘密提醒，继续聊天': 'Dismiss this reminder and keep chatting',
    '这段含有密码或密钥，不会写入记忆。可以去掉这些内容后再告诉我。': 'This contains a password or key and will not be saved as memory. Remove those details before trying again.',
    '内容有点长。可以用短一点的话告诉我想记住的事。': 'This is a little long. Shorten the detail you want remembered.', '你可以继续说，等有具体内容时再决定要不要记住。': 'Keep chatting; decide what to remember once you have shared a specific detail.',
    '保存上面的原文到私密记忆，仅在这台电脑留存。': 'Save the exact text above to private memory on this computer.', '重试保存': 'Retry save', '存为私密记忆': 'Save privately', '这次不保存': 'Do not save', '继续聊': 'Keep chatting',
    '这条已只存本地私密记忆；继续聊秘密请切到私聊。': 'Saved only to local private memory. Switch to Private to continue discussing secrets.', '这次不记住': 'Not saved as memory',
    '这次操作尚未确认，请重试。': 'This action was not confirmed. Please retry.', '关闭提示': 'Dismiss notice', '操作没有完成，请重试。': 'The action did not finish. Please retry.', '桌面连接尚未就绪，请重新打开劳纶缇娜。': 'The desktop connection is not ready. Reopen Laurentina.',
    '本地对话': 'Local chat', '你添加的': 'Added by you', '角色设置': 'Character settings', '你分享的': 'Shared by you', '个人资料': 'Personal facts', '长期偏好': 'Lasting preferences', '习惯': 'Habits', '目标': 'Goals',
    '已连接': 'Connected', '未连接': 'Disconnected', '未找到已安装的模型': 'No installed models found', '请先连接本地模型服务': 'Connect the local model service first', '未选择': 'Not selected', '本地模型未连接': 'Local model disconnected',
    '本地运行 · 记忆已连接': 'Running locally · Memory connected', '本地运行 · 记忆待连接': 'Running locally · Memory disconnected', '本地聊天 · 记忆已连接': 'Local chat · Memory connected', '本地聊天 · 记忆待连接': 'Local chat · Memory disconnected',
    '云端聊天 · 记忆已连接': 'Cloud chat · Memory connected', '云端聊天 · 记忆待连接': 'Cloud chat · Memory disconnected', '云端已选 · 尚未验证': 'Cloud selected · Not tested', '本地服务尚未连接': 'Local services disconnected',
    '当前为日常对话': 'Daily chat selected', '新建日常对话，当前私聊保持不变': 'Start a daily chat; keep this private chat', '当前为私聊': 'Private chat selected', '新建私聊，当前日常对话保持不变': 'Start a private chat; keep this daily chat',
    '私聊原文仅存本地 · 个人资料与长期偏好按共享规则同步': 'Private chat stays local · Personal facts follow sharing rules', '日常使用云端模型 · Enter 发送，Shift + Enter 换行': 'Cloud chat · Enter to send, Shift + Enter for a new line',
    '当前秘密与确认仅在本地处理；继续私密交流可切到私聊': 'This secret and consent stay local; switch to Private for ongoing private chat', '正在本地回复这条私密消息': 'Replying to this private message locally',
    '私聊原文仅存本地；明确的个人资料与长期偏好可按共享规则同步。': 'Private chat stays local; explicit personal facts and preferences follow sharing rules.', '在本地聊天，相关长期信息可加入共享记忆。': 'Chat locally; relevant lasting information may be added to shared memory.',
    '私密记忆仅供本地 Core 和私聊使用，其他助手无法读取。': 'Private memory is available only to local Core and private chat, not other assistants.', '已连接的助手可以读取共享记忆，包括你允许共享的个人资料与助手人设。': 'Connected assistants can read shared memory, including approved personal facts and assistant persona.',
    '复制回答': 'Copy reply', '已复制': 'Copied', '复制': 'Copy', '朗读回答': 'Read reply aloud', '回答已停止': 'Reply stopped', '回答没有完成': 'Reply incomplete', '仅存本地': 'Local only', '私密消息 · 仅在本地处理': 'Private message · Local processing only',
    '正在读取记忆…': 'Loading memories…', '正在搜索记忆…': 'Searching memories…', '没有找到相关记忆': 'No matching memories', '还没有私密记忆': 'No private memories yet', '还没有共享记忆': 'No shared memories yet', '重试': 'Retry',
    '记忆内容': 'Memory content', '写下希望她记住的事情。': 'Write what you would like remembered.', '保存记忆': 'Save memory', '删除记忆': 'Delete memory', '删除这条记忆？': 'Delete this memory?', '记忆已保存': 'Memory saved', '记忆已删除': 'Memory deleted',
    '正在整理用户画像…': 'Loading your profile…', '还没有关于你的资料': 'No profile details yet', '移除资料': 'Remove detail', '移除这条资料？': 'Remove this detail?', '资料已移除': 'Detail removed',
    '使用本机已安装的模型，无 API 调用费用。': 'Use an installed model locally, without API usage charges.', '填写本机已安装的 Ollama 模型名称。': 'Enter the name of an installed Ollama model.',
    '当前通过 API 接入，按 API 账户计费。ChatGPT 账号登录正在后续规划中。': 'Connect through the API, billed to your API account. ChatGPT account sign-in is planned.', '从官方控制台填写你有权限使用的模型 ID。': 'Enter a model ID available to your provider account.',
    '通过 DeepSeek API 接入，费用和余额以官方账户为准。': 'Connect to the DeepSeek API. Your official account determines billing and balance.', '填写官方控制台提供的模型 ID。': 'Enter the model ID from the official console.',
    '部分模型和地区有免费额度，并有用量限制；免费层内容可能用于改进产品。': 'Some models and regions offer limited free quotas. Free-tier content may be used to improve products.', '在 Google AI Studio 选择可用模型，再填写其模型 ID。': 'Choose an available model in Google AI Studio and enter its model ID.',
    '使用火山方舟 API；免费试用和后续费用以你的账户为准。': 'Uses the Volcengine Ark API; trial quota and billing depend on your account.', '填写火山方舟控制台中可调用的模型 ID 或推理接入点 ID。': 'Enter an available model or inference endpoint ID from the Ark console.',
    '连接提供 OpenAI 兼容接口的本地或云端服务。': 'Connect a local or cloud service with an OpenAI-compatible API.', '按服务商说明填写模型 ID。': 'Enter the model ID specified by the provider.', '自定义': 'Custom', '模型': 'Model', '未配置模型': 'Model not configured',
    '添加其他模型…': 'Add another model…', '添加模型…': 'Add model…', '私聊固定使用本地模型': 'Private chats always use a local model', '密钥已保存；留空即可保留。': 'Key saved; leave blank to keep it.', '尚未保存密钥。': 'No key saved yet.',
    '正在保存连接…': 'Saving connection…', '连接已保存': 'Connection saved', '正在验证连接…': 'Testing connection…', '连接验证通过': 'Connection verified', '请先保存连接，再进行测试。': 'Save the connection before testing it.',
    '日常聊天模型已切换': 'Daily chat model switched', '删除这个连接？': 'Delete this connection?', '删除后可重新添加。正在进行的回答不受影响。': 'You can add it again later. Running replies keep their original connection.', '连接已删除': 'Connection deleted', '请先保存修改，再选择这个连接。': 'Save your changes before selecting this connection.',
    '等待开始': 'Queued', '正在启动': 'Starting', '正在提交': 'Submitting', '正在停止': 'Stopping', '提交状态待核对': 'Submission needs checking', '正在工作': 'Running', '等待处理': 'Waiting', '等待你的决定': 'Needs your decision', '已完成': 'Completed', '执行失败': 'Failed', '已停止': 'Stopped', '已中断': 'Interrupted', '等待状态': 'Waiting for status',
    '助手': 'Assistant', '选择执行目标': 'Choose destination', '原任务目标暂时不可用，请重新选择': 'The previous destination is unavailable; choose another', '需要选择执行目标': 'Choose a destination', '发送任务': 'Send task', '刷新目标': 'Refresh destinations',
    '正在提交任务…': 'Submitting task…', '请先选择一个当前可用的执行目标。': 'Choose an available destination first.', '执行服务没有返回任务编号，请先检查连接状态。': 'The service did not return a task ID. Check the connection.', '请在原应用停止这项任务。': 'Stop this task in its original app.',
    '批准一次': 'Approve once', '仅此次允许': 'Allow once', '允许一次': 'Allow once', '拒绝': 'Deny', '允许本次会话': 'Allow for this session', '需要你的确认': 'Confirmation required', '这项操作需要你的确认': 'This action needs your confirmation',
    '正在保存角色与人设…': 'Saving character and persona…', '角色已保存，人设摘要已共享': 'Character saved; persona summary shared', '已恢复默认形象，保存后生效。': 'Default avatar restored. Save to apply.',
    '图片尺寸过大或无法打开，请换一张图片。': 'This image is too large or cannot be opened. Choose another image.', '图片已导入，动画会按原图播放；保存后生效。': 'Image imported with its original animation. Save to apply.', '头像已裁剪，保存角色后生效。': 'Avatar cropped. Save the character to apply.',
    '模型已保存，将用于接下来的回答。': 'Model saved for future replies.', '请先结束当前录音，再打开悬浮球。': 'Finish recording before opening the companion.',
    '录音已保留在输入框，请确认后发送。': 'Transcript kept in the composer. Review it before sending.', '录音已转为文字，可编辑后发送。': 'Transcript ready. Edit it before sending.',
    '正在录音，点击结束': 'Recording; click to finish', '结束录音': 'Finish recording', '正在识别录音…': 'Transcribing…', '正在准备麦克风…': 'Preparing microphone…', '正在准备声音…': 'Preparing voice…', '正在朗读…': 'Speaking…', '朗读已停止': 'Speech stopped',
    '语音设置已保存': 'Voice settings saved', '声音设置已保存': 'Voice settings saved', '正在保存声音设置…': 'Saving voice settings…', '请先停止录音。': 'Stop recording first.', '麦克风正在启动，请稍候。': 'The microphone is starting. Please wait.',
    '停止': 'Stop', '思考中': 'Thinking', '聆听中': 'Listening', '说话中': 'Speaking', '点击对话': 'Click to chat', '显示主窗口': 'Show main window', '隐藏陪伴': 'Hide companion', '发送': 'Send',
    '记忆已保存，聊天记录暂时无法刷新。': 'Memory saved; chat history could not refresh.', '已取消，聊天记录暂时无法刷新。': 'Cancelled; chat history could not refresh.', '交流语言': 'Language', '其他信息': 'Other information', '助手形象': 'Assistant avatar',
    '正在回答': 'Replying', '回答未完成': 'Reply incomplete', '仅本地': 'Local only', '已复制回答': 'Reply copied', '暂时无法复制，请选择文字后复制。': 'Could not copy. Select the text and copy it manually.', '朗读这条回答': 'Read this reply aloud',
    '请先选择当前可用的任务执行目标。': 'Choose an available task destination first.', '原对话的秘密确认未能取消，请返回原对话检查；内容仍留在本地。': 'The secret request in the original chat could not be cancelled. Return there to check; its content remains local.',
    '新的对话': 'New chat', '新的私聊': 'New private chat', '私密内容': 'Private content', '记忆仍在后台整理，可稍后到「关于你」查看。': 'Memory is still processing. Check About you later.', '正在整理值得记住的信息…': 'Organizing lasting information…',
    '回答没有完成，请检查本地模型后重试。': 'The reply did not finish. Check the local model and retry.', '部分记忆暂未同步，可到「关于你」查看。': 'Some memories have not synced. Check About you.', '连接暂时中断，正在尝试恢复。你可以停止本次回答。': 'Connection interrupted; trying to reconnect. You can stop this reply.',
    '重新读取': 'Reload', '这里还没有记忆': 'No memories here yet', '换一个关键词试试。': 'Try another search term.', '你可以手动添加，也可以在聊天中告诉她。': 'Add a memory manually or share something in chat.', '添加一条记忆': 'Add a memory',
    '这条信息会加入共享库，供已连接的助手读取。': 'This will be added to shared memory for connected assistants.', '这条信息仅保存在本地私密库。': 'This is saved only to local private memory.', '写下一条希望她记住的事实或偏好…': 'Write a fact or preference to remember…',
    '记忆尚未保存，请重试。': 'Memory was not saved. Retry.', '这会从共享记忆库移除该信息。': 'This removes the information from shared memory.', '这会从本地私密库移除该信息。': 'This removes the information from local private memory.',
    '正在读取关于你的信息…': 'Loading your profile…', '我们还在慢慢认识彼此': 'No profile details yet', '聊聊你的称呼、习惯和愿望，明确的信息会逐渐整理在这里。': 'Shared facts about your name, habits and goals will appear here.',
    '已同步': 'Synced', '已记录': 'Recorded', '待同步': 'Pending sync', '同步未完成': 'Sync incomplete', '你已确认': 'Confirmed by you', '移除这条个人信息': 'Remove this profile detail', '移除这条个人信息？': 'Remove this profile detail?',
    '她会停止使用这条画像信息，并尝试移除对应的长期记忆。': 'This profile detail will no longer be used. Its corresponding memory will also be removed if supported.', '移除未完成，请重试。': 'Removal did not finish. Retry.', '个人信息已移除': 'Profile detail removed',
    '秘密确认': 'Secret confirmation', '本地回答': 'Local reply', '+ 添加模型…': '+ Add model…', '待确认秘密及后续确认只在本地处理': 'Unconfirmed secrets and their consent are processed locally', '这条私密消息的回答正在本地生成': 'This private reply is being generated locally',
    '选择日常聊天模型；云端模型会收到日常聊天内容': 'Choose a daily model; cloud models receive daily chat content', '尚未设置模型': 'No model set', '日常使用中': 'Used for daily chat', '连接已验证': 'Connection verified', '已配置 · 待验证': 'Configured · Not tested', '尚未配置完成': 'Setup incomplete',
    '已有密钥保存在本机。留空可继续使用。': 'A key is saved locally. Leave blank to keep using it.', '私聊始终使用本地服务。': 'Private chats always use local services.', '密钥只保存在本机配置中。测试会发送简短请求，可能消耗服务商额度。': 'Keys are stored locally. Testing sends a short request and may use provider quota.',
    '下一步：填好配置，保存连接。': 'Next: complete the fields and save.', '已设为日常模型，可返回聊天。': 'Selected for daily chat. You can return to chat.', '连接已验证，点击「用于日常聊天」。': 'Connection verified. Click Use for daily chat.',
    '配置已保存，下一步测试连接。': 'Configuration saved. Test the connection next.', '配置已保存。请测试连接，再用于日常聊天。': 'Configuration saved. Test it before using it for daily chat.', '\n密钥输入已清空，需要时请重新填写。': '\nThe key input was cleared. Enter it again if needed.',
    '请先保存修改，再测试这个连接。': 'Save your changes before testing this connection.', '正在发送一条简短请求验证连接…': 'Sending a short request to test the connection…', '连接尚未验证通过。': 'Connection could not be verified.',
    '已用于接下来的日常聊天；私聊仍使用本地模型。': 'Selected for future daily chats. Private chats still use a local model.', '这个连接及其本机保存的密钥将被移除。': 'This connection and its locally saved key will be removed.', '图片无法打开，请换一张图片。': 'This image could not be opened. Choose another image.',
    '停止试听': 'Stop preview', '停止声音播放或准备': 'Stop speech playback or preparation', '试听已保存的声音': 'Preview the saved voice', '停止录音并识别': 'Finish recording and transcribe', '（代码内容请查看文字）': '(See the text for code)',
    '请先结束录音，再朗读回答。': 'Finish recording before playing a reply.', '准备朗读…': 'Preparing speech…', '语音服务没有返回可播放的声音。': 'The voice service did not return playable audio.', '声音播放失败，请检查输出设备。': 'Audio playback failed. Check your output device.',
    '声音暂时无法播放，请再点一次朗读。': 'Audio could not play. Click Read aloud again.', '当前窗口无法使用麦克风，请重新打开桌面应用。': 'This window cannot access the microphone. Reopen the desktop app.', '当前录音格式不受支持。': 'The recording format is not supported.',
    '录音中断，请检查麦克风后重试。': 'Recording interrupted. Check your microphone and retry.', '这段录音过大，请分段录音。': 'This recording is too large. Use shorter recordings.', '没有听清楚，请再说一次。': 'Speech was not recognized. Try again.', '正在录音 0:00': 'Recording 0:00',
    '麦克风权限未开启，请在系统设置中允许录音。': 'Microphone access is disabled. Allow recording in system settings.', '录音已转为文字，已放回原来的对话草稿。': 'The transcript was kept in the original chat draft.', '本地声音尚未就绪': 'Local voice is not ready', '已就绪 · 中文 / English': 'Ready · Chinese / English',
    '已配置 · 待试听': 'Configured · Preview needed', '已就绪': 'Ready', '自定义服务已配置，请试听确认连接与声音。': 'Custom service configured. Preview it to check the connection and voice.', '请先保存声音设置，再试听所选声音。': 'Save voice settings before previewing the selected voice.',
    '请选择目标对话': 'Choose a destination chat', '等待提交': 'Ready to submit', '正在取得执行回执': 'Getting execution receipt', '请选择真实的执行目标；只交接这条任务和共享信息。': 'Choose an available destination. Only this task and shared information are sent.',
    '选择这项任务的目标对话': 'Choose the destination chat for this task', '选择目标对话': 'Choose destination chat', '请先选择目标对话。': 'Choose a destination chat first.', '刷新可用任务目标': 'Refresh task destinations',
    '请在工作记录或原应用核对，应用不会自动重发这项任务。': 'Check task history or the original app. This task will not be resubmitted automatically.', '这一步需要你的决定': 'This step needs your decision', '请核对即将执行的操作。': 'Review the action before it runs.',
    '仅这一次': 'Just once', '本次会话允许': 'Allow for this session', '始终允许': 'Always allow', '在工作页查看': 'View in Work', '任务状态暂时无法刷新，可到工作页核对；任务不会重新提交。': 'Task status could not refresh. Check Work; the task will not be resubmitted.',
    '还没有任务。\n把第一件事交给她。': 'No tasks yet.', '正在刷新可用助手…': 'Refreshing available assistants…', 'Hermes 尚未连接。开始任务时会尝试连接本地执行服务。': 'Hermes is disconnected. Starting a task will try the local execution service.',
    'Hermes · 工作执行': 'Hermes · Task execution', ' 本地 Hermes 仍可使用。': ' Local Hermes remains available.', '外部对话已连接，可选择具体对话交接任务。': 'External chats connected. Select a specific chat to delegate work.',
    '当前没有可接续的外部对话。可先在 Codex 打开对话，再刷新这里。': 'No external chats are available. Open a chat in Codex, then refresh here.', '外部对话连接尚未确认，可刷新可用助手。': 'External chat connection is unconfirmed. Refresh available assistants.',
    '原来的助手暂时不可用，请重新选择执行目标。': 'The previous assistant is unavailable. Choose another destination.', '工作任务': 'Task', '提交状态无法确认，请在原应用核对；请勿重复提交相同任务。': 'Submission is unconfirmed. Check the original app before submitting again.',
    '这次任务没有返回文字结果。': 'This task returned no text result.', '任务已提交，正在等待实际执行结果…': 'Task submitted. Waiting for actual results…', '如需停止，请在原应用停止。': 'To stop, use the original app.', '请检查即将执行的操作。': 'Review the action before it runs.',
    '仅允许这一次': 'Allow just once', '未收到有效审批编号，请在原应用检查这一步。': 'No valid approval ID was received. Check this step in the original app.',
    '随时在这里': 'Ready when you are', '打开聊天，拖动可移动动态球': 'Open chat; drag to move the orb', '点击聊天，拖动移动': 'Click to chat; drag to move', '打开聊天，拖动可移动立绘': 'Open chat; drag to move the character',
    '打开主面板': 'Open main window', '隐藏悬浮球': 'Hide companion', '拖动移动': 'Drag to move', '主面板正在录音': 'Main window is recording', '正在朗读': 'Speaking', '正在想一想…': 'Thinking…',
    '录音已提交到主面板': 'Voice input sent to the main window', '已转为文字，请在主面板确认': 'Transcript ready for review in the main window', '角色无法加载，请检查资源包': 'Character could not load. Check the package.', '图片无法播放，请重新导入': 'Image could not play. Import it again.',
    '和{name}说些什么…': 'Message {name}…', '给{name}发消息': 'Message {name}', '本地模型：{model}': 'Local model: {model}', '已整理 {count} 条记忆': 'Organized {count} memories',
    '找到 {count} 条相关记忆': 'Found {count} matching memories', '{count} 条记忆': '{count} memories', '更新于 {date}': 'Updated {date}', '{name} · 接入指引': '{name} · Setup guide',
    '已导入 {filename}，保存后生效。': 'Imported {filename}. Save to apply.', '准备朗读 {part}…': 'Preparing speech {part}…', '正在朗读 {part}': 'Speaking {part}', '正在录音 {elapsed}': 'Recording {elapsed}',
    '录音已转为文字，已放入新的{mode}草稿。': 'The transcript was kept in a new {mode} draft.', '{target}（暂时不可用）': '{target} (unavailable)',
    'Hermes 已连接{details}。当前执行环境以实际配置为准。': 'Hermes connected{details}. Tools depend on the configured environment.',
    '暂时无法读取外部对话，请刷新重试。{note}': 'External chats could not load. Refresh and retry.{note}', 'Codex / ChatGPT 暂时断开。请回到 Codex 重新连接，再刷新这里。{note}': 'Codex / ChatGPT disconnected. Reconnect in Codex, then refresh here.{note}',
    '尚未连接 Codex / ChatGPT。{note}': 'Codex / ChatGPT is not connected.{note}', 'Codex / ChatGPT 的连接尚未确认，请刷新可用助手。{note}': 'Codex / ChatGPT connection is unconfirmed. Refresh available assistants.{note}',
  };
  const reverse = new Map();
  for (const [zh, en] of Object.entries(english)) if (!reverse.has(en)) reverse.set(en, zh);
  const templates = [];
  function templatePattern(value) {
    const names = [];
    const parts = value.split(/(\{[A-Za-z_]+\})/g).map((part) => {
      if (/^\{[A-Za-z_]+\}$/.test(part)) { names.push(part.slice(1, -1)); return '(.*?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    return { regex: new RegExp(`^${parts.join('')}$`, 's'), names };
  }
  for (const [zh, en] of Object.entries(english)) if (/\{[A-Za-z_]+\}/.test(zh)) templates.push({ source: zh, zh: templatePattern(zh), en: templatePattern(en) });
  let language = 'zh';
  const records = new WeakMap();
  const attributes = new WeakMap();
  const protectedSelector = '[data-user-content="true"],.message-body,.user-bubble,.secret-preview,.memory-content,.profile-content,.work-list-title,#work-run-title,#skill-preview-content,#skill-preview-title,.provider-card-model,.provider-card>strong,.conversation-user-title,.project-user-title,.skill-source,.inline-task-content,.work-approval pre';
  const protectedOptions = '#daily-provider option,#model-select option,#work-target option,#chat-work-target option,#tts-voice option';
  function recognize(value) {
    if (english[value]) return { source: value, variables: {} };
    if (reverse.has(value)) return { source: reverse.get(value), variables: {} };
    for (const template of templates) for (const pattern of [template.zh, template.en]) {
      const match = pattern.regex.exec(value); if (!match) continue;
      return { source: template.source, variables: Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]])) };
    }
    return null;
  }
  function translate(value, variables = {}) {
    const input = String(value ?? '');
    const recognized = recognize(input);
    const source = recognized?.source || input;
    let result = language === 'en' ? (english[source] || source) : source;
    for (const [key, text] of Object.entries({ ...recognized?.variables, ...variables })) result = result.replaceAll(`{${key}}`, String(text));
    return result;
  }
  function excluded(element) { return !element || Boolean(element.closest(protectedSelector)) || ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE'].includes(element.tagName); }
  function translateNode(node) {
    const parent = node.parentElement;
    if (excluded(parent) || parent.closest(protectedOptions)) return;
    const current = node.nodeValue;
    let record = records.get(node);
    if (!record || current !== record.last) {
      const recognized = recognize(current.trim()); if (!recognized) return;
      record = { ...recognized, padding: [current.match(/^\s*/)[0], current.match(/\s*$/)[0]], last: current };
    }
    const next = record.padding[0] + translate(record.source, record.variables) + record.padding[1];
    record.last = next; records.set(node, record);
    if (current !== next) node.nodeValue = next;
  }
  function translateAttributes(element) {
    if (element.closest(protectedSelector)) return;
    let map = attributes.get(element); if (!map) { map = {}; attributes.set(element, map); }
    for (const key of ['placeholder', 'title', 'aria-label']) {
      const current = element.getAttribute(key); if (!current) continue;
      let record = map[key];
      if (!record || current !== record.last) { const recognized = recognize(current); if (!recognized) continue; record = { ...recognized, last: current }; }
      const next = translate(record.source, record.variables); record.last = next; map[key] = record;
      if (current !== next) element.setAttribute(key, next);
    }
  }
  function apply(root = document.body) {
    if (root.nodeType === Node.TEXT_NODE) { translateNode(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) translateNode(node); else translateAttributes(node);
    }
  }
  function setLanguage(value) {
    language = value === 'en' ? 'en' : 'zh';
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    apply();
  }
  let observer;
  function start(root = document.body) {
    observer?.disconnect(); apply(root);
    observer = new MutationObserver((changes) => {
      const roots = new Set();
      for (const change of changes) {
        if (change.type === 'characterData') roots.add(change.target);
        else if (change.type === 'attributes') roots.add(change.target);
        else for (const child of change.addedNodes) roots.add(child);
      }
      for (const node of roots) apply(node);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
  }
  window.I18n = Object.freeze({ translate, setLanguage, start, apply, get language() { return language; }, dictionary: Object.freeze(english) });
  window.tr = translate;
})();
