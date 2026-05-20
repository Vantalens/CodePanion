# 能力证据矩阵（L1 / L2 / L3 / L4）

每个接入路径都按 [监控源能力分层](MONITORING_SOURCES.md#能力分层) 划分能力，本表把当前可验证的依据全部列出来：代码位置、自动化测试用例、限制与未验证项。

> **范围说明**：本矩阵描述的是「daemon 端 + 客户端契约层」的能力证据，自动化测试可覆盖。**真机端到端的样本采集与截图验收**（在真实 Claude / Codex 客户端中跑闭环）归入 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) P1.2 的「真实运行数据截图视觉验收」与 P1.0 的「Alpha 首批入口完成查看 → 判断 → 回复最小闭环」，并由作者本机分批补足。
>
> **本矩阵不是 SLA**：能力声明严格等于「当前代码 + 当前测试可证伪」，不含意图、不含规划。

## 路径 A：CLI/PTY 包装

适用：Claude Code、Codex CLI、任何带交互 prompt 的本地 CLI。

| 能力 | 证据 | 备注 |
| --- | --- | --- |
| L1 来源识别 | [packages/daemon/src/daemon/sessionManager.ts](../packages/daemon/src/daemon/sessionManager.ts) 创建 session 时分配 id；GUI source rail 展示。 | source kind = `cli`。 |
| L2 状态识别 | PromptDetector 命中 yes/no / 编号选项 / 静默；测试覆盖：[packages/daemon/test/promptDetector.test.mjs:9](../packages/daemon/test/promptDetector.test.mjs#L9) 与 `:24`；进入 `waiting` 状态。 | `done` / `error` 由退出码触发，覆盖在 server.integration.test.mjs 的 session 生命周期用例。 |
| L3 回复链路 | `POST /sessions/:id/reply` → PTY 写回 stdin；测试覆盖：[packages/daemon/test/server.integration.test.mjs:410](../packages/daemon/test/server.integration.test.mjs#L410) 「WebSocket observer receives workflow events and CLI socket receives injected input」与 `:444` 「multiple CLI sessions run in parallel without cross-talk」。 | 多 session 同时 waiting 的不污染：[`:759`](../packages/daemon/test/server.integration.test.mjs#L759)「各自保留 lastPrompt 且互不污染」。 |
| L4 工作流编排 | 暂未声明 L4。 | 阶段 2 范围。 |

## 路径 B：Codex Desktop 本地 jsonl 同步

适用：Codex Desktop 的对话同步（只读）。

| 能力 | 证据 | 备注 |
| --- | --- | --- |
| L1 来源识别 | jsonl 文件 → thread；测试覆盖：[packages/daemon/test/codexDesktopAdapter.test.mjs:106](../packages/daemon/test/codexDesktopAdapter.test.mjs#L106) 「session_meta creates a thread with workspace and fresh status」。 | source kind = `codex-desktop`。 |
| L2 状态识别 | task_started / task_complete → workflow status：[`:169`](../packages/daemon/test/codexDesktopAdapter.test.mjs#L169) 「event_msg.task_started + task_complete map to status items」；标题升级：[`:305`](../packages/daemon/test/codexDesktopAdapter.test.mjs#L305) 「first user_message upgrades a degraded title」；陈年会话标 done：[`:126`](../packages/daemon/test/codexDesktopAdapter.test.mjs#L126) 「stale session_meta yields thread with status=done」。 | 工具调用、命令输出、代码块同步覆盖在同文件其他用例。 |
| L3 回复链路 | **不支持**。CodePanion 只读 jsonl，不向 Codex Desktop 写回。 | 见 [INTEGRATIONS_CODEX.md](INTEGRATIONS_CODEX.md) 路径 B 的限制段。 |

## 路径 C：VS Code 扩展

适用：VS Code 内任何窗口 / 终端 / 任务 / 调试会话。

| 能力 | 证据 | 备注 |
| --- | --- | --- |
| L1 来源识别 | 扩展 `activate()` 调 `/sources/register`：[packages/vscode-extension/extension.js:75](../packages/vscode-extension/extension.js#L75)；测试覆盖：[server.integration.test.mjs:568](../packages/daemon/test/server.integration.test.mjs#L568) 「VS Code 来源注册后事件链路完整可追溯」。 | source kind = `vscode`，每个窗口独立 source。 |
| L2 状态识别 | 任务启动 / 完成 / 失败、终端打开 / 关闭、调试会话起止；测试覆盖：[server.integration.test.mjs:628](../packages/daemon/test/server.integration.test.mjs#L628) 「VS Code 来源的 done / error 事件映射为 workflow status item」。 | 全部使用 VS Code 公开 API（[`extension.js`](../packages/vscode-extension/extension.js) 的 activate）。 |
| L3 回复链路 | **不支持**。VS Code 扩展不接管终端 PTY；想 L3 必须改走路径 A 或 D。 | 见 [INTEGRATIONS_CLAUDE_CODE.md](INTEGRATIONS_CLAUDE_CODE.md) / [INTEGRATIONS_CODEX.md](INTEGRATIONS_CODEX.md) 路径 C。 |

## 路径 D：CC Switch

适用：账号 / provider 切换。

| 能力 | 证据 | 备注 |
| --- | --- | --- |
| L1 来源识别 | 进程级识别：[packages/daemon/src/adapters/aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts) 的 `cc-switch` profile；测试覆盖：[aiToolProcessAdapter.test.mjs:5](../packages/daemon/test/aiToolProcessAdapter.test.mjs#L5) 与 `:18`、`:28`、`:39`。 | source kind = `cc-switch`，tier = `switcher`。 |
| L2 切换事件 | 当前仅靠进程出现 / 消失推断；未接公开 CLI / 事件 API。 | 计划：未来 CC Switch 暴露公开事件后通过 `/events` 上报当前 profile。 |
| L3 回复链路 | **不适用**。CC Switch 本身不接受 AI 回复，配合路径 A 使用。 | 见 [MONITORING_SOURCES.md](MONITORING_SOURCES.md#cc-switch-兼容策略)。 |

## 路径 E：外部适配器 `/sources/register` + `/events`

适用：任何本地工具想接入 CodePanion 控制台。

| 能力 | 证据 | 备注 |
| --- | --- | --- |
| L1 来源识别 | `POST /sources/register`：[server.integration.test.mjs:296](../packages/daemon/test/server.integration.test.mjs#L296) 「`/sources/register` rejects invalid payloads」、[`:309`](../packages/daemon/test/server.integration.test.mjs#L309) 「`/sources/:id/disconnect` marks a source offline and broadcasts it」。 | source kind 可任意，常用 `external`。 |
| L2 状态识别 | `POST /events` 接受 `prompt` / `done` / `error` / `activity` / `notification`：[server.integration.test.mjs:341](../packages/daemon/test/server.integration.test.mjs#L341) 「`/events` rejects invalid payloads」、`:628` 复用同链路。 | 调用方需要 daemon token。 |
| L3 回复链路 | `POST /events/:id/reply` 已经支持回复回写到事件触发的适配器；测试覆盖：[server.integration.test.mjs:351](../packages/daemon/test/server.integration.test.mjs#L351) 「`/events/:id/reply` rejects invalid payloads」（payload 校验路径），实际回流由调用方实现。 | SDK 草案在 backlog（[DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) 阶段 2 B2）。 |

## 国产 AI 工具进程级识别

仅 L1 进程识别；首批 / 观察 / 切换器分档见 [MONITORING_SOURCES.md](MONITORING_SOURCES.md#国产-ai-工具覆盖策略)。

| 能力 | 证据 |
| --- | --- |
| L1 来源识别（首批 5 项） | TOOL_PROFILES 显式标注；测试覆盖：[aiToolProcessAdapter.test.mjs:53](../packages/daemon/test/aiToolProcessAdapter.test.mjs#L53) 「tier 收敛与 MONITORING_SOURCES.md 一致」。 |
| L2 / L3 | 暂无；通过 CLI 包装（路径 A）或外部适配器（路径 E）才能提升。 |

## 全链路横向证据

| 维度 | 证据 |
| --- | --- |
| WebSocket 鉴权 | subprotocol token 校验：[server.integration.test.mjs:503](../packages/daemon/test/server.integration.test.mjs#L503)–`:556` 共 6 个用例（缺 token / 错 token / 旧 query 鉴权 / 错 Origin / 缺 sessionId / WebView2 虚拟 host）。 |
| HTTP 鉴权与负输入 | 全部业务路由都有 `rejects invalid payloads` 用例（line 260–398 区间），HTTP API 主链路覆盖：[`:197`](../packages/daemon/test/server.integration.test.mjs#L197) 「HTTP API requires auth and covers session lifecycle」。 |
| 中文不乱码（链路层） | [`:696`](../packages/daemon/test/server.integration.test.mjs#L696) 「中文文本在 HTTP 与 WebSocket 链路上全程不乱码」。 |
| 断线恢复 | [`:813`](../packages/daemon/test/server.integration.test.mjs#L813) 「observer 短暂中断后重连可从 workflow-snapshot 拿到断线期间的事件」；[`:911`](../packages/daemon/test/server.integration.test.mjs#L911) 「daemon 重启后 workflow snapshot 恢复并通过 WS 推送给重连的 GUI」。 |
| C# DTO 漂移检测 | [generateCsharpDtos.test.mjs:23](../packages/daemon/test/generateCsharpDtos.test.mjs#L23)–`:55`（match / drift / CRLF / LF-only 四个用例）。 |
| 配置文件 owner-only | [configPermissions.test.mjs:12](../packages/daemon/test/configPermissions.test.mjs#L12)–`:60`（POSIX 0o600、Windows ACL 剥离 BUILTIN\\Users、跨平台可读）。 |
| 日志脱敏 | [logger.test.mjs:29](../packages/daemon/test/logger.test.mjs#L29)–`:128`（homedir、Bearer、query token、长 hex、嵌套对象、循环引用、err stack）。 |

## 未由自动化覆盖的项（待真机样本）

下列项不能由 daemon 端自动化测试单独证明，需要在用户本机分批采样、记录在 [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md)，并最终汇总到 P1.2「真实运行数据截图视觉验收」中：

- GUI / WebView 端的中文渲染（daemon 链路已覆盖，渲染层依赖系统字体）。
- 多任务并行时 GUI 卡片排序是否「一眼能判断下一步」（主观判断，需截图）。
- 通知系统在 Windows 11 不同通知中心配置下的可达性。
- VS Code 扩展在真实 VS Code Extension Host 中的事件时序（仓库 daemon 端集成测试覆盖契约，VS Code 端无 host 自动化）。
- Codex Desktop / Claude Code / 国产工具升级文件格式后的兼容性回归（需要真实样本提交到测试 fixture 后追加用例）。

## 维护约定

- 任何新的入口或路径必须在「能力声明 ⇄ 自动化测试」之间建立双向引用。新增一行此表 ⇒ 必须有自动化测试用例支撑。
- 该表与代码绑定，每次 schema / 路由 / 适配器变更后都要回过来对账。
- 不允许把「计划」「下一步」写进本表 ——只描述当前可验证的能力。
