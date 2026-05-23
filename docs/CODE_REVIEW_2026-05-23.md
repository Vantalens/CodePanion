# 代码审计 2026-05-23

接续 [CODE_REVIEW_2026-05-21.md](./CODE_REVIEW_2026-05-21.md) 与 [CODE_REVIEW_2026-05-22.md](./CODE_REVIEW_2026-05-22.md) 之后的第三轮审计。这一轮按用户要求**覆盖全仓**（不再局限于近一周的未提交改动），重点排查：

- daemon 隐私边界（adapters / notifier / sourceManager / client 是否会把用户内容写到上报、通知、日志、错误信息里）
- daemon 启动健壮性（workflow 定义 / 模板加载、CLI start / stop、pty spawn 失败路径）
- 接力链路（[packages/daemon/src/pty/handoffRunner.ts](../packages/daemon/src/pty/handoffRunner.ts)、[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts) handoff launcher、snooze reminder）
- GUI 安全面（[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs) WebView2、[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js) 渲染、[packages/gui/App.xaml.cs](../packages/gui/App.xaml.cs) 弹窗）
- adapter-sdk / vscode-extension / packaging 长尾

发现 **20 项需排期处理**（4 项 P0 + 16 项 P1）+ 一组 P2/P3 长尾。**本文件仅作审计快照，不附带代码修复**。修复按 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) 顶部「2026-05-23 第三轮审计待处理」分组排期。

---

## P0：违反 POSITIONING / 阻塞启动

### N-6 aiToolProcessAdapter 把进程 CommandLine 全文上报 (P0)

- 路径：[packages/daemon/src/adapters/aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts)
- 现状：进程级 L1 探测把 Windows `Get-CimInstance Win32_Process` 拿到的 `CommandLine` 整段写进 metadata 上报；命令行常含用户名、绝对路径、API key、prompt 片段（例如 `codex chat --api-key sk-... --prompt "review my secret file..."`）。
- 影响：违反 [POSITIONING.md](./POSITIONING.md) 「不读取账号、token、API key、用户内容」契约。即便不落盘，也会通过 monitor-event 推到 GUI 与日志 ring。
- 修复方向：上报前对 CommandLine 做白名单提取（仅工具名 + 子命令首词），其余截断；如必须保留则单独走 `--include-cmdline` 开关，默认关闭。
- 关联：[N-12](#n-12-sourcemanager-logger-写事件回复正文-p1)、[N-7](#n-7-notifier-透传用户内容到桌面通知-p0)。

### N-7 notifier 透传用户内容到桌面通知 (P0)

- 路径：[packages/daemon/src/daemon/notifier.ts](../packages/daemon/src/daemon/notifier.ts)
- 现状：snooze 到点提醒 / 等待输入通知会把 `thread.title`、`lastPrompt`、`lastAssistantSummary` 原样送进系统通知 body；Windows 通知中心会把 body 完整缓存到 `wpndatabase.db`。
- 影响：用户输入过的 prompt、对话片段、文件路径会被系统级缓存收走，超出 daemon 的本地 retention 控制。
- 修复方向：通知 body 只放固定模板（"任务 X 等待输入" / "稍后任务到点"），detail 仅放任务标题首 40 字符；prompt / summary 通过点击通知再回 GUI 看，不进系统通道。

### N-8 codepanion-notify CLI 与 install 注入互斥 (P0)

- 路径：[packages/daemon/src/cli/notify.ts](../packages/daemon/src/cli/notify.ts) ↔ [packages/daemon/src/cli/install.ts](../packages/daemon/src/cli/install.ts) ↔ [packages/daemon/src/cli/index.ts](../packages/daemon/src/cli/index.ts)
- 现状：`install` 在 Windows 启动注册项里注入 `codepanion notify --message "..."`，但 `notify` 子命令在 yargs 里只声明 `--title` 与位置参数；index.ts 顶层带 `.strict()`，未知 flag 直接 exit 1。
- 影响：install 一旦真机走通就会马上坏掉——用户重启后看不到任何通知，daemon 进程还在跑但失声。
- 修复方向：要么给 `notify` 注册 `--message <string>` flag 并把它合并到 body；要么改 install 注入只用位置参数 `codepanion notify "title" "body"`。两侧加端到端单测，避免再次漂移。

### N-9 workflow 定义 / 模板加载无 try/catch (P0)

- 路径：[packages/daemon/src/workflows/workflowDefinitionManager.ts](../packages/daemon/src/workflows/workflowDefinitionManager.ts) `load()` + [packages/daemon/src/workflows/templateManager.ts](../packages/daemon/src/workflows/templateManager.ts) `load()`
- 现状：两个 manager 在 daemon 启动早期同步读 `~/.codepanion/workflows/*.json` 与 `templates/*.json` 并 `JSON.parse`，无 try/catch。任何一个文件被外部编辑器写坏（trailing comma、UTF-8 BOM、半截写入）都会让 `bootDaemon` 抛在初始化路径上，整个 daemon 起不来；GUI 一直在 daemon-down 状态。
- 影响：一次损坏导致主线断电。Alpha 用户没有 daemon 日志查看入口（GUI 当前不暴露 `~/.codepanion/logs`），自救成本极高。
- 修复方向：每个文件 try/catch；失败时记到 logger.warn + 重命名为 `<name>.broken-<timestamp>.json`，继续加载其他文件；启动完后通过 monitor-event 把"已隔离 X 个损坏配置"广播给 GUI。

---

## P1：接力链路 / 安全 / 健壮性

### H-1 scheduleSnoozeReminder 启动时遍历过期任务 (P1)

- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts):749-751（启动遍历）+ scheduleSnoozeReminder 定义
- 现状：daemon 启动时同步遍历所有 `snoozedUntil < now` 的任务，逐个 `scheduleSnoozeReminder` 并立即 emit 通知 + monitor-event。如果用户机器睡了一夜，早上启动会一次性补发几十条通知。
- 影响：抢焦点（违反 P0.1 "不乱跳"）+ 系统通知中心刷屏。
- 修复方向：启动时只把过期任务标记为 `due`，把 reminder 合并成一条聚合通知（"4 个稍后任务已到点"），点开 GUI 才看到具体列表。

