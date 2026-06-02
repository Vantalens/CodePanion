# CodePanion 本地 AI 工作流设计

## 目标

CodePanion 的主线是「Rust 本地全自动 AI IDE」：**一切核心 workflow 在 CodePanion 内进行**。CodePanion 自身是本地开发系统，把 step 执行拆成两条正交轴——**architecture（进程内 agent 架构 / harness）× model（用户配置的 API 或本地模型）**——在本地 daemon 内组合运行，而不是 shell 出去调外部 CLI 当黑盒。

用户从一个产品目标出发，CodePanion 在本机自动完成任务拆分、AI 角色分工、多模型协作、实现、测试、审查、文档和产出归档。用户主要观察多个任务/项目的进程，只在计划确认、方向调整、高危行为和最终交付时介入。外部模型通过 API 提供智能；Codex、Claude Code、OpenCode 等外部 agentic coding tool 必须能作为能力源被 CodePanion 调用，并进入本地 workflow 的权限、日志、artifact 和审核门体系。

## 参考原则

OpenCode 的 agent 管理模式提供了可借鉴的结构：项目级 agent、primary agent、subagent、角色描述、模型绑定、权限控制和 task delegation。CodePanion 不复制 OpenCode 的 CLI 体验，而是在图形工作台中提供同类概念的本地 workflow 管理能力。

## 核心对象

### Workspace

Workspace 对应一个本地项目。它保存项目级 workflow 配置、角色配置、任务历史、人工审核记录和产出索引。

建议目录形态：

```text
.codepanion/
├── workflow.json
├── roles/
│   ├── orchestrator.md
│   ├── planner.md
│   ├── builder.md
│   ├── reviewer.md
│   ├── tester.md
│   └── docs-writer.md
└── artifacts/
```

### Role

Role 是一个可复用的 AI 工作角色。每个角色至少声明：

- `name`：角色名
- `description`：何时使用
- `model`：可选模型绑定，例如同一模型多角色或不同 provider 分工
- `permissions`：读、写、命令、网络、任务委派等权限
- `contextPolicy`：上下文预算和可读取范围
- `deliveryContract`：输出格式、必须回传的结果和失败时需要的诊断信息

首批内置角色：

- `orchestrator`：拆解目标、分派任务、汇总状态、决定是否进入人工审核
- `planner`：分析需求和代码结构，输出实现计划，不直接改代码
- `builder`：按计划修改代码和文档
- `tester`：运行测试、补充验证用例、解释失败
- `reviewer`：只读审查变更，输出风险、缺口和是否可交付
- `docs-writer`：维护用户文档、开发文档、变更记录和产出摘要

### Workflow

Workflow 是一次从目标到交付记录的执行实例。它由多个节点组成：

1. `intake`：用户输入目标、限制、成功标准
2. `decompose`：Orchestrator 拆分任务
3. `plan-review`：人工确认计划
4. `build`：Builder 执行实现
5. `test`：Tester 验证
6. `code-review`：Reviewer 审查
7. `human-acceptance`：人工确认是否接受产出
8. `archive`：归档计划、变更、测试、审查和最终摘要

Workflow 默认面向全自动推进：除显式 `checkpoint` 或高危行为触发的 human gate 外，节点应自动进入下一步。失败后由 Orchestrator / Tester / Builder 组合决定是否自动重试、进入修复循环或请求人工介入。

### Project 与全局调度

Project 是 workspace 的上层索引，用于多项目管理。全局调度层至少保存：

- 项目列表：名称、路径、标签、最近活动时间、当前状态
- 全局 runs：所有项目正在运行、等待、失败、暂停和完成的 workflow
- 全局 gates：所有项目等待人工审核的节点
- 全局队列：待启动、运行中、受阻和可重试的任务
- 跨项目 artifact：一个项目产出可作为另一个项目 workflow 的输入

多任务并行是核心能力。调度器必须能同时运行多个 workflow，并按 workspace 隔离文件访问、命令 cwd、artifact 和 run history。

### Human Gate

Human Gate 是必须由用户确认的节点。第一阶段至少保留四个门：

