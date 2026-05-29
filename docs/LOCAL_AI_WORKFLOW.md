# CodePanion 本地 AI 工作流设计

## 目标

CodePanion 的新主线是个人本地 AI 工作流操作台。用户从一个产品目标出发，在本机完成任务拆分、AI 角色分工、多模型协作、人工审核和产品产出归档。外部工具不再是被动监听对象，只能作为用户显式调用的 workflow 执行器或上下文输入。

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
- `handoffContract`：输出格式、必须回传的结果和失败时需要的诊断信息

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

## 执行器边界

Codex、Claude Code、OpenCode 和 CLI/PTTY 都应被抽象为 executor：

- `executor`：能执行某个 workflow 节点，例如运行编码任务、测试命令或文档生成。

上下文输入不独立成为监听来源。用户可以手动选择文件、目录、历史记录或诊断文本交给 workflow，但 CodePanion 不主动监听外部窗口，也不猜测闭源工具内部状态。任何写回、命令执行或跨工具调用都必须是用户显式授权的 executor 行为。

## GUI 形态

GUI 的第一屏应从“会话流”转向“workflow board”：

- 左侧：Workspace 与 workflow 列表
- 中间：当前 workflow 的节点、状态、阻塞点和人工审核门
- 右侧：角色、模型、权限、产出和原始执行记录
- 底部或抽屉：人工输入、批准、拒绝、重试、继续、归档

现有 `等待我 / 失败 / 需审阅 / 运行中 / 完成` 状态保留，但挂到 workflow 节点和 artifact 上，而不是挂到外部来源会话上。

## 第一阶段落地范围

第一阶段只做产品与实现边界重排：

- 更新定位、路线图、开发任务和架构叙事
- 定义 workspace / role / workflow / human gate / artifact 模型
- 从当前路线中移除监听来源设计
- 将 handoff 叙事收敛为 executor / role assignment 叙事
- 暂不改 daemon / GUI 运行时代码

后续代码实现应优先复用现有 `workflowManager`、`workflowDefinitionManager`、`WorkflowRunHistory`、GUI 任务状态和 handoff 回流结构。

## Step 字段约定

每个 `WorkflowStep` 字段都对应上面的概念模型：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `id` | 短标识符 | step 在 workflow 内唯一 |
| `tool` | 任意字符串 | 仅作标签，不决定执行行为，默认 `local` |
| `role` | 同 `BUILTIN_WORKFLOW_ROLES` | 标记本步骤由哪个角色承担 |
| `model` | 任意字符串 | 透传给 provider CLI 作 `--model` |
| `provider` | `local` / `codex` / `claude-code` / `opencode` | 决定 `command/args` 如何被包装成实际 CLI 调用 |
| `permissions` | `read` / `write` / `command` / `network` / `delegate` / `approve` | 角色权限，给执行端做约束 |
| `contextPolicy.maxTokens` | 正整数 | 上下文预算 |
| `contextPolicy.include` / `exclude` | 相对路径 / glob 列表 | 拒绝 `..` 段与绝对路径，防止 traversal |
| `humanGate` | 短标识符 | 标记此 step 属于哪一道人工门 |
| `artifacts` | `plan` / `patch-summary` / `test-result` / `review-report` / `human-decision` / `delivery-note` 子集 | step 完成时由 daemon 按此清单落占位 artifact |
| `checkpoint` | bool | 是否需要人工放行才能继续；触发 paused 状态 |

`provider` 决定 daemon 怎么实际拼 CLI：

- `local`：`command/args` 原样执行
- `codex`：`codex exec [--model M] [<base-args>...] <prompt>`
- `claude-code`：`claude -p <prompt> [<base-args>...] [--model M]`
- `opencode`：`opencode run [--model M] [<base-args>...] <prompt>`

`{var}` 占位先于 provider 包装渲染，所以 prompt 文本里可以用 workflow params。

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
