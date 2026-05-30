# CodePanion 当前开发任务标准

## 使用规则

- 本文件只记录路线大改后的当前任务，不再承载旧监听路线、历史审计流水账或已废弃验收项。
- 新任务必须符合 [docs/POSITIONING.md](docs/POSITIONING.md) 和 [docs/LOCAL_AI_WORKFLOW.md](docs/LOCAL_AI_WORKFLOW.md)。
- 每完成一组可验证改动，必须同步更新本文件状态。

状态标记：

- `[ ]` 未开始
- `[-]` 进行中
- `[x]` 已完成
- `[!]` 受阻

---

## 当前产品标准

> **本地优先、供应商中立、面向个人开发者的 Agent AI IDE + AI 工作流控制台。**

CodePanion 后续专注：

1. **任务拆分**：把用户目标拆成可审核、可执行、可回收的 workflow 节点。
2. **角色协作**：用 Orchestrator、Planner、Builder、Tester、Reviewer、Docs Writer 等角色推进开发。
3. **能力源调用**：通过逆向接口 / API / CLI 调用 Codex、Claude Code、OpenCode、本地 CLI/PTY 等外部能力 —— CodePanion 是调用方，把它们当作可编排的能力源，不是把任务派给它们。
4. **人工审核**：需求、计划、审查、交付等关键节点必须能由用户批准、拒绝或要求重试。
5. **产出闭环**：记录计划、变更摘要、测试结果、审查报告、人工决策和交付摘要。

明确不继续投入：

- 外部窗口监听
- 进程识别路线
- Codex Desktop 被动同步路线
- VS Code 来源事件路线
- 多源监控看板路线
- 旧的 handoff / 接力作为产品主概念

---

## P0：路线重排与仓库清理

- [x] **W-01** 更新 [docs/POSITIONING.md](docs/POSITIONING.md)：确认监听路线退出当前产品定义。
- [x] **W-02** 新增 [docs/LOCAL_AI_WORKFLOW.md](docs/LOCAL_AI_WORKFLOW.md)：定义 workspace、role、workflow、human gate、artifact、executor 边界。
- [x] **W-03** 更新 [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md)：Alpha 改为个人本地 AI 工作流闭环。
- [x] **W-04** 更新 [README.md](README.md)：对外说明任务拆分、角色协作、多模型和人工审核闭环。
- [x] **W-05** 清理旧路线文档：删除监控源、能力证据、工具接入、旧审计、旧验收、旧用户指南和旧实现日志。
- [x] **W-06** 重写本文件，移除旧监听路线 backlog。

---

## P1：建立本地 workflow 模型

- [x] **W-10** 定义 workspace 级配置目录：`.codepanion/workflow.json`、`.codepanion/roles/*.md`、`.codepanion/artifacts/`。
- [x] **W-11** 扩展 workflow definition schema，支持 role、model、permissions、contextPolicy、humanGate、artifact 输出契约。
- [x] **W-12** 新增内置角色模板：Orchestrator、Planner、Builder、Tester、Reviewer、Docs Writer。
- [x] **W-13** 将现有 handoff 状态收敛为 role assignment / executor run 状态，避免继续围绕“转交给外部工具”组织主概念。
- [x] **W-14** 新增 workflow run artifact 历史：计划、变更摘要、测试结果、审查报告、人工决策、交付摘要。

---

## P2：GUI 从会话流转向 workflow board

- [x] **W-20** 将主界面第一层重排为 workspace / workflow 列表，而不是外部会话列表。
  - **GUI 整体重建为工作流控制台**：删除监听式 shell（VS Code 插件面板 / 来源分组任务队列 / 会话流 / 接力 PTY 面板 / 收件箱 / session 回复 omnibar），chat.html/js/css 全部重写。
  - 顶栏 workspace 选择条（路径 + 最近列表 localStorage 持久化，空=全局）+ 连接状态。
  - 三栏：左 workflow 定义/近期 runs/人工门，中 run 时间线，右 详情/人工门决策。
  - webview ↔ host 协议收敛为工作流控制台：`request-workflow-board/run/launch/gate-resolve/run-cancel/delivery` + `set-workspace`；旧的 reply/event-reply/task-action/handoff-launch 移除。