- 需求门：目标是否理解正确
- 计划门：拆分和实施顺序是否合理
- 审查门：风险、测试缺口和残留问题是否可接受
- 交付门：最终产出是否进入完成状态

### Artifact

Artifact 是 workflow 的产出记录，不只包括文件变更。首批 artifact 类型：

- `plan`：任务拆分和实现计划
- `patch-summary`：代码或文档变更摘要
- `test-result`：测试命令、结果和失败诊断
- `review-report`：审查意见和风险等级
- `human-decision`：用户在审核门的决定
- `delivery-note`：最终交付摘要

## 多模型与多角色

CodePanion 支持两种使用方式：

- 同一模型多角色：例如全部角色使用 GPT-5 Codex，但 prompt、权限和上下文不同。
- 多模型协作：例如 Planner 使用高推理模型，Builder 使用代码模型，Reviewer 使用另一家模型做交叉审查。

模型选择不应成为产品入口。用户面对的是角色和 workflow；模型只是角色配置的一部分。

## 外部 Agentic Coding Tool Provider

外部 agentic coding tool 是 workflow step 的能力源，而不是独立于 workflow 的外部会话。CodePanion 至少支持三类 provider：

- **API provider**：外部工具提供公开 API 时，CodePanion 直接调用其 API，并把请求、响应、错误、token/usage 和输出归档到 step run。
- **CLI provider**：外部工具只提供 CLI 时，CodePanion 通过受控 executor 调用，必须设置 workspace `cwd`、参数白名单、环境变量策略、超时、取消和 stdout/stderr 捕获。
- **In-process harness**：研究 Claude Code、Codex、OpenCode 等工具的 agent 架构，把可复用的 tool-use 循环、权限模型、上下文策略和任务委派实现到 CodePanion daemon 内。

Provider 需要声明：

- `id`：能力源标识，例如 `codex-api`、`claude-code-cli`、`opencode-harness`
- `kind`：`api` / `cli` / `harness`
- `capabilities`：是否支持读文件、写文件、跑命令、网络、任务委派、流式输出、取消
- `permissions`：允许的文件范围、命令范围、网络范围和是否需要人工门
- `runtime`：API endpoint、CLI command、或 Rust harness 模块

Workflow step 可以同时声明 `role`、`model` 和 `provider`。例如 Builder 使用 Codex provider 实现，Reviewer 使用 Claude Code 风格 harness 审查，Tester 使用 shell provider 跑测试。所有 provider 的输出都必须统一进入 run history、artifact、delivery-note 和 GUI 实时事件。

## 执行模型：architecture × model 两轴

每个 workflow step 的执行由两条正交轴决定：

- **architecture（harness，进程内）**：
  - `shell`：在本机 spawn `step.command/args`，用于跑测试、本地命令等非 AI 步骤。
  - `agent`：CodePanion 进程内的 agent 运行时把 step 组成 prompt 交给模型 API 完成。架构思路逆向自 Claude Code 等，但**在 CodePanion 进程内复刻**，不 shell 外部 CLI。
    - **single-call**：组 prompt → 调一次 `/chat/completions` → 捕获返回文本（step 不声明工具权限时的退化形态）。
    - **tool-use 循环（slice 2a，只读）**：step 声明 `permissions=read` 且选了 workspace 时，agent 可多轮调用 **只读工具** `read_file` / `list_dir`（模型发 tool_call → CodePanion 执行 → 回填结果 → 再调），直到给出结论或触顶 `config.agent.maxTurns`。文件访问用 `ensurePathInside` 钳在 workspace 根内，越界拒绝；无 workspace 则禁用文件工具。每轮 assistant 文本 / 工具调用 / 工具结果通过 WS `step-output` 实时推到 GUI 时间线。
    - 待办（slice 2b）：`write_file` / `run_command`（`permissions=write` / `command` 门控，cwd 钳 workspace + Windows batch-arg 防护）。