### H-2 pty.runner 先 registerSession 再 try pty.spawn (P1)

- 路径：[packages/daemon/src/pty/runner.ts](../packages/daemon/src/pty/runner.ts):76-107
- 现状：`runWithPty` 先 `sessionManager.registerSession(...)`，再 `try { pty.spawn(...) } catch { logger.error; process.exit(2) }`。spawn 失败时 session 留在 daemon 内存里、`process.exit(2)` 又直接退出子进程，但 daemon 主进程仍持有这条 ghost session。
- 影响：handoff / workflow 走 spawn 失败路径会在 GUI 里留一条永远 running 的假任务。
- 修复方向：调换顺序——先 try spawn，spawn 成功再 registerSession；spawn 失败走 reject + abort hook，由调用方决定要不要 emit 失败事件。

### H-3 commandExists 用 execSync 同步阻塞 (P1)

- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts):842-852
- 现状：handoff launcher 校验目标工具是否在 PATH 时用 `execSync('where codex', { timeout: 1500 })`。execSync 在 Node 主线程同步阻塞，连续启动 4 个 handoff 时会让 daemon 卡 6 秒，期间所有 WebSocket 消息排队。
- 影响：GUI 在 handoff 启动期间表现为"卡死"，违反 P0.1 不乱跳但要求"始终响应"的隐含承诺。
- 修复方向：改为异步 `execFile`，配合 `Promise.all` 并发探测；结果按工具名缓存 5 分钟，连续 handoff 不重复探测。

### H-4 classifyHandoffIssueType 大 corpus regex (P1)

- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts):934-956 `classifyHandoffIssueType`
- 现状：把接力子进程的最后 200KB stdout 直接喂给 6 条长 regex（配置/权限/网络/依赖/测试/构建），每条都是 `/(?:...).*?(?:...)/is`。stdout 是日志洪流，命中代价 O(n*regex_count)，单次能跑 50~100ms，且无超时保护。
- 影响：接力回流瞬间 daemon 主线程被 regex 卡住，GUI 看到延迟分类。
- 修复方向：先按行切片（最近 2000 行就够），分类只看最后 50 行 + 退出码；regex 用预编译 + non-backtracking 写法（避免 `.*?`）。

### H-5 handoffRunner 静默吞清理失败 + prompt 明文留盘 (P1)

