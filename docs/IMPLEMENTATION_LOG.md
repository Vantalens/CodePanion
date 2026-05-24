# 实施日志

记录已落地的工程改动细节：测试覆盖、威胁模型、压测数据、关键设计决策。任务清单（[DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md)）只跟踪「做什么」，此文档跟踪「怎么做的、为什么、验证到什么程度」。

---

## P3a 本周清零（2026-05-19 完成）

### S-2 `/sessions/:id/prompt` Zod 校验

- 路径：[packages/daemon/src/daemon/server.ts:317](../packages/daemon/src/daemon/server.ts#L317)
- 在 `shared/protocol.ts` 增加 `SessionPromptRequestSchema`：`lastLines: string`（限制最大长度 16 KiB）、`options: string[]`（每项校验类型与长度，最多 32 项）
- 路由内用 `.safeParse` 替换裸 `req.body?.lastLines` 读取
- 测试覆盖：非字符串 lastLines、超长 lastLines、options 非数组、options 元素非字符串、options 超过上限

### S-7 NuGet 漏洞审计恢复

- 路径：[packages/gui/CodePanion.Gui.csproj](../packages/gui/CodePanion.Gui.csproj)
- 改为 `NuGetAudit=true` + `NuGetAuditMode=direct`，只静默 NU1900（审计源不可达）告警
- `npm run gui:build` 通过且仍可触发真实 CVE 告警

### A-5 `start.bat` 路径与编码

- 路径：[start.bat](../start.bat)
- 使用 `%~dp0` 锚定脚本目录，`chcp 65001` 解决中文乱码
- 自动探测 Debug / Release GUI 构建路径，`stop.bat` 同步处理

### S-15 移除 node-notifier

- 路径：[packages/daemon/package.json](../packages/daemon/package.json)
- 改用 PowerShell / osascript / notify-send，不再需要 node-notifier
- 从 dependencies 与 devDependencies 中移除并刷新 package-lock.json

### P-2 WorkflowManager.appendItem ID 去重

- 路径：[packages/daemon/src/daemon/workflowManager.ts:41](../packages/daemon/src/daemon/workflowManager.ts#L41)
- 命中重复时打 `debug` 日志并返回 false（此前是无声丢弃）
- 单元测试覆盖去重路径不污染线程状态

---

## P3b 两周内稳态隐患（2026-05-19 主体完成）

### S-1 DOMPurify 替代 + CSP

- 路径：[packages/gui/wwwroot/vendor/codepanion-markdown.js:75](../packages/gui/wwwroot/vendor/codepanion-markdown.js#L75)
- 离线允许列表式 DOMPurify 替代实现：仅放行白名单标签/属性，禁用危险 URL scheme（`javascript:` / `vbscript:` / `data:text/html`）与所有 `on*` 处理器
- `chat.html` 加 `Content-Security-Policy` meta，禁用 inline script、限制 `connect-src` / `object-src`
- 测试：[packages/daemon/test/markdownSanitizer.test.mjs](../packages/daemon/test/markdownSanitizer.test.mjs) 9 条 XSS 回归用例覆盖 `<script>`、`onerror` / `onclick` / `onmouseover`、`javascript:` / `vbscript:` / `data:text/html`、`<iframe>` / `<object>` / `<embed>` / `<style>`、未知标签、危险属性、HTML 注释、marked.parse 转义链路
- 引入 jsdom devDependency 加载 GUI 脚本做沙箱断言

### S-3 Claude Code hook token 落盘

- 路径：[packages/daemon/src/cli/install.ts:86](../packages/daemon/src/cli/install.ts#L86)
- 切换到 `writeFileSync(..., { mode: 0o600 })` + `chmodSync` 兜底
- hook 命令字面量改用 `codepanion notify`，不再携带 Bearer 字面量；token 单一来源为 `~/.codepanion/config.json`

**命名管道 / Unix socket 升级评估（2026-05-19，决定维持现状）：**

- 当前威胁模型：daemon 仅绑 127.0.0.1、token 文件 POSIX 0o600 + Windows NTFS ACL 已锁定、WS 走 subprotocol + Origin 白名单
- 命名管道方案工程成本：重写 HTTP/WS server、迁移 5+ 客户端、跨平台两套语义、C# 端需自写桥接
- 环境变量临时注入会让 token 重新回到 settings.json 字面量，属退步
- 结论：工程成本远高于安全增量，维持现状
- 残余风险「同用户态恶意进程读 config.json」属 OS 级权限隔离（AppContainer / capabilities），不在 P3b 范围
- 后续：`codepanion rotate-token` CLI 移到 backlog（[B5](../DEVELOPMENT_TASKS.md#b5-跨平台-gui-评估)）

### S-12 config.json owner-only 写盘

- 路径：[packages/daemon/src/config.ts:10](../packages/daemon/src/config.ts#L10)
- POSIX：`writeOwnerOnly` 写入 `mode: 0o600` 并 `chmodSync` 兜底；目录 `~/.codepanion` 以 `0o700` 创建
- Windows：`icacls /inheritance:r` + `/grant:r ${user}:F` 移除 `BUILTIN\Users` 与继承 ACE，目录与文件同源处理
- 测试：[configPermissions.test.mjs](../packages/daemon/test/configPermissions.test.mjs)
  - POSIX 用 `stat` 检查 `mode & 0o777 === 0o600`，含覆盖写场景
  - Windows ACL 断言剥离 `BUILTIN\Users` / `Authenticated Users`，仅保留当前用户 `(F)`
  - 手动 `icacls` 输出复核确认仅剩 `WANG\Owen:(F)`

### S-4 / S-5 WebSocket subprotocol + Origin

- 路径：[packages/daemon/src/daemon/server.ts:376](../packages/daemon/src/daemon/server.ts#L376)
- 鉴权从查询字符串迁移到 `Sec-WebSocket-Protocol: codepanion.token.${token}`
- 客户端同步迁移：[shared/client.ts:99](../packages/daemon/src/shared/client.ts#L99)、[pty/runner.ts:82](../packages/daemon/src/pty/runner.ts#L82)、[gui/Services/DaemonClient.cs:119](../packages/gui/Services/DaemonClient.cs#L119)
- Origin 白名单：仅放行 `null` / missing 与 `https://codepanion.local`（WebView2 虚拟主机）
- 测试覆盖：缺 subprotocol、错误 token、跨域 Origin、白名单 Origin 四条用例

### P-1 工作流快照去抖 + 原子写

- 路径：[packages/daemon/src/daemon/workflowManager.ts:173](../packages/daemon/src/daemon/workflowManager.ts#L173)
- `appendItem` 后通过 `scheduleSnapshot` 排程一次去抖的 `writeSnapshotNow`（默认 200ms，`snapshotDebounceMs=0` 触发同步写盘用于测试）
- 写盘改为 `fs/promises.writeFile` + 临时文件 + `rename` 保证原子性
- shutdown 路径走 `flushSnapshot` / `flushSnapshotSync`

**压测数据（[scripts/stress-workflow.mjs](../scripts/stress-workflow.mjs)，2026-05-19）：**

- 配置：5 分钟 × 100 ev/s = 30,000 事件
- appendItem 延迟：avg 0.020ms / p99 0.180ms / max 4.527ms
- RSS：从 55MB 升到 77MB 峰值后稳定（增长 22.2MB，阈值 200MB）
- 堆：稳定在 12–16MB，无泄漏
- 磁盘写：1501 次（4.0 writes/s，符合 200ms 去抖预期），ratio 0.05 写/事件
- 脚本支持 `--duration` / `--rate` / `--threads` / `--debounce` 调参；PASS / FAIL 由 RSS 增长 / 延迟 / 写盘比三条阈值自动判定
- 8 小时实地稳态运行已降级为 Beta 前稳态验证：不阻塞 Windows Alpha 收口和阶段 2 第一批本地模板能力；当前用 retention 上限、快照裁剪、`npm run stress:workflow` 与自动化回归作为 Alpha 防线。

### A-2 版本号统一

- 路径：[packages/daemon/src/shared/version.ts](../packages/daemon/src/shared/version.ts)、[packages/gui/CodePanion.Gui.csproj:17](../packages/gui/CodePanion.Gui.csproj#L17)
- daemon：运行期从 `package.json` 读取并通过 `shared/version.ts` 导出 `VERSION`，`/health` 与 `ws hello` 使用同一来源
- GUI：csproj 构建期通过 MSBuild 属性函数从根 `package.json` 抽取 `version` 注入 `<Version>`，.NET SDK 自动派生 `AssemblyVersion` / `FileVersion` / `InformationalVersion`
- 验证：`dotnet build` 产物经 `FileVersionInfo` 确认 `AssemblyVersion=FileVersion=0.1.0.0`、`ProductVersion=0.1.0+<git-sha>`

---

## P3c 一个月内基线（2026-05-19 部分完成）

### A-6 logger 脱敏

- 路径：[packages/daemon/src/logger.ts](../packages/daemon/src/logger.ts)
- `maskString` 处理 homedir / Bearer / 查询 token / 长 hex 四类敏感串
- `maskValue` 递归 mask 对象与数组，`Error` 实例特判展开（绕开 pino 默认序列化），WeakSet 防循环
- pino `redact.paths` 兜底字段名：`token` / `authorization` / `cookie` / `apiKey` / `secret` / `password` 及 `*.headers.*`
- 测试：[packages/daemon/test/logger.test.mjs](../packages/daemon/test/logger.test.mjs) 11 条用例

### codexDesktopAdapter 解析测试

- 路径：[packages/daemon/test/codexDesktopAdapter.test.mjs](../packages/daemon/test/codexDesktopAdapter.test.mjs)
- 17 条用例：7 纯函数（`toTimestamp` / `shouldHideCodexContent` / `textFrom` / `statusFromEvent`）+ 10 类级集成（session_meta、user_message、task_started/complete、response_item 角色过滤、function_call、turn_context 忽略、compacted、offset 增量扫描）

### HTTP 路由反例补齐

- 路径：[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs)
- 8 条 POST 路由 Zod 拒绝路径：`/notify`、`/sources/register`、`/events`、`/events/:id/reply`、`/sessions`、`/sessions/:id/output`、`/sessions/:id/reply`、`/sessions/:id/exit`

---

## P0.3 多 CLI 会话并行（2026-05-19）

- 路径：[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs)
- 新增交叉 reply 测试：在两个 CLI 端各注册 waiter 后交叉发 reply，断言 inject-input 互不串扰
- 同时验证 output 历史不污染、exit 只影响目标会话
- 当前 `npm test` 68 项通过

---

## P0.2 保留策略可配置化（2026-05-19）

- 路径：[packages/daemon/src/config.ts](../packages/daemon/src/config.ts)、[packages/daemon/src/daemon/sessionManager.ts](../packages/daemon/src/daemon/sessionManager.ts)、[sourceManager.ts](../packages/daemon/src/daemon/sourceManager.ts)、[workflowManager.ts](../packages/daemon/src/daemon/workflowManager.ts)、[server.ts](../packages/daemon/src/daemon/server.ts)
- 集中默认值：在 `config.ts` 导出 `RETENTION_DEFAULTS`（session / source / workflow 三组），与各 manager 内部 cap 同源。
- Zod schema：`RetentionSchema` 允许部分覆盖，未列字段回落默认值；非正整数被拒绝。
- 三个 manager 改为构造时读取 `options.retention`，移除原有顶层 `const MAX_*`；`server.ts` 透传 `cfg.retention.{session,source,workflow}`。
- 文档：新增 [docs/RETENTION.md](RETENTION.md)，列 cap 表 + 触发语义 + 配置示例，并指向相关测试。
- 测试覆盖：
  - [test/sessionManager.test.mjs](../packages/daemon/test/sessionManager.test.mjs) `SessionManager respects custom retention caps`
  - [test/sourceManager.test.mjs](../packages/daemon/test/sourceManager.test.mjs) `SourceManager respects custom retention caps`
  - [test/workflowManager.test.mjs](../packages/daemon/test/workflowManager.test.mjs) `WorkflowManager respects custom retention caps from constructor`
- 验证：`npm run build && npm test` → 73 pass / 2 POSIX-skip / 0 fail
- P0.2 验收 #3「保留策略有文档说明且可配置」由 [-] 升 [x]；#2「长时间运行不会出现无限制内存增长」按 Alpha 降级处理，8h 实地稳态压测移入 Beta 前验证。

---

## 方向校准后首批收口（2026-05-20）

### P-3 GUI workflow 缓存 retention 裁剪

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- 新增 `MAX_WORKFLOW_ITEMS_PER_THREAD=500` 与 `MAX_WORKFLOW_ITEM_IDS=8000`，与 daemon 默认 retention 保持同级别边界。
- `storeWorkflowItem` 改为先归一化和过滤，再进入去重集合，避免被忽略项污染 `workflowItemIds`。
- 单线程超过 cap 时裁掉最旧 workflow items，并同步从 `workflowItemIds` 删除，降低 WebView 长跑内存增长风险。
- GUI 侧同步增加 `MAX_WORKFLOW_THREADS=80` 和全局 `workflowItemIds` 裁剪，移除过期线程时同步清理 items、conversation 与代码块引用。

### P-4 CLI 输出 workflow item 稳定唯一 ID

- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)
- 将 CLI 输出 / prompt / exit 的 workflow item id 从 `timestamp + byteLength` 改为会话内单调序号。
- 修复同一会话、同一毫秒、同字节长度输出被 `WorkflowManager.appendItem` 去重误吞的风险。
- 测试：[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs) 新增 `workflow keeps same-length CLI output chunks emitted in the same millisecond`，通过覆写 `Date.now` 固定毫秒，断言两条同长度输出都进入 workflow snapshot。

### P-5 PTY 默认 debug stderr 降噪

- 路径：[packages/daemon/src/pty/runner.ts](../packages/daemon/src/pty/runner.ts)
- 默认不再输出 `[codepanion-debug]` 到 stderr。
- 仅当 `CODEPANION_DEBUG=1` 或 `LOG_LEVEL=debug` 时输出 PTY spawn / WebSocket 连接调试信息，避免污染被包装命令的 stderr。

### S-10 Windows 便携包 Node runtime 固定

- 路径：[scripts/package-windows.ps1](../scripts/package-windows.ps1)、[scripts/build-daemon-bundle.mjs](../scripts/build-daemon-bundle.mjs)
- 发布包内置 `node.exe` 固定为 `v24.14.1`，SHA256 固定为 `58E74BF02FC5BBACC41DCB8BEF089961CD5BDDD37830B87784E4FC624D145D1F`。
- `package-windows.ps1` 在复制前和复制后都校验 Node 版本与 SHA256，不一致时直接失败，避免把 PATH 中任意 Node 混入发布包。
- daemon bundle target 从 `node22` 调整为 `node24`，README / INSTALL / DEVELOPMENT / USER_GUIDE / REDESIGN 同步改为 Node 24.x 要求。

---

## P1.2 主对话低价值 workflow 内容收敛（2026-05-20）

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- 主对话不再展开工具调用、命令输出和普通完成状态的原始内容，避免用户看到难懂的内部事件和参数。
- 主对话保留：用户目标、AI 可读回复、等待输入、错误、关键文件/代码产出。
- 工具调用 / 命令输出默认只进入统计摘要；只有文件变更、artifact 或错误才生成简短活动摘要，不再附带 rawItems 原文。

---

## P1.2 启动闪烁与 Codex 审批 JSON 噪音修复（2026-05-20）

- 路径：[packages/daemon/src/adapters/codexDesktopAdapter.ts](../packages/daemon/src/adapters/codexDesktopAdapter.ts)
- Codex Desktop 同步现在会过滤只包含 `risk_level`、`user_authorization`、`outcome`、`rationale` 的审批 / 沙箱决策 JSON，避免它们作为主消息进入 GUI。
- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- workflow snapshot / workflow event 渲染改为 `requestAnimationFrame` 防抖，启动同步大量历史时不再逐条 `renderAll()`。
- 自动滚动在批量同步和追加消息时使用 `auto`，只保留必要的稳定定位，避免启动阶段 smooth scroll 动画叠加造成闪烁。
- 测试：[packages/daemon/test/codexDesktopAdapter.test.mjs](../packages/daemon/test/codexDesktopAdapter.test.mjs) 覆盖审批 JSON 过滤。

---

## P1.1 统一来源元数据字段（2026-05-20）

- 路径：[packages/daemon/src/shared/protocol.ts](../packages/daemon/src/shared/protocol.ts)、[packages/daemon/src/daemon/sourceManager.ts](../packages/daemon/src/daemon/sourceManager.ts)
- `/sources/register` 新增统一元数据字段：`capabilityLevel`、`integrationKind`、`privacyBoundary`。
- daemon 会按 `kind` 自动派生默认值：CLI / Claude / Codex 为 L3 + `cli-pty` + `explicit-session`；Codex Desktop 为 L2 + `local-file-sync` + `local-history`；VS Code 为 L2 + `extension` + `explicit-extension`；CC Switch 为 L1-L2 + `config-switcher`；AI 工具进程扫描为 L1-L2 + `process-scan`。
- 外部适配器仍可显式覆盖这些字段，避免 GUI 只能按 source 名称猜能力。
- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- GUI 消息模型透传统一元数据，并优先用 daemon 元数据展示能力层级、接入方式和隐私边界。
- 测试：[packages/daemon/test/sourceManager.test.mjs](../packages/daemon/test/sourceManager.test.mjs) 覆盖首方来源默认元数据和外部适配器覆盖。

---

## P1.0 CC Switch 账号 / Provider 切换兼容（2026-05-20）

- 路径：[packages/daemon/src/shared/protocol.ts](../packages/daemon/src/shared/protocol.ts)、[packages/daemon/src/adapters/aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts)
- 新增来源类型 `cc-switch`，用于识别 CC Switch / Claude Code Switch 类账号与 provider 切换工具。
- AI 工具扫描器新增常见命令和进程识别：`cc-switch`、`ccs`、`ccswitch`、`claude-code-switch`、`@*/cc-switch`、`@*/claude-code-switch`。
- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- GUI 将 `cc-switch` 显示为 `CC Switch`，能力层级为 `L1/L2 配置切换`，隐私边界为 `配置切换器`。
- 路径：[docs/MONITORING_SOURCES.md](MONITORING_SOURCES.md)、[docs/API.md](API.md)、[README.md](../README.md)
- 文档明确推荐流程：先用 CC Switch 切换账号 / provider，再通过 `codepanion run -- <ai-cli>` 接管实际任务。CodePanion 不读取 `~/.claude`、`~/.codex`、账号 token、cookie 或供应商认证文件。
- 测试：[packages/daemon/test/aiToolProcessAdapter.test.mjs](../packages/daemon/test/aiToolProcessAdapter.test.mjs) 覆盖 CC Switch 进程名、Claude Code Switch npm 命令和 `ccs` alias。

---

## P3c 最小 CI 流水线（2026-05-20）

- 路径：[.github/workflows/ci.yml](../.github/workflows/ci.yml)
- 新增 Windows GitHub Actions 基线：`npm ci`、`git diff --check`、`npm test`、`npm run validate:extensions`、`dotnet build packages/gui/CodePanion.Gui.csproj -c Release`、`npm run package:windows`。
- CI 固定 Node.js `24.14.1` 和 .NET SDK `8.0.x`，并把 `CODEPANION_NODE_PATH` 指向 runner 上的 Node，以复用发布脚本里的版本与 SHA256 校验。
- 路径：[INSTALL.md](../INSTALL.md)
- 清理安装说明中残留的 Node 18 检查提示，统一为 Node 24。
- 本地验证：
  - `git diff --check` 通过，仅有 Windows 换行转换提示。
  - `npm run validate:extensions` 通过。
  - `npm test` 通过，77 pass / 2 skip / 0 fail。
  - `npm run package:windows` 通过，生成 `D:\CodePanion\dist\CodePanion-win-x64\CodePanion.Gui.exe`。
  - 打包 Node runtime：`v24.14.1`，SHA256 `58E74BF02FC5BBACC41DCB8BEF089961CD5BDDD37830B87784E4FC624D145D1F`。

---

## P3c WebSocket 鉴权与会话错配回归（2026-05-20）

- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)、[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs)
- 修复 `role=cli` 但缺少 `sessionId` 时被当成 observer 接入的问题；现在会关闭连接并返回 WebSocket close code `4400` / `missing sessionId`。
- 已有未知 session 行为继续保持为 `4404` / `no such session`。
- 新增回归测试：缺少 token subprotocol、错误 token subprotocol、旧 query token 鉴权、非法 Origin、WebView2 virtual host Origin、CLI 缺少或错配 session。

---

## 阶段 1 文档与 EXE 打包收口（2026-05-20）

- 路径：[docs/API.md](API.md)、[docs/MONITORING_SOURCES.md](MONITORING_SOURCES.md)、[docs/PHASE1_ACCEPTANCE.md](PHASE1_ACCEPTANCE.md)、[DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md)
- API 文档改为记录 WebSocket subprotocol token 鉴权，不再展示 query token 示例。
- 监控源文档补充 `POST /sources/:id/disconnect`，明确 VS Code 扩展停用或窗口关闭时应显式上报 offline。
- 阶段 1 验收清单同步当前自动化覆盖：来源断开、CLI workflow item ID 防碰撞、Codex Desktop adapter 解析、WebSocket 鉴权与 Origin 校验。
- 当前仍需补证据的验收项：真实 GUI 多会话截图/录屏、真实 Claude / Codex / VS Code+Copilot / Codex Desktop 样本证据；8 小时长跑内存曲线已降级为 Beta 前稳态验证，完整虚拟列表归 Beta 评估。
- 验证：
  - `npm run validate:extensions` 通过。
  - `git diff --check` 通过，仅有 Windows 换行转换提示。
  - `npm run package:windows` 通过，生成 `D:\CodePanion\dist\CodePanion-win-x64\CodePanion.Gui.exe`。
  - 打包 Node runtime：`v24.14.1`，SHA256 `58E74BF02FC5BBACC41DCB8BEF089961CD5BDDD37830B87784E4FC624D145D1F`。

---

## P1.3 GUI 断线恢复可见性（2026-05-20）

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)、[packages/gui/Services/DaemonClient.cs](../packages/gui/Services/DaemonClient.cs)
- GUI 收到 daemon 断线后：状态栏显示「正在后台重试」、重连按钮可见、WebView 事件流写入一次断线提示。
- 增加 `DispatcherTimer` 自动重连：每 2 秒尝试重新读取配置并连接 daemon；首次失败时会尝试自动启动随包 daemon，连接恢复后停止 timer。
- 连接恢复后：状态栏变为已连接、WebView 事件流写入恢复提示，daemon 端会在 observer WS 建连时自动推送 `workflow-snapshot`，GUI 使用现有 snapshot handler 恢复任务视图。
- `SendReplyAsync` / `SendMonitorEventReplyAsync` 改为返回成功状态；回复失败时 GUI 会写入明确错误事件，不再只写本地日志。
- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)、[packages/vscode-extension/extension.js](../packages/vscode-extension/extension.js)
- 新增 `POST /sources/:id/disconnect`，将来源标记为 offline 并广播 `source-disconnected`；VS Code extension 在 deactivate 时调用该接口。
- 测试：[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs) 覆盖来源离线广播、`GET /sources` offline 状态和未知 source 404。

---

## P0.3 验收场景补强（2026-05-19）

四条新集成测试加到 [packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs)。`npm test` 当前 70 通过 / 2 POSIX-only 用例在 Windows 跳过 / 0 失败。

### VS Code 来源注册端到端

- 通过 `/sources/register` 注册 `kind=vscode` 来源，断言：
  - HTTP 返回的 `kind` / `status` / `capabilities` 字段
  - observer WS 收到 `source-registered`
  - `GET /sources` 列出该来源（含 `workspace`）
  - 后续 `/events` 触发 observer 端 `monitor-event` 与 `workflow-event(item-append)`
  - `GET /workflow/threads` 出现对应 `source:` 线程

### 中文文本端到端

- 单个 session 走完 register → output → prompt → list → event 全链路，所有字段使用中文 + 全角符号 + emoji：
  - 中文 `cwd` / `args`、中文 prompt 内容 + 中文 options（`['是', '否']`）
  - HTTP GET 回读 `fullOutput` / `chunks` 字节级一致
  - observer WS 端 `session-output` / `session-prompt` / `monitor-event` 收到的字符串与发送方一致
  - `/sessions` 列表中的 `lastPrompt`、`cwd` 保留中文
- Express 已设 `Content-Type: application/json; charset=utf-8`，覆盖确认 fetch 解码正确
- GUI / WebView 端未在本次纳入：阶段 1 退出标准里仍标 `[-]`

### 多会话同时等待

- 注册 3 个 session（含中文 prompt、混合选项），分别 `markPrompt`，断言：
  - `/sessions` 中三者 `status: 'waiting'`，`lastPrompt` 各自独立
  - 每个 session 的 `outputChunks` 末尾 prompt chunk 内容正确
  - 任一 session 的 prompt 文本不会出现在其他 session 的 output 历史中

### daemon 重启 + workflow snapshot 恢复

- 用 `mkdtempSync` 建临时目录作为 `workflowSnapshotPath`
- 引入 `withServerSnapshot` 帮助函数：teardown 前先 `await workflows.flushSnapshot()`，再 close server
- Server #1：register session → prompt → exit(0)，断言 `/workflow/threads` 包含 `session:<id>` 线程
- Server #2（同一 snapshot 路径）：observer 连接后收到 `workflow-snapshot`，恢复的线程包含原 prompt content 和 `done` 状态项；`/workflow/threads` 也可见
- 修复 `waitForMessage` 在 server-on-connect 即时广播场景下的竞态：新增 `openWsBuffered`，在 `'open'` 触发前就挂 `'message'` 监听并缓冲消息，`wait(predicate)` 先扫缓冲再等新消息

---

## P1.2 主界面被动来源降噪与交互入口收敛（2026-05-20）

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- `source-registered` / `source-disconnected` 只更新来源状态，不再生成 Main Stage 对话，避免 CC Switch 这类配置切换器占用当前任务。
- 被动来源（CC Switch、国产 AI IDE/插件、Qwen Code 进程识别等）的普通 `activity` 事件不再进入主任务列表；只有 `prompt` / `error` 会显示。
- 任务列表、运行中计数、初始任务选择统一过滤被动 `source:*` 对话，避免大量相同窗口和重复内容。
- 无可回复 prompt 时隐藏顶部「回复/继续」、抽屉「定位回复框」和底部输入栏，避免显示不可交互控件。
- 路径：[packages/daemon/src/adapters/aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts)
- CC Switch 进程扫描从按 PID 注册改为按可执行文件身份去重，避免 Electron/桌面壳 helper 进程刷出多个重复来源。
- 测试：[packages/daemon/test/aiToolProcessAdapter.test.mjs](../packages/daemon/test/aiToolProcessAdapter.test.mjs) 覆盖 CC Switch 多 PID 同路径去重。

---

## P3c A-1 Zod schema 自动生成 C# DTO（2026-05-20）

- 路径：[packages/daemon/src/shared/protocol.ts](../packages/daemon/src/shared/protocol.ts)、[scripts/generate-csharp-dtos.mjs](../scripts/generate-csharp-dtos.mjs)、[packages/gui/Models/Generated/ProtocolDtos.g.cs](../packages/gui/Models/Generated/ProtocolDtos.g.cs)
- 把 `MonitorSource` interface 升为 `MonitorSourceSchema`（Zod），与 `SessionInfoSchema` / `MonitorEventSchema` 一起作为 GUI DTO 单一真相来源。`registeredAt` / `lastSeenAt` / `startedAt` 补 `.int()`，避免被生成器推断成 `double`。
- 新增生成器 `scripts/generate-csharp-dtos.mjs`：导入编译后的 `protocol.js`，递归解开 `optional / nullable / default` 包装，把 Zod 类型映射到 C# 类型；`pid` / `exitCode` 通过 `FIELD_TYPE_HINTS` 保留为 `int?`；其余整数走 `long`；枚举映射为 `string`，与现有 GUI 调用方一致。`MonitorEventInfo` 由 `MonitorEventSchema` + `id`（运行时由 daemon 注入）+ 收紧为必需的 `timestamp` 三段合并生成。
- 输出文件标记 `<auto-generated />`、放在 `CodePanion.Gui.Models` 命名空间，被 `Services/DaemonClient.cs` 通过原有 `using CodePanion.Gui.Models;` 直接消费。删掉手写的 `SessionInfo` / `MonitorSourceInfo` / `MonitorEventInfo`（三处重复定义已合并）。
- 同时修复 P1.1 引入但 GUI 一直丢失的字段：`CapabilityLevel` / `IntegrationKind` / `PrivacyBoundary` 现在能从 `source-registered` 透传到 WebView，对应 `chat.js` 既有的 `message.capabilityLevel || message.CapabilityLevel` 回退。
- 新增 npm 脚本：`gen:dtos` 重新生成；`validate:dtos` 以 `--check` 比对 `protocol.ts` 与已提交的 `.g.cs`，不一致时退出码 1。`npm test` 末尾自动跑 `validate:dtos`，CI Windows job 复用现有 `npm test` 步骤即可拦截漂移。
- 验证：
  - `npm test` → 83 pass / 2 skip / 0 fail，`validate:dtos` 通过。
  - `npm run gui:build` → 0 警告 / 0 错误。
  - `git diff --check` 仅 CRLF 警告，无空白错误。

### 代码审核纠偏（2026-05-20）

针对 A-1 落地后的代码审查，修补了 5 处隐患：

- 生成器写盘前把模板字面量里的 CRLF 归一为 LF（`rawContent.replace(/\r\n/g, '\n')`），新增 [.gitattributes](../.gitattributes) `*.g.cs text eol=lf`，避免 Windows 工作树每次 `gen:dtos` 都产生 CRLF↔LF churn。
- `FIELD_TYPE_HINTS` / `FIELD_DEFAULT_HINTS` 的 key 改为 `"SchemaName.fieldName"` 形式，避免未来在不同 schema 上引入同名字段时被误覆盖。
- 新增 `FIELD_DEFAULT_HINTS`，把审查前丢失的 `SessionInfo.Status = "running"` / `MonitorSourceInfo.Status = "online"` 等手写 DTO 语义默认值显式补回，对应 schema enum 字段没有 Zod default 的事实。
- `isIntegerNumber()` 在 `ZodNumber` 带 checks 但都不是 int 标志时，会通过 `CODEPANION_DEBUG=1` 或 `LOG_LEVEL=debug` 输出 `[gen-dtos]` 警告而不是静默回退 `double`，便于在 Zod API 变更时第一时间发现。
- 嵌套 `ZodObject` 直接 `throw`，强制后续 schema 扩展显式更新生成器，而不是默默退化成 `object`。
- 新增 [packages/daemon/test/generateCsharpDtos.test.mjs](../packages/daemon/test/generateCsharpDtos.test.mjs)（4 用例）：`--check` 与已提交文件一致 / 漂移退出 1 / 在 CRLF 文件上仍判定一致 / write 模式输出仅含 LF。
- 验证：
  - `npm test` → 87 pass / 2 skip / 0 fail（含 4 个新生成器用例）。
  - `npm run gui:build` → 0 警告 / 0 错误。
  - `npm run validate:dtos` → 通过。

---

## P1.3 observer 重连恢复验证（2026-05-20）

- 路径：[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs)
- daemon 侧已有的恢复机制：observer WS 握手后 server 主动推送 `hello` + `workflow-snapshot`（[packages/daemon/src/daemon/server.ts:518-519](../packages/daemon/src/daemon/server.ts#L518-L519)）。先前测试覆盖的是 daemon 进程重启路径，缺一条「daemon 不重启、客户端短暂断网」的回归。
- 新增集成用例：observer 连接 → 接收实时事件 → 主动断开 → daemon 期间继续接收 prompt / output / 新 session / exit → 第二个 observer 连接 → 校验 `workflow-snapshot` 包含断线前后所有线程与 item，并验证重连后实时事件链路仍可继续推送。
- 串本地链路时发现旧测试断言写错了消息形状：daemon 广播的是 `workflow-event` + `event.action='item-append'`，不是直觉上的 `workflow-item`。新测试按 [packages/daemon/src/shared/protocol.ts:218-219](../packages/daemon/src/shared/protocol.ts#L218-L219) 修正后通过。
- 验证：`npm test` → 90 tests / 88 pass / 2 skip / 0 fail，含新增的 observer 重连用例。

---

## P1.3 客户端 / 适配器失败日志富化（2026-05-20）

- 路径：[packages/daemon/src/shared/client.ts](../packages/daemon/src/shared/client.ts)、[packages/daemon/src/pty/runner.ts](../packages/daemon/src/pty/runner.ts)、[packages/daemon/src/adapters/codexDesktopAdapter.ts](../packages/daemon/src/adapters/codexDesktopAdapter.ts)、[packages/daemon/test/daemonHttpError.test.mjs](../packages/daemon/test/daemonHttpError.test.mjs)
- 出发点：runner 里 `postPrompt/postOutput/postExit` 全部 `.catch(() => {})` 静默吞错；client.ts HTTP 失败只抛 `new Error(...)` 文本串，无 enumerable 字段可供 pino 序列化；`checkHealth` catch 完全吞掉异常。daemon 半故障时用户在 GUI 看到状态不同步但本地终端无任何痕迹。
- 改动：
  - 新增 `DaemonHttpError extends Error`：携带 `method` / `path` / `status` / `body`（body 截 4096，message snippet 截 200）。所有 HTTP 失败统一走它。
  - `checkHealth()` 返回 `{ ok, pid?, error? }`：catch 路径把 `err.message` 写入 `.error`，runner 在 `daemon is not running` 提示后追加 `(error)`，便于区分 daemon 没起 vs. 端口被占。
  - runner 三处 `.catch(() => {})` → `reportClientFailure(label)`，仅在 `CODEPANION_DEBUG=1` / `LOG_LEVEL=debug` 时通过 `debug()` 写 stderr，PTY stdout 不被污染；ws.error / message parse 同样补上 debug 记录。
  - `codexDesktopAdapter.scan()` 给 `consume(path)` 包了 per-file try/catch，单文件解析失败带 `{ file, offset }` 上下文继续，整个 scan pass 不再因为一个坏文件中断。
- 测试：6 用例覆盖 `DaemonHttpError` 字段填充、字符串截断、`instanceof` 判别、`maskValue` 保留字段、pino logger 实际写出 `status=500` 等结构化字段。
- 验证：`npm test` → 96 tests / 94 pass / 2 skip / 0 fail。`npm run gui:build` 不受影响（client.ts 不导出给 C#）。

---

## 产品图标替换（2026-05-20）

- 路径：[packages/gui/Assets/app-icon-source.png](../packages/gui/Assets/app-icon-source.png)、[scripts/install-icon.ps1](../scripts/install-icon.ps1)、[packages/gui/icon-README.md](../packages/gui/icon-README.md)
- 把图标真相来源固化为 `Assets/app-icon-source.png`，所有派生产物（`app-icon.ico` / `tray-icon.ico` / `app-icon-64.png` / `app-icon-256.png`）由 `scripts/install-icon.ps1` 一键生成。
- 脚本只依赖 PowerShell 5.1 自带的 `System.Drawing`，不引入 ImageMagick 或 Node 二进制；自己拼 ICONDIR/ICONDIRENTRY 容器并存 32-bit PNG 帧，Vista+ 原生支持。
- 关键决策：
  - 自动 trim 阈值 245，剔除浅色背景外的纯白边距，**保留**圆角矩形容器本体（与产品视觉风格一致）。
  - app-icon.ico 含 16/24/32/48/64/128/256，tray-icon.ico 仅含 16/24/32/48（小尺寸优化）。
  - 中文注释全部去掉：PowerShell 5.x 在无 BOM 时按 CP936 解析脚本，遇到 UTF-8 中文会触发 parser 错误。
  - `dist/` 下的旧副本不动；下一次 `npm run package:windows` 会从 `packages/gui/Assets` 重新复制。
- 验证：`npm run gui:build` → 0 警告 / 0 错误，新图标已嵌入 dll 资源。

---

## 验证命令清单

提交前通用基线：

```powershell
npm test
npm run build
npm run gui:build
npm run validate:extensions
dotnet build packages/gui/CodePanion.Gui.csproj -c Release
git diff --check
```

发布包：

```powershell
npm run package:windows
git check-ignore -v dist packages/gui/bin packages/gui/obj
```

压测（按需）：

```powershell
npm run stress:workflow -- --duration 300 --rate 100
```

---

## P1.1 Codex Desktop 线程标题与状态识别质量（2026-05-20）

### 现象与根因

`codexDesktopAdapter.ensureThread()` 之前每条 item 都用 `isFreshTimestamp(timestamp) ? 'running' : 'done'`
无条件 upsert：

- `task_complete` 把 thread.status 置为 `done` 之后，下一条 fresh 时间戳的 item 会把状态刷回
  `running`，GUI 上「已完成」的任务一直回到「进行中」。
- `titleFromPath` 输出形如 `Codex 12-00-00-019abcd-1234`（保留时间分秒和 UUID 段），用户看不出
  来自哪个会话；用户消息里通常有更明确的语义，但当时没有任何升级机制。

### 修复

[packages/daemon/src/daemon/workflowManager.ts](../packages/daemon/src/daemon/workflowManager.ts)

- 新增 `getThread(id)` 公开方法，供 adapter 在不构造 snapshot 包装的前提下查询线程当前状态。

[packages/daemon/src/adapters/codexDesktopAdapter.ts](../packages/daemon/src/adapters/codexDesktopAdapter.ts)

- `ensureThread()` 先调 `getThread()`，命中即直接返回，不再覆盖已有 status / title。
  终止状态（`done` / `error`）由后续 item 自然推进，stale fresh-timestamp 不会回刷。
- `titleFromPath()` 改成只提取 `YYYY-MM-DD`，输出 `Codex 2026-01-15`；未匹配时回退到 basename。
- 新增 `isDegradedTitle()` / `summarizeUserMessage()` / `maybeUpgradeTitle()`：
  线程标题仍是降级形态时，首条 `user_message` 的内容（去 code fence、collapse 空白、≤60 字符）
  会替换为更可读的标题；已经有 workspace basename 等"真"标题时不动。

### 验证

```bash
npm test
```

- `packages/daemon/test/codexDesktopAdapter.test.mjs` 新增 6 个用例：
  - `titleFromPath` 只保留日期段
  - `isDegradedTitle` 识别 placeholder / 历史形态 / 真实标题
  - `summarizeUserMessage` 折叠空白、截断带省略号、剥离 code fence
  - `task_complete` 之后的 fresh item 不再把状态刷回 running
  - 无 session_meta 时，首条 user_message 升级降级标题；后续 user_message 不再覆盖
  - 已有 workspace 派生的标题（`example`）不会被 user_message 覆盖
- 全量 `npm test` 通过：102 用例，100 pass / 2 skipped / 0 fail。

---

## P2.1 / P2.2 故障排查与安装文档校准（2026-05-20）

### 现象与根因

- `docs/TROUBLESHOOTING.md` 引用了已经不存在的 `test-connection.js` / `diagnose.bat`，
  WebSocket URL 还是老式 `?token=xxx&role=observer`（P3b S-4/S-5 之后改为 subprotocol token），
  并夹杂"我们正在考虑切换 WebSocket 实现"等过时的工程内部话语。
- `INSTALL.md` 中"方法 2: 使用预编译版本（即将推出）"过时（Windows 便携版已发布）；
  "可选：添加资源文件 - 取消注释 ApplicationIcon" 与现实矛盾（已经有真实图标）；
  "建议使用管理员权限运行" 误导用户（daemon 只绑 127.0.0.1，不需要 admin）；
  故障排查节大量与 TROUBLESHOOTING.md 重复，新用户读两份会困惑。
- `README.md` 占位仓库地址 `yourusername/codepanion`；Notifier 段落声称"支持
  macOS/Linux"，但 Alpha 实际只验证 Windows，与产品边界矛盾。

### 修复

[docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)

- 全量重写。重组为 7 个小节：daemon/GUI 没连上、WebSocket 失败、文字乱码、
  多源监控、通知、收集反馈、已知限制。
- 明确写出当前 WS 鉴权约定（`Sec-WebSocket-Protocol: codepanion.token.<token>`
  + Origin 校验），不再保留 query token 例子。
- 删除所有不存在的诊断文件引用。

[INSTALL.md](../INSTALL.md)

- "方法 2" 改为指向真实的 Windows 便携版发布流程，强调 SHA256 校验。
- "可选：添加资源文件"重写为"资源文件已内置 + 替换图标流程"，引用 `scripts/install-icon.ps1`。
- 故障排查节收敛为安装期常见 4 项，运行期问题统一指向 TROUBLESHOOTING.md。
- 删除"建议使用管理员权限"等错误提示。

[README.md](../README.md)

- 占位 clone URL 改为真实 `https://github.com/Vantalens/CodePanion.git`。
- Notifier 描述与"当前 Alpha 仅在 Windows 10/11 上验证"对齐。

### 验证

- 文档变更不涉及代码逻辑，`npm test` 维持 100 pass / 2 skipped / 0 fail。
- 手工核对：`ls test-connection.js diagnose.bat` 已经不存在；
  `Sec-WebSocket-Protocol` 鉴权路径在 [packages/daemon/src/daemon/server.ts:402](../packages/daemon/src/daemon/server.ts#L402) 落地。

---

## 复盘审计与缺陷修复（2026-05-20）

对前面几轮提交（P1.1 Codex 标题升级、P1.3 客户端日志富化、P2.1/P2.2 文档梳理）
做一次回头审计，发现以下需要修补的缺陷：

### 文档遗留占位符

- [packages/gui/SettingsWindow.xaml:98](../packages/gui/SettingsWindow.xaml#L98)
  与 [docs/USER_GUIDE.md:747](USER_GUIDE.md#L747) 仍然引用 `yourusername/codepanion` 占位符。
- 之前一轮把 `README.md` 的 clone URL 改成了 `Vantalens/CodePanion.git`，但 git
  remote 实际还是旧名 `Vantalens/RemindAI.git`。与用户确认按目标名（CodePanion）统一，
  仓库改名后 origin 自动对齐。
- 修复：上述两处占位符统一改为 `Vantalens/CodePanion`。

### INSTALL.md 的 `pwsh` 引用

[INSTALL.md](../INSTALL.md) 替换图标流程之前写的是 `pwsh scripts/install-icon.ps1`，
但 Windows 默认只装 PowerShell 5.x（`powershell.exe`），没有 `pwsh` 别名除非装了
PowerShell 7。修复为 `powershell -ExecutionPolicy Bypass -File scripts\install-icon.ps1`，
PowerShell 7 用户的 `pwsh` 写法作为备注。

### WorkflowManager.getThread 缺少直接单元测试

P1.1 引入的公共方法 `getThread(id)` 之前只通过 codexDesktopAdapter 的集成测试间接覆盖。
现补 [packages/daemon/test/workflowManager.test.mjs](../packages/daemon/test/workflowManager.test.mjs)
直接用例：未注册的 id 返回 `undefined`、注册后返回 live 引用、appendItem 改状态后
立即可读到。

### 验证

```bash
npm test
cd packages/gui && dotnet build -nologo -v quiet
```

- 全量测试 103 用例：101 pass / 2 skipped / 0 fail（比之前多一个 getThread 用例）。
- GUI 构建：0 警告 0 错误。
- `git remote -v` 仍为 `Vantalens/RemindAI.git`；仓库改名属用户操作，不在本轮范围。

## P1.1 VS Code 扩展事件价值提升（2026-05-20）

### 背景

之前 [packages/vscode-extension/extension.js](../packages/vscode-extension/extension.js) 只 hook 了
`onDidEndTaskProcess` 和 `onDidOpenTerminal`，任务失败也只发 `'done' / 'error'` type
但没透传 `level` 字段，且 `postEvent`/`disconnectSource` 失败被 `.catch(() => {})` 静默
吞掉，与 P1.3「适配器与客户端失败日志足以定位问题」相悖。多 workspace 时还用 `;` 连
完整路径，可读性差。

### 改动

只用 VS Code 公开 API，把任务与调试两个高价值生命周期补齐，并把失败日志拉齐：

- 新增 `logFailure(label, method, route, err)` helper，统一打印
  `[CodePanion] <label> <method> <route> status=... — <message>`，替换所有 `.catch` 静默。
- `request()` 失败时构造带 `.status` / `.method` / `.route` 的 Error，便于 logFailure 显示
  HTTP 状态码。
- `workspaceName()` 改用 `path.basename(folder.uri.fsPath)`、` + ` 连接，多 workspace
  时不再打印完整路径。
- `registerSource` 的 `capabilities` 增补 `'debug'`。
- 新增 hook（全部公开 API）：
  - `vscode.tasks.onDidStartTaskProcess` → `type: 'activity'`，标题 `任务启动：${name}`。
  - 现有 `onDidEndTaskProcess` 拆分：退出码 0 发 `type: 'done'` + `level: 'done'`；
    非 0 发 `type: 'error'` + `level: 'error'`，content 带退出码。
  - `vscode.window.onDidCloseTerminal` → `type: 'activity'`，标题 `终端已关闭`。
  - `vscode.debug.onDidStartDebugSession` → `type: 'activity'`，标题 `调试开始：${name}`。
  - `vscode.debug.onDidTerminateDebugSession` → `type: 'done'`，标题 `调试结束：${name}`。
- [packages/vscode-extension/package.json](../packages/vscode-extension/package.json) 的
  `description` 更新为「Reports VS Code window, task lifecycle, terminal, and debug
  session activity to CodePanion daemon.」。

### 不做

- 不 hook `onDidChangeWindowState`：高噪声低价值。
- 不接入 Copilot Chat / 第三方扩展私有状态：违反产品边界。
- 不引入 `codepanion.events.*` 子配置开关：过早抽象，保留 `codepanion.enabled` 一键关闭。

### 测试

[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs)
新增「VS Code 来源的 done / error 事件映射为 workflow status item」用例：

- vscode 来源 POST `type: 'done'` 任务事件 → observer 收到 `workflow-event`
  `kind: 'status'`、`status: 'done'`、source 为 `vscode`、title 命中 `/任务完成/`。
- vscode 来源 POST `type: 'error'` 退出码 1 → observer 收到 `kind: 'status'`、
  `status: 'error'`、title 命中 `/任务失败/`、content 含 `退出码：1`。

### 文档

- [docs/MONITORING_SOURCES.md](MONITORING_SOURCES.md) VS Code 行：能力列从「上报任务结
  束、终端打开等事件」改为「上报任务启动 / 完成 / 失败、终端打开 / 关闭、调试会话
  起止等公开 API 事件」；边界列补「不接入 Copilot Chat 私有 API」。

### 验证

```bash
npm test
npm run validate:dtos
```

- 全量测试 104 用例：102 pass / 2 skipped / 0 fail（新增 done/error 用例）。
- DTO 漂移检测：clean。
- VS Code 扩展自动化测试需要 VS Code Extension Host，超出 Alpha 范围；
  daemon 端集成测试已覆盖事件契约。

## P1.1 国产工具优先级梯队收敛（2026-05-20）

### 背景

[docs/MONITORING_SOURCES.md](MONITORING_SOURCES.md) 里有「首批 / 下一梯队」叙述，但
[packages/daemon/src/adapters/aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts)
的 `TOOL_PROFILES` 没有任何字段表达梯队归属，文档与代码靠记忆对齐。同时 MarsCode、
Qwen Code 在文档里属于「下一梯队」，但在 `TOOL_PROFILES` 中和首批工具混排，难以审计。

### 改动

- 新增 `ToolTier` 类型 (`'first' | 'second' | 'switcher'`) 和 `ToolProfile.tier` 字段，
  在 `TOOL_PROFILES` 中显式标注每一项的梯队归属：
  - first: `lingma`、`codebuddy`、`trae`、`comate`、`codegeex`
  - second: `marscode`、`qwen-code`
  - switcher: `cc-switch`
- 文件内 `TOOL_PROFILES` 顺序也按 tier 重新分组（first → second → switcher 之外的
  特殊项保持原位），方便人眼审计。
- 没有改动扫描行为：tier 只是元数据，目前不参与排序或事件过滤，留给后续 GUI / 通知
  按需消费。

### 文档

[docs/MONITORING_SOURCES.md](MONITORING_SOURCES.md) 的「国产 AI 工具覆盖策略」一节重写：

- 新增 `tier` 判定标准表（首批 / 观察 / 切换器 的入选条件与能力诉求）。
- 列出每个 `kind` 当前所处 tier 与当前能力，便于和代码对照。
- 把「不在 `TOOL_PROFILES` 但保留观察」的工具单列：CodeArts / Qoder 独立 IDE / 其他
  外部适配器接入 —— 写明各自不写死正则的原因，避免在没有真实样本前堆砌进程匹配。
- 增补操作约定：新增 profile **必须** 声明 `tier`，并同步更新 tier 收敛单元测试。

### 测试

[packages/daemon/test/aiToolProcessAdapter.test.mjs](../packages/daemon/test/aiToolProcessAdapter.test.mjs)
新增「TOOL_PROFILES tier 收敛与 MONITORING_SOURCES.md 一致」用例：

- `TOOL_PROFILES.tier` 按 tier 聚合后，first / second / switcher 列表与文档表格完全一致。
- 遍历断言每个 profile 的 tier 都在合法枚举范围内，防止后续新增 profile 漏标。

### 不做

- 不基于 tier 改变扫描频率或事件等级：当前没有数据支持调整；先把元数据落地，让后
  续可以基于真实 Alpha 数据决定是否对 second 梯队降频。
- 不为 Qoder 独立 IDE / CodeArts 提前写正则：避免没有样本的"假识别"。

### 验证

```bash
npm test
npm run validate:dtos
```

- 全量测试 105 用例：103 pass / 2 skipped / 0 fail（新增 tier 收敛用例）。
- DTO 漂移检测：clean（本次未改 schema）。

## P1.0 固化 Claude Code 接入步骤（2026-05-20）

### 背景

Claude Code 接入路径之前散落在 [docs/USER_GUIDE.md](USER_GUIDE.md)（场景 1 + 命令参考）、
[packages/daemon/src/cli/install.ts](../packages/daemon/src/cli/install.ts)（hooks 安装注释）、
[README.md](../README.md)（基础命令）三个位置，没有一份能让新用户一次性看懂
「CLI/PTY、hooks、VS Code 终端、CC Switch」四条路径各自的能力等级、回复链路、限制与验收方式。

P1.0「固化 Claude Code 接入步骤」就是把这部分内容收敛成一份独立指南。

### 改动

新增 [docs/INTEGRATIONS_CLAUDE_CODE.md](INTEGRATIONS_CLAUDE_CODE.md)：

- 顶部 TL;DR 直接指明日常使用走 CLI/PTY（路径 A）。
- 接入路径总览表：四条路径分别标注能力等级、回复链路、适用场景。
- 路径 A（CLI/PTY）：启动命令、工作机制、L1/L2/L3 能力证据（含对 `server.ts:317` 的指向）、
  限制（中文/换行/不能接管已运行 Claude）、验收步骤。
- 路径 B（hooks）：`codepanion install claude-code` 行为、token 不入 settings.json 的原因
  链接到 P3b 的 S-3 记录、卸载策略（按 `codepanion-managed` tag）。
- 路径 C（VS Code 终端）：VS Code 扩展的能力与限制；明确不接管 PTY、不读 Copilot 私有 API。
- 路径 D（CC Switch + A）：和 MONITORING_SOURCES 里 switcher tier 的说明保持一致。
- 不做 / 边界一节：不读 `~/.claude/credentials.json`、不调私有 API、不把进程识别
  描述为深度接管、不做模型对话客户端。
- 故障排查：定位常见路径 A/B/C 问题，最后导向 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。

### 文档交叉链接

- [docs/README.md](README.md) 「开发文档」一节新增「Claude Code 接入指南」入口。
- [docs/USER_GUIDE.md](USER_GUIDE.md) 场景 1 顶部增加跳转指针，并把启动命令从
  `claude code` 改回真实可执行命令 `claude`（Claude Code CLI 的 binary 名是 `claude`，
  `claude code` 是个别旧文档里的别名笔误）。

### 不做

- 不写「最佳实践」类长文：Alpha 阶段实际使用样本还少，写出来也会过时。固化指南
  只描述当前可验证的能力，不做最佳实践猜测。
- 不在指南里塞中文截图：等里程碑 1.2「真实运行数据截图视觉验收」恢复后再补图。

### 验证

无代码改动，只跑文档基线：

```bash
npm test
npm run validate:dtos
```

- 测试：105 用例 103 pass / 2 skipped / 0 fail（不变）。
- DTO 漂移检测：clean（不变）。
- 人工验收：从 [docs/README.md](README.md) 的「开发文档」导航能跳到新指南；
  USER_GUIDE 场景 1 跳转链接生效；新指南的所有相对路径解析正确。

---

## P1.0 Codex 接入指南固化（2026-05-20）

### 背景

[DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) P1.0「固化 Codex 接入步骤」要求把
Codex 在 CodePanion 内的接入路径写成可执行步骤，与已经存在的
[INTEGRATIONS_CLAUDE_CODE.md](INTEGRATIONS_CLAUDE_CODE.md) 对称。

### 实施

新增 [docs/INTEGRATIONS_CODEX.md](INTEGRATIONS_CODEX.md)，结构对称 Claude Code 指南：

- 路径 A（Codex CLI/PTY 包装）：L3 完整，含启动命令、能力证据指向
  [packages/daemon/src/daemon/server.ts:317](../packages/daemon/src/daemon/server.ts#L317) 与
  [packages/daemon/test/server.integration.test.mjs:444](../packages/daemon/test/server.integration.test.mjs#L444)。
- 路径 B（Codex Desktop 本地 jsonl 同步）：**只读 L2**，明确不能向 Codex Desktop 写回；
  能力证据指向 [codexDesktopAdapter.test.mjs:106 / :169 / :305](../packages/daemon/test/codexDesktopAdapter.test.mjs)。
- 路径 C（VS Code 终端跑 Codex CLI）：L2 状态识别（VS Code 公开终端 / 任务事件）；**不直接接管 PTY**，L3 需切换至路径 A。扩展不接管 Copilot 私有状态。
- 路径 D（CC Switch + 路径 A）：账号切换不读 token。

### 不做 / 边界

- 不向 Codex Desktop 写回（路径 B 的 L3 明确缺位）。
- 不调用 Codex CLI 私有 API、不读取上游 `~/.codex/credentials.json`。
- 不把进程级识别包装成「Codex Desktop 完整集成」。

### 文档交叉链接

- [docs/README.md](README.md) 「开发文档」新增 Codex 接入指南导航。

---

## P1.0 能力证据矩阵（2026-05-20）

### 背景

P1.0「用真实 Claude / Codex / VS Code / CLI 样本逐项记录 L1/L2/L3 能力证据」需要把分散在
集成指南、监控源说明、测试文件里的 L1/L2/L3 声明聚合为一张可对账的表，让任何一行能力
声明都对应到代码与自动化测试。

### 实施

新增 [docs/CAPABILITY_EVIDENCE.md](CAPABILITY_EVIDENCE.md)：

- 5 条入口路径（A: CLI/PTY、B: Codex Desktop、C: VS Code、D: CC Switch、E: 外部适配器）
  + 国产 AI 工具 L1 进程识别 + 全链路横向证据，全部用「代码位置 → 测试文件:line」格式。
- 显式分离「自动化能覆盖的能力」与「需要真机样本的能力」。后者归入
  [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) P1.2「真实运行数据截图视觉验收」。
- 维护约定：新增一行 ⇒ 必须有对应自动化测试用例；不允许写「计划」「下一步」。

### 不做

- 不把矩阵当 SLA：能力声明严格等于「当前代码 + 当前测试可证伪」。
- 不在矩阵里展开真机截图（属于 P1.2 范围）。

---

## P3c CI validate:dtos 拦截可见性（2026-05-20）

### 背景

P3c「CI 在 PR 阶段拦截测试失败与 schema 漂移」中，DTO 漂移检测已经通过
`package.json` 的 `"test"` 脚本（`npm test` 末段调 `validate:dtos`）执行，但 CI 步骤名
只显示 `Run daemon tests`，看不到漂移检测覆盖范围。

### 实施

[.github/workflows/ci.yml](../.github/workflows/ci.yml) 把步骤名改为
`Run daemon tests + DTO drift check`，明确该步骤同时拦截测试失败与 schema 漂移；
不引入冗余的独立 `npm run validate:dtos` 步骤（已经被 `npm test` 覆盖）。

### 不做

- 不把 `validate:dtos` 拆成独立 CI step：会重复跑 schema 比对，浪费 CI 时间。
- 不在本地 pre-commit 强制跑 `validate:dtos`：已经在 `npm test` 里，开发者 push 前自然会跑。

---

## P2.2 全仓文档不夸大能力 + 定位一致审计（2026-05-20）

### 背景

P2.2「文档不夸大当前能力」与「仓库内产品定位始终一致」需要一次性扫描，确认没有
「深度集成」「深度接管」「全自动」之类的夸大表述，所有面向用户的文档对产品定位口径一致。

### 实施

#### 扫描结果

- 搜索 `深度集成|深度接管|全自动|完整接管` —— 命中只出现在 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md)
  与 [docs/MONITORING_SOURCES.md](MONITORING_SOURCES.md) 的「**不**……」边界声明里，
  属于产品 guardrails 文案，保留。
- 搜索 `RemindAI|yourusername` —— 命中只在 [docs/IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md)
  的历史变更说明里，作为「过去叫这个」的事实陈述存在，保留。

#### 定位口径校准

[docs/PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md)、[docs/ARCHITECTURE.md](ARCHITECTURE.md)、
[README.md](../README.md)、[INSTALL.md](../INSTALL.md)、[docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
口径统一为「本地优先、供应商中立、单入口多出口的 AI 开发工作流控制台 / 控制平面」。

#### REDESIGN.md 标历史草案

[docs/REDESIGN.md](REDESIGN.md) 是 v2.0 时期的设计稿，部分要点（控制平面定位、能力分层、
L1/L2/L3 来源边界）已落地，但代码片段中的 Focus Assist 检测、WebView2 通信骨架仅作设计参考。
头部状态从「设计阶段」改为「历史草案 — 部分要点已落地，代码片段中的 Focus Assist 等
示例**未实现**」，避免误导读者把示例当作当前代码。

### 验证

```bash
npm test
npm run validate:dtos
```

文档审计无代码改动；上述命令仍 clean。

### 不做

- 不删除 REDESIGN.md：历史思考路径对未来重构仍有参考价值。
- 不重写 IMPLEMENTATION_LOG.md 历史变更：作为审计记录保留。


---

## P3c P-6 npm audit 授权与执行（2026-05-20）

### 背景

P3c「P-6 `npm audit` 安全审计流程确认」明确要求「依赖元数据外发边界，获得允许后再执行」。
用户在 2026-05-20 授权后执行。

### 执行

```bash
npm audit
# found 0 vulnerabilities

npm audit --json | jq .metadata
```

### 结果

- 总依赖：211（prod 122 / dev 90 / optional 27 / peer 0）
- 漏洞分布：info 0 / low 0 / moderate 0 / high 0 / critical 0
- 总数：0

### 不做

- 不把 `npm audit` 加进 CI 自动运行：每次外发 lock 元数据到 npm registry，不符合
  「本地优先 / 最小采集」原则。沿用「人工授权 → 手动执行 → 记录到日志」流程。
- 不写「npm audit 看门狗」脚本：和上一条同理；当依赖出现高危时，用户主动跑即可。


## 第二轮代码审查遗留修复（2026-05-20）

第二轮深度审查发现的 2 个 Blocking + 4 个 Should-Fix，全部在本轮内闭环。审查覆盖与
工程修复见 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) P3a/P3b/P3c 章节。

### B-1 SourceManager 离线来源内存泄漏（修复）

**根因**：`SourceManager.disconnect(sourceId)` 只把 `source.status` 改成 `'offline'` 并
广播 `source-disconnected`，**从未** 调用 `this.sources.delete()`。`aiToolProcessAdapter`
的进程扫描循环会在 daemon 长时间运行后持续注册新来源，进入 offline 后留在 Map 中无限
累积，直接踩中 P0.2「daemon 长时间运行不会出现无限制内存增长」红线。

**修复**：

- [packages/daemon/src/daemon/sourceManager.ts](../packages/daemon/src/daemon/sourceManager.ts) 新增
  `pruneOfflineSources()`：按 `lastSeenAt` 升序保留最新 N 条 offline 来源，溢出者 `sources.delete()`
  并记 `offline monitor source evicted` 日志。`disconnect` 末尾调用一次。
- [packages/daemon/src/config.ts](../packages/daemon/src/config.ts) `RETENTION_DEFAULTS.source.offlineSources` 默认 50；
  Zod schema 增加同名字段，沿用现有 `retention.source.*` 风格。
- [docs/RETENTION.md](RETENTION.md) cap 一览表新增「离线来源缓存」行，并在「触发与丢弃语义」
  说明不向 GUI 单独广播（GUI 已在 `source-disconnected` 时把状态改为 offline，daemon
  侧的 LRU 回收对外不可见）。
- [packages/daemon/test/sourceManager.test.mjs](../packages/daemon/test/sourceManager.test.mjs) 新增两条用例：
  - `SourceManager evicts oldest offline sources beyond cap` 覆盖溢出淘汰顺序。
  - `SourceManager keeps online sources regardless of offline cap` 防止在线源被误淘。

### B-2 validate-extensions.mjs 升级到真实激活契约校验（修复）

**根因**：旧脚本只检查 `package.json` 有 `main` 和 `engines.vscode` 两个字段，但 CI step
名是「Validate extension manifests」，给人错觉认为这是 manifest 校验。`activationEvents`
为空、`contributes.configuration.properties` 描述缺失、`main` 指向不存在的文件、扩展不
import `vscode` host API 等问题都检测不出。

**修复**：

- [scripts/validate-extensions.mjs](../scripts/validate-extensions.mjs) 重写为多段校验：
  - 强制字段：`name` / `displayName` / `version` / `publisher` / `description`。
  - `engines.vscode` 是 semver-range（用 `/^[~^>=<]*\d+(\.\d+){0,2}/` 粗匹配）。
  - `activationEvents` 必须是非空数组。
  - `main` 指向的文件实际存在；源码包含 `exports.activate` / `exports.deactivate` 字符；
    源码里至少出现一次 `require('vscode')`。
  - `contributes.configuration.properties.*` 每条都要有 `type` 与 `description`。
  - 全部失败汇总后退出码 1，单条失败不再短路。
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) step 名改为
  「Validate extension manifests + activation contract」，让 CI 输出与脚本实际做的事一致。

### S-2 兜底 500 错误响应接入 maskString 脱敏（修复）

**根因**：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts) 末尾
错误中间件直接把 `String(err?.message ?? err)` 写回 JSON 响应。`ENOENT, open
'C:\Users\Owen\...'` 这类带 homedir 的错误会把用户名经 HTTP 返回到 GUI（GUI 又会写
WebView 控制台日志，构成被动泄露）。logger 已统一过 `maskString`，但 HTTP 响应未走同一管道。

**修复**：

- [packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts) 错误中间件
  在写响应前先 `maskString(String(err?.message ?? err))`，与日志走同一脱敏规则
  （homedir → `~` / Bearer / token=... / 长 hex）。
- 单元覆盖由 [packages/daemon/test/logger.test.mjs](../packages/daemon/test/logger.test.mjs)
  的 11 条 maskString / maskValue 用例提供，未额外加端到端测试以免多触发同步错误路径。

### S-1 DEVELOPMENT_TASKS.md 历史行号锚点剥离（修复）

**根因**：P3a/P3b 历史段 5 处 `[label:行号](path#Lxxx)` 锚点指向的实际行号已漂移（例如
`server.ts:317` 现在是 `/sessions/:id/output` 而非 `/sessions/:id/prompt`），违反
[Feedback: doc layout](../../../../Owen/.claude/projects/d--Users-user9078bf5d-projects-agents-a0e76ac6e9/memory/feedback_doc_layout.md)
「DEVELOPMENT_TASKS.md 只放规划」与本日早些时候已经全面剥离行号锚点的方针。

**修复**：

- 用一段 `node -e` 替换 `\[label:N\]\(path#LN\)` 模式 → `[label](path)`（保留文件级链接，
  去掉具体行号），共匹配 5 处。命令 inline 在本节即可，不再单独脚本化。

### S-3 VS Code 扩展 postEvent 字段覆盖 footgun（修复）

**根因**：[packages/vscode-extension/extension.js](../packages/vscode-extension/extension.js)
`postEvent` 用 `Object.assign({ type, source, sourceId, ... }, extra || {})` —
caller 在 `extra` 中如果传同名 key（例如 `type`、`source`、`sourceId`、`timestamp`）会
**覆盖** 核心路由字段。当前 caller 都规矩，但这是 footgun。

**修复**：把 `Object.assign` 顺序倒过来，先放 `extra`，再用核心字段覆盖。注释明确
「caller 拿不到 type/source/sourceId/timestamp 的覆盖权」。

### S-4 VS Code 扩展每事件重复读盘（修复）

**根因**：`loadDaemonConfig` 在每次 `postEvent` / `request` 时都
`readFileSync(~/.projects/config.json) + JSON.parse + vscode.workspace.getConfiguration`。
密集事件（任务大量并发 / 调试断点风暴）下不必要的同步 I/O 直接堆在 extension host
事件循环上。

**修复**：

- 引入模块级 `cachedConfig`，首次访问填充，`invalidateConfig()` 清空。
- `activate` 中注册 `fs.watch(CONFIG_PATH, () => invalidateConfig())` 与
  `vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('projects') && invalidateConfig())`。
- 两个 disposable 都挂在 `context.subscriptions`，VS Code 卸载扩展时自动清理。
- 不做：不加 TTL 失效（fs.watch + settings 监听已覆盖所有外部变更来源）。

### 验证

```powershell
npm test                       # 105 pass / 0 fail / 2 skipped
npm run validate:dtos          # C# DTO 与 protocol.ts 一致
npm run validate:extensions    # manifest + activation contract ok
git diff --check               # 仅 LF/CRLF autocrlf warning
```

## 2026-05-20 阶段 2 本地工作流操作台

### S2.1-S2.4 工作流模板、编排、跨工具步骤和历史回放

**实现**：

- `codepanion template add/list/show/run/remove`：保存可参数化命令模板到 `~/.codepanion/workflow-templates.json`。
- `codepanion workflow add/list/show/run/remove/history/replay`：保存多步骤工作流到 `~/.codepanion/workflows.json`，执行历史写入 `~/.codepanion/workflow-runs.json`。
- 工作流步骤支持 `tool` 元数据、`after` 依赖、`checkpoint=true` 人工检查点、`template` 复用模板和 `{param}` 参数渲染。
- `workflow history --query <text>` 可搜索历史运行；`workflow replay <runId>` 使用历史参数重跑，也可继续用 `--set name=value` 覆盖。
- 修复 `codepanion start` 遇到陈旧 `daemon.pid` 时无法启动的问题：当 `/health` 不通时清理 stale pidfile，再启动新 daemon；`checkHealth()` 增加 1.5s 超时，避免健康检查长时间挂起。
- 修复 `runWithPty()` 成功退出后仍可能留下 stdin / resize / WebSocket handle 导致 CLI 不退出的问题。

**验证**：

```powershell
node --test packages/daemon/test/workflowTemplateManager.test.mjs      # 5 pass
node --test packages/daemon/test/workflowDefinitionManager.test.mjs    # 5 pass
codepanion workflow add/list/run/history                               # 临时本地 JSON 路径 smoke 通过
codepanion workflow run realcheck --yes                                # 两步骤 cmd.exe /c exit 0 真实执行 success
```

### GUI 真实不可用问题修复

**根因**：

- 用户实际运行的是 `dist\CodePanion-win-x64\CodePanion.Gui.exe` 便携包，源码构建通过不代表便携包已更新。
- 本机 `workflow-snapshot.json` 已膨胀到约 20MB / 8280 条 item，GUI 启动时需要一次性解析并渲染大量历史。
- 旧默认 `retention.workflow.itemsPerThread=500` 对 Codex Desktop 历史同步过大；单条 workflow item 也可能包含 40KB 以上内容。
- GUI 首次连接失败时会触发自动重连定时器，同时 `ConnectToDaemon()` 后续又会在 daemon 启动后主动连接，造成启动期连接竞态。

**修复**：

- 默认 workflow retention 降为 `threads=30`、`itemsPerThread=120`、`seenItems=4000`，并对旧默认配置自动迁移。
- `WorkflowManager` 对单条 item content 做 12000 字符上限截断，防止少数超长消息拖垮 snapshot。
- GUI 首次连接流程加 `_isReconnectInProgress` 保护，启动 daemon 期间停止自动重连定时器，避免并发连接。
- 重新生成 `dist\CodePanion-win-x64` 便携包，确保用户双击的 GUI 与 daemon bundle 都是修复后的版本。
- 已备份并压缩本机旧 snapshot：`workflow-snapshot.before-retention-fix.json`，当前 snapshot 降至约 2.6MB / 30 threads / 1446 items。

**验证**：

```powershell
npm run package:windows                    # 重新生成便携包
Start-Process dist\CodePanion-win-x64\CodePanion.Gui.exe
codepanion status                          # daemon running, pid=16876, port=7777
npm test                                   # 117 pass / 0 fail / 2 skipped
npm run validate:extensions                # manifest + activation contract ok
git diff --check                           # 仅 LF/CRLF autocrlf warning
```

---

## 2026-05-21 全仓审计 P0 修复

backlog 详见 [docs/CODE_REVIEW_2026-05-21.md](./CODE_REVIEW_2026-05-21.md)。下方记录 P0 五项的实际落地。

### P0-A 主聊天流不再被重连状态噪音淹没

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- 取消 `OnDaemonConnected` / `OnDaemonDisconnected` 里向 chat-stream 发 `SendStatusMessage` 的调用，仅保留窗口顶部状态条更新
- 重连状态属于「环境状态」而非「对话内容」，混入会话流违背产品 P0 看得懂原则

### P0-B 切换视图不再抢焦点重置 activeConversation

- 路径：[packages/gui/wwwroot/chat.js:247](../packages/gui/wwwroot/chat.js#L247)
- 仅当当前 active 在「全量 conversations」中已彻底消失时才回退到第一条；筛选导致暂不可见不触发重置
- 旧逻辑会在用户每次切换 view（如 all → waiting）时把光标拽回头部，违反「不抢焦点」原则

### P0-C VS Code 扩展配置命名空间笔误

- 路径：[packages/vscode-extension/extension.js](../packages/vscode-extension/extension.js)
- `vscode.workspace.getConfiguration('projects')` 改为 `'codepanion'`，与 `package.json` `contributes.configuration.title` 对齐
- 旧拼写永远拿不到用户设置，CapabilityLevel `port` 永远走默认 7777

### P0-D inject-input 与 spinner 输出的竞态

- 路径：[packages/daemon/src/daemon/sessionManager.ts:80](../packages/daemon/src/daemon/sessionManager.ts#L80)、[packages/daemon/src/pty/runner.ts:179](../packages/daemon/src/pty/runner.ts#L179)
- 旧实现一旦看到任意 output 立即清掉 `lastPromptOptions` / `currentPromptOptions`，spinner 心跳一闪就让 GUI 回复被判 `invalid-reply`
- 改为按 chunk 内容区分：
  - 仅含 `\r` 的覆盖式心跳（spinner）→ 保留 options
  - 含 `\n` 的真实输出 → 视为 CLI 已越过当前 prompt，清掉 options 防误注入旧选择
- daemon 与 CLI runner 两侧同步修复，保证 inject-input 收到时 currentPromptOptions 仍有效
- 回归测试：[packages/daemon/test/sessionManager.test.mjs](../packages/daemon/test/sessionManager.test.mjs) 新增 `keeps prompt options through spinner output`；原 `cannot reuse a stale prompt option after a reply or new output` 继续覆盖 `\n` 真输出场景

### P0-E observer 重连后 sessions/sources 视图恢复

- 路径：[packages/daemon/src/daemon/server.ts:524](../packages/daemon/src/daemon/server.ts#L524)、[packages/daemon/src/shared/protocol.ts:222](../packages/daemon/src/shared/protocol.ts#L222)、[packages/gui/Services/DaemonClient.cs:289](../packages/gui/Services/DaemonClient.cs#L289)
- 增补 `sessions-snapshot` / `sources-snapshot` 两个 WsServerEvent，observer 握手后立刻和 workflow-snapshot 一起下发
- C# 端在 `DaemonClient` 暴露 `SessionsSnapshotReceived` / `SourcesSnapshotReceived` 事件，`MainWindow` 重新填充 `_sessions` 集合并把每个来源以 `source-registered` 形态投给 WebView
- `SessionInfoSchema` 增补 `lastPromptOptions`，便于重连后 GUI 在等待中的会话上仍能展示选项
- DTO 同步：`npm run gen:dtos` 重新生成 [packages/gui/Models/Generated/ProtocolDtos.g.cs](../packages/gui/Models/Generated/ProtocolDtos.g.cs)，`npm run validate:dtos` 通过

### 附带：P1-E VS Code 扩展 daemonRequest 抛弃非 JSON 响应

- 路径：[packages/vscode-extension/extension.js](../packages/vscode-extension/extension.js)
- `JSON.parse(text)` 包 try/catch；非 JSON（如 daemon 返回 HTML 错误页）走 reject，附 method/route/cause，避免静默吞掉

**验证**：

```powershell
npm test                                   # 129 pass / 0 fail / 2 skipped（新增 1 条 spinner 回归）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致
npm run gui:build                          # 0 警告 0 错误
```

P1 / P2 项继续留在 [docs/CODE_REVIEW_2026-05-21.md](./CODE_REVIEW_2026-05-21.md) backlog。

### 2026-05-21 P0 实施自评跟踪修复

对 2026-05-21 P0 五项修复做了一轮代码审核（详见对话），落地以下跟踪修复，避免 P0-D/E 自身引入新的边界态：

- **M1（=backlog P2-A）** [packages/gui/wwwroot/chat.js:689](../packages/gui/wwwroot/chat.js#L689)：`getMessageRenderKey` 删除新引入的重复 `options` 键，保留 `options: message.options || null` 那行；对象字面量同名键的静默覆盖问题清零
- **M2** [packages/daemon/src/daemon/sessionManager.ts:96](../packages/daemon/src/daemon/sessionManager.ts#L96)：`appendOutput` 含 `\n` 时除了清 `lastPromptOptions`，再把 `status='waiting'` 拉回 `running`。否则用户在 CLI 终端直接回车（不走 daemon inject）后，GUI 会卡在「等待但已无选项」的死锁中间态；observer 重连还会把这个错状态固化到 `sessions-snapshot` 推给客户端
- **M3** [packages/gui/MainWindow.xaml.cs:453](../packages/gui/MainWindow.xaml.cs#L453)：`OnSessionsSnapshotReceived` 在重建列表前先记 `previousId`，重建后按 id 恢复选中；找不到再回退 `SelectedIndex = 0`。P0-E 的本意只是恢复列表，不应附带把用户选中切走（与 P0-A/B 的「不抢焦点」原则一致）
- **S1** [packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs)：补一条 observer 握手集成测试，断言连接后能依次拿到 `sessions-snapshot` / `sources-snapshot` / `workflow-snapshot` 且包含先前注册的 session/source id
- **M2 单测** [packages/daemon/test/sessionManager.test.mjs](../packages/daemon/test/sessionManager.test.mjs)：新增 `resets waiting → running when real output crosses the prompt`

**验证**：

```powershell
npm test                                   # 131 pass / 0 fail / 2 skipped（新增 2 条回归）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致
npm run gui:build                          # 0 警告 0 错误
```

### 2026-05-21 P0 实施二轮代码审核跟踪修复

二轮代码审核（详见对话）发现 M2/M3 落地后仍有三处可加固，本次一起处理：

- **N1** [packages/daemon/src/daemon/sessionManager.ts:80](../packages/daemon/src/daemon/sessionManager.ts#L80)：`appendOutput` 头部加 `if (rec.status === 'exited') return;`，并删掉冗余的 `if (rec.status !== 'waiting') rec.status = 'running';`。原写法在 onExit 后 60s 删除窗口内若收到延迟 chunk，会把 `exited` 错改回 `running`；冗余条件在新逻辑下完全等价于内嵌的 `waiting → running` 分支
- **N2** [packages/gui/Services/DaemonClient.cs:34](../packages/gui/Services/DaemonClient.cs#L34)、[MainWindow.xaml.cs:481](../packages/gui/MainWindow.xaml.cs#L481)：`SourcesSnapshotReceived` 事件签名 `JArray` → `MonitorSourceInfo[]`，与 `SessionsSnapshotReceived` 强类型对齐；反序列化也改用 `ToObject<MonitorSourceInfo[]>()`
- **N3** [packages/gui/wwwroot/chat.js:773](../packages/gui/wwwroot/chat.js#L773)：`disableOptionsForPrompt` 删掉只覆盖 `"`/`\` 的不完整 CSS.escape polyfill；WebView2 与 jsdom 均原生提供 `CSS.escape`

**验证**：

```powershell
npm test                                   # 131 pass / 0 fail / 2 skipped
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致
npm run gui:build                          # 0 警告 0 错误
```

### 2026-05-21 P0 实施三轮代码审核跟踪修复

三轮代码审核（详见对话）针对 P0-E 落地后仍残留的四处加固一次性处理：

- **H3** [packages/daemon/src/shared/protocol.ts:204](../packages/daemon/src/shared/protocol.ts#L204)：`SessionInfoSchema.lastPromptOptions` 加 `z.string().max(500)` + `.max(32)`，与 `WorkflowItemSchema.options` 上限对齐，杜绝畸形 prompt 经 `/sessions` HTTP 路径绕过限制
- **H4** [packages/gui/wwwroot/chat.js:736](../packages/gui/wwwroot/chat.js#L736)、[chat.css](../packages/gui/wwwroot/chat.css)：自由文本 session prompt（密码、文件名等 daemon 解析不到 options 的场景）在卡片内显式渲染 `.prompt-hint`「该提示需要自由文本回复，请在 CLI 终端中直接输入」，避免用户在 omnibar 隐藏后看上去卡住
- **H1** [packages/gui/MainWindow.xaml.cs:481](../packages/gui/MainWindow.xaml.cs#L481)、[chat.js:968](../packages/gui/wwwroot/chat.js#L968)：`OnSourcesSnapshotReceived` 改为转发整条 `sources-snapshot`；web 端按 id reset+merge，清掉不在 snapshot 中的旧来源。原实现拆成 `source-registered` 一条条投递，断网期间 disconnect 事件丢失的来源会永远停留在 online
- **H2** [packages/gui/MainWindow.xaml.cs:453](../packages/gui/MainWindow.xaml.cs#L453)、[Models/SessionViewModel.cs:101](../packages/gui/Models/SessionViewModel.cs#L101)：`OnSessionsSnapshotReceived` 改为按 id diff（existing → `UpdateFrom`，missing → `Add`，stale → `RemoveAt`），不再 `Clear()+Add`。原实现即便保留 `previousId` 也会让 ObservableCollection 短暂触发 SelectionChanged=null，与 P0.1「不抢焦点」精神抵触；diff 方案保持 ViewModel 实例引用与选中态稳定
- 回归测试：[packages/daemon/test/chatWorkflowSnapshot.test.mjs](../packages/daemon/test/chatWorkflowSnapshot.test.mjs) 新增 `session prompts without options surface a CLI-direct-input hint`（H4）与 `sources-snapshot replaces stale sources after observer reconnect`（H1）

**验证**：

```powershell
npm test                                   # 133 pass / 0 fail / 2 skipped（新增 2 条回归）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致
npm run gui:build                          # 0 警告 0 错误
```

---

## 2026-05-21 P1 backlog 收口（A/B/C/D/F）

[docs/CODE_REVIEW_2026-05-21.md](./CODE_REVIEW_2026-05-21.md) 中 P1-A/B/C/D/F 五项一次性收口；P1-E 已在 P0 段附带修复。

### P1-A GUI `_sessions` 永不裁剪 exited

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)、[packages/gui/Models/SessionViewModel.cs](../packages/gui/Models/SessionViewModel.cs)
- 新增 `SessionViewModel.ExitedAt`，`OnSessionExited` 设置后调 `PruneExitedSessions()`
- 按 `ExitedAt` 升序裁剪到 `MaxExitedSessions = 50`（活跃会话永远保留）
- daemon 已有 60s 删除窗口仅作内存裁剪，不会广播"删除"事件，所以 GUI 端必须独立做 LRU；observer 重连 sessions-snapshot 同步路径已在 H2 收敛

### P1-B `DaemonClient.DefaultRequestHeaders` 并发不安全

- 路径：[packages/gui/Services/DaemonClient.cs](../packages/gui/Services/DaemonClient.cs)
- 抽出 `PostJsonAsync(url, payload)`：用 `HttpRequestMessage` 把 `Authorization` 头挂在请求实例上，不再 `Clear() + Add()` 共享 `DefaultRequestHeaders`
- `SendReplyAsync` / `SendMonitorEventReplyAsync` / `RegisterSourceAsync` 全部走该 helper；未来 Dispatcher 单线程约束放宽后也不会触发 `InvalidOperationException`

### P1-C MainWindow `async void` 异常兜底

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- `MainWindow_Loaded` / `HandleUserReply` / `HandleMonitorEventReply` / `Settings_Click` / `Reconnect_Click` / `AutoReconnectTimer_Tick` 全部加 try/catch 总兜底
- 异常落到 `AddLog($"... {ex.GetType().Name} - {ex.Message}")`，不再让 WPF 进程因未捕获 async 异常崩溃

### P1-D `gui.log` 滚动 + 异步写入

- 路径：[packages/gui/Services/GuiLogWriter.cs](../packages/gui/Services/GuiLogWriter.cs)（新增）、[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)、[packages/gui/Services/DaemonClient.cs](../packages/gui/Services/DaemonClient.cs)
- 新增 `GuiLogWriter` 单例：`Channel<string>` bounded(10_000) + DropOldest，后台单 worker `Task` 消费写盘
- `MainWindow.AddLog` 与 `DaemonClient.Log` 都改为 `GuiLogWriter.Instance.Enqueue`；DaemonClient 不再直接写文件，统一通过事件流到 `MainWindow.OnLogMessage`
- 文件超 5MB 滚动到 `gui.log.1/.2/.3`，最旧覆盖；进程关闭路径（`OnClosed` / `Exit_Click`）调 `Dispose()` 让 worker 把队列刷干
- 解决：UI Dispatcher 不再被同步 `File.AppendAllText` 阻塞；长跑后日志不再无限增长

### P1-F DaemonClient 重连无指数退避

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- `ReconnectMinSeconds=2` / `ReconnectMaxSeconds=30`；`StartAutoReconnect` 重置间隔到 2s
- `AutoReconnectTimer_Tick` finally 段：未连上时 `Interval = min(30s, 2s * 2^min(attempts, 4))`，序列 2/4/8/16/30s 上限
- 连接成功路径 `OnDaemonConnected` 已重置 `_reconnectAttempts = 0` 并 stop timer，下次断线从 2s 重新起步

### 不做

- 不在 daemon 侧广播"session 已从内存删除"事件：当前 GUI LRU 已够，新事件会扩协议表面
- 不为 `GuiLogWriter` 引入 NLog/Serilog 依赖：5MB×4 文件 + 异步 Channel 足以解决长跑+卡顿两个 P1 痛点

### 验证

```powershell
npm test                                   # 133 pass / 0 fail / 2 skipped（本轮未新增 daemon 单测）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致（本轮未改 schema）
npm run gui:build                          # 0 警告 / 0 错误
```

## 2026-05-21 P2 backlog 收口（B/C/D/E）

承接 [CODE_REVIEW_2026-05-21.md](./CODE_REVIEW_2026-05-21.md) 中 P2-B/C/D/E 四项清理（P2-A 已在 P0 跟踪修复 M1 阶段处理）。本轮不涉及鉴权 / 配置 / 协议表面变化，主要是减少状态泄漏、合并高频写入、移除重复语义。

### P2-B `pruneWorkflowItemIdsGlobal` 同步清理 codeBlocks

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- 全局 LRU 裁剪 workflow item 时未联动 `state.codeBlocks`，导致代码视图保留对已删除消息 id 的引用；和 `removeWorkflowThread` 已有的清理逻辑对齐
- 末尾按"保留 conversationId 非 workflow:* 或者 messageId 仍在 `workflowItemIds` 中"过滤 codeBlocks；若 `activeCodeId` 被剪掉则回落到下一个可见块
- 没有命中删除时短路返回，避免空操作时仍走一次 Set/filter

### P2-C 收敛 prompt 选项回复的换行注入到 CLI 单点

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- 协议升级后 GUI → daemon `/reply` 用 `optionIndex` 决议（`sessionManager.ts:resolvePromptOption` 已 `trim` 末尾 `\r?\n`），CLI 侧 `runner.ts:replyTextForPromptOption` 自己拼 `\n` 触发 PTY 回车
- 移除 `HandleUserReply` / `HandleMonitorEventReply` 中 `value + "\n"` 拼接，daemon `outputChunks` 不再多吞一个空行；保留 CLI 端 `\n`（PTY 唯一需要换行的地方）
- daemon 端无需改动，trim 行为已经覆盖旧路径

### P2-D server.ts 合并高频 PTY 输出 chunk

- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)
- 每条 `session-output` 立即 `appendItem` 会让 spinner / 进度条快速撑满 workflow items + id 计数器；改为按会话维护 `pendingOutputs` + 50ms 合并窗口
- 边界事件（`session-prompt` / `session-exited`）触发前先 `flushPendingOutput`，保证 prompt 永远出现在合并输出之后；session 关闭后清理对应 counter
- WebSocket 直播链路不变（observer 仍订阅每条 `session-output`），合并只作用在 workflow item 落盘

### P2-E `extractCodeBlocks` 一次性裁剪

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- 每识别一个代码块就 splice 一次，O(n²) 形态；改为收集 matched 数组后批量 push，最后整体裁剪到 `MAX_CODE_BLOCKS`
- `pruneMessageState` 与 `state.codeBlocks` 上限仍兜底，不会绕过

### 新增 / 调整测试

- `packages/daemon/test/server.integration.test.mjs`
  - 把"same millisecond 两条 output 各自记为单条"改为"50ms 内合并为一条 item，content 串联"
  - 新增"flush before next prompt"：merged output 后立刻 prompt，断言 1 条 command + 1 条 prompt，且 prompt 时间戳 ≥ command 时间戳

### 不做

- 不为 `kind: 'command'` 单独引入 ring buffer：50ms merge + workflow retention 已能压制基线，第二层缓冲会让回放语义复杂化
- 不动 CLI `replyTextForPromptOption` 的 `\n`：PTY 仍需要这个换行触发回车，集中在一处比分散到 GUI/server 更直观

### 验证

```powershell
npm test                                   # 134 pass / 0 fail / 2 skipped（+1：output-flush-before-prompt 测试）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致（本轮未改 schema）
npm run gui:build                          # 0 警告 / 0 错误
```

## 2026-05-21 P0.3 任务列表摘要重建

承接 [DEVELOPMENT_TASKS.md#P0.3](../DEVELOPMENT_TASKS.md#p03-重新定义任务列表摘要)：左侧任务列表过去把"最近一条原始消息内容"塞进 preview，命令输出 / token_count / 心跳一刷新就把可读信息挤出去；任务状态只有 dot 颜色，看不出下一步要不要我处理。本轮把列表项重写为 **6 档固定状态 + 下一步动作**。

### 6 档状态映射 + 派生函数

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- 新增 `deriveConversationDisplay(conv)` 返回 `{ kind, label, action }`：

  | 状态 kind        | 文案     | 触发条件                                                  | 下一步动作                |
  | ---------------- | -------- | --------------------------------------------------------- | ------------------------- |
  | `waiting-me`     | 等待我   | `status === 'prompt'`                                     | 选择选项或输入回复        |
  | `error`          | 失败     | `status === 'error'`                                      | 查看错误并复制诊断        |
  | `review`         | 需审阅   | `status === 'done'` 且有 artifact/file_change/code/tool   | 查看新产物                |
  | `done`           | 完成     | `status === 'done'` 且没有上述产物                        | 执行已结束                |
  | `source-online`  | 来源在线 | `isPassiveSourceKind(source)` 且 status 非 prompt/error   | 等待新事件                |
  | `running`        | 运行中   | 其余                                                      | 由 `runningHint` 派生细分 |

- `runningHint(item)` 根据 `errorCount/promptCount/toolCount/commandCount/messageCount` 顺序回退到 `有错误待复核 / 即将需要回复 / 工具调用中 / 命令输出中 / AI 处理中 / 执行中`
- `refreshWorkflowConversation` 把 `summary` 上的计数（prompt/error/code/fileChange/message/tool/command）一并写到 conversation 对象，使派生函数不依赖最近一条原始消息
- `statusLabel` 同步把"等待输入 → 等待我"、"已完成 → 完成"，让右上角 / 抽屉态文案与列表对齐

### makeConversationButton 重写

- preview 改为 `display.action`，不再回退到 `item.lastContent || item.source`
- 新增 `.status-chip` 显示 `display.label`，独立于 source / capability chip
- `dataset.displayStatus` 标记 dot 类型，方便测试断言与 CSS `:has` 选择器

### CSS 配套

- 路径：[packages/gui/wwwroot/chat.css](../packages/gui/wwwroot/chat.css)
- `.conversation-dot.waiting` 重命名为 `.waiting-me`，新增 `.review`（紫）、`.source-online`（弱灰）
- 失败 / 等待我 / 需审阅 三档 item 加底色与边框，列表无需点开就能定位需要处理的任务
- `.status-chip` 在四档（waiting-me / error / review / done）下反白为实色，与单色 dot 形成双重信号

### 弱接入来源过滤（已就绪，新增覆盖）

- `isUserFacingConversation` 早已通过 `isPassiveSourceKind + !isActionableStatus` 把 cc-switch / qwen-code / trae / codebuddy / lingma / marscode / codegeex / comate / ai-ide 从主队列里隐藏；本轮没改逻辑，只补了一条 e2e：被动源出现 `kind: 'prompt' status: waiting` 时应作为 `等待我` 进队

### 新增测试

- `packages/daemon/test/chatWorkflowSnapshot.test.mjs`
  - **派生覆盖**：`deriveConversationDisplay` 对 6 档分别返回正确 `kind / label / action`，单测覆盖各分支
  - **预览反例**：含 `npm install\nadded 142 packages` 命令片段的 prompt 任务，列表 preview 仅显示动作文案，不应出现原始内容；`status-chip` 文本应为 `等待我`
  - **被动源抬升**：`qwen-code` 出现 `prompt` 时应进入主队列，`dataset.displayStatus === 'waiting-me'`

### 不做

- 不引入"已读 / 未读"时间戳来区分 `review` vs `done`：当前用"是否有 artifact / file_change / code / tool"作为审阅信号，足够覆盖"AI 改了东西 vs 普通收尾"两种最常见场景；额外的"已读时间戳"会让状态机变成 6×2，难测试
- 不动 `lastContent` 字段：其他地方（archived 判定、debug 日志）仍会用到，删除会扩大改动半径

### 验证

```powershell
npm test                                   # 137 pass / 0 fail / 2 skipped（+3：6 档派生、preview 动作、qwen 抬升）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致（本轮未改 schema）
npm run gui:build                          # 0 警告 / 0 错误
```

## 2026-05-21 P1.1 等待输入优先

接住 P0.3 的 6 档状态后，本轮把"等待我"做成真正的队列一等公民：

- 排序上不再仅按 `lastAt` 倒序，否则一个忙碌的 running 任务一刷新就把旧 prompt 压下去
- 详情上明确"回复将写到哪里"，无写回目标时彻底隐藏回复入口，不再给"假回复"

### 队列优先级

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- 新增 `conversationPriority(item)`：依据 `deriveConversationDisplay(item).kind` 给出 0~5：
  - `waiting-me` → 0
  - `error` → 1
  - `review` → 2
  - `running` → 3
  - `source-online` → 4
  - `done` → 5
- `renderConversationList` 排序：先按优先级升序，同档再按 `lastAt` 倒序
- `chooseInitialConversation` 同步走同一套比较器：首次进入或重连后没有选中任务时，自动落到等待我 / 失败而不是最近一条 done

### 回复入口判定

- `renderOptions(sessionId, eventId, options, messageId)`：
  - **既无 `sessionId` 又无 `eventId`** → 不渲染按钮/输入，只渲染一句 `.prompt-hint`：「该提示无可回写的目标会话，请回到来源工具中继续。」这堵掉了原本"记录本次选择"的伪输入路径
  - 有 `sessionId` 或 `eventId` → 选项上方先渲染一行 `.prompt-target`，明确写"回复将写回 CLI/PTTY 会话" 或 "回复将通过事件发送到来源适配器"
  - 其余分支（session+无选项、event+自由输入）保持 P0 时期的逻辑不动
- `selectOption` 没改：sessionId 分支早就 early-return，eventId 分支保留本地 `addMessage('您的回复')` 回显

### CSS 配套

- 路径：[packages/gui/wwwroot/chat.css](../packages/gui/wwwroot/chat.css)
- 新增 `.prompt-target` 样式：弱化色 + 11px，作为选项上方的低调说明，不抢提示文本的注意力

### 新增测试

- `packages/daemon/test/chatWorkflowSnapshot.test.mjs`
  - **排序固化**：3 个并行任务（running 最新 / waiting 较旧 / done），断言列表第一条 `dataset.displayStatus === 'waiting-me'` 且标题指向 waiting 任务，验证 lastAt 倒序无法盖掉等待我
  - **无目标隐藏**：codex-desktop 类 thread（非 `session:` 前缀）的 prompt 不应渲染任何 `.option-button` / `.custom-input`，且 `.prompt-hint` 文案含「回到来源工具」，omnibar 也保持 hidden
  - **回复目标可见**：session-style thread 的 prompt 应渲染 `.prompt-target` 文本包含 `CLI`、`PTTY` 或 `会话` 任一关键词，且选项按钮个数等于 `options.length`

### 不做

- 不在选项里直接显示 sessionId / eventId 的原始字符串：那是内部 ID，对用户没意义；只保留"将写到 CLI/PTTY 会话"或"通过事件发到来源适配器"的语义级表述
- 不调整 `selectOption` 行为：sessionId 分支早 return 避免本地伪记录，eventId 分支保留回显是 P0 时期决策，超出 P1.1 边界
- 不为 done / running / review 任务添加 `.prompt-target`：它们并不在等待输入，加这行只会增加噪音

### 验证

```powershell
npm test                                   # 140 pass / 0 fail / 2 skipped（+3：排序固化、无目标隐藏、目标可见）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致（本轮未改 schema）
npm run gui:build                          # 0 警告 / 0 错误
```

## 2026-05-21 P1.2 失败态可诊断

为 [DEVELOPMENT_TASKS.md#p12-失败态可诊断](../DEVELOPMENT_TASKS.md#p12-失败态可诊断) 提供实施细节。

### 主视图失败摘要

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- 新增 `renderErrorSummary(message)`：仅对 `message.type === 'error'` 渲染，遍历 `rawItems` 过滤 `status === 'error'`，在 `workflowSummary` 之后、`workflow-details`（默认折叠）之前插入 `.error-summary` 块
  - 标题：失败项数 > 0 写 `失败 N 项`，否则写 `本次任务以失败结束`
  - 每行用 `workflowKindLabel(kind)` 给出"命令输出 / 工具调用 / 文件变更"等中文 kind 名 + 原始标题，正文经 `compactText` 截断防止刷屏
  - 超过 3 项时附 `另有 N 项错误，详情见下方原始事件。`，引导用户去展开 `workflow-details`
- 这一块仅在主视图露出"具体报了什么"，原始日志保持折叠（不破坏 P0.2 的拆分原则）

### 一键复制诊断

- 新增 `renderDiagnosticsAction(message)`：在选项之后追加 `.diagnostics-action > button.action-button`，文案"复制本次失败诊断"
- 新增 `buildFailureDiagnostics(message)`：生成结构化 Markdown，供用户粘到 Codex/Claude 继续排查：
  - 头部：时间 ISO、任务标题、`来源：xxx（能力层级文案）`、可选工作区
  - `## 失败摘要`：`message.content`，daemon 没给摘要时落"（daemon 未给出摘要）"
  - `## 报错原始事件`：遍历 `errored`，输出 `- 命令输出：title`，正文包 ```三反引号``` 块
  - `## 最近命令 / 工具调用`：从 `rawItems` 选最后 4 条 `command` / `tool_call`，同样以代码块呈现
  - 单条正文超过 2000 字符的截断由 `truncateForDiagnostics(content)` 加 `（…已截断 N 字）` 提示
- `stage-copy-context` 不再只是把 `compactText(content)` 拼起来，而是改走 `buildStageContext(conversation, messages)`：包含任务/来源/能力/隐私边界 + 最近 12 条消息摘要

### CSS 配套

- 路径：[packages/gui/wwwroot/chat.css](../packages/gui/wwwroot/chat.css)
- 新增 `.error-summary` / `.error-summary-title` / `.error-summary-row` / `.error-summary-more` / `.diagnostics-action`：浅红描边 + 暖白底色 + 行内 strong/span 网格，与已有 `.message-error .message-card` 红色边框风格统一

### 新增测试

- `packages/daemon/test/chatWorkflowSnapshot.test.mjs`
  - **失败摘要 + 诊断复制按钮**：workflow-snapshot 含 `goal + cmd(status=error) + assistant`，断言 `.error-summary` 命中 `/npm test|jest/`，`.diagnostics-action .action-button` 文案匹配 `/复制.*失败.*诊断/`；并对 `buildFailureDiagnostics` 直接传入 mock message 验证 Markdown 头/摘要/原始事件/jest 关键字均在

### 不做

- 不修改 `workflow-details` 的 `open` 默认值：保持折叠是 P0.2 拆分主内容与原始执行记录的明确约定；用户需要细节就展开 details，不需要的主视图已有摘要
- 不为 type !== 'error' 的消息渲染 `.error-summary`：避免把 running/done 的轻量 status 误展示为失败
- 不写复制行为的 e2e：剪贴板需要真实 webview 环境；改在 `buildFailureDiagnostics` 上跑单元级断言更稳

### 验证

```powershell
npm test                                   # 143 pass / 0 fail / 2 skipped（+1：失败摘要 + 诊断复制按钮）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致（未改 schema）
npm run gui:build                          # 0 警告 / 0 错误
```

## 2026-05-21 P1.3 来源与隐私边界可见

为 [DEVELOPMENT_TASKS.md#p13-来源与隐私边界可见](../DEVELOPMENT_TASKS.md#p13-来源与隐私边界可见) 提供实施细节。

### 能力层级文案与原始等级

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- `capabilityLevelLabel(rawLevel)` 文案改为中文语义：
  - `L1` → `L1 进程识别`
  - `L1-L2` → `L1/L2 弱接入`
  - `L2` → `L2 只读事件`
  - `L2-L3` → `L2/L3 事件可回`
  - `L3` → `L3 可回写会话`
  - `L4` → `L4 工作流编排`
- `capabilityForSource(source)` 重构成统一 `make(rawLevel, detail)` 构造器，对 cli / codex-desktop / vscode-extension / cc-switch / qwen-code / trae 等 builtin 来源返回 `{ rawLevel, level, detail }` 三件套，避免下游再 split 字符串
- `capabilityForMessage(message)` 沿用上面，但允许显式 `message.capabilityLevel` 覆盖（外部 adapter 显式告诉我们能力时优先采用）
- 新增 `capabilityChipClass(rawLevel)`：把 `L2-L3` 等含特殊字符的 rawLevel 转成 `capability-l2l3` 这种安全 CSS class

### 三处 chip 同步上色

- 任务列表 `.conversation-chip.capability-chip`：在 `makeConversationButton` 里读 `capabilityForMessage(item).rawLevel`，apply class + `dataset.capabilityLevel`，并把 `dataset.source = item.source` 暴露出来便于排错
- 顶部 `#stage-capability` / 抽屉 `#drawer-capability`：新增 `applyCapabilityClass(elementId, rawLevel)`，先清掉残留 `capability-*` class 再加新的，避免切任务时染色串台
- `updateStageMeta` / `renderContextDrawer` 都走同一个 `applyCapabilityClass`，保证三处显示同一个能力色

### 隐私边界与最近消息纳入复制上下文

- `buildStageContext(conversation, messages)`：替代原本只是 `compactText(content)` 拼接的 contextText
  - 头部含 `任务 / 来源 / 状态 / 能力 / 隐私边界` 五项；隐私边界由 `conversation.passive ? '只读同步' : '可写'` 派生
  - `## 最近消息`：最近 12 条，每条带时间戳 + source label + type + 截断正文
- 这让"复制上下文"动作也能反映出来源能力，给 Codex/Claude 排查提供真实边界信息

### CSS 配套

- 路径：[packages/gui/wwwroot/chat.css](../packages/gui/wwwroot/chat.css)
- 新增 6 个 `.capability-l*` 配色（list / stage / drawer 三处共享同一组规则）：
  - L1 / L1-L2：弱化灰底，对应"进程识别 / 弱接入"，强调只读
  - L2：深灰底白字，区分一般只读事件
  - L2-L3：偏蓝灰，事件可回的中间态
  - L3：`var(--accent)` 主蓝，CLI/VS Code 这类可回写会话
  - L4：`#8b5cf6` 紫，工作流编排（外部 adapter 显式声明 L4 时落到这里）

### 新增测试

- `packages/daemon/test/chatWorkflowSnapshot.test.mjs`
  - **chip 能力层级表示**：`capabilityLevelLabel` 各档命中中文文案；`capabilityChipClass` 各档落 `capability-lX` / `capability-l1l2` / `capability-l2l3`；`addMessage` 一个 CLI session 后任务列表的 chip 自带 `capability-l*` class
  - **弱接入区分**：workflow-snapshot 同时含 `session:` 前缀 CLI 任务与 `cc-switch` 任务，断言两条 conversation-item 的 `capability-chip[data-capability-level]` 不相等，避免 L1 进程识别被误读成 L3 可回写

### 不做

- 不为来源种类做 i18n 抽离：当前 Alpha 只面向中文用户，`capabilityLevelLabel` 内联中文是刻意选择
- 不让外部 adapter 自由声明 L5+：能力层级表受 `[docs/POSITIONING.md](POSITIONING.md)` 约束，超出范围会让用户误判 CodePanion 的能力边界
- 不在抽屉里展开能力定义说明：已经用文案"进程识别 / 只读 / 可回 / 工作流编排"自解释，再加段落会再次混入聊天流式噪音

### 验证

```powershell
npm test                                   # 143 pass / 0 fail / 2 skipped（+2：chip 能力层级、弱接入区分）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致（未改 schema）
npm run gui:build                          # 0 警告 / 0 错误
```

## 2026-05-21 P2.1 真实入口验收

为 [DEVELOPMENT_TASKS.md#p21-首批入口](../DEVELOPMENT_TASKS.md#p21-首批入口) 提供实施细节。这一轮以"自动化证据"作为验收：四类入口（CLI/PTTY、Codex Desktop、VS Code 扩展、外部适配器）各自补全运行/等待/完成/失败 + 噪音过滤的端到端用例。

### CLI/PTTY 失败路径

- 路径：[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs)
- 现状：成功退出（`exitCode: 0`）的全流程在 `HTTP API requires auth and covers session lifecycle` 等用例已经覆盖；prompt / output / reply 也都通；唯独 **非零退出 → workflow status='error'** 这条 [server.ts:151](../packages/daemon/src/daemon/server.ts) 的分支完全没用例
- 新增用例：`CLI 会话以非零退出码结束时 workflow 写入 status=error 的退出 item`
  - `POST /sessions` 注册一条 CLI 会话 → `POST /sessions/:id/exit { exitCode: 1 }`
  - 通过 observer WS 等待 `workflow-event.item-append` 且 `item.status === 'error'`，断言 `content` 含 `退出码：1`
  - 再 `GET /workflow/threads/session:<id>` 验证 snapshot 持久化路径也包含 error item，避免 GUI 重连重建时漏掉失败状态

### Codex Desktop 内部噪音端到端过滤

- 路径：[packages/daemon/src/adapters/codexDesktopAdapter.ts](../packages/daemon/src/adapters/codexDesktopAdapter.ts)
- 之前 `toWorkflowItem` 对 `event_msg.type === 'token_count' / 'usage' / 'reasoning' / 'cost_update'` 没有显式过滤，会落到 fallback `kind: 'status'`，把 token 计费 / 内部 CoT 当成普通 status item 暴露给用户
- 新增导出 `isCodexInternalEvent(eventType)` 与 `isCodexInternalResponseItem(itemType)`：
  - event_msg 内部噪音：`token_count`、`usage`、`token_usage`、`tokens`、所有 `reasoning*`、`cost_update`
  - response_item 内部噪音：所有 `reasoning*`、`token_count`、`usage`
  - 关键字小写匹配，避免 codex 升级时同义事件漏掉
- `toWorkflowItem` 早期 return null：在 event_msg / response_item 解析的最前面拦掉，保证后续逻辑、统计、title 升级都不会被噪音污染
- 新增 5 个测试（覆盖纯函数 + ingest 端到端 + 审批 JSON 真实 jsonl 路径）：
  - `isCodexInternalEvent treats token / reasoning / cost noise as internal`
  - `isCodexInternalResponseItem treats reasoning / token_count items as internal`
  - `event_msg token / reasoning / cost records do not become workflow items`
  - `response_item reasoning / token_count records are filtered before becoming status items`
  - `approval-decision JSON written into a session jsonl never becomes a workflow item`（之前只在纯函数 `shouldHideCodexContent` 上断言过，这次走完整 ingest 路径，模拟用户消息体里被塞了一段审批 JSON）

### VS Code 扩展不再制造假任务

- 路径：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- 改动：`isPassiveSourceKind` 把 `vscode` 加入被动源列表。理由：VS Code 扩展 [extension.js:170-199](../packages/vscode-extension/extension.js) 会发"VS Code 已连接"、"终端打开"、"终端关闭"、"调试开始"这类 `type: 'activity'` 事件；它们是来源视图信息，不该在主任务队列里制造假任务
- 抬升路径不变：`isUserFacingConversation` 通过 `isActionableStatus(item.status)`（即 `prompt` / `error`）允许 VS Code 真实失败/等待事件继续进入主队列
- 新增 GUI 测试 2 条（[packages/daemon/test/chatWorkflowSnapshot.test.mjs](../packages/daemon/test/chatWorkflowSnapshot.test.mjs)）：
  - `VS Code 来源仅 activity 事件不会在主任务队列中制造假任务`：snapshot 含两条 activity（终端打开 + 调试开始），断言 `state.conversations.has('workflow:vscode-thread') === false` 且 `.conversation-item` 数为 0
  - `VS Code 来源出现真实失败时才会抬升为主队列任务`：snapshot 一条 `status: 'error'` 的 status item，断言主队列出现一条 `dataset.displayStatus === 'error'` 的 conversation

### VS Code 配对生命周期事件端到端

- 路径：[packages/daemon/test/server.integration.test.mjs](../packages/daemon/test/server.integration.test.mjs)
- 新增 `VS Code 来源的 terminal / debug 生命周期事件能被 daemon 接收并广播`：
  - 注册一个 vscode source（capabilities: window/tasks/terminals/debug）
  - 依次发 4 条事件：终端打开 → 终端关闭 → 调试开始 → 调试结束
  - 断言 observer 收到对应 workflow-event，调试结束被打成 `status: 'done'`
  - `GET /workflow/threads` 校验 vscode thread 的 itemCount ≥ 4，验证全部生命周期都落到了同一个 source thread

### 外部适配器端到端

- 已有覆盖：`VS Code 来源注册后事件链路完整可追溯`（`/sources/register` → `/events` → workflow-event 推送 → `GET /workflow/threads` 看到对应 thread）实际上就是外部适配器端到端的代表用例；done/error 映射也由 `VS Code 来源的 done / error 事件映射为 workflow status item` 覆盖
- 本轮没有额外为通用 adapter 重复同一路径用例，理由：[/events](../packages/daemon/src/daemon/server.ts) 路由对 source kind 无歧视，已有 vscode 用例已经走完所有分支

### 入口与能力层级标注

- CLI/PTTY → `L3` 可回写会话（capabilityForSource('cli')）
- Codex Desktop → `L2` 只读事件（capabilityForSource('codex-desktop')）
- VS Code 扩展 → `L2` 只读事件（capabilityForSource('vscode')，passive 主队列）
- 外部适配器 → 落到 `make('L1', ...)` 默认 L1，由 adapter 自己声明更高能力时通过 `message.capabilityLevel` 覆盖
- 这些标注由 P1.3 落地的 capability chip 在三处（list / stage / drawer）同步可视化，本轮验收阶段不再重复

### 不做

- 不为 CLI/PTTY 写 `runner.ts` 本体的 pty.spawn 集成测试：需要真实子进程，CI 跨平台差异大；HTTP API 层用例已覆盖 prompt / reply / exit 全部业务路径
- 不为通用 adapter（kind: 'cli' / 'other'）重复 vscode 已覆盖的端到端：`/events` 路由按 schema 校验，源 kind 仅作打标无业务分支
- 不在 codexDesktopAdapter 显式列举所有可能的 reasoning_* 子类型：`startsWith('reasoning')` 已包含 reasoning / reasoning_delta / reasoning_summary 等所有变体
- 不把 vscode 加到 GUI 任务列表的"特殊高亮"：与其他被动源一致即可，避免再给用户造概念差异

### 验证

```powershell
npm test                                   # 152 pass / 0 fail / 2 skipped（+9：5 codex 噪音、1 CLI 失败、1 VS Code 配对、2 VS Code 主队列策略）
npm run validate:dtos                      # C# DTO 与 protocol.ts 一致（未改 schema）
npm run gui:build                          # 0 警告 / 0 错误
```

## 2026-05-21 P2.2 GUI 真机验收（自动化部分）

把"3 个并行任务稳定渲染"和"中文不乱码"做成自动化覆盖，
并把 daemon 自动启动路径变成契约检查，避免便携包打包阶段
出现"产物缺失但要等真机双击才发现"的回归。
真机双击启动 + 真机录屏证据仍需用户在 Windows 便携包上完成。

### 3+ 并行任务稳定渲染

`packages/daemon/test/chatWorkflowSnapshot.test.mjs` 新增
"三个及以上并行任务同屏渲染时优先级排序稳定且不抢焦点"：

- snapshot 同时塞入 4 个任务（运行中 / 等待我 / 失败 / 完成）。
- 校验 `.conversation-item` 至少 3 条；按 dataset.displayStatus 验证排序
  开头是 `waiting-me`、`error` 在 `running` 之前。
- 队列计数 `queue-waiting=1 / queue-error=1 / queue-running=1`。
- 用户选中 running 任务后，对 fail/wait 线程追发 item-append，
  `state.activeConversation` 仍是 `workflow:run-thread`，未被新事件抢走。

### 中文文本不乱码

同文件新增"中文文本在主视图与复制上下文中完整保留不乱码"：

- snapshot 注入含 `src/服务/账户.ts`、`第①步`、🚀 的 assistant 消息。
- 主聊天区 `chat-container.textContent` 必须保留这三个片段，
  且不能出现 `\uXXXX` 反斜杠转义、不能出现 `&#x...;` HTML 实体。
- `buildStageContext` 输出同样三个断言（保留 + 无转义），
  确保复制到剪贴板的诊断文本能直接喂给 Codex/Claude。

HTTP/WS 端中文 roundtrip 在
`packages/daemon/test/server.integration.test.mjs:963` 已有覆盖，
本批补齐 GUI 主视图与复制上下文两个出口。

### daemon 自动启动路径契约

`packages/gui/Services/DaemonProcessManager.cs` 的
`FindDaemonEntry()` 会按以下顺序查找：
1. `{baseDir}/daemon/daemon.cjs`（便携版打包后路径）
2. 父目录递归找 `packages/daemon/bundle/daemon.cjs`
3. 兜底 `packages/daemon/dist/daemon-entry.js`

为了避免任一产物缺失只在真机双击时才暴露，
新增 `packages/daemon/test/daemonBundle.test.mjs` 三项契约测试：

- `bundle/daemon.cjs` 存在且大于 100KB（防止空文件 / 半个 bundle）。
- bundle 内含 `/health` 路由与 `bootDaemon|acquireLock` 入口符号，
  否则 DaemonProcessManager 的健康轮询永远失败。
- `dist/daemon-entry.js` 存在且 import 了 `bootDaemon`，
  作为 DaemonProcessManager 回退路径不能丢。

`/health` 行为本身在
`server.integration.test.mjs:199` 已校验（200 + `{ ok: true }`）。

### 文档对齐 GUI 任务标准

- `README.md` 的"核心功能"重写为六档队列 / 主视图分区 / 焦点稳定 /
  失败诊断复制 / 来源与能力可见，去掉"提示对话框"等旧描述。
- `docs/USER_GUIDE.md` 的"GUI 界面"整段替换：
  - 六档状态表（等待我 / 失败 / 需审阅 / 运行中 / 来源在线 / 完成）。
  - 助手内容 vs 执行记录的主视图分区。
  - 等待输入只在真实可写回会话上显示。
  - 失败诊断复制与能力层级 chip 文案。
- `INSTALL.md` 的验证步骤改为新 GUI 状态语言：
  "任务队列"、"等待 / 运行 / 失败"计数器，
  交互式命令的预期路径从"等待我 → 运行中 → 完成"。

### 不做

- 不为便携版双击启动写自动化（需要真机 / 真实 Windows shell）。
- 不为 GitHub Actions 加端到端 GUI smoke（CI 上 WebView2 不可靠）。
- 不替换 README 中阶段 1 / 阶段 2 路线、CLI 命令表、CC Switch 流程等
  仍然准确的小节，避免无意义的文档抖动。

### 验证

```powershell
npm test            # 159 pass / 0 fail / 2 skipped（+7：3 daemon bundle 契约、2 GUI 并行/中文、2 已有）
npm run gui:build   # 0 警告 / 0 错误（bundle 1.9mb）
npm run validate:dtos  # C# DTO 与 protocol.ts 一致（未改 schema）
```

## 2026-05-21 Strategy Backlog Adapter SDK 与示例适配器

P0/P1/P2 已稳定，按 DEVELOPMENT_TASKS.md「Strategy Backlog 等 P0/P1/P2 稳定后再推进」
启动第二条：Adapter SDK 与示例适配器。目标是让任何 Node 20+ 脚本都能把自己接入 CodePanion
来源 / 事件队列，而不需要写 VS Code 扩展或新 daemon 模块。

### 范围

- 新增 [packages/adapter-sdk/](../packages/adapter-sdk/)：零依赖纯 JS SDK + TypeScript 类型声明。
- 新增两个示例：`examples/file-watcher.mjs`、`examples/git-hook.mjs`。
- 新增 [docs/ADAPTER_SDK.md](./ADAPTER_SDK.md) 文档与 `packages/adapter-sdk/README.md`。
- 把 SDK 测试纳入根 `npm test`：现在跑 `daemon test → adapter-sdk test → validate:dtos`。

### 设计

- SDK 暴露 `createAdapter()` / `new CodePanionAdapter()` / `readDaemonConfig()`，全部走 daemon
  公开的 HTTP 接口（`/sources/register`、`/events`、`/events/:id/reply`、`/sources/:id/disconnect`），
  不依赖任何 daemon 内部模块。
- 默认 `integrationKind=adapter` + `privacyBoundary=explicit-adapter`，与 GUI 来源徽章 / 能力层级
  显示完全对齐。
- 配置读取与 VS Code 扩展同源：默认从 `~/.codepanion/config.json` 读 port/token，可被构造参数覆盖。
- 错误以 `CodePanionAdapterError` 抛出，带 `status` / `method` / `route` / `cause`，便于上层判断
  401 等场景；参数校验在客户端完成，不会触发空请求。

### 测试

[packages/adapter-sdk/test/adapter.test.mjs](../packages/adapter-sdk/test/adapter.test.mjs)
直接 import `packages/daemon/dist/daemon/server.js` 在临时实例上跑真实 daemon，覆盖：

- `readDaemonConfig` 读取真实文件 + fallback。
- 注册来源后 `emitEvent` 走 `/events` 返回 ok，且 sourceId 自动绑定。
- prompt → reply → listReplies 闭环。
- token 错误返回 401 时抛 `CodePanionAdapterError`（status=401）。
- 参数校验（缺 name / 空 eventId / 非字符串 text / 未注册 disconnect）均按规范抛 reject 而非崩进程。

中文 + emoji 内容路径在 `emitEvent` 用例里覆盖；不再依赖 `~/.codepanion` 真实状态。

### 不做

- 不把 SDK 加入 npm workspaces：避免影响 daemon 构建路径与现有 `npm install` 用户体验。
- 不为 SDK 单独发 npm 包：当前仍以仓库内本地 `file:` 依赖形式发布，等使用方稳定再考虑独立发版。
- 不让 SDK 自动启动 / 重启 daemon：保持调用方与 daemon 解耦，由 GUI / CLI 负责生命周期。
- 不为示例脚本加自动化 e2e：示例就是面向真实环境（文件系统 / git hook）的最小代码，跑真实场景验证。

### 验证

```powershell
node --test packages/adapter-sdk/test/*.test.mjs   # 7 pass / 0 fail
npm test                                            # daemon + adapter-sdk + validate:dtos 一并通过
```

---

## 2026-05-22 Strategy Backlog 本地审计导出

### 背景

Strategy Backlog 中的"本地审计导出和结果归档"。daemon 已经把 prompt / output / 回复 / 来源事件保留在内存的滚动窗口里（[docs/RETENTION.md](RETENTION.md)），但用户排错、本地归档时只能逐个 HTTP 请求拼装。需要一个一次性导出全部活跃窗口状态的入口，并保留对敏感字段的脱敏选项——前提是不联网、不引入 DTO 破坏性改动。

### 设计选择

- 新增独立的 `GET /audit/snapshot` HTTP endpoint，而非把审计快照塞进 WS / 工作流 DTO：审计是面向运维的工具入口，避免触发 C# DTO 重生与 GUI 端耦合。响应仅是已有 `MonitorSource` / `MonitorEvent` / `SessionInfo` / `WorkflowThread` / `WorkflowItem` 的合并视图，`schemaVersion=1` 给后续演进留口。
- `SourceManager.exportSnapshot({ since })` 在 manager 内部按时间戳过滤事件、回复和在 `since` 之后活跃过的来源，避免 server 层重新遍历内部结构。
- CLI 子命令独立成 `packages/daemon/src/cli/audit.ts`，导出函数 `redactSnapshot` 以便单测，避免重复实现脱敏逻辑。脱敏策略：长度 ≤ 6 整体打码，> 6 保留首尾各 2 字符 + 长度信息；家目录路径替换为 `***`。
- 输出文件权限固定 `0o600`，与 [packages/daemon/src/cli/install.ts](../packages/daemon/src/cli/install.ts) 中 token 落盘的处理一致。
- `--since` 同时接受 ISO 8601 字符串和 epoch 毫秒，对负数、`NaN`、非数字串统一 400；CLI 层 `parseSince` 与 server 端各自做一次防御性校验。

### 改动

- [packages/daemon/src/daemon/sourceManager.ts:133](../packages/daemon/src/daemon/sourceManager.ts#L133)：新增 `exportSnapshot({ since })`，返回按时间戳过滤、按时间排序的 `sources` / `events` / `replies`。
- [packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)：注册 `GET /audit/snapshot`，合并 sources + sessions + workflow 快照，校验 `since` 参数。
- [packages/daemon/src/shared/client.ts:123](../packages/daemon/src/shared/client.ts#L123)：新增 `AuditSnapshot` 类型与 `getAuditSnapshot({ since })` 客户端。
- [packages/daemon/src/cli/audit.ts](../packages/daemon/src/cli/audit.ts)：新增 `auditExportCommand`，支持 `--output / --format / --since / --redact`，导出 `redactSnapshot` 供测试与未来程序化调用。
- [packages/daemon/src/cli/index.ts:198](../packages/daemon/src/cli/index.ts#L198)：注册 `codepanion audit <action>` 命令。
- 文档：新增 [docs/LOCAL_AUDIT.md](LOCAL_AUDIT.md)；[docs/API.md](API.md) 增加 `GET /audit/snapshot` 段落；[docs/USER_GUIDE.md](USER_GUIDE.md) 命令参考补 `codepanion audit <action>` 条目。

### 不做的事

- 不引入新的持久化层：审计快照仅反映当前内存活跃窗口，超出 `retention` 的数据本就不再保留。
- 不在协议 DTO（`packages/daemon/src/shared/protocol.ts`）中固化 `AuditSnapshot`：避免每次字段增删触发 C# DTO 重生；只在 `client.ts` 中以 TS 类型暴露给 daemon 自己的 CLI 调用方。
- 不在 GUI 中加界面入口：审计是命令行运维工具，GUI 真要做时通过 WebView2 调用 CLI 即可。
- 不引入外部上传通道：所有输出都是本地文件，权限 `0o600`，与 daemon 本地优先定位一致。

### 验证

```powershell
node --test packages/daemon/test/auditExport.test.mjs   # 5 pass / 0 fail
npm test                                                # daemon + adapter-sdk + validate:dtos 一并通过
```

## 2026-05-22 Strategy Backlog 国产工具深度适配

承接 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md#strategy-backlog) 中「国产工具深度适配」条目的第一步：从"识别更多进程"升级为"识别更准、能上报更真的事件"。

### 范围

只做不需要新签约 / 不需要插件私有 API 的两件事：

1. **Qoder 拆为独立 first 梯队 `kind`**。原本被打成 `lingma` profile 的 `tongyi` / `通义灵码` 兼容路径，但 Qoder 实际上是阿里独立 IDE（VS Code/Code OSS 系），进程名 `Qoder.exe` 和命令行特征都与 lingma 插件完全不同；继续共用会让 GUI 来源徽章把两类工具串到一起。
2. **Adapter SDK 增加 `local-tool-bridge.mjs` 模板**。让任意国产工具（已被 process-scan 识别为 L1，但 daemon 看不到具体事件）通过本地日志 / 状态文件接出 `error` / `prompt` / `done` / `activity` 真事件，把来源能力等级显式从 L1 抬到 L2。

### 改动

- [packages/daemon/src/shared/protocol.ts](../packages/daemon/src/shared/protocol.ts)：`SourceKindSchema` 新增 `'qoder'`（位列 `lingma` 与 `marscode` 之间，符合 `kind` 既有排序习惯）。
- [packages/adapter-sdk/src/index.d.ts](../packages/adapter-sdk/src/index.d.ts)：`SourceKind` 类型联合同步新增 `'qoder'`，SDK 调用方在 TypeScript 端拿到 IDE 自动补全。
- [packages/daemon/src/adapters/aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts)：新增独立 `qoder` profile（`tier: 'first'`、`group: 'Code OSS / VS Code 系'`、`processPatterns: [/^qoder/i]`、`commandPatterns: [/\\Qoder(\\|$)/i, /(^|[\s"'])qoder(\.exe)?([\s"']|$)/i]`、能力 `['process-detected', 'window', 'code-oss-family', 'ai-ide']`），`inferWorkspace` IDE 排除名单中加入 `Qoder` 避免把 Qoder 主程序路径误判成 workspace。lingma profile 仅保留 `/lingma/i`、`/tongyi/i` 模式不变，两者正则不重叠。
- [packages/daemon/test/aiToolProcessAdapter.test.mjs](../packages/daemon/test/aiToolProcessAdapter.test.mjs)：tier 收敛用例把 `first` 列表更新为 `['codebuddy', 'codegeex', 'comate', 'lingma', 'qoder', 'trae']`；新增「Qoder 独立 IDE 进程被识别为 qoder kind 而不是被吞进 lingma profile」覆盖 `Qoder.exe`、`Qoder Helper (Renderer).exe`、纯 lingma 插件路径三类输入，钉死 profile 命中归属。
- [packages/adapter-sdk/examples/local-tool-bridge.mjs](../packages/adapter-sdk/examples/local-tool-bridge.mjs)（新增）：CLI 桥接进程。`--kind`/`--name`/`--watch`/`--workspace` 四参，`fs.watch` + 末尾偏移读增量，不回放历史；`classify` 把 `ERROR/FAIL/EXCEPTION/TRACEBACK/失败/错误/\bERR\b/\bFATAL\b` 升级为 `error`，`?` 结尾 / `请选择` / `是否` / `Continue?` / `(y/n)` 升级为 `prompt`，`完成/done/success/✓` 升级为 `done`，其它落 `activity`；注册来源时 `capabilityLevel: 'L2'`、`capabilities` 含 `tool:<kind>`，事件能直接挂到对应国产工具维度。`KNOWN_KINDS` 集合限制 `--kind` 合法值，避免错串其它来源。
- [packages/adapter-sdk/test/localToolBridge.test.mjs](../packages/adapter-sdk/test/localToolBridge.test.mjs)（新增）：6 用例覆盖 classify 四个分支、parseArgs 四参解析、`KNOWN_KINDS` 必须含 first 梯队 + `external`。导出表面纯函数化，不依赖 daemon。
- [docs/MONITORING_SOURCES.md](./MONITORING_SOURCES.md)：first 梯队表格新增 `qoder` 行，删除原来「Qoder 共用 lingma profile」的临时备注；新增「把工具从 L1 升到 L2 的最短路径」小节指引 vendor 用 bridge 示例接出真事件。
- [docs/ADAPTER_SDK.md](./ADAPTER_SDK.md)：示例适配器列表新增 `local-tool-bridge.mjs`，明确它就是国产工具厂商把 L1 推到 L2 的标准模板。
- [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md)：「国产工具深度适配」条目下加两个子勾选，已落地 L1→L2 路径打勾，L3 写回链路仍开放。

### 不做的事

- 不为任何具体国产工具写死"读 `~/.lingma/...`"、"读 IDE 插件 SQLite"之类的私有数据源接入：与 [MONITORING_SOURCES.md](./MONITORING_SOURCES.md#不读取的数据) 隐私边界冲突。
- 不在 daemon 里内置具体工具的事件解析：行级分类规则放进可被各家厂商 fork 的 bridge 示例里，daemon 只负责把 SDK 上来的事件挂到对应 `kind`。
- 不强行替每个国产工具补 L3：L3 需要工具本身有公开的"继续 / 回复 / 中止"通道，没拿到该通道前不假装支持。
- 不在 GUI 端做"工具维度大盘"：当前 GUI 已能按 `kind` 渲染来源徽章，扩面留给后续 Strategy Backlog 工作流模板 / 跨工具转派条目。

### 验证

```powershell
node --test packages/adapter-sdk/test/localToolBridge.test.mjs  # 6 pass / 0 fail
node --test packages/daemon/test/aiToolProcessAdapter.test.mjs  # 6 pass / 0 fail
npm test                                                        # daemon 165 / adapter-sdk 13 / DTO 校验全绿
```

## 2026-05-22 Strategy Backlog 工作流模板与跨工具转派

承接 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md#strategy-backlog) 中「工作流模板和跨工具转派的产品化」条目。daemon 端已存在完整的 `WorkflowTemplateManager` / `WorkflowDefinitionManager` / `runWorkflow` 内核与 CLI 命令，但产品化层有三个空洞：(1) GUI 完全看不到工作流运行进度（只在 CLI 输出末尾打印），(2) 没有从 JSON 文件批量导入的入口，新用户上手成本高，(3) 仓库里没有任何可直接复用的示例模板。本切片填掉前两个 + 给出两个开箱示例；GUI 模板抽屉留到 Alpha 闭环之后。

### 改动

- [packages/daemon/src/workflows/workflowDefinitionManager.ts](../packages/daemon/src/workflows/workflowDefinitionManager.ts)：`runWorkflow` 新增可选 `hooks: WorkflowRunHooks`（`onWorkflowStart` / `onStepStart` / `onStepFinish` / `onWorkflowFinish`）。Hook 通过 `invokeHook` 包装：失败被 catch 后只打 warning，不阻断真实执行——事件总线不可用永远不应让本地命令半途夭折。`skipped` / `checkpoint` 状态步骤也会触发 `onStepFinish`，保证 GUI 端能完整看到"为什么停在这里"。
- [packages/daemon/src/cli/workflows.ts](../packages/daemon/src/cli/workflows.ts)：`workflowRunCommand` / `workflowReplayCommand` 新增 `createDaemonHooks(workflowName)`：daemon 在线时注册一个临时来源（`kind=cli`、name=`workflow:<name>`、`capabilityLevel=L2`），把每个步骤事件映射为 `monitor-event`（`activity` / `done` / `error` / `prompt`），运行结束自动 `disconnectSource`。daemon 离线时返回 `undefined`，CLI 退回纯本地行为。新增 `workflowImportCommand({ file })`：接受三种 JSON 形态——单个对象 / 数组 / `{ workflows: [...] }`——统一走 `WorkflowDefinitionManager.save`，所以 import 路径和 `workflow add` 命令行路径产出完全一致的存储。
- [packages/daemon/src/cli/index.ts](../packages/daemon/src/cli/index.ts)：workflow action 列表加入 `import`，新增 `--file <path>` 选项；位置参数 `name` 在 `import` 时被当作文件路径兜底。
- [packages/daemon/src/shared/client.ts](../packages/daemon/src/shared/client.ts)：补 `disconnectSource(id, reason?)` HTTP 客户端方法（之前 SDK / 适配器层有，但 daemon 自己的 CLI 走的内部 client 没暴露）。
- [packages/daemon/examples/workflows/codex-then-claude-review.json](../packages/daemon/examples/workflows/codex-then-claude-review.json)（新增）：Codex 起草 → 人工 checkpoint → Claude Code 复审，示范跨工具串接。
- [packages/daemon/examples/workflows/build-test-audit.json](../packages/daemon/examples/workflows/build-test-audit.json)（新增）：build → test → audit 导出，示范本地交付前最短闭环。
- [packages/daemon/examples/workflows/README.md](../packages/daemon/examples/workflows/README.md)（新增）：示例集说明、用法、JSON 形态。
- [packages/daemon/test/workflowDefinitionManager.test.mjs](../packages/daemon/test/workflowDefinitionManager.test.mjs)：新增三个 hooks 用例——成功路径调用顺序、hook throw 不阻断执行、失败路径上 `onStepFinish` / `onWorkflowFinish` 收到的状态正确。
- [packages/daemon/test/workflowExamples.test.mjs](../packages/daemon/test/workflowExamples.test.mjs)（新增）：四个用例钉死示例模板——`examples/workflows/` 下所有 JSON 能被 `WorkflowDefinitionManager.save` 加载、`codex-then-claude-review` 含 checkpoint 且依赖正确、`build-test-audit` 串起 npm + codepanion audit、import 路径与 `parseWorkflowSteps` 命令行路径产出等价的存储结构。
- [docs/USER_GUIDE.md](./USER_GUIDE.md)：`codepanion workflow` 段补 `import` 动作、import 示例、GUI 衔接说明、预置示例介绍。
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md)：核心模块部分新增「Workflow Template Engine」章节，介绍两层模型、`runWorkflow` hooks 与 GUI 联动方式、预置示例位置。

### 不做的事

- 不做 GUI 模板抽屉 / 工作流运行视图：当前 GUI 已能通过来源活动流看到步骤事件，专用工作流面板的优先级低于 Alpha 闭环验证。
- 不在 daemon 端缓存或聚合工作流事件：`runWorkflow` 走 HTTP 把事件发给 daemon 后，由 SourceManager / WS 广播负责扇出，不在工作流层引入新的状态机。
- 不引入新的 daemon HTTP 路由：CLI 借用现成的 `/sources/register` + `/events` + `/sources/:id/disconnect`，避免协议表面积膨胀和 C# DTO 重生。
- 不在 import 路径上写格式探测 / 自动迁移：JSON 字段与 `WorkflowDefinitionSchema` 已经一致，让 zod 做校验即可，省去一层不确定性。

### 验证

```powershell
node --test packages/daemon/test/workflowDefinitionManager.test.mjs   # 8 pass / 0 fail（含 3 个新 hooks 用例）
node --test packages/daemon/test/workflowExamples.test.mjs            # 4 pass / 0 fail
npm test                                                              # daemon 172 / adapter-sdk 13 / DTO 校验全绿
```

---

## 2026-05-22 文档与定位对齐

承接「进行研究，进行代码审核，确定现阶段的情况和后期开发方向 → 更新文档，然后修复发现的问题」这一对话产出。代码审计结论：2026-05-21 的 16 项隐患（P0-A~E、P1-A~F、P2-A~E）全部已在源码中收口；Strategy Backlog 中 Adapter SDK / 本地审计导出 / Qoder 拆分 / 工作流模板已落地。剩余的 Alpha 阻塞项只属于真机产物范畴（便携版双击录屏、打包入口审查、8h 稳态曲线）。问题主要落在文档侧：[ARCHITECTURE.md](./ARCHITECTURE.md) / [DEVELOPMENT.md](./DEVELOPMENT.md) 仍保留与现行架构和产品定位冲突的描述，需要清理。

### 改动

- [docs/ARCHITECTURE.md](./ARCHITECTURE.md)：
  - 整体架构图重画，明确 daemon 内核四个 Manager（SessionMgr / SourceMgr / WorkflowMgr / AuditExport）以及 PromptDetector / 进程适配器 / Adapter SDK 的位置，去掉旧图里只剩 CLI + PTY + Notifier 的窄视角。
  - 「错误处理」章节删除虚构的 `CodePanionError` / `ErrorCode` 枚举，改为引用真实的 `DaemonHttpError`（[shared/client.ts](../packages/daemon/src/shared/client.ts)）与 `CodePanionAdapterError`（[adapter-sdk/src/index.js](../packages/adapter-sdk/src/index.js)），并列举 PTY / daemon 不可达 / WebSocket 断开 / daemon 崩溃四种真实路径的恢复策略。
  - 「性能优化」换为「资源监管」，统一指向 [docs/RETENTION.md](./RETENTION.md) 与各 manager 实际的 retention 字段，避免再出现「无限滚动 buffer」「无界 chunk」之类的过时表述。
  - 「扩展性」改写为 L1 / L2 / L3 三层接入路径，删除 Slack 通知 / 邮箱通道这类与 [POSITIONING.md](./POSITIONING.md)「不做通用个人 Agent」直接冲突的示例。
  - 「测试策略」从 Jest / Supertest / ws 改为 `node:test` 真实分布表，把 7 个测试维度与现仓库实际 test 文件路径绑死，方便新增功能时直接对号入座。
  - 「部署」收敛为「开发环境」+「Windows Alpha 用户路径」两段，移除 NSSM / launchd / systemd 章节——Alpha 的普通用户路径就是双击 `CodePanion.Gui.exe`，服务化部署属于未来评估。
  - 删除「未来规划」章节（远程会话 SSH / 插件系统 / 云同步 / 移动端通知 / AI 辅助提示识别——这五项每一条都和 POSITIONING.md 的「不做」边界冲突），改为「路线衔接」指向 PRODUCT_ROADMAP / POSITIONING / DEVELOPMENT_TASKS / IMPLEMENTATION_LOG，避免「未来规划」与产品定位双口径。
- [docs/DEVELOPMENT.md](./DEVELOPMENT.md)：测试章节从 Jest（`describe` / `it` / `expect` / `beforeEach`）+ Supertest 全部替换为 `node:test` + `node:assert/strict`，给出单元（PromptDetector）、集成（真 daemon，无 supertest）、hooks 闭包断言（runWorkflow）三种范式；测试组织目录改为 `packages/daemon/test/*.test.mjs` 的真实分布；运行命令补 `npm run validate:dtos` 与 `validate:extensions`。资源链接里 Jest 改为 [node:test 文档](https://nodejs.org/api/test.html)。
- [docs/CODE_REVIEW_2026-05-21.md](./CODE_REVIEW_2026-05-21.md)：末尾新增「状态汇总（2026-05-22 复核）」表，把 16 项隐患逐条标注代码锚点（修复对应的文件 + 行号），作为下一轮审计的起点。
- [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md)：
  - P3 新增「ARCHITECTURE.md / DEVELOPMENT.md 与现行架构 / 测试栈对齐」勾选项，指向本日志条目。
  - 新增「当前阻塞 Alpha 收口的真机项」一节，明列三件必须用真机产物完成的事：便携版双击启动录屏、打包入口审查、8h 稳态运行。8h 项遵循 `feedback_long_validation_last` 的「长时间稳态验证放最后」约束。

### 不做的事

- 不在 ARCHITECTURE.md 里保留任何「未来规划」式的展望条目：路线在 PRODUCT_ROADMAP.md / POSITIONING.md / DEVELOPMENT_TASKS.md 中维护，架构文档只描述当前架构，避免双源真相。
- 不引入 Mocha / Vitest / Jest 替代品：仓库已经统一在 `node:test`，文档与现状对齐即可。
- 不为本次纯文档变更新增自动化测试：变更内容是 markdown 描述，`npm test` 等回归只用来确认文档变更未误改测试断言或代码示例的引用。

### 验证

```powershell
npm test                    # daemon + adapter-sdk + DTO 校验全绿（用于回归，确认文档变更未触发任何代码侧失败）
npm run validate:dtos       # 协议契约一致性
```

---

## 2026-05-22 第二轮审计修复（N-1 ~ N-5 + 打包卫生）

承接「继续进行开发……把项目做完」对话产出。审计窗口：2026-05-21 主审计完成 → 2026-05-22 文档对齐之后新落地的 Strategy Backlog 改动 + 打包脚本。完整审计记录见 [CODE_REVIEW_2026-05-22.md](./CODE_REVIEW_2026-05-22.md)。

### N-1 audit --redact 补 session / workflowThread 元数据脱敏

- 路径：[packages/daemon/src/cli/audit.ts](../packages/daemon/src/cli/audit.ts)
- 原 `redactSnapshot` 漏盖：`sessions[].lastPrompt / lastPromptOptions / args / command / cwd / windowTitle`、`workflowThreads[].title / workspace`、`workflowItems[].filePath / options`。修复后这些字段统一走 `redactText` / `redactPath`。
- 新增 `redactWorkflowThread` 把 thread + 内联 items 一并脱敏；`redactWorkflowItem` 扩展处理 filePath / options 数组。
- 测试：[packages/daemon/test/auditExport.test.mjs](../packages/daemon/test/auditExport.test.mjs) 新增 `'redactSnapshot 覆盖 session 的 lastPrompt / args / cwd 与 workflowThread 元数据'`，对所有新字段断言。

### N-2 workflow import 部分失败容错

- 路径：[packages/daemon/src/cli/workflows.ts](../packages/daemon/src/cli/workflows.ts) `workflowImportCommand`
- 每条 entry 用 try/catch 隔离，统计 `imported` / `failed`，最末打印 `[codepanion] import summary: imported=X failed=Y`。
- 退出码语义：全失败 → 1，部分失败 → 2，全成功 → 0。
- 支持顶层 `[...]` 和 `{ workflows: [...] }` 两种包装。
- 测试：[packages/daemon/test/workflowImport.test.mjs](../packages/daemon/test/workflowImport.test.mjs) 4 条覆盖 4 个分支。

### N-3 runWorkflow 异常时 daemon source 不泄露

- 路径：[packages/daemon/src/cli/workflows.ts](../packages/daemon/src/cli/workflows.ts) `createDaemonHooks` / `workflowRunCommand` / `workflowReplayCommand`
- 新增 `DaemonHookBundle.abort(reason)`：emit error 事件 + `disconnectSource('workflow-aborted')`，吞掉自身的 disconnect 失败。
- `workflowRunCommand` / `workflowReplayCommand` 把 runWorkflow 包 try/catch，catch 分支 `hooks?.abort(err.message)` 后 rethrow，确保 schema 校验失败 / 未知 template 等抛错路径不会留下 `online` 状态的幽灵 workflow source。

### N-4 file-watcher 示例加默认忽略 + 200ms 去抖

- 路径：[packages/adapter-sdk/examples/file-watcher.mjs](../packages/adapter-sdk/examples/file-watcher.mjs)
- `DEFAULT_IGNORE` Set：node_modules / .git / .svn / .hg / dist / build / out / target / .next / .cache / .turbo / .parcel-cache / coverage。
- 同一相对路径 200ms 去抖（pending Map + flushTimer），后到的 eventType 覆盖前一次。
- 头部注释更新使用建议。
- 测试：[packages/adapter-sdk/test/fileWatcher.test.mjs](../packages/adapter-sdk/test/fileWatcher.test.mjs) 6 条覆盖正斜杠 / 反斜杠 / 普通源码不误伤 / 空路径 / DEFAULT_IGNORE 完备性 / DEBOUNCE_MS 阈值。

### N-5 local-tool-bridge readTail 单飞

- 路径：[packages/adapter-sdk/examples/local-tool-bridge.mjs](../packages/adapter-sdk/examples/local-tool-bridge.mjs)
- 新增 `reading` 标志 + `pendingRescan` 标记。同一时刻只允许一个 createReadStream，stream `close` 时释放锁 + 检查 pendingRescan 触发下一轮。
- 用 `readUntil = stat.size` 锁住读取范围，避免 TOCTOU 把刚 append 的新增量切到下一次。
- 用注释固化"为什么需要单飞"，防止后续优化误删。

### Windows 便携版打包卫生（README + Assets 过滤）

- 路径：[scripts/package-windows.ps1](../scripts/package-windows.ps1)、[packages/gui/CodePanion.Gui.csproj](../packages/gui/CodePanion.Gui.csproj)
- `README_START.txt` 从英文改为 8 行中文：双击启动、自动拉 daemon、目录整体性、`%USERPROFILE%\.codepanion\` 落盘位置、卸载方式。
- csproj 给 `Assets\**\*` 加 Condition：`Filename Extension == 'README.md'` 或 `Filename` 以 `-source` 结尾的资产不再复制到 publish 目录，发布产物不再混入 Assets/README.md 与 `app-icon-source.png/svg`。
- 这一条只关闭打包脚本侧的卫生问题，真机产物双击启动录屏与 8h 稳态运行仍挂在「当前阻塞 Alpha 收口的真机项」。

### 验证

```powershell
npm run build       # daemon TS 重编译产生新 audit / workflows dist 产物
npm test            # daemon 175 + adapter-sdk 19 全绿
npm run validate:dtos
```

### 不做的事

- N-3 未单独写集成测试：daemon client 模块边界 mock 成本与 abort 单行 catch 改动的可见性不成比例；abort 与 finalize 共用同一个 `disconnectSource` API，原 finalize 路径已有间接覆盖。
- N-5 未单独写并发读 stream 测试：异步 I/O 时序难复现，靠代码注释 + 评审固化。

---

## 2026-05-23 第三轮审计修复（N-6 / N-7 / N-9 + H-1 / H-2）

[docs/CODE_REVIEW_2026-05-23.md](./CODE_REVIEW_2026-05-23.md) 列出的全仓审计 20 项中，本轮先落地隐私 + 启动健壮性 + 接力链路最高 ROI 五项；其余 H-3 ~ H-5 与 N-8 / N-10 ~ N-21 仍挂在 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md)「2026-05-23 第三轮审计待处理」分组按优先级排期。

### N-6 aiToolProcessAdapter 上报字段脱敏 + 移除 process.path 兜底

- 路径：[packages/daemon/src/adapters/aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts)
- `process.commandLine` 仅用于本地 profile 匹配，永不直接上报；`windowTitle` 与 `workspace` 走新增的 `sanitizeReportField`：`maskString`（HOME → `~`、`Bearer ...` → `[Redacted]`、≥32 字符 hex → `[Redacted]`）+ 80 字符截断。
- `inferWorkspace` 不再用 `process.path`（含 `C:\Users\<name>\` 用户名）作兜底，未匹配到工程目录时返回 `undefined`，宁缺勿滥。
- 测试：[packages/daemon/test/aiToolProcessAdapter.test.mjs](../packages/daemon/test/aiToolProcessAdapter.test.mjs) 新增 `'sanitizeReportField 把 HOME 替换为 ~ 并截断到 80 字符（N-6）'`，验证空值、200 字符长串截断、以 `…` 收尾。

### N-7 通知通道中心化脱敏 + 关键 call site 改用固定模板

- 路径：[packages/daemon/src/daemon/notifier.ts](../packages/daemon/src/daemon/notifier.ts) + [packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)
- `Notifier.show` 在交给原生通知前统一走 `clipNotifyText`：`maskString` + 多空白合并 + 截断（title 60 / body 80），并停止把 title / message 写到 `logger.warn`（与 [N-12] 关联，避免日志副本超出 daemon retention）。
- 5 个 call site 切换为固定模板，不再把用户内容塞进系统通知 body：
  - `emitSnoozeDueNotification`：`'点击 CodePanion 查看任务'`
  - `/notify` 路由：按 level 选择 `'有任务等待您的回复'` / `'任务出现错误，请查看 CodePanion'` / `'任务已完成'` / `'点击 CodePanion 查看详情'`
  - monitor-event 触发的通知：按 `event.type` 选择同上 4 套模板，原始 `event.content` / `windowTitle` 留给 GUI broadcast。
  - `POST /sessions/:id/prompt`：body 改成 `'有任务等待您的回复'`，不再把 PTY 最后 2 行原文喂进系统通知。
- broadcastNotification（GUI 通道）保持原内容，由 GUI 自己决定如何渲染——系统通知中心只承载触发，不承载内容。
- 测试：新增 [packages/daemon/test/notifier.test.mjs](../packages/daemon/test/notifier.test.mjs)（4 条）覆盖：截断到 max 字符 + `…` 收尾、空 / undefined 返回空字符串、Bearer token → `[Redacted]`、多空白合并为单空格。

### N-9 workflow 定义 / 历史 / 模板加载隔离损坏文件

- 路径：[packages/daemon/src/workflows/workflowDefinitionManager.ts](../packages/daemon/src/workflows/workflowDefinitionManager.ts) + [packages/daemon/src/workflows/templateManager.ts](../packages/daemon/src/workflows/templateManager.ts)
- 三个 `load()` 全部 `try { JSON.parse + schema.parse } catch { quarantine + 返回空 store }`。
- 损坏文件改名为 `<name>.broken-<ISO 时间戳>.json`，`logger.warn` 记录 `path` + `quarantined` 字段；重命名也失败时降级到 `logger.error` 但**仍返回空 store**，daemon 继续启动（这是核心：再差也比让 daemon 起不来好）。
- 测试覆盖：
  - [workflowDefinitionManager.test.mjs](../packages/daemon/test/workflowDefinitionManager.test.mjs) 新增 `'WorkflowDefinitionManager 遇到损坏 JSON 时隔离文件并返回空 store'` 与 `'WorkflowRunHistory 遇到损坏 JSON 时隔离文件并返回空 store'`。
  - [workflowTemplateManager.test.mjs](../packages/daemon/test/workflowTemplateManager.test.mjs) 新增 `'WorkflowTemplateManager 遇到损坏 JSON 时隔离文件并返回空 store'`。
  - 断言：`list()` 返回 `[]`；目录里出现 `xxx.json.broken-*` 副本；原文件已被改名。

### H-1 daemon 启动时 snooze due 聚合为单条通知

- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts) 启动 hook（原 `for ... scheduleSnoozeReminder` 循环位置）
- 启动遍历改为两个分支：未过期 → 走原 `scheduleSnoozeReminder` 定时器；已过期 → 收集到 `dueAtStartup[]` 并同步清掉 `snoozedUntil`。
- 循环结束后若 `dueAtStartup` 非空：发**一条**系统通知（`'稍后任务已到期'` + `'{N} 个稍后任务已回到待处理队列'`），同时仍逐个走 `broadcastNotification` 让 GUI 列表逐条更新。
- 这样用户机器睡了一夜后启动 daemon 不再被 N 条系统通知抢焦点（违反 P0.1 「不乱跳」），而 GUI 内部状态仍准确。
- 未单独写单元测试：startup 逻辑依赖 `createServer` 内闭包，单测引入成本大于价值；行为靠 server.integration.test.mjs 已有的 snapshot 路径间接覆盖（无 due 任务时无变化）。

### H-2 pty.runner 先 spawn 再 registerSession

- 路径：[packages/daemon/src/pty/runner.ts](../packages/daemon/src/pty/runner.ts)
- 原顺序：`registerSession`（daemon 登记）→ `pty.spawn`（spawn 失败 → `process.exit(2)` → daemon 这边留着 ghost session）。
- 新顺序：`pty.spawn`（失败 → exit 2，daemon 未登记 → 无 ghost）→ `registerSession`（失败 → `term.kill()` 兜底 + exit 2）。
- 这样满足 H-2 描述的"spawn 失败不留 ghost"语义；与 [N-14] 关联——workflow step spawn 失败后 daemon source 不再泄露的根因从 hook 层下沉到 runner 层。
- 没有单独写集成测试：node-pty 失败路径在 CI 环境难以稳定触发；改动是顺序调换 + 一个 catch 兜底，靠 server.integration.test.mjs 已有的正常 spawn 路径回归。

### 验证

```powershell
npm test            # daemon 206/204 pass + 2 skip + adapter-sdk 19 全绿，0 fail
npm run validate:dtos  # C# DTO 与 protocol.ts 仍一致
```

### 不做的事

- N-7 没有进一步把 `notifier.show` 调用方全数转成 enum 化模板：5 个 call site 已经处理，剩余 handoff launched / session exit 两处本身就是 hardcoded 文本，没有用户内容透传。继续抽象只增维护成本。
- 没有给 H-1 / H-2 写专门的集成测试：见各小节末尾的「未单独写」说明，靠现有 server.integration / runner 路径间接覆盖。

---

## 2026-05-23 第三轮审计第二批修复（N-10 / N-11 / N-12 / N-19 / N-20 / N-21）

延续上一批 (N-6/N-7/N-9 + H-1/H-2)，本次收口剩余的 P0/P1 日志脱敏 + GUI ↔ native 边界 + 焦点检测。来源仍是 [docs/CODE_REVIEW_2026-05-23.md](CODE_REVIEW_2026-05-23.md)。

### N-10 DaemonHttpError.message 去掉 response body

- 路径：[packages/daemon/src/shared/client.ts](../packages/daemon/src/shared/client.ts)
- 原构造器在 `super(...)` 里拼了 `body.slice(0, 200)`：daemon 把请求体 echo 回来（典型场景：Zod 报错的 issue.path/path/issue.message + 4xx 的 invalid payload）时，message 直接含用户文本；GUI 端 `OnLogMessage` 写到 `gui.log`、daemon pino 走 `{err}` 同样落 `log.jsonl`。
- 改为 `super(\`${method} ${path} failed: ${status}\`);`，body 仍然保留在 `error.body`（≤4096 字节）字段。调用方需要诊断时显式 `err.body` 取，普通 logger 不再二次落盘正文。
- 测试：[packages/daemon/test/daemonHttpError.test.mjs](../packages/daemon/test/daemonHttpError.test.mjs) 已有用例改成断言「message 等于 `${method} ${path} failed: ${status}`、不含 body」；新增 client.test.mjs 复测同契约。

### N-11 daemon client request() 加 AbortSignal.timeout

- 路径：[packages/daemon/src/shared/client.ts](../packages/daemon/src/shared/client.ts)
- 旧 `request()` 直接 `await fetch(...)`，无 timeout。一旦 daemon 卡死或被长任务阻塞主线程，CLI 和 GUI 都会永远挂起；之前 `checkHealth` 自己单点处理了 1500ms abort，可惜 `notify` / `postOutput` / `postPrompt` / `listSources` 都没有兜底。
- 新增：
  - `DaemonClientTimeoutError`（带 `method` / `path` / `timeoutMs`，name 稳定）—— 调用方据此区分「daemon 不在线」（ECONNREFUSED / fetch failed）与「daemon 卡死」。
  - `RequestOptions { timeoutMs?: number; signal?: AbortSignal }` —— 默认 `8000ms`，长任务（handoff/workflow）可在调用点提一格；外部 signal 与 timeout 协同 abort。
  - `CODEPANION_REQUEST_TIMEOUT_MS` 环境覆盖：方便测试缩短到 200ms 重现「daemon 卡死」。
- 实现细节：用 `AbortController` 加 `setTimeout` 取消，`finally` 里清 timer + 解绑 externalAbort，区分 timeout 与外部 abort（外部 abort 透传，timeout 才包成 `DaemonClientTimeoutError`）。
- 测试：[packages/daemon/test/client.test.mjs](../packages/daemon/test/client.test.mjs)
  - DaemonHttpError message 不含 body（N-10 回归）。
  - body 截断到 4096。
  - DaemonClientTimeoutError 类形状（name / timeoutMs / method / path）。
- 不做：现有调用站点 (`notify` / `postOutput` / `listSources` 等) 暂未改成 long-op 8s 之外的 timeout；这些都是短调用，8s 足够。handoff / workflow 的长操作主入口走 CLI 侧 PTY，不经过这层 fetch，不影响。

### N-12 sourceManager 日志收敛到路由字段

- 路径：[packages/daemon/src/daemon/sourceManager.ts](../packages/daemon/src/daemon/sourceManager.ts)
- 三处 `logger.info({ ... })` 此前直接把整个 source / event / reply 对象 dump 出来，落到 `~/.codepanion/log.jsonl`：含 `windowTitle`、`workspace`、`content`、`title`、`text` 等可能携带用户内容的字段——与 [docs/POSITIONING.md](POSITIONING.md) 「audit --redact 时正文走 maskString」相悖（log.jsonl 已经写下了 mask 之前的版本）。
- 默认改为只打路由字段：
  - `register`：`{ sourceId, kind, capabilityLevel, integrationKind }`
  - `emitEvent`：`{ eventId, eventKind, sourceId, sessionId, level, contentBytes, hasOptions }`
  - `reply`：`{ eventId, sourceId, textBytes }`
- 正文字段（`source`/`event`/`text`）落到 `logger.trace` 等级。pino 默认 level `info`，trace 不会写盘；开发者要排查时改 `CODEPANION_LOG_LEVEL=trace` 显式打开，等于把"是否落盘用户内容"决策权交还给用户。
- 不做：没有写新单测。pino 的 destination 是模块级 lazy singleton，注入 mock 成本远高于改动本身；改动是显式字段列表 + 一处级别下放，回归靠现有 server.integration.test.mjs / sourceManager.test.mjs 的正路径检查日志没有 crash。

### N-19 WebView2 拦截 NavigationStarting / NewWindowRequested

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- WebView2 渲染 markdown 时，DOMPurify 会保留可点击的 `<a href>`。CSP 已经阻止脚本注入，但用户点击外链会让 WebView2 自己导航——离开 `codepanion.local` 后整个 chat UI 就被替换成第三方页面，且 CSP 范围也随之失效。
- 现在在 `InitializeWebView()` 里订阅两事件：
  - `NavigationStarting`：放行 `codepanion.local` / `about:` / `data:` 三类内部导航；其它 URI 直接 `e.Cancel = true` 转给 `OpenExternalLink`。
  - `NewWindowRequested`：一律 `e.Handled = true`，URI 同样走 `OpenExternalLink`。
- `OpenExternalLink` 行为：
  - 非 `http` / `https` 协议（含 `javascript:` / `file:` / `mailto:`）直接拒绝，写 gui.log。
  - http(s) 弹 OK/Cancel 确认框，明示要打开的 URL，再调用 `Process.Start(... UseShellExecute = true)` 让系统默认浏览器接管。
- 不做：没有写 WebView2 的自动化点击测试。WPF + WebView2 单测需要真实窗口栈，CI 上跑不动；改动是两段 cancel 路径，靠下一次 GUI 手测覆盖。

### N-20 WebMessageReceived 收敛到 type 白名单

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- 原实现用 `JObject.Parse` 拿到 `type`，然后链式 `if` 走 5 个 type；JSON 解析失败时只写一句 log，未知 type 也只是写 log，且每个分支都自己处理 `JObject` 的 dynamic 取值。
- 改为：
  - 顶层 try/catch 包裹 JObject.Parse，失败先写 gui.log 再 return。
  - 新增 `AllowedWebMessageTypes` 静态 HashSet (`ready` / `reply` / `event-reply` / `task-action` / `handoff-launch`)，空 / 未知 type 直接 warn + return。
  - 命中后才进入 switch，从这里再分派给 Handle* 方法。
- 这样恶意 / 误植的 type（未来 chat.js 改动出 bug 时）不会触达 daemon。
- 不做：没有进一步切到 `System.Text.Json` + 严格 record schema。Newtonsoft.Json 是项目主依赖，引入 STJ 会带来双依赖；目前 type 白名单 + Handle* 内部各自的 string 校验已经足以隔离 daemon。

### N-21 App.xaml.cs 崩溃落盘 + FocusAssistDetector 真实实现

- 路径：[packages/gui/App.xaml.cs](../packages/gui/App.xaml.cs)、[packages/gui/Services/SoundPlayer.cs](../packages/gui/Services/SoundPlayer.cs)
- App.xaml.cs：
  - 原 `DispatcherUnhandledException` 只弹 MessageBox，用户秒关后事故现场就丢了。
  - 改为先写 `%LocalAppData%\CodePanion\logs\gui-crash.log`（含异常类型 / message / stack），再异步入 GuiLogWriter 队列，最后才弹 MessageBox 并提示用户去看 log。
  - 同时挂上 `AppDomain.CurrentDomain.UnhandledException`：非 UI 线程崩溃也会落盘。
- SoundPlayer.cs (`FocusAssistDetector`)：
  - 原 `GetCurrentState` 读了一个并不存在的 `CloudStore\...\quiethourssettings.Data` 注册表项，且即便取到 byte[] 也直接返回 `Off`，等于全程返回 Off → 用户开了专注模式也照样发提示音。
  - 改为 P/Invoke `shell32.dll!SHQueryUserNotificationState`，按 Windows 文档枚举映射：`QUNS_QUIET_TIME → AlarmsOnly`、`QUNS_BUSY / RUNNING_D3D_FULL_SCREEN / PRESENTATION_MODE → PriorityOnly`、`QUNS_ACCEPTS_NOTIFICATIONS / QUNS_APP / QUNS_NOT_PRESENT → Off`。
  - 这次同时覆盖了 Focus Assist、Presentation Mode、D3D 全屏：用户开会 / 玩游戏时不发声音，回到正常态恢复。
- 不做：没有给 SHQueryUserNotificationState 写注入式 mock。Shell API 在 CI 容器里没有桌面 session，调用要么返回 NOT_PRESENT 要么返回 ACCEPTS——两种都映射到 Off，回归测试价值低；改动是一处 P/Invoke + switch，靠手动 QA 验证。

### 验证

```powershell
npm run build       # tsc + build-daemon-bundle 通过
npm test            # daemon 209/207 pass + 2 skip + adapter-sdk 19/19 全绿，0 fail
npm run validate:dtos  # C# DTO 与 protocol.ts 仍一致
```

### 不做的事（本批跳过项）

- N-13 ~ N-18、H-3 ~ H-5：留待下批集中处理；它们或者依赖更深的重构（H-3 / H-4 的同步阻塞）、或者影响打包发布脚本（N-15 / N-17 / N-18），需要单独评估变更面。
- 没有为 N-19 弹确认框的体验做 GUI 截屏对齐：当前 MessageBox 已是 WPF 标准控件，单走真机 QA 即可。后续 P3 GUI 整改可再统一替换成更克制的 in-app banner。

---

## 2026-05-23 第三轮审计第三批修复（N-8 / H-3 / H-4 / H-5 / N-13 / N-14 / N-15 / N-18）

收口 P0 yargs 兼容、P1 性能与隐私、P1 Map 单增 / Windows 命令注入 / pid 复用误杀。来源仍是 [docs/CODE_REVIEW_2026-05-23.md](CODE_REVIEW_2026-05-23.md)。

### N-8 `codepanion notify --message` 在 yargs `.strict()` 下首启即坏

- 路径：[packages/daemon/src/cli/index.ts](../packages/daemon/src/cli/index.ts)
- `install claude-code` hook 注入的命令是 `codepanion notify "<title>" --message "<body>"`，而 `notify` 仅声明了位置参数 `message`、未注册 `--message`；`.strict()` 直接拒，CLI 退出 1，hook 静默丢消息。
- 在 `notify` 命令上显式注册 `--message` 选项，描述里写明「与位置参数 message 二选一，--message 优先」。运行时回退顺序保持不变（`a.message ?? positional`）。
- 不做：没有改 install hook 的命令格式，因为多个第三方文档已经引用 `--message` 这种写法；服务端兼容反而成本最低。

### H-3 commandExists 改异步 + 5min TTL 缓存

- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)
- 原 `commandExists(name)` 用 `execSync('command -v ... / where ...')`，连续发起 handoff 时每次都同步阻塞 daemon 主线程几十～几百 ms（取决于 OS PATH 长度），WS broadcast 在这段时间内全部卡住。
- 改为：
  - `execFile` + Promise 包装，stdio 完全异步。
  - POSIX 用 `which`（`command -v` 是 shell builtin，`execFile` 不可达），Windows 用 `where`。
  - 模块级 `commandExistsCache: Map<name, { result, expiresAt }>`，TTL 5min；典型部署只有 codex / claude / opencode 三个目标，首启实测一次，后续走缓存。
- 调用点改为 `await commandExists(...)`，原 `const fallback = ... || !commandExists(...)` 同步逻辑一并改成 await。
- 不做：没有把 cache key 加上 PATH 指纹。本地开发环境 PATH 在 5min 内被改的几率极低，引入哈希反而增加冷启动开销。

### H-4 classifyHandoffIssueType 改预编译 + 末尾语料

- 路径：[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)
- 原 6 条带 `.*?` 的 regex 每次调用都在调用栈里临时构造；分类输入是接力子进程的整段 stdout（轻则几十 KB，重则 200 KB+），含大量短行时 `.*?` 的回溯能把单次 classifier 抬到 50~100ms 量级，期间 daemon 主线程不响应。
- 改为：
  - `HANDOFF_ISSUE_PATTERNS` 提到模块级常量数组（`{ kind, pattern }`），预编译一次；`classifyHandoffIssueType` 只做 `pattern.test(corpus)` 短路遍历。
  - 引入 `buildHandoffClassificationCorpus`：从 items / output chunks 反向取，截尾 50 行、上限 8KB；分类只看这小段，避开巨型 stdout 上的回溯。
- 关键字保持不变，确保现有 fixture / 用户语义可识别。
- 不做：没有引入 Aho-Corasick 等多模匹配库。当前 6 条 pattern 在 8KB 语料上的耗时已 < 1ms，加依赖得不偿失。

### H-5 handoffRunner prompt 明文不再静默残留

- 路径：[packages/daemon/src/pty/handoffRunner.ts](../packages/daemon/src/pty/handoffRunner.ts)、[packages/daemon/src/daemon/boot.ts](../packages/daemon/src/daemon/boot.ts)
- 旧实现：daemon 把 prompt + 启动配置 JSON 写到 OS `tmpdir/codepanion-handoff/<id>.json`，子进程 `rmSync` 删一次就 try/catch 静默吞失败；Windows AV 锁文件 / 子进程崩溃都会让明文 prompt 留下来。
- 现在：
  - 子进程 `runHandoffRunner` 启动后先 `readFileSync` 把 JSON 读进内存，再走 `tryRemoveWithRetry`：4 次尝试，间隔 0ms / 100ms / 250ms / 500ms。
  - 仍删不掉时把残留路径追加到 `tmpdir/codepanion-handoff/leaks.log`（`ISO\tpath`），保证父进程可见。
  - daemon `bootDaemon()` 在 acquireLock 之后立刻 `cleanupStaleHandoffTmp()`：扫整个 handoff tmp 目录，删 24h 前的残留；读 `leaks.log` 把登记过的路径再补一刀，处理完删 leaks.log 自身。
- 不做：没有把 prompt 写成加密格式。本地 tmp 在 OS 用户上下文内可读取就是设计前提，重点是「不留下 + 留下可追溯」而非加密。

### N-13 codexDesktopAdapter trackedFiles 引入 LRU + TTL

- 路径：[packages/daemon/src/adapters/codexDesktopAdapter.ts](../packages/daemon/src/adapters/codexDesktopAdapter.ts)
- 旧 `trackedFiles: Map<path, { path, offset, threadId }>` 只增不减；用户长时间挂着 GUI 时 codex sessions 目录会持续产新 jsonl，Map 单调爬升，8h 长跑 RSS 报告每小时 +几 MB。
- 改动：
  - `TrackedFile` 新增 `lastSeenAt`，`consume()` 初始化与每次更新都刷新。
  - 新增 `evictStaleTrackedFiles()`：先按 TTL (48h idle) 与 `existsSync(path)` 清除过期 / 文件已被 Codex 自身 GC 的条目；若仍超过 cap (512)，按 `lastSeenAt` 升序删除最旧的若干。
  - `scan()` 头尾各调用一次 `evictStaleTrackedFiles()`，保证单次 scan 内即便新增 > cap 也能立刻收敛。
  - 构造器暴露 `maxTrackedFiles` / `trackedFileTtlMs` 重载（测试用）；新增 `trackedFileCountForTests()` test-only API。
- cap 取 512 = 10 × RECENT_SESSION_LIMIT，足够覆盖几天的会话；TTL 48h 与 ACTIVE_SESSION_WINDOW_MS (3 天) 同量级，避免周期扫描反复重生已淘汰的项。
- 不做：没有把 trackedFiles 移到磁盘持久化。重启后从头扫一遍只多消耗一次 IO，但拿回了「单进程内 Map 上限可控」的强保证。

### N-14 runWorkflow 对 executor 抛错归一化为 failed step

- 路径：[packages/daemon/src/workflows/workflowDefinitionManager.ts](../packages/daemon/src/workflows/workflowDefinitionManager.ts)、[packages/daemon/test/workflowDefinitionManager.test.mjs](../packages/daemon/test/workflowDefinitionManager.test.mjs)
- H-2 让 pty.spawn 失败时不再 process.exit 直接绕过 hooks，但 `runWorkflow` 自身仍是 `const exitCode = await executor(...)` 裸 await：executor 抛错（spawn ENOENT、registerSession 失败、handoff 路径异常）会一路 reject 到 daemon，`onStepFinish` / `onWorkflowFinish` 都不触发，GUI 上 step 永远停在 running。
- 现在用 try/catch 包裹，捕获到异常时把 stepRun 标成 `status='failed'` / `exitCode=-1` / `message='executor threw: ${err.message}'`，触发 onStepFinish 后把 run.status 置 failed 并 break。剩余步骤不再执行（与 exitCode!==0 行为一致）。
- 测试：新增「executor 抛错（如 pty.spawn 失败）时归一化为 failed step」用例，断言 step.exitCode=-1、message 含原始错误、finalRun.status='failed'、后续依赖步骤不执行。

### N-15 Windows .cmd/.bat 参数转义（CVE-2024-27980）

- 路径：[packages/daemon/src/pty/runner.ts](../packages/daemon/src/pty/runner.ts)、[packages/daemon/test/runnerWindowsEscape.test.mjs](../packages/daemon/test/runnerWindowsEscape.test.mjs)
- CVE-2024-27980：Windows 上 child_process / node-pty 生成 `.cmd` / `.bat` 时实际由 `cmd.exe /c` 解释；参数即使被 `"..."` 包裹，含 `& | < > ^ "` 或换行的内容仍可逃逸出引号上下文执行任意命令。Node ≥ 21.7 在 `child_process` 默认拒绝，但 node-pty 不走 child_process，必须在 daemon 这层显式拦。
- 新增导出：
  - `isWindowsBatchShell(shell)`：只在 Windows 平台对 `.cmd` / `.bat` 后缀返回 true。
  - `escapeWindowsBatchArg(arg)`：含 `& | < > ^ "` 或换行的参数直接抛错（明确提到 CVE-2024-27980），含空白的安全参数包裹 `"..."`，其余原样返回。
- `runWithPty` 在 PTY spawn 之前判断 `isWindowsBatchShell(shell)`，命中时 `input.args.map(escapeWindowsBatchArg)`；任何参数失败都 `console.error` 后 `process.exit(2)`，不静默放行。
- 测试：覆盖 8 种典型危险参数 + 含空白安全参数 + 无空白安全参数；测试在非 Windows 上仍跑得通（`isWindowsBatchShell` 返回 false 不进入转义路径）。
- 不做：没有提供「我知道我在干什么，请放行」的 override。本仓 workflow / template 参数面向本地用户填写，正常用例从来用不到 cmd.exe 元字符；真要绕过应改成调 `.exe`。

### N-18 cli stop 验证 daemon 身份再发 SIGTERM

- 路径：[packages/daemon/src/daemon/pidfile.ts](../packages/daemon/src/daemon/pidfile.ts)、[packages/daemon/src/cli/stop.ts](../packages/daemon/src/cli/stop.ts)、[packages/daemon/test/pidfileIdentity.test.mjs](../packages/daemon/test/pidfileIdentity.test.mjs)
- 旧 `stopCommand` 拿到 pidfile 后直接 `process.kill(pid, 'SIGTERM')`；如果 daemon 早已退出而 OS 把 pid 复用给了用户的另一个进程（编辑器、终端），就会误杀无辜进程。
- 新增 `verifyDaemonIdentity(pid)`：
  - Linux 读 `/proc/<pid>/cmdline`（NUL 分隔 → 空格）。
  - macOS 用 `execFileSync('ps', ['-p', pid, '-o', 'command='])`。
  - Windows 先 `wmic process where ProcessId=<pid> get CommandLine /value`，失败 / `match()` 为空时回退 `powershell -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>').CommandLine"`。
  - 命令行匹配 `/(daemon-entry|codepanion)/i` 返回 `match`、不匹配返回 `mismatch`、OS 调用全失败返回 `unknown`。
- `stopCommand` 行为：
  - `match` / `unknown` → 维持旧逻辑（SIGTERM → 25 × 100ms 等待 → 必要时 SIGKILL）。
  - `mismatch` → 写 warn 后只清 pidfile，绝不 kill。
  - SIGKILL 之前再 verify 一次，避免 SIGTERM 等待期内 pid 被复用。
- 测试：用当前测试进程（命令行不含 daemon-entry）断言 result ∈ {mismatch, unknown} 且绝不为 match；用 pid=2147483646 断言 unknown 路径不抛错。

### 验证

```powershell
npm run build          # tsc + build-daemon-bundle 通过
npm test               # daemon 215/218 pass + 2 skip + 1 ephemeral-port flake（server.integration 单跑全绿），adapter-sdk 19/19，0 真失败
npm run validate:dtos  # C# DTO 与 protocol.ts 一致
```

### 不做的事（本批跳过项）

- N-16 history.append NDJSON 重构、N-17 cli start 与 GUI 双击并发竞态：留待下批；它们都属于持久化 / 进程协议层的更深动作，需要单独评估。
- 没有对 H-3 commandExists 缓存写直接单测（函数是 server.ts 内部模块作用域）；改动只是把同步 execSync 替换成异步 execFile + Map 缓存，回归靠现有 server.integration.test.mjs 的 handoff 路径覆盖。
- 没有对 H-4 buildHandoffClassificationCorpus 写性能基准；新实现把语料截到 8KB / 50 行后回溯空间塌缩到常数级，肉眼即可判断收益，正式 benchmark 留给「长时间稳态验证」阶段统一做。

---

## 2026-05-23 第三轮审计第四批修复（N-16 / N-17）

收口剩余 P1 持久化健壮性 + 启动原子性两项。来源仍是 [docs/CODE_REVIEW_2026-05-23.md](CODE_REVIEW_2026-05-23.md)。

### N-16 — `WorkflowRunHistory` 重写为 NDJSON

旧实现把 history 当成单个 JSON 对象（`{ version, runs:[] }`），每次 `append` 都是「读全文件 → 整段 schema parse → 数组追加 → 全量回写」。这条路径有两个致命问题：

1. **任何一条历史 schema 失败，整个文件被 quarantine** —— `load` 走 try/catch 后把文件改名为 `*.broken-*.json` 并返回空 store，几百条历史一次坏 entry 全丢。
2. **append 频率随 runs 数线性变慢** —— 每次都要 reparse 整段 + 整段 stringify 回写。

改成 NDJSON：

- [packages/daemon/src/workflows/workflowDefinitionManager.ts](../packages/daemon/src/workflows/workflowDefinitionManager.ts)
  - `append(run)` 改为 `appendFileSync(this.path, JSON.stringify(parsed) + '\n', 'utf8')`：不再读旧文件，新 run 永远落得下来。
  - `load()` 增加 `tryLoadLegacy()`：先 `JSON.parse(raw)`，多行 NDJSON 在第二条 JSON 处必败 → 走 `parseNdjsonRuns`；parse 成功且形状是 `{ version, runs }` 容器才走 legacy 迁移（成功 → `rewriteNdjson` 一次到位；schema 失败 → 仍走 quarantine 隔离，避免把可疑文件误当 NDJSON 用）。
  - `parseNdjsonRuns()`：按行 `JSON.parse + WorkflowRunSchema.parse`，坏行计数 + 首样本 → `logger.warn`，其余行保留；同 id 后写入覆盖前写入（适配「dry-run 后真跑」覆盖语义）。
  - `maybeCompact()`：用 newline 计数做廉价启发，超过 `maxRuns × 1.5` 才 compact —— `load → sort by startedAt desc → slice(0, maxRuns) → tmp+rename rewrite`，把成本摊到很多次 append 上。

关键设计点：

- **legacy 识别不能只看首字符 `{`**：NDJSON 每行也以 `{` 开头，否则 NDJSON 文件会被误判成损坏 legacy 容器，触发 quarantine 后整个文件被改名 —— append 还能写但 list 永远空。改用「parse 整段成功 + 形状有 `runs` 字段」双重判断。
- **compaction 不在每次 append 后都跑**：行数计数走 `Buffer.charCodeAt(i) === 10`，常数级；行数 ≤ 阈值时立即返回。

回归测试（[packages/daemon/test/workflowDefinitionManager.test.mjs](../packages/daemon/test/workflowDefinitionManager.test.mjs)）：

1. **单行坏数据不会 truncate 全历史** —— 在合法 run 之间夹两条坏行，`list()` 返回 3 条合法 run，原文件不被改名。
2. **旧版 `{ version, runs }` 容器首次加载自动迁移为 NDJSON** —— 文件被原地改写为多行，每行独立 JSON。
3. **append 不读旧文件，坏行存在时新 run 仍能成功落盘** —— 预置一行损坏 NDJSON，调用 `append`；旧坏行原样保留、新行追加到末尾，`list()` 跳过坏行返回新 run。
4. **超过 `maxRuns × 1.5` 后触发 compaction，长跑稳定在 maxRuns** —— maxRuns=4 append 10 次，文件最终落在 ≤ 6 行，`list()` 返回最新 4 条。
5. **现有 N-9 测试更新**：旧版 quarantine 语义只在「JSON.parse 成功 + 形状是 legacy 容器 + schema 失败」这条窄路径上保留；完全坏掉的 JSON（trailing comma 之类）改交给 NDJSON 跳过坏行处理，更安全。

### N-17 — `acquireLock` 改用 `openSync('wx')` 原子独占创建

旧实现 `readPid → isProcessAlive → clearPid → writePid` 四步全是非原子。`codepanion start` 与 GUI 双击同时启动时，两个 daemon child 可以同时通过 alive 检查（pid 文件刚被对方 `clearPid` 清掉，或两侧都拿到 dead pid），然后两侧 `writePid` 顺序覆盖，最终两个 daemon 同时跑 —— 抢 8181 端口、抢 token 文件、抢 workflow snapshot 写入。

改动（[packages/daemon/src/daemon/pidfile.ts](../packages/daemon/src/daemon/pidfile.ts)）：

- `acquireLock(path = PID_PATH)` 走 `openSync(path, 'wx')` 原子独占创建：只有一个 child 能赢，其他立即 EEXIST 退出。
- EEXIST 时检查持有者：alive → 本进程立刻让位（`return false`）；dead → unlinkSync 后重试一次 `wx`（兼容上次 daemon 异常退出后无法重启）。最多 2 attempt。
- 接受 `path` 入参（默认 `PID_PATH`）：production 行为无变化，回归测试可以传 mkdtempSync 临时路径覆盖三条关键路径，不污染 `~/.codepanion/daemon.pid`。

回归测试（[packages/daemon/test/pidfileLock.test.mjs](../packages/daemon/test/pidfileLock.test.mjs)）：

1. **首获空闲 pidfile** → 返回 true，文件写入当前 pid。
2. **活持有者** → 把测试进程自己的 pid 预写入 pidfile（alive 检查必为 true），`acquireLock` 立刻返回 false，绝不覆盖。
3. **死残留** → 预写一个几乎不可能存在的 pid（2147483646），触发「EEXIST → isProcessAlive=false → unlink → 重试 wx → 成功」路径。
4. **同进程连续调用** → 首获成功、再次必返回 false（覆盖「两个 child 都通过 alive 检查」的回归不变量）。

### 验证

```powershell
npm run build          # tsc + build-daemon-bundle 通过
npm test               # daemon 224 pass + 2 skip（@npmcli/ci-detect / 平台门控），adapter-sdk 19/19，0 真失败
npm run validate:dtos  # C# DTO 与 protocol.ts 一致
```

### 不做的事（本批跳过项）

- `cli/start.ts` 仍保留 `stalePid` 时 `clearPid()` 的旧逻辑：`acquireLock` 已能在 child 侧原子化处理死残留，这段 CLI 提前清理在并发场景下严格意义上是冗余的，但不再有害（child 走 wx，并发另一侧仍能让位）。删除它属于另一项「CLI startup 流程精简」，不在本次审计范围。
- 没有对 N-16 写「8h 长跑 history 文件不会无限膨胀」的端到端基准：compaction 触发条件（行数 > maxRuns×1.5）容易由单元测试覆盖，真实长跑数据点留给 [docs/POSITIONING.md](POSITIONING.md) 的 Alpha 验收阶段。
- 没有 N-17 的真多进程并发测试：node:test 同进程下用 `openSync('wx')` 串行也能覆盖关键不变量（首获 / 活让位 / 死残留），真正的多进程原子性由 OS `O_EXCL` 语义保证；手动多终端验证留给 GUI 真机入口审查环节。

---

## 2026-05-23 第三轮审计修复 P2/P3 + GUI 单栏重做

本批一次性收掉「第三轮全仓审计」积压的 P2/P3 长尾，并顺手把用户当面反馈的两个最痛点（WebView 右键刷新就空、前端 UI 太杂）一起解决。S-2 仍延后。

### A-3 adapter-sdk `file-watcher.mjs` Linux 兼容

- 路径：[packages/adapter-sdk/examples/file-watcher.mjs](../packages/adapter-sdk/examples/file-watcher.mjs)
- 旧实现直接 `fs.watch(dir, { recursive: true })`。Linux 上 Node < 20 不支持 recursive，会抛 `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`，示例 watcher 静默丢事件。
- 新增 `tryRecursiveWatch()`：捕获该错误码（或 `/recursive/i` 文本兜底）→ 返回 false → 进入 `watchRecursiveFallback()`，对目标根目录的所有子目录递归挂 `fs.watch`，再为 mkdir 出来的新子目录补 watch。
- 其它错误（权限、ENOTDIR 等）仍原样抛出，不被吞掉。
- 头部 doc block 写清平台支持矩阵，避免下一个读 example 的人再踩同一坑。

### A-4 adapter-sdk `local-tool-bridge.mjs` 事件 dedupe

- 路径：[packages/adapter-sdk/examples/local-tool-bridge.mjs](../packages/adapter-sdk/examples/local-tool-bridge.mjs)
- 国产工具控制台经常把同一行（如 `FAIL: build broken`）重复打 N 次（spinner、retry 框架）。bridge 直推每一行会把 daemon `/events` 打爆 + workflow 列表灌满重复条目。
- 新增 `createDedupe(now, windowMs=30_000, maxKeys=4_000)` 工厂：
  - sha1(line) → Map<hash, ts>；
  - 同 hash 在 30s 窗口内只放行一次；
  - 命中后用 `Map.delete + set` 把 key 移到末尾，构成 LRU；
  - 超出 maxKeys 时丢最旧条目（FIFO 头）。
- `drainChunk()` 在 `classify()` 之前 `if (!shouldEmit(line)) continue;` 过滤。
- 测试 [packages/adapter-sdk/test/localToolBridge.test.mjs](../packages/adapter-sdk/test/localToolBridge.test.mjs) 新增两条：
  - 同行在窗口内只放行一次、窗口外再次放行；
  - 超过 maxKeys 后最旧 key 被淘汰、其余仍在窗口内的继续被抑制。

### V-1 vscode-extension daemon-down 指数退避

- 路径：[packages/vscode-extension/extension.js](../packages/vscode-extension/extension.js)
- 老逻辑：daemon 没起来 / 重启时，扩展每个事件都打一条 `console.warn` + 立即重试 register，dev console 几秒就刷屏。
- 新增 `markDaemonOnline()` / `markDaemonOffline()` / `scheduleReconnect()`：连接错误专门用 `isConnectionError()` 区分（`ECONNREFUSED` / `ECONNRESET` / `ETIMEDOUT` / `AbortError` 等），重连延迟 1s → 2s → 4s → … 封顶 60s（`RECONNECT_MAX_MS`）。
- `consecutiveFailures > SILENT_AFTER_FAILURES(3)` 后所有同类连接失败静默，避免 `logFailure` 反复 warn；4xx / 5xx / 解析失败仍正常落盘。
- reconnect 成功补一条「VS Code 已连接」activity 事件，与首次 register 行为一致。
- `markDaemonOffline()` 同时清空 `sourceId`，避免 daemon 重启后用旧 id 推事件。

### V-2 vscode-extension request timeout

- 同上文件
- 旧 `http.request` 没设 timeout，daemon 进入异常状态（socket accept 但不读）时会无限挂起，VS Code 状态栏对应回调永久 pending。
- 新增 `DEFAULT_REQUEST_TIMEOUT_MS = 8_000` + `req.setTimeout(timeoutMs, () => { req.destroy(new Error(...ETIMEDOUT)) })`，长任务路径可在 `options.timeoutMs` 显式放大。
- 错误被 `isConnectionError` 归类为连接错误，触发 V-1 静默退避路径。

### V-3 vscode-extension config 文件探测

- 同上文件
- 旧实现：扩展激活时直接 `fs.watch(~/.codepanion/config.json)`，但首次安装 daemon 还没生成 config，会抛 ENOENT 让 watcher 直接死掉，daemon 起来后 token 轮换也无法被 pick up。
- 新逻辑：
  - `watchConfigFile()` 返回布尔，try/catch 包裹 fs.watch；
  - 失败时 `startConfigProbe()` 用 `setInterval(5_000)` 周期探测，文件出现立刻装上 watch 并清掉 probe；
  - `configProbeTimer.unref()` 不阻塞 VS Code 退出；
  - `onDidChangeConfiguration` 监听 `codepanion` 设置变更，同样 `invalidateConfig()`。
- `__internals` 导出常量 + `isConnectionError`，便于以后接 node:test 补回归。

### S-1 `scripts/package-windows.ps1` 通配符稳定性

- 路径：[scripts/package-windows.ps1](../scripts/package-windows.ps1)
- 旧 `Copy-Item -Path (Join-Path $publishDir '*') -Destination $distDir -Recurse -Force` 在 PowerShell 5.1（系统默认）和 PowerShell 7 行为不同：PS5 对子目录递归通配符解析不稳，少数情况下顶层文件按字面拷贝、嵌套目录漏掉。
- 改用 `Get-ChildItem -LiteralPath $publishDir -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination ... -Recurse -Force }` 显式枚举顶层条目，整段路径不再有任何通配符解析。
- 行 147-153 加注释说明 PS5/PS7 行为差与 LiteralPath 的意图。

### GUI 「右键刷新就空」+ 单栏东京黑重做

> 用户截图反馈：「软件开着的，一刷新就看不见任何东西了，前端太复杂了，需要简约，用暗色调设计，白色不合适，一大堆莫名其妙的东西」。AskUserQuestion 收敛后定下：刷新触发是 WebView 右键 → 刷新；调色板用 Tokyo Night；策略「彻底推翻重做，先做线框」；要砍掉左侧状态 tab、左侧分组切换、顶部四宫格、右上操作按钮一排；布局选「纯单栏 · 任务流」；与本批 P2/P3 修复一起交付。

#### Host 端 snapshot replay（解决「刷新就空」）

- 路径：[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- 根因：[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js) 在初始化时向 host 发 `{type:'ready'}`，host 之前只回 `connection-status`，不会重发 workflow/sources snapshot。daemon WebSocket 是长连，所以右键 reload 之后 WebView 的 JS 状态全清空，但 daemon 不知道要再推一次，结果 UI 空白。
- 修复：
  - 新增字段 `_cachedWorkflowSnapshot`（JToken）+ `_cachedSourcesSnapshot`（`MonitorSourceInfo[]`）+ `_snapshotCacheLock`。
  - `OnWorkflowSnapshotReceived` / `OnSourcesSnapshotReceived` 在转发给 WebView 的同时把最新一份 deep clone 缓存到字段里。
  - `case "ready"` 分支调用新增的 `ReplayCachedSnapshots()`：在锁内取一次缓存，先发 `sources-snapshot` 再发 `workflow-snapshot`（顺序与 daemon 首次广播一致，避免 workflow item 指向未注册的 source）。
- 设计权衡：没有走「daemon 主动重推」是因为 daemon 端并不知道 host 触发了 reload；走 host 缓存避免与 daemon WebSocket 协议变更耦合，单点改完即生效。

#### chat.css 东京黑 + 单栏 override

- 路径：[packages/gui/wwwroot/chat.css](../packages/gui/wwwroot/chat.css)
- DOM 不动：1736 行 `chatWorkflowSnapshot.test.mjs` 依赖 `#conversation-list / #stage-source / #stage-focus-reply / #spotlight-next-action` 等 id 才能通过。本轮以纯 CSS 视觉重做绕过测试同步成本，DOM 节点裁剪 + 测试更新留 Phase 2。
- `:root` token 全量替换为 Tokyo Night：`--bg #1a1b26`、`--panel #1f2030`、`--text #c0caf5`、`--accent #7aa2f7`、绿/橙/红/紫四色诊断色。
- 末尾 `/* === 东京黑 + 单栏视觉 override === */` 块（约 300 行）：
  - `#app-shell` 强制 `grid-template-columns: 360px minmax(420px, 1fr) !important; grid-template-rows: 1fr !important`，把原来的多列多行布局压回左侧任务流 + 右侧任务详情两栏。
  - `display: none !important` 隐藏：`#source-rail`、`#code-browser`、`#omnibar`、`.queue-overview`、`.sidebar-tools`、`.list-grouping`、`#batch-toolbar`、`.stage-actions`、`.priority-strip`、`#task-spotlight`、`#conversation-header .crumb`。
  - 暗化 `.conversation-item`、`.action-button`、status pill、code block、scrollbar、输入框；保留必要的语义色（done 绿 / error 红 / waiting 橙 / running 紫）。

### 验证

- `npm test`：226 总条，223 pass，1 fail（`/sources/:id/disconnect`，fetch `bad port` — `server.address().port` 在 ephemeral 端口分配的少数时序下拿到 0，与本批改动无关，复现不稳，列入 daemon 测试基础设施跟进项）。
- 没有覆盖 `ReplayCachedSnapshots()` 的单元测试：WPF + WebView2 host 路径目前不在 node:test 范围，等下一轮 host 端用 `MainWindowTestHarness` 抽象时补上回归。
- UI 没在真机跑过；东京黑 + 单栏布局 + 右键刷新不丢，需要用户本地双击 `dist/CodePanion-win-x64/CodePanion.Gui.exe` 真机确认。

### 不做的事（本批跳过项）

- **S-2** `scripts/build-daemon-bundle.mjs` external 声明仍延后：与 `pkg` / `esbuild` 选型相关，单独一项更合适。
- **J-01 ~ J-10** chat.js 长尾（重渲、内存、链接处理）：CSS 重做已经把用户视觉吐槽收掉，本批不进 chat.js 业务逻辑，避免和上面这些长尾交织。
- **Phase 2 DOM 裁剪**：把 `display: none` 的节点真正从 DOM 删掉、同步更新 `chatWorkflowSnapshot.test.mjs`（约 30 个测试 case 的选择器），单独一轮。
- 没补 V-1/V-2/V-3 的 node:test：扩展用了 `vscode` 模块，纯 node:test harness 起不来；`__internals` 导出已经准备好，等下一轮专门加 mock。

---

## Alpha 用户实测反馈四项硬伤（2026-05-24）

> 用户截图 + 文字反馈：「界面没变化，刷新也没用；前端最左边是什么东西；我把 codex 都关了，在 VS Code 里 Claude Code 插件工作，你的界面里只有 Codex；问题还是很多且相当严重」。逐条定位为四个独立缺陷：A 来源已退出仍显示运行中 / B Claude Code 完全识别不到 / C 刷新后状态不与现实同步 / D 左侧 sidebar 顶部有冗余装饰元素。

### A：thread `sourceOnline` 生命周期

- 路径：[packages/daemon/src/shared/protocol.ts](../packages/daemon/src/shared/protocol.ts)、[packages/daemon/src/daemon/workflowManager.ts](../packages/daemon/src/daemon/workflowManager.ts)、[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)、[packages/gui/wwwroot/chat.js](../packages/gui/wwwroot/chat.js)
- 根因：`WorkflowStatus` 只有 `running / waiting / done / error / paused`，没有「来源已离线」语义；Codex 退出后 thread 在最后一次事件里多半停在 `running`，daemon 重启 / 进程消失都不会自动改写 thread.status（`paused` 是用户主动操作的语义，不能借用）。
- 修复：
  - `WorkflowThreadSchema` 新增可选 `sourceOnline?: boolean`（向后兼容旧 snapshot）。
  - `WorkflowManager.setSourceOnline(sourceId, online)` 同时按 `thread.id === source:<id>` 命名约定与 `thread.source === sourceId` 字段匹配；只在实际翻转时广播 `thread-upsert`，避免高频空刷新。
  - `WorkflowManager.loadSnapshot` 重启后强制把所有恢复的 thread 标为 `sourceOnline: false`，等真实 source 重新 register 时再翻 true。
  - `server.ts` 在 `sources.onEvent` 中加 `source-registered → setSourceOnline(true)` / `source-disconnected → setSourceOnline(false)` 两条直通线；monitor-event upsertThread 路径在 thread payload 上带 `sourceOnline: true`。
  - `chat.js` 的 `storeWorkflowThread` 透传时用 `??`（不是 `||`）防止 `false` 被旧 `existing.sourceOnline` 覆盖；`deriveConversationDisplay` 新增 `source-offline` 分支但**只降级非 actionable 状态**，等待我 / 失败 / 需审阅 即使来源离线也保留高优先级显示。
- 测试：[packages/daemon/test/workflowManager.test.mjs](../packages/daemon/test/workflowManager.test.mjs) 三条新增（按 source 字段匹配、按 id 命名匹配、重启后默认离线）；[packages/daemon/test/chatWorkflowSnapshot.test.mjs](../packages/daemon/test/chatWorkflowSnapshot.test.mjs) 三条（offline 降级、offline + waiting 不降、offline + error 不降）。

### B：Claude Code / Codex CLI / OpenCode 进程探测盲区

- 路径：[packages/daemon/src/adapters/aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts)
- 根因：`TOOL_PROFILES` 一直只覆盖国产工具 + CC Switch；Claude Code、Codex CLI、OpenCode 三个英美 CLI 完全没有 profile，进程在跑也不会注册为 source。CC Switch 是账号 / provider 切换器，跟 Claude Code 本身根本不是一个东西，命名巧合让人误以为已经覆盖。
- 修复：
  - 在 `TOOL_PROFILES` 头部加入三个 `tier: 'first'` profile：
    - `claude-code`：`processPatterns` 匹配 `claude(-code).exe`；`commandPatterns` 锚定 npm 包名 `@anthropic-ai/claude-code` + 路径段 `\claude-code\(bin|cli|dist)\`，避免误命中其它叫 claude 的程序。
    - `codex`：进程名 `codex.exe`；命令行用 `@openai/codex` 锚定，并加负向 lookahead `(?!desktop)` 把 `codex desktop` 子命令让给 `codexDesktopAdapter`。
    - `external` (OpenCode)：进程名 `opencode.exe` + `@sst/opencode` 路径段。
  - 在 `scan()` 注册 source 前对非 `switcher` profile 强制 `overrideMetadata`：`capabilityLevel: 'L1-L2'`、`integrationKind: 'process-scan'`、`privacyBoundary: 'minimal-process'`。`sourceManager.defaultSourceMetadata` 默认会把 `claude-code/codex` kind 当成 L3 cli-pty（真实接力），进程探测必须显式降级，不能让 GUI 错误显示「深度接管」。
- 测试：[packages/daemon/test/aiToolProcessAdapter.test.mjs](../packages/daemon/test/aiToolProcessAdapter.test.mjs) 新增三条 + 调整 `byTier.first` 断言名单；`codex desktop` 反例确认会被 negative lookahead 排除。

### C：host 收到 `ready` 时主动从 daemon REST 重拉快照

- 路径：[packages/gui/Services/DaemonClient.cs](../packages/gui/Services/DaemonClient.cs)、[packages/gui/MainWindow.xaml.cs](../packages/gui/MainWindow.xaml.cs)
- 根因：上一轮 `ReplayCachedSnapshots()` 只把 host 端缓存重发给 WebView，但用户在 GUI 启动后**才**开 / 关工具时，daemon 的真实状态可能已经走在前面，cache 还是旧数据，所以「刷新也没用」。
- 修复：
  - `DaemonClient` 新增 `FetchSourcesSnapshotJsonAsync()` / `FetchWorkflowSnapshotJsonAsync()`，走 daemon HTTP REST `GET /sources` 与 `GET /workflow/snapshot`，带 Bearer token。
  - `ReplayCachedSnapshots()` 改成两步：先 dispatch 缓存（即时不空白），再 fire-and-forget 异步触发 `RefreshSnapshotsFromDaemonAsync()`：拉到新 JSON 后覆盖 `_cachedWorkflowSnapshot` / `_cachedSourcesSnapshot`，再回到 UI 线程 SendMessageToWeb。
  - 不阻塞 ready 响应，避免刷新动作"卡一下"；REST 失败时静默写日志，UI 仍然显示 cache。
- 没有覆盖此路径的 node:test，原因和上一轮一样：WPF + WebView2 + WebSocket reload 路径需要 `MainWindowTestHarness` 抽象，单独一轮收。

### D：左侧 sidebar 顶部冗余装饰元素

- 路径：[packages/gui/wwwroot/chat.css](../packages/gui/wwwroot/chat.css)
- 用户截图指的「最左边那个东西」追到 `brand-row` 里的 `.status-indicator`（红 / 灰圆点 + "未连接"文字）+ 副标题 `<p>统一多任务操作平台</p>`。极简单栏布局已经把这俩留在 sidebar 最顶部，看起来像残留小控件。
- 修复：
  - `#conversation-sidebar .brand-row p`、`#conversation-sidebar .status-indicator` 全 `display: none !important`，让 sidebar 顶部只剩 `<h1>CodePanion</h1>` 直接进入任务列表。
  - 真实连接状态走 `stage-meta` 与新增的 `source-offline` 任务标记体现，不再依赖独立小指示器。
  - 同时补 `.conversation-dot.source-offline { background: #475569 }` + `.conversation-item:has(.conversation-dot.source-offline)` 的 `opacity: 0.62` + `.status-chip` 灰底字体色，让"来源已离线"在任务列表里能一眼区分于运行中 / 完成 / 失败。

### 验证

- `npm test`：232 总条，230 pass，2 skip（POSIX 0o600 权限测试在 Windows 上 skip），0 fail；SDK 21/21 pass；C# DTO 校验通过。
- 之后需重跑 `scripts/package-windows.ps1` 重打 `dist/CodePanion-win-x64/` 与同名 zip，然后请用户真机双击 EXE 验证：
  1. 关闭 Codex 后任务点变灰、status chip 显示「来源已离线」；
  2. 在 VS Code 里启动 Claude Code 插件后 10s 内出现新 source；
  3. WebView 右键 reload 后 UI 立刻显示真实 daemon 状态而非 stale cache；
  4. sidebar 顶部不再有"未连接"小圆点 + 副标题。

### 即时回归：B 加的 profile 触发"一排重复 Codex"假来源（2026-05-24 紧急修复）

> 用户立即截图反馈：列表里出现 10 项几乎一样的卡片，其中 8 项是 Codex，2 项是 claude-code，但他已经关掉了 Codex。

- 根因：上面 B 步加的三个 profile 把 `processPatterns` 设得太宽：
  - `processPatterns: [/^codex(\.exe)?$/i]` 直接命中 Codex Desktop 的 Electron 多进程模型（主进程 + N 个 renderer / GPU / utility helper 都叫 `codex.exe`），每个 PID 都被注册成独立 source。
  - `commandPatterns` 里 `/(^|[\s"'])codex(\.exe)?\s+(?!desktop)/i` 这种宽松文本匹配同样让任何命令行含 "codex " 字串的进程被吞进来。
  - 即便有 `sourceKeyForProcess`，其默认 `${kind}:${PID}` 分键策略也无法合并不同 PID 的同工具实例。
- 修复（[packages/daemon/src/adapters/aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts)）：
  - 三个新 profile 的 `processPatterns` 全部清空（`[]`），完全不靠进程名命中。
  - `commandPatterns` 收敛为**单条**严格 npm 包路径：`/[\\/]@anthropic-ai[\\/]claude-code[\\/]/i`、`/[\\/]@openai[\\/]codex[\\/]/i`、`/[\\/]@sst[\\/]opencode[\\/]/i`。Codex Desktop / 同名第三方程序的 commandLine 里不会出现这些 npm 包路径，被天然排除。
  - `sourceKeyForProcess` 把 `claude-code` / `codex` / `external` 一并并入 path-based dedup 分支（原先只有 `cc-switch`），同一可执行路径不同 PID 合并为一个 source。
- 测试（[packages/daemon/test/aiToolProcessAdapter.test.mjs](../packages/daemon/test/aiToolProcessAdapter.test.mjs)）：
  - 新增 4 条防御测试：claude.exe 无包路径→不命中；codex.exe Electron main / renderer→不命中；OpenCode 同名误识别→不命中；同一 binary path + 不同 PID + 正反斜杠路径→同一 source key。
  - 全套通过：234 总条 / 232 pass / 2 skip / 0 fail；SDK 21/21；DTO 校验通过。
- 教训写进自己的工作流：新增 process 探测 profile 时，processName 单独命中要慎用——Electron / Node CLI 命名空间冲突是常态，必须靠唯一标识（npm 包路径 / 唯一 binary 签名）二次校验，并默认走 path-based dedup。
- 之后重打 `dist/CodePanion-win-x64/` + 104.3MB zip；新 daemon bundle 已确认包含严格匹配（grep 命中 5 处）。
- 用户验证步骤（必须先杀掉上一个 EXE 实例再启动新 dist 里的 `CodePanion.Gui.exe`）：
  1. Codex Desktop 在跑、Codex CLI 没装时，列表里**不**应出现任何 Codex 来源；
  2. 同时跑 Claude Code CLI 多个子进程时，列表里**只**出现一个 claude-code 来源而非多个；
  3. 关闭 Codex / Claude Code 后 10 秒内对应来源消失或被翻为 sourceOnline=false。