- **model（API 后端）**：`config.json` 的 `models[<id>]`（OpenAI 兼容，如 DeepSeek）。step 用哪个由 `step.model → role 绑定.model → defaultModel` 中第一个能命中的决定。key 存 config.json（0600 保护）。
- **provider（能力源）**：可选地指定 API provider、CLI provider 或 in-process harness。provider 决定使用哪个外部 agentic coding tool 或内部 harness；model 决定该 provider 使用哪个模型后端。
- **permissions**：step 的 `permissions`（`read/write/command/...`）首次有运行时意义——门控 agent 能用哪些工具。默认 `[]` → 无工具 → single-call。

兼容：历史 `provider` 字段保留——`local→shell`，`codex/claude-code/opencode→agent`（旧语义是 shell 出去调该 CLI，现统一为进程内 agent，harness 风格差异靠 role/system-prompt 区分）。

上下文输入不独立成为监听来源。用户可以手动选择文件、目录、历史记录或诊断文本交给 workflow，但 CodePanion 不主动监听外部窗口，也不读取闭源工具的私有存储或登录态。模型只通过 API 调用、用用户自己的 key。

## GUI 形态

GUI 的第一屏应从“会话流”转向“多项目 AI 开发工作台”：

- 左侧：项目列表、当前 workspace、workflow 定义和任务队列
- 中间：全局 runs / 当前项目 workflow 的节点、状态、阻塞点和人工审核门
- 右侧：角色、模型、权限、产出、delivery-note 和原始执行记录
- 底部或抽屉：人工输入、批准、拒绝、重试、继续、归档

现有 `等待我 / 失败 / 需审阅 / 运行中 / 完成` 状态保留，但挂到 workflow 节点和 artifact 上，而不是挂到外部来源会话上。

## Rust 重构落地范围

下一阶段先做 Rust 技术验证和核心迁移：

- 创建 Rust workspace 与 daemon 二进制
- 实现 `/health`、WebSocket、OpenAI-compatible 模型客户端
- 迁移 agent tool-use 循环、只读工具、写文件工具、命令工具和高危行为检测
- 迁移 workflow engine、run history、artifact、delivery-note 和 gate resolve
- 保持 GUI 所需 HTTP/WS 契约兼容
- 建立内存、启动时间、二进制大小和实时输出延迟基准

Node 实现仅作为行为基线。Rust 迁移后，新增核心能力优先进入 Rust daemon；Node 侧只做必要兼容或清理。

## Step 字段约定

每个 `WorkflowStep` 字段都对应上面的概念模型：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `id` | 短标识符 | step 在 workflow 内唯一 |
| `tool` | 任意字符串 | 仅作标签，不决定执行行为，默认 `local` |
| `role` | 同 `BUILTIN_WORKFLOW_ROLES` | 标记本步骤由哪个角色承担 |
| `model` | 任意字符串 | 选择 `config.json` 中的模型后端或角色绑定模型 |
| `provider` | `local` / `codex` / `claude-code` / `opencode` | 历史兼容字段；新执行优先由 `architecture` 决定 |
| `permissions` | `read` / `write` / `command` / `network` / `delegate` / `approve` | 角色权限，给执行端做约束 |
| `contextPolicy.maxTokens` | 正整数 | 上下文预算 |
| `contextPolicy.include` / `exclude` | 相对路径 / glob 列表 | 拒绝 `..` 段与绝对路径，防止 traversal |
| `humanGate` | 短标识符 | 标记此 step 属于哪一道人工门 |
| `artifacts` | `plan` / `patch-summary` / `test-result` / `review-report` / `human-decision` / `delivery-note` 子集 | step 完成时由 daemon 按此清单落占位 artifact |
| `checkpoint` | bool | 是否需要人工放行才能继续；触发 paused 状态 |

`architecture` 决定 daemon 怎么执行：

- `shell`：`command/args` 原样在 workspace cwd 下执行
- `agent`：把 step 渲染成 prompt，进入 CodePanion agent runtime，通过模型 API 与工具循环完成任务

历史 `provider` 只用于兼容旧 workflow：`local` 派生为 `shell`，`codex` / `claude-code` / `opencode` 派生为 `agent`。不同工具风格应通过 role prompt、权限和模型配置表达，而不是把外部 CLI 当黑盒主路径。

## Daemon HTTP / WS 契约

下表覆盖 GUI / 外部脚本接 daemon 的全部 workflow 路径。所有 HTTP 端点都需要 `Authorization: Bearer <token>`。

