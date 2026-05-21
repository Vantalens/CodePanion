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
