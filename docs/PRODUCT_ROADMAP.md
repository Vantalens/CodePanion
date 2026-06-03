# CodePanion 产品路线

## 产品定位

CodePanion 是一个本地优先、供应商中立、面向个人开发者的 **Rust 轻量 AI IDE**。它服务于需要把产品目标自动推进到代码、测试、审查、文档和交付记录的用户：CodePanion 自身就是本地全自动开发系统，通过多 AI 角色分工、多模型协作、高危行为审核门和多项目/多任务调度，把开发目标组织成可复盘的本地 workflow。仓库内具体措辞以 [产品定位契约](POSITIONING.md)、[本地 AI 工作流设计](LOCAL_AI_WORKFLOW.md) 和 [Rust 重构计划](RUST_REWRITE_PLAN.md) 为准。

当前 Windows GUI 默认启动 Rust daemon，workflow 模型、artifact、gate 和 provider API 是当前行为契约。旧 Node daemon 只作为兼容基线保留；后续开发主线继续围绕 Rust agent/workflow 引擎、高危行为检测、多任务并行调度和多项目管理。监听外部工具状态不再进入路线；外部 agentic coding tool 调用能力是必须保留的一等能力源，但要接入本地 workflow，而不是把产品退回外部工具面板。

## 市场判断与差异化

AI 开发正在从单次对话转向长链路、多角色、多模型、可审核、可并行的工程流程。CodePanion 不在代码编辑体验上和 Cursor、Trae、Windsurf、VS Code/Copilot 这类传统编辑器型 AI IDE 正面竞争，也不做 OpenClaw 类通用个人 Agent、Raycast 式通用 launcher、Activity Monitor 式进程监控器或模型聊天客户端；它要做的是本地全自动、多 AI、多项目并行的轻量 AI IDE。

CodePanion 更接近“个人本地 Devin + 多 agent 调度器 + Rust 高性能 daemon”的组合：用户输入目标，系统在本地拆解任务、分派角色、运行多个 workflow、做自动审查和高危门控，并归档交付记录。

核心差异化：

1. **Rust 轻量高性能**：用原生 daemon 支撑低内存、低启动延迟和多任务并行，而不是依赖 Node 运行时达成最终性能指标。
2. **本地全自动闭环**：用户能在一个 GUI 中完成目标输入、任务拆分、计划、执行、测试、审查、交付确认和归档。
3. **多 AI 角色分工**：角色、模型、权限、上下文策略和输出契约是产品一等概念。
4. **多项目/多任务调度**：全局 runs、gates、队列、artifact 和跨项目依赖是核心能力，不是后期附加看板。
5. **能力源中立**：不绑定单一 IDE、模型或云平台；workflow 角色可以使用用户 API、本地模型、Codex、Claude Code、OpenCode 或后续能力源。
6. **权限边界透明**：按角色声明读写、命令、网络、任务委派和外部目录权限，高危行为进入人工门。
7. **产出优先**：围绕代码、测试、审查、文档和交付记录组织体验，而不是围绕聊天、模型或系统进程组织体验。

## 目标用户

- **重度个人开发者**：同时使用 Codex、Claude Code、OpenCode、VS Code/Copilot、多个 CLI 任务或多个项目窗口，需要把一次开发目标拆成可交付闭环。
- **AI 工作流用户**：希望让规划、实现、测试、审查、文档分别由不同角色或模型完成，并在关键节点自己审核。
- **企业研发骨干**：关注私有码仓、内网环境、工具中立、本地留痕和后续审计治理。当前阶段不做团队协作平台，但中后期为私有部署、审计导出和治理能力保留路线。

## 产品保留决策

- **保留当前入口**：Windows Alpha 继续以桌面 GUI 双击运行为普通用户路径；默认入口已迁移为 Tauri 产物 `CodePanion.exe`。
- **Rust daemon 默认**：GUI、CLI、打包和新开发默认走 Rust daemon；Node daemon 只作为旧行为基线保留。
- **保留当前行为基线**：HTTP/WebSocket 契约、workflow 定义、run history、artifact、人工门和 GUI 工作台作为迁移验收标准。
- **重排当前主线**：先 Rust 化本地全自动 workflow，再做多项目/多任务调度和外部能力源接入；监听、识别和外部来源不再进入新路线。
- **GUI 现代化**：Tauri + React GUI 已成为默认桌面壳；Avalonia 仅保留为后续评估项。

## 核心原则

1. **先 Rust 技术验证，再迁移核心闭环**：先验证内存、启动、HTTP/WS、模型客户端，再迁移 agent runtime、workflow engine 和 storage。
2. **先全自动单项目闭环，再多任务并行**：先让一个 workflow 自动完成开发，再扩展到多个项目和多个 workflow 同步运行。
3. **先角色权限和高危门控，再扩大工具权限**：`read_file`、`write_file`、`run_command`、网络访问和 git 操作必须有明确风险分级。
4. **外部工具作为一等 provider 接入**：Codex、Claude Code、OpenCode 等接入要服务本地 workflow，可通过 API provider、CLI provider 或 in-process harness 三种方式实现。
5. **不卖模型调用**：商业化围绕本地工作流管理、角色权限、产出归档、本地审计、隐私和中立性，不做 token 二次分销。

## Alpha 0：Rust Daemon 技术验证

### 目标

证明 Rust 可以承担 CodePanion 的最终性能架构，并兼容当前 GUI 需要的 HTTP/WS 交互。

### 关键能力

- Rust workspace 和 daemon 二进制
- `/health` HTTP 服务
- WebSocket 实时事件推送
- OpenAI-compatible 模型客户端
- 内存、启动时间、二进制大小基准