- 路径：[packages/daemon/src/pty/handoffRunner.ts](../packages/daemon/src/pty/handoffRunner.ts)
- 现状：子进程 `readFileSync(configPath)` → `rmSync(configPath, { force: true })`。如果 rmSync 因为权限 / 被防病毒锁定失败，会直接 try/catch 吞掉；config JSON 里有完整的用户 prompt（schema 上限 200000 字符）。文件位置是 OS tmp 目录，没有任何保留期外的清理保证。
- 影响：用户接力 prompt 在 OS tmp 留明文。
- 修复方向：写 config 前先把 prompt 用 daemon 进程内 AES-GCM 加密（key 仅在父进程内存），子进程通过环境变量拿 key 解密；rmSync 失败时改为多次重试 + 把异常报回父进程让父进程补救（最差也是父进程兜底 unlink）。

### N-10 DaemonHttpError message 含 body 可能泄露 (P1)

- 路径：[packages/daemon/src/shared/client.ts](../packages/daemon/src/shared/client.ts) `DaemonHttpError`
- 现状：HTTP 错误时把 `await res.text()` 直接拼到 `Error.message` 里，body 可能含 token 校验后服务端返回的 prompt 摘要 / session 名。这条 error 最终被 logger.error 落到 `gui.log` / `daemon.log`。
- 影响：日志侧持久化用户内容，与 N-6/N-12 是同一类漏洞。
- 修复方向：error.message 只放 status + statusText；body 单独挂在 `error.responseBody` 字段上，logger 配置默认脱敏该字段。

### N-11 daemon client 无 timeout (P1)

- 路径：[packages/daemon/src/shared/client.ts](../packages/daemon/src/shared/client.ts)
- 现状：所有 daemon HTTP 请求都没有 `AbortSignal.timeout`。daemon 卡死时（被 H-3 触发）GUI / CLI 永远等待。
- 修复方向：统一加 8000ms timeout（接力 / workflow 这类长操作单独传更长的 signal）；timeout 触发时 throw DaemonClientTimeoutError，与 daemon-down 区分。

### N-12 sourceManager logger 写事件 / 回复正文 (P1)

- 路径：[packages/daemon/src/daemon/sourceManager.ts](../packages/daemon/src/daemon/sourceManager.ts)
- 现状：register / unregister / event / reply 路径上 `logger.info({ event })` 把事件 body 整体打到 pino，落到 `~/.codepanion/logs/daemon.log`（默认 7d retention 但永久磁盘明文）。
- 影响：本地日志成了"事件全量副本"，与 audit --redact 的承诺背道而驰。
- 修复方向：默认只打 `{ kind, sourceId, sessionId, eventKind, byteSize }`；正文走 trace 级别，默认关闭。

### N-13 codexDesktopAdapter TrackedFile Map 只增不减 (P1)

- 路径：[packages/daemon/src/adapters/codexDesktopAdapter.ts](../packages/daemon/src/adapters/codexDesktopAdapter.ts)
- 现状：`trackedFiles: Map<string, TrackedFile>` 在监控目录里见到的每个文件都加进去，但文件删除 / Codex 清掉对话历史时不会从 Map 移除。长跑 8 小时（[DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) 真机项第三条）会让这个 Map 单调增长。
- 影响：daemon RSS 缓慢爬升，最终 GUI 进程也跟着拖慢。
- 修复方向：trackedFiles 加 LRU cap（建议 512）+ TTL（48h 未见到则淘汰）；删除事件直接清。

### N-14 runWithPty process.exit 绕过 workflow hooks (P1)

