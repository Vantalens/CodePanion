# 代码审计 2026-05-21

针对 P3a/P3b/P3c 收束后到 2026-05-21 之间的改动（GUI 稳定性重建、daemon `inject-input` 协议升级、VS Code 扩展配置缓存）做的全仓审查。审查范围：

- `packages/daemon/src/daemon/{server,sessionManager}.ts`
- `packages/daemon/src/pty/{runner,promptDetector}.ts`
- `packages/daemon/src/shared/protocol.ts`
- `packages/gui/wwwroot/{chat.js,chat.css}`
- `packages/gui/{MainWindow.xaml.cs,Services/DaemonClient.cs}`
- `packages/vscode-extension/extension.js`

发现 16 项隐患，按当前产品标准（`DEVELOPMENT_TASKS.md` 的 P0/P1/P2）分级。

---

## P0 与 GUI 可理解性、不抢焦点、稳定直接冲突

> P0-A ~ P0-E 已于 2026-05-21 全部修复，详见 [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md#2026-05-21-全仓审计-p0-修复)。

### P0-A 重连通知污染主消息流

- 路径：[MainWindow.xaml.cs:245](../packages/gui/MainWindow.xaml.cs#L245)、[L263](../packages/gui/MainWindow.xaml.cs#L263)
- 现状：`OnDaemonConnected` / `OnDaemonDisconnected` 都调 `SendStatusMessage`，把 "daemon 已连接 / 断开" 卡片插入当前任务视图。
- 影响：违反 P0.1「新事件不抢焦点」，每次自动重连都污染用户正在阅读的任务。
- 建议：只更新状态栏 / 状态指示器；主消息流不写入 daemon 自身的连接状态。

### P0-B 切换 view 时强制重置 activeConversation

- 路径：[chat.js:247-249](../packages/gui/wwwroot/chat.js#L247-L249)
- 现状：`renderConversationList` 在过滤后若 active 不在结果集中就重置为 `conversations[0]`。
- 影响：用户从「全部」切到「等待」/「错误」/「代码」视图时当前任务被自动切走；违反 P0.1。
- 建议：仅在 `activeConversation` 为空或对应任务已彻底消失时才重置；切换 view 时不动 active。

### P0-C VS Code 扩展配置 namespace 拼错

- 路径：[extension.js:145](../packages/vscode-extension/extension.js#L145)
- 现状：`e.affectsConfiguration('projects')` 应为 `'codepanion'`。
- 影响：用户修改 settings.json 后 token / port 缓存不会失效；旋转 token 后扩展继续用旧值，daemon 返回 401，事件全部丢失。
- 建议：单字符串修复 + 在 `configurationChange` 单测中断言 namespace。

### P0-D CLI 端 inject-input 与新输出竞态

- 路径：[runner.ts:182](../packages/daemon/src/pty/runner.ts#L182)
- 现状：`term.onData` 中每次输出都 `currentPromptOptions = []`。
- 影响：GUI 点选项 → daemon → CLI `inject-input` 路径上若 PTY 有 spinner / 心跳 / 进度刷新到达，`currentPromptOptions[event.optionIndex]` 命中空数组，回复静默丢失。
- 建议：把 clear 移到 detector 报告非 prompt 状态时；或在 inject-input 处理后再清。需要补一条「prompt 期间收到心跳输出仍能成功 inject」的回归测试。

### P0-E GUI 重连后 sessions / sources 列表不恢复

- 路径：[server.ts:524-525](../packages/daemon/src/daemon/server.ts#L524-L525)、[DaemonClient.cs:170](../packages/gui/Services/DaemonClient.cs#L170)
- 现状：observer 首连只发 `hello` + `workflow-snapshot`，不发 sessions / sources snapshot；GUI 端 ws 重连后也不 HTTP 拉一次 `/sessions` / `/sources`。
- 影响：GUI 重启后左侧「会话」列表为空，但 workflow 视图已有内容，与「看得懂」目标冲突。
- 建议：observer 接入后在 `hello` 之后追加 `sessions-snapshot` 与 `sources-snapshot`，或 GUI 端在 `Connected` 事件触发后 HTTP 拉一次状态。

---

## P1 资源监管 / 稳态运行隐患

> P1-A / P1-B / P1-C / P1-D / P1-F 已于 2026-05-21 收口，详见 [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md#2026-05-21-p1-backlog-收口abcdf)。P1-E 在 P0 段附带修复。

### P1-A GUI `_sessions` 永不裁剪 exited

- 路径：[MainWindow.xaml.cs:36](../packages/gui/MainWindow.xaml.cs#L36)
- 现状：`ObservableCollection` 只加不删；`UpdateSessionCount` 只统计活跃但不裁剪集合。
- 影响：长时间运行后 `SessionListView` 渲染慢、内存增长。
- 建议：exited 超过 N 个或保留时长后裁剪；与 daemon `retention.session` 对齐。

### P1-B DaemonClient.DefaultRequestHeaders 并发不安全

- 路径：[DaemonClient.cs:326-327](../packages/gui/Services/DaemonClient.cs#L326-L327)
- 现状：每次 `SendReplyAsync` / `SendMonitorEventReplyAsync` 都 `Clear()` 后 `Add(Authorization, ...)`。
- 影响：并发 POST 时（即便目前 Dispatcher 单线程，未来流向调整即触发）头会错乱或抛 `InvalidOperationException`。
- 建议：改用 `HttpRequestMessage` 在请求实例上设头；或一次性在 `LoadConfig` 时设到 default 头并避免重复 Clear。

### P1-C MainWindow `async void` 异常无兜底

- 路径：[MainWindow.xaml.cs:193](../packages/gui/MainWindow.xaml.cs#L193)、[L204](../packages/gui/MainWindow.xaml.cs#L204)、[L276](../packages/gui/MainWindow.xaml.cs#L276)
- 现状：`HandleUserReply` / `HandleMonitorEventReply` / `AutoReconnectTimer_Tick` 均为 `async void`，未捕获异常会让进程崩溃。
- 建议：函数体加 try/catch；或改为 `async Task` 由调用方 await 并 catch。

### P1-D gui.log 无 rotation 且同步阻塞 UI 线程

- 路径：[MainWindow.xaml.cs:530](../packages/gui/MainWindow.xaml.cs#L530)、[DaemonClient.cs:440](../packages/gui/Services/DaemonClient.cs#L440)
- 现状：每次 Log 同步 `File.AppendAllText`，无文件滚动或大小限制。
- 影响：长时间运行后日志无限增长；高频日志阻塞 WPF Dispatcher 引起卡顿。
- 建议：按大小或日期滚动；统一通过 `Channel<string>` 异步写入；与 daemon pino logger 保持口径一致。

### P1-E VS Code 扩展 `JSON.parse` 未捕获

- 路径：[extension.js:76](../packages/vscode-extension/extension.js#L76)
- 现状：`resolve(text ? JSON.parse(text) : {})` 解析异常导致 promise unhandled rejection。
- 建议：包 try/catch，并把原始 text 截断后写入 `logFailure`。

### P1-F DaemonClient 重连无指数退避

- 路径：[MainWindow.xaml.cs:39](../packages/gui/MainWindow.xaml.cs#L39)
- 现状：固定 2 秒重试 + 每次都尝试 `EnsureStartedAsync`。
- 影响：daemon 长时间不可用时刷屏式 retry，日志噪音 + IO 浪费。
- 建议：指数退避到 30s 上限；`EnsureStartedAsync` 只在首次重试时调用。

---

## P2 代码清理 / 可观察性

> P2-B / P2-C / P2-D / P2-E 已于 2026-05-21 收口，详见 [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md#2026-05-21-p2-backlog-收口bcde)。

### ~~P2-A chat.js `getMessageRenderKey` 重复 `options` 键~~（已修，2026-05-21 跟踪修复 M1）

- 路径：[chat.js:689](../packages/gui/wwwroot/chat.js#L689)
- 现状：对象字面量同名键已删除其一，仅保留 `options: message.options || null`。详见 [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md#2026-05-21-p0-实施自评跟踪修复)

### P2-B `pruneWorkflowItemIdsGlobal` 不同步清 codeBlocks

- 路径：[chat.js:1137](../packages/gui/wwwroot/chat.js#L1137)
- 现状：删除孤儿 item 时未同步过滤 `state.codeBlocks`，可能保留对已删除消息 id 的引用。
- 建议：在 `pruneWorkflowItemIdsGlobal` 末尾按当前 `workflowItemIds` 过滤 `state.codeBlocks`。

### P2-C runner.ts `replyTextForPromptOption` 在新协议下冗余

- 路径：[runner.ts:52](../packages/daemon/src/pty/runner.ts#L52)
- 现状：新协议下 CLI 已按 `optionIndex` 解析选项，`replyTextForPromptOption` 与 GUI 端 `value + "\n"` 拼接重复；server `resolvePromptOption` 已 `trim` 末尾换行。
- 建议：保留 CLI 端的换行注入（PTY 需要 \n 触发回车），但删除 GUI / server 中冗余的换行拼接逻辑，集中在 CLI 单点。

### P2-D 每个 PTY 输出 chunk 都立即 appendItem 到 workflow

- 路径：[server.ts:83-92](../packages/daemon/src/daemon/server.ts#L83-L92)
- 现状：高频 PTY 输出每条都 `appendItem`；snapshot 写盘虽有 200ms 去抖，但内存中 items 与 ID 计数器仍快速增长。
- 建议：在 server 侧也合并 N ms 内的 output chunk；或 `kind: 'command'` 类型走单独的小型环形缓冲，不每条都进 workflow 主列表。

### P2-E `extractCodeBlocks` 每次 push 后 splice

- 路径：[chat.js:795-798](../packages/gui/wwwroot/chat.js#L795-L798)
- 现状：每识别一个代码块就裁剪一次。
- 建议：改为批量识别后再裁剪一次；`pruneMessageState` 已有上限兜底。

---

## 验收边界

- 16 项均未涉及鉴权 / 加密路径，P3b 的 token / WS subprotocol / Origin 防线不受影响。
- P0-A / P0-B / P0-E 是 P0 验收（「界面不再被刷屏」「主内容刷新不会清空重建」）能否通过的关键。
- P0-D 一旦触发会导致用户在 GUI 看见选项点了无反应，配合 spinner / 心跳输出时复现路径明确，建议先补单测再修。
- P0-C 是单字符修复但影响面大，可单独拆出一个最小修复 PR。

---

## 状态汇总（2026-05-22 复核）

16 项全部已修复并落地代码：

| 编号 | 状态 | 验证锚点 |
| --- | --- | --- |
| P0-A | 已修复 | [MainWindow.xaml.cs:245-263](../packages/gui/MainWindow.xaml.cs#L245-L263) 移除主流写入 |
| P0-B | 已修复 | [chat.js:256-258](../packages/gui/wwwroot/chat.js#L256-L258) 仅在彻底缺失时重置 |
| P0-C | 已修复 | [extension.js:158](../packages/vscode-extension/extension.js#L158) 已用 `codepanion` namespace |
| P0-D | 已修复 | [runner.ts:179-188](../packages/daemon/src/pty/runner.ts#L179-L188) clear 由 detector 状态驱动 |
| P0-E | 已修复 | [server.ts:595-597](../packages/daemon/src/daemon/server.ts#L595-L597) hello 后追发 sessions/sources snapshot |
| P1-A | 已修复 | `MainWindow.PruneExitedSessions` 按 retention 裁剪 |
| P1-B | 已修复 | `DaemonClient` 改 per-request `HttpRequestMessage` |
| P1-C | 已修复 | `async void` 全部包 try/catch |
| P1-D | 已修复 | `GuiLogWriter` 使用 `Channel<string>` + 大小滚动 |
| P1-E | 已修复 | extension.js JSON.parse 包 try/catch |
| P1-F | 已修复 | 2s → 30s 指数退避，仅首次调 `EnsureStartedAsync` |
| P2-A | 已修复 | 跟踪修复 M1 删除重复键 |
| P2-B | 已修复 | [chat.js:1341-1366](../packages/gui/wwwroot/chat.js#L1341-L1366) 同步过滤 codeBlocks |
| P2-C | 已修复 | runner CLI 单点换行，GUI/server 不再拼接 `\n` |
| P2-D | 已修复 | server 50ms 合并 PTY 输出 chunk |
| P2-E | 已修复 | [chat.js:921-952](../packages/gui/wwwroot/chat.js#L921-L952) 批量识别后一次性 splice |

新进入的隐患在新一轮审计文档里归档，本文件保留作为 2026-05-21 时间点的快照。