### 成功标准

- Rust daemon 空闲内存 < 50MB
- daemon 冷启动 < 500ms
- daemon 二进制 < 20MB
- HTTP/WebSocket 正常工作
- 模型客户端能调用 OpenAI-compatible API

## Alpha 1：Windows 个人本地 AI 工作流闭环

### 目标

让一个人能够从一个 Windows GUI 把一个开发目标拆成任务，由 CodePanion 内不同 AI 角色自动计划、实现、测试、审查和归档，在高危动作或关键节点人工审核，并归档最终产品产出。

### 关键能力

- Workspace 级 workflow 配置和角色配置
- 内置 Orchestrator、Planner、Builder、Tester、Reviewer、Docs Writer 六类角色
- 任务拆分、计划确认、执行、测试、审查、最终验收和归档节点
- 同一模型多角色与多模型协作的配置模型
- 人工审核门：需求、计划、审查、交付
- 产出归档：计划、变更摘要、测试结果、审查意见、人工决策、交付摘要
- 进程内 agent runtime 支持 tool-use 循环、只读/写文件/跑命令工具和高危行为检测
- 用户 API、本地模型和外部 agentic coding tool 都作为角色能力源
- provider 抽象支持 API provider、CLI provider 和 in-process harness 三类外部能力调用

### 成功标准

- 一个 workflow 能从目标输入走到交付摘要
- 至少支持计划、实现、测试、审查、文档五类角色节点
- 人工审核门能阻止未经确认的计划或产出继续自动推进
- 每次完成后能查看可复盘的 artifact 历史
- 文档真实反映当前能力，不夸大外部工具接管深度

## Beta：扩大可调用的 AI 能力源

### 目标

在 Alpha 闭环稳定后，扩大 CodePanion 可调用的外部 AI 编程工具能力源，并加强多项目/多任务调度、角色模板、任务历史和跨工具协作能力。外部工具调用不是可选装饰，而是 CodePanion 供应商中立和多 AI 协作能力的重要组成部分。

### 接入优先级

1. 通义灵码 / Qoder、Qoder CLI
2. CodeBuddy IDE / CodeBuddy Code
3. Trae
4. 百度 Comate
5. CodeGeeX
6. MarsCode、CodeArts 进入下一梯队验证

### 关键能力

- 对首批工具按 L1/L2/L3/L4 分层推进，不强行读取闭源私有状态
- 能力源接入 SDK 草案，降低对一个新外部 AI 工具完成 API provider / CLI provider / in-process harness 适配的成本
- 本地 workflow 历史、artifact 查询、角色模板和跨工具能力编排基础
- Tauri GUI 已作为默认桌面壳落地；Avalonia 仅作为后续跨平台备选评估

### 成功标准

- 首批外部 AI 能力源接入后，常见开发目标能够完成「拆分 - 调用 - 审核 - 归档」的闭环
- 用户能明确区分每个外部 AI 能力源当前支持的是手动上下文（L1）、单节点调用（L2）、可审核节点（L3）还是 workflow 编排（L4）

## GA 与长期商业化

### 产品层级

- **Community**：本地 daemon、基础 GUI、基础 workflow、内置角色、对 CLI/Codex/Claude/OpenCode/VS Code 等首批能力源的基础调用。
- **Pro**：多模型角色路由、项目级角色库、workflow 模板、artifact 历史归档、失败重试和工具配置管理。
- **Enterprise**：私有部署、审计导出、策略中心、敏感目录边界、组织规则同步、离线或内网模式。

### 边界

Enterprise 是中后期治理方向，不改变当前阶段不做团队协作平台的原则。短期不做多用户协作、共享空间、权限审批流、token 分销或模型调用平台。

## 明确不做

- 不做传统编辑器型 AI IDE（不和 VS Code / Cursor / Trae / Comate / CodeBuddy 这类代码编辑器在文本编辑体验上正面竞争）
- 不做通用个人 Agent 或聊天聚合器
- 不做 Raycast 式通用 launcher
- 不做 Activity Monitor 式系统进程监控器
- 不做模型聊天客户端
- 不做团队协作平台
- 不做默认系统级 OCR 或全局屏幕读取
- 不读取 token、cookie、私有插件数据库以及任何上游工具非公开的存储或登录态（注：可调用上游工具公开/逆向得到的接口与 API 作为能力源，这是 CodePanion 的核心实现方式）
- 不把 CodePanion 定位为 Codex、Claude Code、VS Code、Cursor、Trae 或 CodeBuddy 的替代品；CodePanion 是本地全自动开发主系统，它们是可接入的能力源
- 不做监听外部窗口路线

## 当前开发优先级

1. **Rust 技术验证**：创建 Rust workspace，实现最小 `/health`、WebSocket、模型客户端和性能基准。
2. **Rust 核心迁移**：迁移 config、model client、agent runtime、workflow engine、storage、HTTP/WS 契约。
3. **自动开发工具链**：实现 `write_file`、`run_command`、风险分级、高危行为审核门和失败自动修复循环。
4. **多任务并行调度**：支持多个 workflow 同时运行、取消、恢复、排队、全局 runs/gates。
5. **多项目管理**：实现 project registry、项目切换、跨项目 artifact、跨项目依赖和全局队列视图。
6. **GUI 工作台完善**：围绕项目、任务、角色、模型、权限、审核门和 delivery-note 组织界面。
7. **外部能力源接入**：在本地主闭环稳定后，把 Codex、Claude Code、OpenCode、本地模型和国产 AI 编程工具接入为可编排 provider。
