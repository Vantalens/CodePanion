# CodePanion 当前开发任务标准

## 使用规则

- 本文件从 2026-05-21 起重写为当前开发标准，不再承载历史流水账。
- 历史审计、命令证据、已完成修复记录保留在 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md) 和 Git 提交历史中。
- 新任务只有在符合 [docs/POSITIONING.md](docs/POSITIONING.md) 的产品边界时才能进入本文件。
- 每完成一组可验证改动，必须同步更新本文件状态。

状态标记：

- `[ ]` 未开始
- `[-]` 进行中
- `[x]` 已完成
- `[!]` 受阻

---

## 当前产品标准

CodePanion 当前不是聊天客户端、通用个人 Agent、完整 AI IDE、通用启动器或系统进程监控器。当前产品标准是：

> **本地优先、供应商中立、跨软件 / 跨窗口 / 跨项目的多任务完整操作台。**

当前阶段只优先解决四件事：

1. **看得懂**：用户一眼知道哪个任务在运行、等待、审批、失败或完成。
2. **不乱跳**：新事件不能抢走用户正在看的任务，界面不能因为输出刷新而弹跳。
3. **分得清**：助手内容、用户输入、命令输出、工具调用、文件变更必须有清晰边界。
4. **接得住**：等待输入、审批和失败必须高优先级显示，并给出真实可用动作。
5. **管得住**：任务需要能被置顶、稍后、归档和恢复，避免主队列持续堆积。

---

## 当前最高优先级：GUI 可理解性重建

用户反馈：

- 界面一会像 `cmd` 输出，一会像助手回答。
- 看不出来当前任务到底在做什么。
- 内容不停弹跳，阅读位置不稳定。
- 输出内容混在一起，主界面没有控制台应有的秩序。

判断：

- 现有 GUI 仍带有聊天流 / 时间线思路，不适合作为“任务中控台”。
- `command` / `tool_call` / `status` / `assistant` / `user` 混入同一个主内容流，是当前混乱的直接原因。
- 自动重选最新任务、整屏重建、强制滚到底部，是弹跳和焦点漂移的直接原因。

---

## P0：先让主界面稳定、可读

### P0.1 固定任务选择与滚动行为

- [x] 新事件到来时，不自动切换用户正在查看的任务。
- [x] 只有当前任务不存在或用户未选择任务时，才自动选择最高优先级任务。
- [x] 用户不在底部时，不强制滚到底部。
- [x] 用户正在阅读旧内容时，显示“有新内容”提示或保持静默，不抢滚动位置。
- [x] 移除主消息进入动画和列表 hover 位移，减少视觉弹跳。

验收标准：

- [x] 选中任务后，其他任务产生新事件不会抢焦点。
- [x] 主内容区刷新不会清空重建导致阅读位置丢失。
- [x] 自动滚动只发生在用户已经接近底部时。

详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-21-全仓审计-p0-修复)。

### P0.2 拆分主内容与原始执行记录

- [x] 主视图默认只显示：任务目标、当前状态、最新助手摘要、等待输入、错误、关键文件变更。
- [x] `command`、`tool_call`、低价值 `status` 默认折叠为“执行记录”。
- [x] 原始输出最多作为可展开详情展示，不直接淹没主界面。
- [x] `cmd.exe`、`powershell`、`npm test`、`dotnet build` 等命令输出必须标为“命令输出”，不能伪装成助手内容。

验收标准：

- [x] 同一个任务中，助手内容与命令输出视觉上明确分区。
- [x] 命令输出不会默认占据整块主视图。
- [x] 用户能从主视图看出“当前任务在做什么”和“下一步是否需要我处理”。

详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-21-p2-backlog-收口bcde) 中 `command` / `tool_call` 折叠与命令输出标注的实现记录。

### P0.3 重新定义任务列表摘要

- [x] 左侧任务列表优先显示任务状态和下一步动作，而不是最近一条原始输出。
- [x] 任务状态固定为：`等待我`、`运行中`、`失败`、`需审阅`、`完成`、`来源在线`。
- [x] 弱接入来源和配置切换器不进入主任务队列，除非出现等待输入或错误。
- [x] 主舞台顶部新增任务聚焦区，把当前任务的下一步、项目归属、管理状态和摘要直接图形化展示。

验收标准：

- [x] 任务列表不再被命令输出片段刷屏。
- [x] 用户无需点开任务，也能判断是否需要处理。