- 路径：[packages/daemon/src/workflows/workflowDefinitionManager.ts](../packages/daemon/src/workflows/workflowDefinitionManager.ts) step runner
- 现状：workflow step 走 runWithPty，runner 内部 spawn 失败时直接 `process.exit(2)`（见 H-2）。workflow 的 onStepFail hook 不会被调用，[N-3](./CODE_REVIEW_2026-05-22.md#n-3-runworkflow-抛错时-daemon-source-泄露-p2) 在 5/22 修过的 abort 路径在这里失效。
- 影响：workflow 把"spawn 失败"误报成"daemon 自身崩溃"。
- 修复方向：H-2 修完后此项自动收敛；但要补单测验证 spawn 失败 → onStepFail hook 被调用 → daemon 仍存活。

### N-15 Windows .cmd/.bat 命令注入 (P1)

- 路径：[packages/daemon/src/cli/templates.ts](../packages/daemon/src/cli/templates.ts) + [packages/daemon/src/pty/runner.ts](../packages/daemon/src/pty/runner.ts):38-59
- 现状：node-pty 在 Windows 上走 cmd.exe；用户传入的 args 含 `& | ^ < >` 时未转义。属于 CVE-2024-27980 类（Node.js child_process 在 Windows .cmd/.bat 的 args 注入）。模板里允许用户自定义 `args`，这条路径直接暴露给用户输入。
- 影响：用户从 GUI 触发的 args 可被注入新命令。
- 修复方向：runner 在 Windows 平台对所有 args 强制走 `"..."` 包裹 + 内部 `"` 转 `""`；模板加 schema 校验拒绝包含 `& | ^ < >` 的 args；优先升级到 Node.js 已修复的 child_process 路径并直接复用其转义。

### N-16 history.append schema 失败丢全历史 (P1)

- 路径：[packages/daemon/src/workflows/workflowDefinitionManager.ts](../packages/daemon/src/workflows/workflowDefinitionManager.ts) `appendHistory`
- 现状：append 时一次性 parse 整个 history 文件 + 验 schema + 追加 + 全量写回。中间任何一条历史 schema 失败 → catch 里直接覆盖写一个空数组。
- 影响：一次坏 entry 导致几百条 workflow run 历史全丢。
- 修复方向：改为 NDJSON（一行一条），append 不读旧文件；读取时按行 try/parse，跳过坏行而不是 truncate。

### N-17 cli start 并发启动竞态 (P1)

- 路径：[packages/daemon/src/cli/start.ts](../packages/daemon/src/cli/start.ts)
- 现状：双击 `CodePanion.Gui.exe` 与 CLI `codepanion start` 同时跑时，两侧都先 isAlive(pid) → 都判定 daemon 没起 → 都 spawn 一个 daemon。pid 文件最后被晚到的覆盖。
- 影响：会有 2 个 daemon 抢同一个 token 文件 / 端口。
- 修复方向：写 pid 文件前用 `open(..., 'wx')` 独占；失败时把 pid 文件解读后 wait + 直接复用。

### N-18 cli stop 用旧 pid 误杀 (P1)

- 路径：[packages/daemon/src/cli/stop.ts](../packages/daemon/src/cli/stop.ts)
- 现状：stop 读 pid 文件后直接 `process.kill(pid, 'SIGTERM')`，不校验 pid 进程是否真的是 codepanion daemon（仅 pid 文件存在 → 信任）。Windows 上 pid 复用频繁，停掉前一次的 daemon 后短期内可能误杀掉用户的其他进程。
- 修复方向：kill 前用 OS API 拿 process 名 / commandLine 校验是 daemon-entry.js 才发信号；不匹配则只清 pid 文件，不杀。

### N-19 WebView2 未拦截 NavigationStarting / NewWindowRequested (P1)

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- 现状：WebView2 控件没有订阅 `NavigationStarting` 与 `NewWindowRequested`。chat.js 渲染 markdown 出来的 `<a target="_blank">` 链接（或 `[click](javascript:...)`）会触发 WebView2 自身 navigation 行为。
- 影响：用户点接力子进程输出里的恶意链接 → WebView2 弹外部浏览器或新窗口。CSP 限制了内联脚本，但导航是 WebView2 框架层。
- 修复方向：NavigationStarting 内白名单：只允许 codepanion.local 与 `about:blank`；其余 e.Cancel = true，转 `Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true })` 给默认浏览器，并先 prompt 用户确认。NewWindowRequested 一律 cancel + 同样走默认浏览器。

### N-20 WebMessageReceived 无 schema 校验 (P1)

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- 现状：WebView2 → C# 的 `WebMessageReceived` 处理只 `JsonConvert.DeserializeObject<dynamic>(...)` + `switch (type)`，没有按预期形状校验。dispatcher 一旦因为 vendored marked / DOMPurify 漏出来一个攻击者控制的 message，C# 侧会直接按字段触发动作（包括接力启动）。
- 影响：从渲染层到 native 侧的信任边界缺失。
- 修复方向：C# 侧引 System.Text.Json + 严格 record 类型；type 字段做白名单 enum；未知 type 直接丢弃 + warn 日志。protocol.ts 同步加 zod schema，跑 `validate:dtos` 校验双侧一致。

### N-21 MessageBox 抢焦点 + FocusAssistDetector 桩 (P1)

- 路径：[packages/gui/App.xaml.cs](../packages/gui/App.xaml.cs) + [packages/gui/Services/SoundPlayer.cs](../packages/gui/Services/SoundPlayer.cs) `FocusAssistDetector`
- 现状：未处理异常用 `MessageBox.Show(...)` 弹原生窗口；FocusAssistDetector.GetCurrentState 直接 `return FocusAssistState.Off`（桩函数）。两者都违反 P0.1 "不抢焦点 / 不乱跳"。
- 影响：用户专注另一个窗口时 daemon-down / 未捕获异常会硬弹一个抢焦点的对话框；勿扰模式失效，通知声音也会打扰。
- 修复方向：MessageBox 改成 GUI 内 in-app banner（顶部条 + 详情可展开）；FocusAssistDetector 调用 Windows ToastNotificationManager.History.RequestUserConsentAsync 或读注册表 `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings\Windows.SystemToast.FocusAssist` 判断真实状态。

---

## P2 / P3 长尾

不阻塞 Alpha，挂在 Strategy Backlog 后续轮次处理。

### GUI 前端（chat.js）

- **J-01** conversation 列表逐项 click 监听器，列表 rerender 时旧节点未 removeEventListener；长跑后内存累积。建议改事件委托。
- **J-02** renderAll 每次 thread-upsert 都全量重渲；500+ 任务时帧率掉。建议引入脏检查 + 任务级 diff。
- **J-09** marked 渲染出的 `<a target="_blank">` 与 N-19 同根；前端侧补一层 `addEventListener('click', e => { if (link.href 非白名单) { e.preventDefault(); postWebMessage('open-external', href) } })`。
- **J-10** 切到 code 视图（如果存在）会重置 activeConversation，违反 P0.1 不抢焦点；需在视图切换前后保留 selection。

### adapter-sdk 示例

- **A-3** [file-watcher.mjs](../packages/adapter-sdk/examples/file-watcher.mjs) 在 Linux 上 `fs.watch({ recursive: true })` 不支持；示例需要平台分支或在 README 标明仅 Windows/macOS。
- **A-4** [local-tool-bridge.mjs](../packages/adapter-sdk/examples/local-tool-bridge.mjs) N-5 修过单飞但仍可能事件洪水（短 burst 内同一行被分类多次）；补 dedupe（content hash + 30s 窗口）。

### vscode-extension

- **V-1** [extension.js](../packages/vscode-extension/extension.js) daemon-down 时不断 retry，VS Code 状态栏会刷屏；改指数退避 + 静默上限。
- **V-2** request 无 timeout（同 N-11，跨包重复一次）。
- **V-3** fs.watch 在 daemon socket 首次缺文件时直接 fail，daemon 启动后不会重试；改成"文件不存在则 setInterval 探测 + 出现后 watch"。

### packaging

- **S-1** [scripts/package-windows.ps1](../scripts/package-windows.ps1) 通配符 `Copy-Item Assets\*` 在 PS 5 / PS 7 行为不一致；建议改 explicit list 或 Get-ChildItem -Exclude。
- **S-2** [scripts/build-daemon-bundle.mjs](../scripts/build-daemon-bundle.mjs) esbuild 没声明 external（node-pty / pino / ws），bundle 体积偏大且 native module 处理脆弱；补 external + 文档说明哪些必须外置。

---

## 总览

| 优先级 | 项目数 | 范围 |
|--------|-------|------|
| P0 | 4 (N-6 ~ N-9) | 隐私边界 + 启动健壮性 |
| P1 | 16 (H-1 ~ H-5, N-10 ~ N-21) | 接力链路 + 客户端超时 + 日志脱敏 + GUI 安全面 |
| P2/P3 | 11 (J-01 等 / A-3 / A-4 / V-1 ~ V-3 / S-1 / S-2) | 性能 / 跨平台示例 / 打包卫生 |

修复路径建议：

1. **本周**：N-6 / N-7 / N-9（隐私 + 启动健壮性）+ H-1 / H-2（接力链路最易触发的两条）。
2. **下周**：N-19 / N-20（GUI ↔ native 边界）+ N-10 / N-11 / N-12（日志脱敏 + timeout）+ N-21（焦点）。
3. **本月内**：H-3 / H-4 / H-5 + N-8 + N-13 ~ N-18。
4. **Alpha 真机三项**（[DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) 末段）：保持原顺序，放最后。

---

## 关联

- [POSITIONING.md](./POSITIONING.md) 隐私边界
- [CODE_REVIEW_2026-05-21.md](./CODE_REVIEW_2026-05-21.md) 第一轮
- [CODE_REVIEW_2026-05-22.md](./CODE_REVIEW_2026-05-22.md) 第二轮
- [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) 「2026-05-23 第三轮审计待处理」分组
