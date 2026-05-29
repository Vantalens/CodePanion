# CodePanion 产品路线

## 产品定位

CodePanion 是一个本地优先、供应商中立、面向个人开发者的 AI 工作流操作台。它服务于需要把产品目标推进到代码、测试、审查、文档和交付记录的用户，把任务拆分、AI 角色分工、多模型协作、人工审核和产出归档收束到一个本地图形工作台中。仓库内具体措辞以 [产品定位契约](POSITIONING.md) 和 [本地 AI 工作流设计](LOCAL_AI_WORKFLOW.md) 为准。

现有产品不推倒重做。当前的 Windows GUI、本地 daemon、CLI/PTTY 和统一任务 / workflow 模型，都是本地 AI 工作流路线的基础资产。变化在于主线：监听外部工具状态不再进入路线，后续只做用户主动发起的 workflow 编排与角色协作闭环。

## 市场判断与差异化

AI 开发正在从单次对话转向长链路、多角色、多模型、可审核的工程流程。CodePanion 不和 Cursor、Trae、Windsurf、VS Code/Copilot 这类 AI IDE 正面竞争，也不做 OpenClaw 类通用个人 Agent、Raycast 式通用 launcher、Activity Monitor 式进程监控器或模型聊天客户端；它要做的是个人本地 AI 工作流的组织层。

核心差异化：

1. **角色中立**：不绑定单一 IDE、模型或云平台，角色可以映射到 Codex、Claude Code、OpenCode、CLI 或后续执行器。
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

1. **先闭环，后扩展执行器**：先让一个本地开发 workflow 从目标到产出完整跑通，再增加更多显式执行器。
2. **先角色，后自动化**：先定义角色权限、输出契约和人工审核门，再讨论自动调度。
3. **分层描述执行能力**：L1 手动上下文输入，L2 单节点执行器，L3 可审核 workflow 节点，L4 多角色 / 多模型 workflow 编排。
4. **不卖模型调用**：商业化围绕本地工作流管理、角色权限、产出归档、本地审计、隐私和中立性，不做 token 二次分销。

## Alpha：Windows 个人本地 AI 工作流闭环

### 目标

让一个人能够从一个 Windows GUI 把一个开发目标拆成任务，分派给不同 AI 角色执行，在关键节点人工审核，并归档最终产品产出。

### 关键能力

- Workspace 级 workflow 配置和角色配置
- 内置 Orchestrator、Planner、Builder、Tester、Reviewer、Docs Writer 六类角色
- 任务拆分、计划确认、执行、测试、审查、最终验收和归档节点
- 同一模型多角色与多模型协作的配置模型
- 人工审核门：需求、计划、审查、交付
- 产出归档：计划、变更摘要、测试结果、审查意见、人工决策、交付摘要
- 保留 CLI/PTTY、Codex、Claude Code、OpenCode 作为显式 executor

### 成功标准

- 一个 workflow 能从目标输入走到交付摘要
- 至少支持计划、实现、测试、审查、文档五类角色节点
- 人工审核门能阻止未经确认的计划或产出继续自动推进
- 每次完成后能查看可复盘的 artifact 历史
- 文档真实反映当前能力，不夸大外部工具接管深度

## Beta：本地工作流执行器增强

### 目标

在 Alpha 闭环稳定后，扩大首批 executor 接入，并加强角色市场、项目模板、任务历史和跨工具协作能力。

### 执行器优先级

1. 通义灵码 / Qoder、Qoder CLI
2. CodeBuddy IDE / CodeBuddy Code
3. Trae
4. 百度 Comate
5. CodeGeeX
6. MarsCode、CodeArts 进入下一梯队验证

### 关键能力

- 对首批工具按 L1/L2/L3/L4 分层推进，不强行读取闭源私有状态
- Executor SDK 草案，降低显式执行器接入成本
- 本地 workflow 历史、artifact 查询、角色模板和跨工具任务分派基础
- Tauri/Avalonia 跨平台 GUI 评估，但只在 Alpha 稳定后决定是否迁移

### 成功标准

- 首批 executor 接入后，常见开发目标能够完成“拆分 - 执行 - 审核 - 归档”的闭环
- 用户能明确区分每个 executor 当前支持的是手动上下文、单节点执行、可审核节点还是 workflow 编排

## GA 与长期商业化

### 产品层级

- **Community**：本地 daemon、基础 GUI、基础 workflow、内置角色、CLI/Codex/Claude/OpenCode/VS Code 基础执行器。
- **Pro**：多模型角色路由、项目级角色库、workflow 模板、artifact 历史归档、失败重试和工具配置管理。
- **Enterprise**：私有部署、审计导出、策略中心、敏感目录边界、组织规则同步、离线或内网模式。

### 边界

Enterprise 是中后期治理方向，不改变当前阶段不做团队协作平台的原则。短期不做多用户协作、共享空间、权限审批流、token 分销或模型调用平台。

## 明确不做

- 不做完整 AI IDE
- 不做通用个人 Agent 或聊天聚合器
- 不做 Raycast 式通用 launcher
- 不做 Activity Monitor 式系统进程监控器
- 不做模型聊天客户端
- 不做团队协作平台
- 不做默认系统级 OCR 或全局屏幕读取
- 不读取 token、cookie、私有插件数据库或上游工具私有 API
- 不把 CodePanion 定位为 Codex、Claude Code、VS Code、Cursor、Trae 或 CodeBuddy 的替代品
- 不做监听外部窗口路线

## 当前开发优先级

1. 完成本地 AI 工作流模型设计：workspace、role、workflow、human gate、artifact
2. 将现有 workflow / handoff / task state 代码重排为 role assignment 与 artifact loop 的实现基础
3. 重建 GUI 信息架构：从会话流转向 workflow board
4. 建立多模型与同模型多角色的配置、权限和输出契约
5. 移除监听来源、进程识别和被动状态采集路线，按显式 executor 能力分层推进
