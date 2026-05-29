# CodePanion 产品定位契约

本文档用于约束 README、路线图、GUI 文案、包描述和后续功能规划。

- 2026-05-28 起，CodePanion 放弃外部监听路线，主线调整为「个人本地 AI 工作流闭环」。
- 2026-05-29 起，进一步将定位明确为「**个人 Agent AI IDE + AI 工作流控制台**」双重身份：CodePanion 自身就是一个本地 Agent AI IDE，通过**逆向接口、调用其 API** 的方式把 Codex / Claude Code / OpenCode 等当作可编排的能力源，而不是把任务"派"给它们；同时保留 workflow / role / artifact / 人工审核门这套控制台机制，给用户编排 IDE 内多步骤工作。

## 定位声明

CodePanion 是一个本地优先、供应商中立、面向个人开发者的 **Agent AI IDE**，同时也是一个 **AI 工作流控制台**。它把用户的产品目标收束为本地 workflow，通过任务拆分、AI 角色分工、多模型协作、人工审核和产出归档，形成从想法到交付记录的闭合回路；在能力实现上，它通过逆向接口和 API 调用外部 AI 编程工具（Codex / Claude Code / OpenCode 等），把它们作为 CodePanion 自身可编排的能力源，而不是被动监听对象，也不是任务接收方。

CodePanion 是主体（调用方），外部 AI 工具是被它调用的能力（被调用方）。

## 核心差异

| 相邻产品类型 | 容易撞车的说法 | CodePanion 的正确说法 |
|---|---|---|
| OpenCode / Codex / Claude Code | 替代某个 AI 编程工具，或把任务"派"给它们 | 借鉴项目级 agent、角色权限和任务委派模式；通过逆向接口/API 调用它们的能力，CodePanion 是上层 Agent IDE 与控制台 |
| 通用个人 Agent / OpenClaw 类 | 全能个人助手、自动接管电脑 | 只围绕用户显式创建的开发 workflow，不做全局个人助理 |
| 传统编辑器型 AI IDE / Trae / Comate / CodeBuddy | 新一代代码编辑器、代码生成平台 | 不做代码编辑器、不和代码生成质量正面竞争；以 Agent + workflow 控制台形态做 IDE，把规划、实现、测试、审查、文档串成流程 |
| 模型聊天客户端 | 多模型聊天、模型调用平台 | 不卖 token，不做通用聊天；模型只作为 workflow 角色的执行能力 |
| 监听 / 监控工具 | 系统级进程监控器、窗口监听器 | 不走监听路线；主线是用户主动发起、可审核、可归档的本地 workflow |

## 做什么

- 将产品目标拆成需求澄清、计划、实现、测试、审查、文档和交付检查等本地 workflow 节点。
- 为不同节点绑定 AI 角色，例如 Orchestrator、Planner、Builder、Reviewer、Tester、Doc Writer。
- 支持同一模型的多角色分工，也支持不同 provider / model 在同一 workflow 中协作。
- 用权限、上下文预算、可写范围、命令执行策略约束每个角色的能力。
- 在需求确认、计划确认、代码审查、测试结果和最终交付处提供人工审核门。
- 将执行记录、人工决策、测试结果、审查意见、产出文件和最终摘要归档到任务历史。
- 通过逆向接口 / API / CLI 调用 Codex、Claude Code、OpenCode、本地 CLI/PTY 等外部能力作为 workflow 角色的能力源（CodePanion 是调用方）。

## 不做什么

- 不做通用个人 Agent、聊天聚合器、邮箱/日历/IM 总控或后台 cron 平台。
- 不做传统编辑器型 AI IDE（不和 VS Code / Trae / Comate / CodeBuddy 这类代码编辑器在文本编辑体验上正面竞争）、模型聊天客户端、代码生成质量竞争或 token 二次分销。
- 不做 Raycast 式通用 launcher，也不把产品退化为系统进程监控器。
- 不读取账号、token、cookie、浏览器登录态、插件私有数据库、上游私有 API、全局屏幕内容或默认剪贴板内容。
- 不提前做团队协作、共享空间、权限审批平台或企业管理后台。
- 不做外部窗口监听、全局屏幕扫描、闭源工具内部状态猜测或进程监控路线。

## MVP 焦点

0 到 1 的 MVP 只围绕“本地任务拆分 + AI 角色协作 + 人工审核 + 产出归档”成立：项目 workspace、workflow 定义、角色库、任务计划、人工审核门、执行记录、测试/审查结果和最终交付摘要。外部监听、跨工具自动转派和更深国产工具适配不进入当前主线。
