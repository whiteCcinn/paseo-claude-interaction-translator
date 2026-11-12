# Claude 交互翻译

先翻译输入并确认后发送给编程 Agent；主 Agent 的一轮任务正常结束后，自动翻译最后一条助手答复。支持英文、简体中文、日文和法文。

在 Agent 会话输入 `/translate [待翻译文字]`，或在 Command Center 打开「翻译输入」。面板将翻译与发送分开：检查译文，再明确选择发送或复制。插件不拦截原生输入框，也不包含原生输入框中的附件。

## 文本会发送到哪里

每一条你主动选择翻译的草稿，以及开启自动最终答复翻译后、每个正常完成的主 Agent 轮次的最后一条助手答复，都会发送到你选择的翻译后端：

- **本地 Codex CLI（默认）：** 插件把文本交给 daemon 所在机器上配置的 Codex 可执行文件。Codex 使用自己配置的模型服务和凭据。本地运行 CLI 不代表文本留在本机，也不代表离线处理。
- **OpenAI 兼容 API：** 插件把文本发送到设置中的 API URL。默认地址是 `https://open.bigmodel.cn/api/coding/paas/v4/chat/completions`。API Key 从设置指定的 daemon 环境变量读取，默认变量名为 `TRANSLATOR_API_KEY`。

回复译文只改变界面显示，Agent 的原始回复和模型历史保持原样。可以切换查看原文，翻译失败时继续显示原文。过程回复、工具、思考、权限面板和恢复的历史不会触发自动翻译。

## 配置与限制

需要 Paseo `>=0.14.0 <0.16.0`。使用默认后端时，在 daemon 所在机器安装并登录 Codex；如果可执行文件不在 daemon 的 `PATH` 中，在设置里填写路径。使用 API 时，配置完整 chat-completions URL、模型 ID 和 Key 的环境变量名。可以选择翻译后端、输入和输出语言，以及是否自动翻译最终答复。

已在 macOS 的 Paseo 0.14.0 和 0.15.4 上验证 daemon 侧运行；Windows 进程回收尚未完整验证。每个正常完成的轮次都可能触发自己的最终答复翻译，多个排队追问不保证只产生一次翻译。译文和面板草稿保存在有容量限制的内存缓存中，可能因回收或插件重载而消失。

配置步骤和运行限制见 [README](https://github.com/whiteCcinn/paseo-claude-interaction-translator#readme)。