- [x] **W-21** 中央区域展示 workflow 节点、当前角色、状态、阻塞点和人工审核门。
  - 中栏 run 时间线：steps 顺序 + 状态染色 + 当前步 + exitCode；接 daemon WS `workflow-run-event` 实时更新（run-start/step-start/step-output/step-finish/run-finish），step-output 实时滚动。
- [-] **W-22** 右侧抽屉展示角色、模型、权限、artifact 和原始执行记录。
  - 已做：右栏展示 artifacts、delivery（复制 markdown/handoff）、步骤 stdout/stderr 输出。
  - 待办：role / model / permission / contextPolicy 绑定展示（需 daemon 暴露 workspace roleBindings 给 board）。
- [-] **W-23** 保留 `等待我 / 失败 / 需审阅 / 运行中 / 完成`，但状态挂到 workflow 节点和 artifact。
  - 已做：run 状态（running/paused/failed/success）挂到 run 卡片与时间线 chip；paused gate 单列展示。
  - 待办：把这些状态做成可筛选的队列视图。

---

## P3：多模型与多角色执行闭环

- [x] **W-30** 支持同一模型绑定不同角色 prompt、权限和上下文策略。
- [-] **W-31** 支持不同 architecture / model 在同一 workflow 中协作。
  - **执行模型两轴化（2026-05-29 定位细化）**：step 执行 = architecture（`shell` 进程内 spawn / `agent` 进程内调模型 API）× model（config.models 的 OpenAI 兼容后端）。旧 `provider` 兼容派生（local→shell，其余→agent），`providerInvocation` 的外部 CLI 拼装已退役。
  - slice 1 = single-call agent：组 prompt → 调一次 `/chat/completions` → 文本落 stepRun.output + WS step-output 实时推送 + delivery-note `## Step output preview`。
  - `daemonWorkflowExecutor` 返回结构化结果（exitCode + stdout + stderr + truncated），shell/agent 两路都落 `stepRun.output`，每流 cap 32KB。
  - config.json `models` / `defaultModel` + [modelClient.ts](packages/daemon/src/models/modelClient.ts)（内置 fetch）；daemon `agentExecutor` 解析 role/model→后端→调模型。
  - slice 2a = tool-use 循环（只读）：`read_file` / `list_dir`，`permissions=read` + workspace 门控，`ensurePathInside` 钳沙箱，`config.agent.maxTurns` 封顶，每轮经 WS step-output 实时推。[agentRuntime.ts](packages/daemon/src/models/agentRuntime.ts) + [agentTools.ts](packages/daemon/src/workflows/agentTools.ts)。
  - 待办：slice 2b 写工具（`write_file` / `run_command`，write/command 权限 + cwd 钳 workspace + batch-arg 防护）；contextPolicy 强制；GUI 选择 architecture/model + 编辑模型后端。
- [x] **W-32** 支持人工在计划、审查、交付门中批准、拒绝、要求重试或追加约束。
  - approve：复用原 runId 从 checkpoint 之后续跑（PR #8）
  - reject：仅落 human-decision artifact，run 维持 paused
  - retry：复用原 runId，回到 checkpoint 前最近一个 success step 重跑该 step，checkpoint 因 yes:true 自动跳过
  - constraints：列表并入 resumed run 的 `values.constraints`，后续 step 可用 `{constraints}` 模板引用
- [x] **W-33** 每次完成 workflow 后生成可复盘交付摘要，并能复制给 Codex / Claude Code / OpenCode 继续处理。
  - delivery-note 由 `recordDeliveryNote` 在每次 workflow 结束（含 paused/failed）自动落条
  - `GET /workflow/runs/:runId/delivery?format=markdown|handoff` 把最新 delivery-note 拉成可直接复制的文本
  - `format=handoff` 在 delivery-note 外再包一层 continuation prompt，可整段贴到 `codex exec` / `claude -p` / `opencode run`
