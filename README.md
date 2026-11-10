# Paseo Claude Interaction Translator

Paseo 交互翻译插件：输入先点击「翻译输入」，确认英文草稿后发送；本轮正常结束后，自动翻译最后一条助手答复。译文只用于界面显示，模型上下文保留原文。

由 [whiteCcinn](https://github.com/whiteCcinn) 维护。翻译后端可选本地 Codex CLI 或 OpenAI 兼容 API。

## 环境要求

- Paseo daemon 与客户端均需 **0.14.0 或更高的兼容版本**，当前声明范围为 `>=0.14.0 <0.16.0`。已在 0.14.0 和 0.15.4 的隔离 daemon 验证安装及重载。
- 默认使用 Codex CLI：在 **daemon 所在机器** 安装并登录 Codex，确保 `codex login status` 成功。
- 使用 API 时，在 daemon 的启动环境中配置翻译服务 Key。

## 安装

在连接目标 daemon 的终端执行：

```bash
paseo plugin install https://github.com/whiteCcinn/paseo-claude-interaction-translator.git
paseo plugin ls
```

在 Paseo 的 Settings → Plugins 打开总开关及本插件开关，再打开本插件的设置。默认后端为 Codex CLI；可执行文件不在 daemon 的 `PATH` 中时，填写其绝对路径。手机只负责操作界面，翻译在连接的 daemon 上执行。

已有会话未显示命令时，重新打开会话或重新连接客户端。插件与客户端版本不兼容时，先更新对应的 Paseo。

## 输入翻译

在目标 Agent 会话中输入：

```text
/translate 请帮我检查这个项目的错误处理
```

也可以输入 `/translate` 打开空面板，或在 Command Center 搜索「翻译输入」。然后：

1. 在翻译面板输入或修改中文。
2. 点击「翻译输入」，检查展示的译文。
3. 点击「确认发送译文」，或复制译文到原生输入框后发送。

翻译动作本身不会发送消息；修改原文会使旧译文失效。默认在发送正文末尾附加回复语言要求，使 Agent 用英文回复，可在设置中关闭。发送失败时保留译文；重试使用同一个消息 ID。

**当前版本使用独立翻译面板。** 已发布的 SDK 尚未提供官网 `main` 分支文档中的 `useComposer` / `setPrompt`，因此插件不会读取或改写原生输入框，也不会自动拦截普通 Enter。`/translate` 是客户端命令，带附件时 Paseo 不执行此命令；本面板仅发送文字，附件请使用原生输入框。

确认发送使用 Paseo SDK 的 `steer` 行为；运行中的处理方式由 Provider 决定，不支持 steering 的 Provider 可能回退为中断。需要避免影响当前任务时，请等本轮结束后发送。

## 输出翻译

```text
Agent 输出原文 → 本轮正常结束 → 翻译最后一条答复 → 界面显示译文
```

- 过程回复、工具结果、思考内容和选择面板保持原样。
- 仅翻译插件启动后观察到的、具有明确轮次和消息 ID 的主 Agent 答复。
- 中断、错误、子 Agent、恢复的历史不会触发自动翻译。
- 译文旁可点击「查看原文」；失败时保留原文，可点击「重试翻译」。
- 新一轮开始或会话关闭会撤销未完成的自动翻译，过期结果不会替换正文。
- 原始回复与模型上下文保持原样；插件不向 Agent 发送译文，不修改 canonical 消息。

这里的「最后一条」是**每个正常完成轮次的最后一条助手答复**，整条翻译。Paseo 客户端的待发送队列没有公开插件观察接口，因此不承诺多个排队追问只产生一次最终翻译。已经启动的翻译可能产生后端用量；这与原 Claude Code 插件的严格队列语义不同。

状态同步只读取内存中的翻译结果，滚动和恢复历史不会重新调用翻译后端。最多保留 128 条、合计 2 MiB 的输出记录；缓存回收或插件重载后显示原文。输入面板最多保留 16 个会话的临时草稿。搜索仍以 Paseo 原文索引为准。

## 翻译设置

在 Settings → Plugins → Claude 交互翻译 → 设置中修改，点击「保存」。多设备修改发生冲突时，重新打开设置页后再编辑。

| 设置 | 默认值 |
| --- | --- |
| 翻译后端 | Codex CLI |
| 输入译文语言 | 英文 |
| 答复显示语言 | 简体中文 |
| 请求 Agent 使用输入译文语言回复 | 开启 |
| 自动翻译最终答复 | 开启 |
| Codex 可执行文件 | `codex` |
| Codex 模型、推理等级 | 跟随本地配置 |

支持英文、简体中文、日文、法文。配置只作用于翻译后端，不改变主 Agent 的模型。

### Codex CLI

复用 daemon 所在机器的 Codex 登录与服务配置。每次翻译使用独立临时会话、只读沙箱；项目文档和 shell 工具关闭。CLI 仍需访问模型服务，不是离线推理。失败不会自动改用 API。

### 兼容 API

选择 `api`，填写完整 `chat/completions` URL、模型 ID 和 **API Key 环境变量名**。默认变量名为 `TRANSLATOR_API_KEY`。Key 不进入插件设置、客户端或仓库。

例如在启动 daemon 的同一个终端设置变量（将示例值替换为自己的 Key）：

```bash
export TRANSLATOR_API_KEY='your-api-key'
paseo daemon start
```

已经运行的 daemon 不会自动获得新 shell 的环境变量。使用桌面应用或系统服务启动时，需在对应启动环境配置；不要把真实 Key 写入本仓库。API 需返回 `choices[0].message.content`；错误、截断、占位符不完整时保留原文。

翻译请求最多运行 120 秒，最多同时运行 2 个请求，额外排队最多 16 个；超出容量明确报错。代码块、行内代码、路径和 URL 使用占位符保护；不完整或不安全的翻译不会替换正文。

## 本地开发与验证

```bash
npm ci
npm run typecheck
npm test
npm run test:coverage
openspec validate initial-plugin --strict
paseo plugin install "$PWD"
```

修改后检查并重载：

```bash
npm run check
paseo plugin reload paseo-claude-interaction-translator
paseo plugin logs paseo-claude-interaction-translator
```

隔离验证会创建临时 daemon home、禁用 relay，并在结束后清理自己的进程与目录：

```bash
PASEO_CLI=/absolute/path/to/paseo node scripts/verify-paseo.mjs
```

测试使用本地假 API 和临时假 CLI，不调用真实模型。实现规格、验证证据及限制见 [OpenSpec](openspec/changes/initial-plugin/) 与 [验证记录](docs/verification.md)。

## 卸载

```bash
paseo plugin remove paseo-claude-interaction-translator
```

## 许可证与来源

[MIT](LICENSE)。文本保护机制参考 [Claude Interaction Translator](https://github.com/whiteCcinn/claude-interaction-translator)，保留原许可证署名。Paseo 的宿主相关逻辑为本项目独立实现。
