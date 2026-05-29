# CodePanion 产品路线

## 产品定位

CodePanion 是一个本地优先、供应商中立、面向个人开发者的 **Agent AI IDE + AI 工作流控制台**。它服务于需要把产品目标推进到代码、测试、审查、文档和交付记录的用户：CodePanion 自身就是 Agent IDE，通过逆向接口和 API 调用 Codex、Claude Code、OpenCode 等外部 AI 编程工具的能力，并把整个过程组织成本地可控的多角色、多模型、可审核的 workflow。仓库内具体措辞以 [产品定位契约](POSITIONING.md) 和 [本地 AI 工作流设计](LOCAL_AI_WORKFLOW.md) 为准。

现有产品不推倒重做。当前的 Windows GUI、本地 daemon、CLI/PTTY 和统一任务 / workflow 模型，都是 Agent AI IDE 路线的基础资产。变化在于主线：监听外部工具状态不再进入路线，后续只做用户主动发起的 workflow 编排与对外部 AI 能力的主动调用。

## 市场判断与差异化

AI 开发正在从单次对话转向长链路、多角色、多模型、可审核的工程流程。CodePanion 不在代码编辑体验上和 Cursor、Trae、Windsurf、VS Code/Copilot 这类传统编辑器型 AI IDE 正面竞争，也不做 OpenClaw 类通用个人 Agent、Raycast 式通用 launcher、Activity Monitor 式进程监控器或模型聊天客户端；它要做的是位于这些工具**之上**的个人 Agent IDE 与本地 AI 工作流控制台 —— 由 CodePanion 主动调用各家 AI 编程工具的接口/API，把它们的能力编织进可审核的本地流程。

核心差异化：

1. **能力源中立**：不绑定单一 IDE、模型或云平台；workflow 角色可以通过逆向接口 / API / CLI 调用 Codex、Claude Code、OpenCode、本地 CLI 或后续能力源 —— CodePanion 是调用方。
2. **本地优先**：状态、日志、规则和操作默认留在本机。
3. **闭环优先**：用户能在一个 GUI 中完成目标输入、任务拆分、计划确认、执行、测试、审查、交付确认和归档。
4. **权限边界透明**：按角色声明读写、命令、网络、任务委派和外部目录权限，不把弱接入包装成深度接管。
5. **产出优先**：围绕代码、测试、审查、文档和交付记录组织体验，而不是围绕聊天、模型或系统进程组织体验。

## 目标用户

- **重度个人开发者**：同时使用 Codex、Claude Code、OpenCode、VS Code/Copilot、多个 CLI 任务或多个项目窗口，需要把一次开发目标拆成可交付闭环。
- **AI 工作流用户**：希望让规划、实现、测试、审查、文档分别由不同角色或模型完成，并在关键节点自己审核。
- **企业研发骨干**：关注私有码仓、内网环境、工具中立、本地留痕和后续审计治理。当前阶段不做团队协作平台，但中后期为私有部署、审计导出和治理能力保留路线。

## 产品保留决策

- **保留当前入口**：Windows Alpha 继续以 `CodePanion.Gui.exe` 双击运行为普通用户路径。
- **保留当前技术栈**：Alpha 阶段继续使用 Node daemon、HTTP/WebSocket、WPF/WebView2 GUI，不立即迁移 Tauri 或 Avalonia。
- **保留当前核心能力**：CLI/PTTY 包装、提示检测、直接回复、系统通知、GUI 时间线和本地 workflow 模型。
- **重排当前主线**：上述能力后续服务于本地 workflow、角色分工和人工审核；监听、识别和外部来源不再进入新路线。
- **后置评估**：Tauri/Avalonia 跨平台 GUI、provider adapter、Enterprise 治理能力和规则跨生态同步进入后续路线，不作为 Alpha 阻塞项。

## 核心原则

1. **先闭环，后扩展能力源**：先让一个本地开发 workflow 从目标到产出完整跑通，再增加更多被 CodePanion 调用的外部 AI 能力源。
2. **先角色，后自动化**：先定义角色权限、输出契约和人工审核门，再讨论自动调度。
3. **分层描述能力调用深度**：L1 手动上下文输入，L2 单节点调用一个外部能力，L3 可审核 workflow 节点，L4 多角色 / 多模型 workflow 编排。
4. **不卖模型调用**：商业化围绕本地工作流管理、角色权限、产出归档、本地审计、隐私和中立性，不做 token 二次分销。

## Alpha：Windows 个人本地 AI 工作流闭环

### 目标

让一个人能够从一个 Windows GUI 把一个开发目标拆成任务，由 CodePanion 内不同角色调用对应外部 AI 能力源执行，在关键节点人工审核，并归档最终产品产出。

### 关键能力

- Workspace 级 workflow 配置和角色配置
- 内置 Orchestrator、Planner、Builder、Tester、Reviewer、Docs Writer 六类角色
- 任务拆分、计划确认、执行、测试、审查、最终验收和归档节点
- 同一模型多角色与多模型协作的配置模型
- 人工审核门：需求、计划、审查、交付
- 产出归档：计划、变更摘要、测试结果、审查意见、人工决策、交付摘要
- 通过逆向接口 / API / CLI 调用 Codex、Claude Code、OpenCode、本地 CLI/PTY 作为角色能力源

### 成功标准

- 一个 workflow 能从目标输入走到交付摘要
- 至少支持计划、实现、测试、审查、文档五类角色节点
- 人工审核门能阻止未经确认的计划或产出继续自动推进
- 每次完成后能查看可复盘的 artifact 历史
- 文档真实反映当前能力，不夸大外部工具接管深度

## Beta：扩大可调用的 AI 能力源

### 目标

在 Alpha 闭环稳定后，扩大 CodePanion 可调用的外部 AI 编程工具能力源，并加强角色市场、项目模板、任务历史和跨工具协作能力。

### 接入优先级

1. 通义灵码 / Qoder、Qoder CLI
2. CodeBuddy IDE / CodeBuddy Code
3. Trae
4. 百度 Comate
5. CodeGeeX
6. MarsCode、CodeArts 进入下一梯队验证

### 关键能力

- 对首批工具按 L1/L2/L3/L4 分层推进，不强行读取闭源私有状态
- 能力源接入 SDK 草案，降低对一个新外部 AI 工具完成逆向接口适配的成本
- 本地 workflow 历史、artifact 查询、角色模板和跨工具能力编排基础
- Tauri/Avalonia 跨平台 GUI 评估，但只在 Alpha 稳定后决定是否迁移

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
- 不把 CodePanion 定位为 Codex、Claude Code、VS Code、Cursor、Trae 或 CodeBuddy 的替代品（CodePanion 是它们之上的 Agent IDE 与控制台）
- 不做监听外部窗口路线

## 当前开发优先级

1. 完成本地 AI 工作流模型设计：workspace、role、workflow、human gate、artifact
2. 将现有 workflow / handoff / task state 代码重排为 role assignment 与 artifact loop 的实现基础
3. 重建 GUI 信息架构：从会话流转向 workflow board
4. 建立多模型与同模型多角色的配置、权限和输出契约
5. 移除监听来源、进程识别和被动状态采集路线，按 CodePanion 主动调用能力源的能力分层推进