### Workspace 参数

所有 workflow endpoint 都接受 `workspace` 参数指定项目根：

- `GET /workflow/...` 端点：`?workspace=<absolute path>` 作为 query 字符串
- `POST /workflow/runs` / `POST /workflow/gates/.../resolve` body 加 `workspace: "<absolute path>"` 字段

指定后 daemon 把 `definitions / history / artifacts` 三个文件都落到 `<workspace>/.codepanion/{workflows.json, workflow-runs.ndjson, workflow-artifacts.ndjson}`，跨 workspace 互不可见。未指定时 fallback 到 `HOME_DIR` 全局共享（向后兼容；适合 CLI 单项目场景）。

`POST /workflow/runs/:runId/cancel` 不需要 workspace，因为 runId 全局唯一并由 daemon 内 `runCancellers` 直接索引。

### Workspace 初始化

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/workspace/initialize` | 在指定根目录落 `.codepanion/{workflow.json, roles/*.md, artifacts/}` |
| `GET` | `/workspace/config?root=...` | 读 workspace 配置；JSON 损坏走 Zod schema 校验 + 文件改名隔离 |

请求体：`{ "root": "<absolute path>" }`。响应：`{ layout }` 包含目录布局。

### Workflow board 与运行

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/workflow/board` | 一次性返回 `{ workflows, runs, gates }`，runs 含活跃 `status: 'running'` 条目 + 最近 30 条历史 |
| `POST` | `/workflow/runs` | 从头启动 workflow：`{ workflow, values?, yes?, dryRun? }`，立即返回 `{ accepted, workflowName }`，进度走 WS |
| `POST` | `/workflow/runs/:runId/cancel` | SIGTERM 当前 step 子进程，run-finish 事件随后到达；非活跃 run 返回 404 |
| `GET` | `/workflow/runs/:runId/artifacts` | 该 run 全部 artifact（plan/patch-summary/test-result/review-report/human-decision/delivery-note） |

`runs` 数组里 `status` 取值：

- `running`（来自 daemon 内存活跃表，含 `currentStepId / currentStepRole / currentStepStatus`）
- `success` / `failed` / `paused` / `dry-run`（来自历史）

### 人工审核门

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/workflow/gates` | 列出当前 paused + 未被 approve/reject 的 run；已 retry 的保留并附 `lastDecision` |
| `POST` | `/workflow/gates/:runId/:stepId/resolve` | 落一条 `human-decision` artifact；`decision=approve` 同时触发 daemon 内续跑 |

`resolve` 请求体：`{ decision: 'approve' \| 'reject' \| 'retry', message?, constraints? }`。响应：

- approve：`{ artifact, resumed: true }`，新一轮 run 走 WS run-event 流
- reject：`{ artifact }`，gate 消失
- retry：`{ artifact }`，gate 仍可见、`lastDecision.decision = 'retry'`，等下一轮

### Delivery-note

每次 `runWorkflow` 末尾（含 paused / failed）自动落一条 `delivery-note` artifact，content 是 markdown：

```text
workflow=<name>
runId=<id>
status=<success|failed|paused|dry-run>
steps=<n>

## Steps
- <id> [<tool> provider=<p> role=<r> model=<m>] <status> :: <message>

## Artifacts
- <type> @ <stepId> (<role>): <title>
```

`files` 字段是所有 prior artifact `files` 的去重并集，方便 GUI 一条记录拿到完整文件清单。

### WS workflow-run-event

订阅 `ws://<daemon>/ws?role=observer`，daemon 内 fire-and-forget 跑 workflow 时推送四种事件：

| action | 字段 |
| --- | --- |
| `run-start` | `runId, workflowName, startedAt` |
| `step-start` | `runId, workflowName, stepId, tool, role?, status` |
| `step-finish` | `runId, workflowName, stepId, status, exitCode?, message?` |
| `run-finish` | `runId, workflowName, status, stepCount, endedAt` |

GUI 收到 `run-finish` 后再 GET `/workflow/board` 或 `/workflow/runs/:runId/artifacts` 即可拿到完整结果，不必 polling 历史文件。
