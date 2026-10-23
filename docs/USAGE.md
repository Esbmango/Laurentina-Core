# 使用指南 / Usage

## 聊天与记忆

「新对话」创建会话；Enter发送、Shift+Enter换行。日常 / 私聊在当前会话中切换，有私聊内容的会话会标记。切换仅影响后续消息，两种模式的草稿分别保留。

日常可以选择已配置的本地或云端模型；私聊固定走本地模型。添加模型后先保存并测试，再选择为日常模型。网页聊天订阅与模型API是不同入口，费用和可用模型由服务商决定。

提到“这是秘密”“只存私密”等内容时，该段先按本地内容处理，助手可以继续正常交流，旁边显示独立确认框。查看预览，再选择「存为私密记忆」或「这次不保存」。关闭弹框不会删除本地聊天；只有成功回执代表长期记忆写入完成。继续聊私密内容时请选择私聊。

「记忆」包含共享、私密、关于你三个页签，可搜索、添加、更正或删除相应内容。获准共享的明确个人资料和长期偏好可形成用户画像；秘密原文不会自动变成共享事实。同步失败或删除失败都不代表已完成，须查看结果。共享范围不等同于ChatGPT自带保存记忆。

## 项目、主题与语言

侧栏项目旁的加号创建项目，菜单可重命名、置顶或新建对话。对话菜单可置顶或移动到项目。「所有对话」返回完整列表。侧栏底部切换明暗主题与中文 / English，重启后保留。界面语言不会翻译已有聊天、记忆、项目名称和技能文档。

## 角色形象与声音

在「角色形象与声音」编辑或导入UTF-8 TXT/Markdown人设，头像上传后可拖动缩放裁剪。保存角色后，原始人设留在本地，人设摘要按当前记忆配置同步。聊天头像、桌宠形象和正式应用L标志分别设置。

桌面陪伴可用动态球、透明立绘 / 动图或角色资源库。单击触碰回应，双击打开面板，拖动移动位置。整体大小和角色人物缩放分别设置；最大800%，超过显示器可用大小后会裁切部分画面，按钮保持可见。透明区域可点击后面的窗口。

角色库支持图片、WebM，以及完整Live2D / Spine ZIP；骨骼播放器须先按安装指南准备。选择已有待机、说话、思考和触摸动作；未指定触摸动作的旧Spine角色可自动匹配 `Interact`。静态图片不会凭空生成骨骼动画。可删除角色；文件先放到本机角色回收区，原始上传ZIP不变。

「触碰回应」可导入准备好的短录音，也可只填台词。录音直接播放，不需模型合成；台词走当前TTS。可试听、删除和关闭。单次触摸动作播放完整一遍后回到待机，短台词结束不会把动作截断；连续单击可切到下一条回应，并避免连续重复同一句。真实回答、录音、思考和工作状态优先于触碰；隐藏或关闭桌宠、切换或删除角色会取消当前触碰。

## 语音

麦克风按钮开始 / 结束录音；默认识别后直接发送，也可改为先检查文字。冲突草稿、切换会话或模式、正在派活时不会强行覆盖或发送。耳机按钮开启连续语音，须在实际设备上检查麦克风和回声效果。

自动朗读默认开启，可以关闭并保存，或使用输入框旁声音按钮快速切换。停止会取消当前准备与播放。单条消息仍可手动朗读。Emoji、代码块和链接仅在朗读副本整理，不改聊天原文。

自定义声线导入清晰的单人参考录音，并填写录音中准确说出的原文。日语录音应配日语逐字稿；**「输出文字发音语言」指要读出的文字语言**，参考是日语时也可用「自动」读中文、英文。

默认使用完整参考方式；跨语言效果不理想时可以试「仅保留音色」。它减少参考逐字稿的影响，可能损失部分音色与语气信息，不能保证更好。保存后分别试听目标语言。内置固定语种Piper声音不会因语言选项变成多语种模型。

桌宠语音输入后打开面板默认关闭，可在声音设置中修改；关闭时问答可以留在桌面，双击仍会打开面板。自动朗读开关仍生效。

## 运行资源

「设置 → 运行资源」可查看RAM / 显存，选择平衡或节省内存。平衡模式允许逐句朗读；节省内存模式下，本地文字回复先完成再开始自动朗读，避免本地聊天与TTS同时生成。云端回复不受这条本地限制。

节省内存会更早释放闲置的语音资源；下一次冷启动可能更慢。后台个人资料整理也会等待语音空闲，不应把等待状态当作已保存。程序不会擅自关闭其他应用或将私聊改用云端。合成持续慢于实时、系统分页和参考声线质量问题不能靠播放器缓冲完全解决。

## 工作与技能

在日常聊天明确交办，或打开「工作」选择执行者和任务。可用目标来自真实已连接接口；指定外部对话时选实际ID。提交回执不等于任务完成，任务完成也不等于成果正确。私聊和待确认秘密不能直接派活；应单独编写可共享指令。

成果核验可指定已有目录、预期文件与支持的数据断言。核验只检查配置要求，失败不会重新投递原任务，也不执行生成文件。停止外部任务的能力由执行者决定；无法停止时应去原应用处理。

「技能」可以导入含 `SKILL.md` 的公开GitHub仓库或目录。导入保存文档和资源，不运行安装脚本。在本次交办中明确选择技能；实际工具、依赖和执行权限来自所选工作助手。

## English summary

- New chat creates a conversation; Daily/Private changes the current conversation's mode. Private messages stay local and are excluded from public/cloud context.
- Memory has Shared, Private and About you tabs. Secret-memory confirmation is separate from conversation, and successful receipts matter.
- Projects, pins, theme and UI language are saved locally. Changing UI language does not rewrite your content.
- Character visuals and voices are grouped together. Single-click the companion for touch responses, double-click for the main panel, and drag to move.
- Touch animations finish one full cycle even if short audio ends first. Repeated clicks advance replies; real answers and active recording/thinking/work retain priority. Hiding the companion or changing characters cancels the touch.
- Output pronunciation language describes the text being spoken, not the language of the reference recording. Keep the reference transcript exact; try speaker-only conditioning as an optional comparison.
- Auto-read can be disabled. Low-memory mode waits for local text generation before auto-reading and delays background profile extraction until voice is idle; cold loading can still be slower.
- Explicit work handoff uses a connected executor. Skill import does not run code. Execution completion and artifact validation are separate states.
