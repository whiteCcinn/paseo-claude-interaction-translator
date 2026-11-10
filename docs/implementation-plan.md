# Paseo 交互翻译插件实现计划

目标：实现已确认的手动输入翻译、自动最终答复翻译，并推送指定仓库。

架构：`shared/` 定义 RPC、设置、消息身份和文本保护；`server/` 负责翻译后端与按 Agent 隔离的轮次状态；`client/` 负责独立翻译面板、设置与纯展示翻译。使用原生事件，不以超时推测任务结束。已发布 SDK 缺少原生草稿接口及插件订阅，使用 Command Center、slash command 与共享的按 Agent 版本化 RPC 查询。

技术栈：TypeScript、React Native、Paseo SDK 0.15.4、Zod、Node test runner。

- [x] 建立共享契约并安装匹配 SDK。使用 `npm run typecheck` 验证。
- [x] 后端先写测试：本地 HTTP 服务验证请求和异常；假 CLI 验证参数、stdin、超时和输出限制。观察失败后实现。
- [x] 状态机先写测试：多个回复只选最后一个、重复事件去重、取消/子代理/旧轮次丢弃、缓存限额、分页身份。观察失败后实现。
- [x] 草稿操作先写测试：成功替换、翻译中编辑或发送后不覆盖、失败保留原文；随后接入已发布接口的独立翻译面板。
- [x] 接入服务端生命周期、客户端 RPC 和设置；测试真实入口注册以及无 canonical 写入。
- [x] 在临时 PASEO_HOME 加载插件，使用假翻译服务进行集成验证，不改运行中的用户 daemon。
- [x] 按规格、正确性和安全性分别审查；运行 `npm test`、`npm run typecheck`、`openspec validate initial-plugin --strict`、`git diff --check`。
- [x] 写中文 README，提交到 main 并推送；核对远端 SHA。
