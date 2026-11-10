# 验证记录

日期：2026-11-10。

## 兼容基线

- macOS、Node.js 24.1.0、npm 11.4.2。
- `@getpaseo/plugin` / client / protocol：0.15.4，版本锁定在 package-lock.json。
- 宿主兼容范围 `>=0.14.0 <0.16.0`；额外使用本机 0.14.0 CLI 在独立临时 home 完成安装、回读及重载，全部为 running，不需要升级用户现有版本。
- 使用实际发布包的 `on` / `before`、RPC、timeline transformer/renderer、screen 与 slash command。
- 官网 main 文档中的原生 composer 草稿接口、插件订阅尚未进入该发布包。本版改用独立翻译面板及每 Agent 共享的版本化查询，不导入宿主私有模块。

## 自动化验证

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 服务端、客户端两份严格 TypeScript 配置通过；客户端不引入 DOM 或 Node 全局类型 |
| `npm ci --no-audit --no-fund` | 依据锁文件完成干净安装 |
| `npm test` | 53 项通过，0 失败 |
| `npm run test:coverage` | 核心逻辑行覆盖率 97.30%，分支 89.43% |
| `openspec validate initial-plugin --strict` | 通过 |
| `git diff --check` | 通过 |
| `npm pack --dry-run` | 客户端、服务端、shared、manifest、README 与 LICENSE 均在包中 |

覆盖率统计范围为 `server/`、`shared/` 和输入状态机 `client/draft.ts`；不代表全部 React UI 的覆盖率。

测试覆盖真实本地 HTTP 服务、临时假 CLI、进程树取消、队列与资源限额、占位符完整性、Unicode 路径、代码块、轮次归属、历史恢复排除、关闭/设置变更竞态，以及实际 React 渲染时的缓存隔离。正式验证使用假后端。开发一次回归用例曾误用 Codex 默认后端，已纠正为独立假后端；该次运行不作为测试或验收依据。

## 实际 Paseo 宿主验证

分别使用 Paseo 0.14.0 与 0.15.4 CLI 运行：

```bash
PASEO_CLI=/absolute/path/to/paseo-0.15.4 node scripts/verify-paseo.mjs
```

脚本使用独立临时 home、独立回环端口，关闭 relay、web UI、语音和服务代理，隔离 Codex/Claude 配置目录。验证结果：

- 官方宿主编译器成功编译客户端与服务端 bundle。
- 将源码复制到无 node_modules 的独立临时目录后，两个 bundle 仍能通过宿主编译，验证 Git 安装不依赖开发环境中的包。
- 安装到临时 daemon 后，插件为 `running`。
- `plugin ls` 回读为 `running`。
- `plugin reload` 后仍为 `running`。
- 停止自己的临时 daemon 并清理临时 home，未改用户正在运行的 Paseo 或原 Claude Code 插件。

## 审查

独立规格与 TypeScript 代码质量审查完成，发现的问题均按失败测试 → 修复 → 通过测试处理，复审通过。详细记录见 [review-01.md](review-01.md)。降低 manifest 最低版本前，先在无 node_modules 的源码副本和实际 0.14.0 宿主完成隔离验证，生产逻辑未更改。

## 验证边界

- 未在用户真实 Paseo 会话中执行安装、发送消息或更换配置。
- 未进行手机端人工界面验收，未以真实模型的响应质量作为通过标准。
- Windows 进程树清理分支仅静态审查；本机实际进程取消验证为 POSIX/macOS。Windows 正常退出后的孤儿进程无法由 Node 核心 API 可靠追踪，当前不承诺该分支的完整进程回收。
- 尚无原生队列观察接口，多个排队追问不保证只翻译一次；具体语义见 README。
