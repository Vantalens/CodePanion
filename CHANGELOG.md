# Changelog

All notable changes to CodePanion will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **W-20 run 详情端点**：`GET /workflow/runs/:runId?workspace=...` 返回完整 run 记录（含每个 step 的 W-31 `output` stdout/stderr）。board 只给摘要，GUI run 卡片要展开 step 输出时走这个详情端点；找不到 → 404。

- **W-32 人工门完整闭环**：`/workflow/gates/:runId/:stepId/resolve` 现在三种决策都会续跑：
  - `approve` → 从 checkpoint 之后续跑（PR #8 已实现）
  - `retry` → 复用原 runId，回到 checkpoint 前最近一个 success step 重新执行；checkpoint 因 `yes:true` 自动跳过
  - `reject` → 不续跑，仅落 human-decision artifact
  - 任何决策都可携带 `constraints` 列表，会作为 `constraints` 字段并入 resumed run 的 values，后续 step 可通过 `{constraints}` 模板引用
- **W-33 delivery export endpoint**：`GET /workflow/runs/:runId/delivery?workspace=...&format=markdown|handoff` 把最新一条 `delivery-note` artifact 拉成可直接复制的文本：
  - `format=markdown`（默认）→ delivery-note 原文加上 workflow/status/runId/steps header
  - `format=handoff` → 在 markdown 外再包一层 continuation prompt，可整段贴到 `codex exec` / `claude -p` / `opencode run` 让外部 AI 接着推进
  - 找不到 delivery-note（run 还没跑完、或 paused 且未生成 note）→ 404
- **W-31 step output 持久化**：`WorkflowStepRunSchema` 新增可选 `output: { stdout, stderr, truncated }`，`runWorkflow.executor` 接受 `ExecutorResult` 联合类型（保留 `Promise<number>` 旧形态）。
  - `daemonWorkflowExecutor` 在 spawn 子进程时同时把 stdout/stderr 累积到 buffer，每流 cap 32KB；超过 cap 后 WS 推送照旧但持久化打 `truncated=true`
  - `recordDeliveryNote` 自动追加 `## Step output preview` 段，每个 step 取 stdout/stderr 头 30 + 末 10 行，让续作的外部 AI 在 handoff 时能看到上一轮 provider 真实返回
- **W-20 workflow board 视图（第一切片）**：GUI rail 增加 ◫ workflow 按钮，激活后 main 区从会话流切换到 workflow board，三列展示 daemon `/workflow/board` 的可执行 workflow / 近期 runs / 等待人工门。
  - 新增 webview ↔ host 协议 `request-workflow-board` / `workflow-board`，host 端走 [`DaemonClient.FetchWorkflowBoardJsonAsync`](packages/gui/Services/DaemonClient.cs) 拉 daemon。
  - 卡片按 run 状态（paused / failed / success / running）染色 left border，让"我现在在跑什么、在等什么"一眼能看到。
  - 待办：从 board 直接 POST `/workflow/runs`、点 gate 跳决策抽屉、workspace 切换。

### Positioning

- 产品定位明确为「个人 Agent AI IDE + AI 工作流控制台」双重身份：CodePanion 自身是 Agent IDE，通过逆向接口和 API 主动调用 Codex / Claude Code / OpenCode 等外部 AI 编程工具的能力作为可编排能力源（不是把任务派给它们，也不是被动监听它们）。同步更新 README、POSITIONING、PRODUCT_ROADMAP、LOCAL_AI_WORKFLOW、DEVELOPMENT_TASKS。

### Fixed