详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-21-p03-任务列表摘要重建)。

---

## P1：任务详情与动作闭环

### P1.1 等待输入优先

- [x] 等待输入任务固定在队列优先级最高处。
- [x] 等待输入详情必须显示来源、目标会话、提示文本、可选项和自定义输入。
- [x] 无真实回复目标时，不显示回复入口。

验收标准：

- [x] 多任务并行时，等待输入不会被普通输出淹没。
- [x] 回复按钮只在真实可写回时出现。

详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-21-p11-等待输入优先)。

### P1.2 失败态可诊断

- [x] 失败任务显示失败摘要、来源、最近命令、退出码或错误文本。
- [x] 大段日志默认折叠。
- [x] 失败态提供“复制诊断上下文”动作。

验收标准：

- [x] 用户能判断失败来自命令、工具调用、连接还是适配器。
- [x] 复制内容足够用于给 Codex/Claude 继续排查。

详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-21-p12-失败态可诊断)。

### P1.3 来源与隐私边界可见

- [x] 每个任务显示来源类型：CLI/PTTY、Codex Desktop、VS Code、外部适配器、进程识别。
- [x] 每个来源显示能力层级 L1/L2/L3/L4。
- [x] 只读同步、进程识别、可回复会话必须明显区分。

验收标准：

- [x] 用户不会把 L1 进程识别误解为深度接管。
- [x] 用户能看到 CodePanion 当前采集边界。

详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-21-p13-来源与隐私边界可见)。

### P1.4 基础任务管理闭环

- [x] workflow thread 支持 `pinned`、`snoozedUntil`、`archived` 任务状态。
- [x] daemon 提供任务状态更新接口，并把变更广播为 `thread-upsert`。
- [x] GUI 支持 `置顶任务`、`稍后 1 小时`、`归档任务`、`恢复任务`。
- [x] `active` 主队列不再展示已稍后 / 已归档任务。
- [x] 新增 `later` 视图承接已稍后 / 已归档任务。
- [x] 任务管理状态持久化到 workflow snapshot，daemon / GUI 重连后恢复。

验收标准：

- [x] 用户可以直接在 GUI 中把任务移出主队列，而不必回到原窗口处理。
- [x] 稍后 / 归档任务不会继续污染当前待处理队列。
- [x] 任务管理动作在 HTTP、WebSocket、WebView DOM 测试中均有自动化覆盖。

详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md) 中 2026-05-23 任务管理闭环实现记录。

---

## P2：真实入口验收

### P2.1 首批入口

- [x] CLI/PTTY：`codepanion run -- <command>` 能展示运行、等待输入、完成、失败。
- [x] Codex Desktop：只读同步线程时，不展示系统提示词、审批 JSON、token 统计等内部噪音。
- [x] VS Code 扩展：窗口、工作区、任务事件能进入来源视图，但不制造假任务。
- [x] 外部适配器：`/sources/register` 和 `/events` 能进入统一模型。

验收标准：

- [x] 每个入口都有截图或自动化证据。
- [x] 每个入口都标注真实能力层级。

详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-21-p21-真实入口验收)。

### P2.2 GUI 真机验收

- [ ] Windows 便携版双击启动（需真机录屏）。
- [x] daemon 自动启动并连接 GUI（DaemonProcessManager 路径 + bundle/dist 产物契约测试已覆盖）。
- [x] 至少 3 个并行任务同时存在时，界面仍稳定可读（GUI snapshot 自动化测试已覆盖）。
- [x] 中文文本在 daemon、WebView、日志和复制内容中不乱码（HTTP/WS 端 + GUI 主视图 + 复制上下文均有自动化测试）。

验收标准：

- [ ] 提供真机截图或录屏证据（仅 Windows 便携版双击启动一项尚需用户真机验证）。
- [x] `npm run gui:build`、`npm test`、`npm run validate:dtos` 通过。

详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-21-p22-gui-真机验收-自动化部分)。

---

## P3：发布与文档

- [x] GitHub Actions GUI 构建会自动生成 `packages/daemon/bundle/daemon.cjs`。
- [x] 远端仓库地址已更新为 `https://github.com/Vantalens/CodePanion.git`。
- [x] 产品定位文档已收束到 [docs/POSITIONING.md](docs/POSITIONING.md)。
- [x] README、INSTALL、USER_GUIDE 已跟随新的 GUI 任务标准更新。
- [x] README 已切换到“普通用户双击运行 GUI”优先，CLI 与开发指令降为开发者次级入口。
- [x] ARCHITECTURE.md / DEVELOPMENT.md 与现行架构 / 测试栈 (node:test) 对齐，移除 Jest / Supertest / 远程会话 / Slack 通知 / NSSM 等过期描述（详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-22-文档与定位对齐)）。
- [ ] 发布包只暴露用户需要的入口和说明，不暴露开发噪音（待真机打包验证）。

---

## 当前阻塞 Alpha 收口的真机项

按 [docs/POSITIONING.md](docs/POSITIONING.md) 与 [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) 的 Alpha 验收口径，下列项必须用真机产物完成；自动化测试无法替代。

- [ ] **Windows 便携版双击启动录屏**：从干净环境双击 `CodePanion.Gui.exe` 到 daemon 自启动 + GUI 看到首次会话/事件，提供录屏或截屏组。
- [ ] **打包产物入口审查**：`scripts/package-windows.ps1` 输出的 zip 只暴露用户需要的入口（`CodePanion.Gui.exe`、`README_START.txt`），不含 `node_modules`、源码、调试脚本。
  - [x] 打包脚本侧 README_START.txt 中文化 + csproj 过滤 `Assets/README.md` 与 `*-source.png/svg`，详见 [docs/CODE_REVIEW_2026-05-22.md](docs/CODE_REVIEW_2026-05-22.md#p3-windows-便携版打包卫生-p3) 与 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-22-第二轮审计修复n-1--n-5--打包卫生)。
  - [ ] 真机解压后审查目录树，把入口清单写入日志。
- [ ] **8 小时稳态运行验证**：daemon + GUI 长跑 8h，记录内存曲线（GUI、daemon、bundle 三个进程）、`gui.log` 滚动条数、`workflow-snapshot` 文件大小、SessionListView 渲染时延。完成后把数据点写入 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md)。
  - 顺序：放在所有功能项之后；现有 retention 自动化测试已覆盖窗口语义，真机长跑只用来确认实际曲线没有偏离。

---

## Strategy Backlog

这些方向不作为当前开发标准，只有 P0/P1/P2 稳定后再推进：

- [ ] 国产工具深度适配：通义灵码 / Qoder / CodeBuddy / Trae / Comate / CodeGeeX。
  - [x] Qoder 拆为独立 first 梯队 `kind`，避免被 lingma profile 共用吞掉；Adapter SDK 提供 `local-tool-bridge.mjs` 把进程级 L1 升级到事件级 L2（详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-22-strategy-backlog-国产工具深度适配)）。
  - [ ] 各工具 L3 写回 / 继续执行链路：等公开 CLI / 扩展 API 或真实日志样本后再推进，不接入插件私有 DB / cookie。
- [x] Adapter SDK 与示例适配器（详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-21-strategy-backlog-adapter-sdk-与示例适配器)）。
- [x] 本地审计导出和结果归档（详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-22-strategy-backlog-本地审计导出)）。
- [ ] 跨工具转派和更完整任务操作的产品化。
- [ ] 任务管理增强：
  - [ ] 批量归档 / 批量恢复 / 批量稍后。
  - [ ] 自定义稍后时间，而不只固定 1 小时。
  - [ ] 任务优先级、手动排序和分组视图。
  - [ ] 系统通知与任务管理状态联动，例如稍后任务到点重新提醒。
  - [ ] “我的待处理”与“已完成/已归档”之间更明确的任务看板切分。
- [x] `runWorkflow` 暴露 hooks；CLI `workflow run` / `replay` 在 daemon 在线时把步骤启动 / 完成 / 失败 / checkpoint 推送为 monitor-event；新增 `codepanion workflow import --file <json>`；`packages/daemon/examples/workflows/` 提供 `codex-then-claude-review`、`build-test-audit` 两个开箱模板（详见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md#2026-05-22-strategy-backlog-工作流模板与跨工具转派)）。
- [ ] GUI 任务操作抽屉 / 转派视图：当前 GUI 只看到来源活动事件，没有专门的转派与接力面板，等 Alpha 闭环验证后再做。
- [ ] Pro / Enterprise 本地治理能力。
- [ ] Tauri / Avalonia / 跨平台 GUI 评估。