- **gate 续跑不再从头重跑**（Codex P1）：人工在 paused checkpoint 上批准后，daemon 复用原 runId 和 startedAt，只跑 checkpoint 之后的 step，前序已成功 step 不重复执行。`runWorkflow` 新增 `resumeFrom: { runId, stepId, previousSteps, startedAt }` 参数。
- **board 按 workspace 过滤 active runs**（Codex P2）：`/workflow/board?workspace=...` 之前会把全局 `activeRuns` Map 里所有 workspace 的 active run 都合并出去，导致 A workspace 在跑时 B workspace 的 board 也能看到。`ActiveRunSnapshot` 新增 `workspaceKey`，board endpoint 按当前 workspace key 过滤。
- **daemon 编译恢复**：上一轮 CodeQL autofix 在 `server.ts` / `workspaceManager.ts` 留下未导入的 `HOME_DIR` / `pathSep` / `isAbsolute` / `existsSync` / `sep` 以及一段 `... ? false : false` 的死代码，daemon TypeScript 编译失败。已补齐导入、去掉死代码、统一用 `node:path` 的 `sep`。
- **修正 workspace root 的错误边界**：autofix 把 workspace root 限定在 `~/.codepanion`（HOME_DIR）下，但 workspace 是用户项目目录、不是 daemon 私有目录。还原为「root 只做 `resolve()` 归一化」，并在 `readConfig` 用新增的 [`packages/daemon/src/workflows/pathSafety.ts`](packages/daemon/src/workflows/pathSafety.ts) 的 `ensurePathInside(workflowPath, this.root, ...)` 校验派生路径不逃出 root，给 CodeQL 提供它需要看到的 containment 数据流。

## [0.2.0] - 2026-05-12

### Added

#### Core Features
- **完整输出捕获**: 实现 `fullOutput` 数组和 `outputChunks` 结构化存储
- **对话流界面**: 基于 WPF + WebView2 的现代化对话界面
- **Markdown 渲染**: 集成 marked.js 和 highlight.js，支持代码高亮
- **智能通知系统**: 声音提示 + Windows Focus Assist 检测
- **会话管理**: 完整的会话列表和状态跟踪

#### GUI Features
- 会话列表（左侧 250px）
- 对话区域（WebView2）
- 选项按钮界面（编号徽章、推荐高亮）
- 自定义输入框（支持 Enter 键提交）
- 空状态显示
- 系统托盘图标
- 连接状态指示器

#### Notification System
- 提示音播放（需要输入时）
- 完成音播放（任务完成时）
- Focus Assist 状态检测
- 前台/后台应用检测
- 智能提示逻辑（避免打扰用户）

#### API Enhancements
- `GET /sessions/:id/output` - 获取会话完整输出
- `fullOutput` 字段 - 完整输出历史
- `outputChunks` 字段 - 结构化输出块

#### Testing & Documentation
- 早期功能验证、端到端和交互式测试材料曾用于阶段性验收；这些旧脚本已在后续清理中移除，当前质量门禁以 `DEVELOPMENT_TASKS.md` 和 `docs/DEVELOPMENT.md` 为准

### Changed
- 项目名称统一为 CodePanion（驼峰命名）
- GUI 从简单界面重构为对话流界面
- Markdown 样式优化（标题、代码块、表格等）
- 选项按钮样式改进（类似 Claude Code）

### Fixed
- C# nullable 引用类型警告（MainWindow.xaml.cs, DaemonClient.cs）
- 测试脚本端口配置（从配置文件动态读取）
- WebView2 资源复制配置
- Assets 目录自动复制

### Documentation
- 统一项目名称为 CodePanion
- 更新所有文档中的项目结构
- 添加图标文件说明（icon-README.md）
- 添加提示音文件说明（Assets/README.md）
- 旧路线阶段性报告已在后续清理中移除，当前状态以 README、产品路线和开发任务清单为准

### Technical Improvements
- 构建状态: 0 个警告，0 个错误
- 测试通过率: 100% (18/18)
- 代码质量提升
- 完整的错误处理

---

## [0.1.0] - 2024-XX-XX

### Added
- 初始版本
- Daemon 守护进程
- 基础 CLI 命令（start, stop, status, run）
- PTY 命令包装
- 提示检测
- HTTP + WebSocket API
- 基础 GUI 界面
- 桌面通知

---

## 版本说明

### 版本号规则
- **主版本号**: 重大架构变更或不兼容的 API 变更
- **次版本号**: 新增功能，向后兼容
- **修订号**: Bug 修复，向后兼容

### 发布周期
- **稳定版**: 每 2-3 个月
- **补丁版**: 根据需要随时发布

---

## 即将推出 (Roadmap)

当前路线以 [产品路线](docs/PRODUCT_ROADMAP.md) 和 [开发任务清单](DEVELOPMENT_TASKS.md) 为准。旧版本号路线不再维护，避免和 Windows Alpha / Beta / GA 路线重复。

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

请参阅 [DEVELOPMENT.md](docs/DEVELOPMENT.md) 了解开发指南。

---

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件
