# CodePanion 产品定位契约

本文档用于约束 README、路线图、GUI 文案、包描述和后续功能规划。

- 2026-05-28 起，CodePanion 放弃外部监听路线，主线调整为「个人本地 AI 工作流闭环」。
- 2026-05-29 起，进一步将定位明确为「**个人 Agent AI IDE + AI 工作流控制台**」双重身份。
- **2026-06-01 起，明确 CodePanion 是一个新的 AI IDE**：通过逆向或调用接口使用外部 agentic coding tool（Codex、Claude Code、OpenCode 等），使用用户自行提供的 API 进行本地工作流搭建，实现对多项目的同步开发管理。

## 定位声明

**CodePanion 是一个新的 AI IDE**，专为个人开发者设计，用于管理多项目的 AI 驱动开发流程。

核心特点：

1. **调用外部 agentic coding tool**：通过逆向接口或 API 调用 Codex、Claude Code、OpenCode 等外部 AI 编程工具，把它们作为可编排的能力源
2. **用户自行提供 API**：支持用户配置自己的模型 API（DeepSeek、OpenAI 等），不依赖特定供应商
3. **多项目同步开发管理**：在一个 IDE 内管理多个项目的 workflow，支持跨项目的任务编排和资源调度
4. **本地工作流控制台**：把产品目标拆成可审核、可执行、可回收的 workflow，通过角色分工、人工审核和产出归档形成闭环

**CodePanion 是主体（调用方），外部 AI 工具和模型 API 是被它调用的能力（被调用方）。**

## 核心差异

| 相邻产品类型 | 容易撞车的说法 | CodePanion 的正确说法 |
|---|---|---|
| OpenCode / Codex / Claude Code | 替代某个 AI 编程工具 | 调用它们的能力，CodePanion 是上层 AI IDE |
| Cursor / Windsurf / Cline | 新一代代码编辑器 | 不做代码编辑器，做 AI IDE：管理多项目、编排 workflow、调用外部 agentic tool |
| 通用个人 Agent / OpenClaw | 全能个人助手 | 只围绕开发场景，管理多项目的 AI 工作流 |
| 模型聊天客户端 | 多模型聊天平台 | 不做通用聊天；模型只作为 workflow 角色的执行能力 |

## 做什么

### 1. 新的 AI IDE

- **多项目管理**：在一个 IDE 内管理多个项目，每个项目有独立的 workspace、workflow 和角色配置
- **跨项目编排**：支持跨项目的任务依赖、资源共享和并行执行
- **统一控制台**：在一个界面内查看所有项目的 workflow 状态、人工审核门和产出

### 2. 调用外部 agentic coding tool

- **逆向接口**：通过逆向工程复刻 Claude Code、Codex、OpenCode 等工具的 agent 架构，在 CodePanion 进程内运行
- **API 调用**：通过 API 调用外部工具的能力（如果它们提供 API）
- **能力编排**：把外部工具当作可编排的能力源，在 workflow 中组合使用

### 3. 用户自行提供 API

- **模型 API 配置**：用户在 `config.json` 中配置自己的模型 API（DeepSeek、OpenAI、Claude、本地模型等）
- **供应商中立**：不依赖特定供应商，不锁定用户
- **API key 本地存储**：API key 存储在本地 `config.json`（0600 权限保护），不上传到任何服务器

### 4. 本地工作流控制台

- **任务拆分**：将产品目标拆成需求澄清、计划、实现、测试、审查、文档和交付检查等 workflow 节点
- **角色分工**：为不同节点绑定 AI 角色（Orchestrator、Planner、Builder、Reviewer、Tester、Doc Writer）
- **人工审核**：在需求确认、计划确认、代码审查、测试结果和最终交付处提供人工审核门
- **产出归档**：将执行记录、人工决策、测试结果、审查意见、产出文件和最终摘要归档到任务历史

### 5. 执行模型：architecture × model 两轴

- **architecture（进程内 harness）**：
  - `shell`：spawn 本地命令（测试、构建等非 AI 步骤）
  - `agent`：进程内 agent 运行时（逆向自 Claude Code 等，支持 tool-use 循环）
- **model（外部 API）**：
  - 用户配置的模型 API（DeepSeek、OpenAI、Claude、本地模型等）
  - 支持同一模型的多角色分工，也支持不同模型在同一 workflow 中协作

## 不做什么

- 不做通用个人 Agent、聊天聚合器、邮箱/日历/IM 总控或后台 cron 平台
- 不做传统代码编辑器（不和 VS Code / Cursor / Windsurf 在文本编辑体验上正面竞争）
- 不做模型聊天客户端、代码生成质量竞争或 token 二次分销
- 不做 Raycast 式通用 launcher，也不把产品退化为系统进程监控器
- 不读取账号、token、cookie、浏览器登录态、插件私有数据库、上游私有 API、全局屏幕内容或默认剪贴板内容
- 不提前做团队协作、共享空间、权限审批平台或企业管理后台
- 不做外部窗口监听、全局屏幕扫描、闭源工具内部状态猜测或进程监控路线

## MVP 焦点

0 到 1 的 MVP 围绕"**新的 AI IDE：多项目管理 + 调用外部 agentic tool + 用户自行提供 API + 本地工作流控制台**"成立：

1. **多项目管理**：workspace 列表、项目切换、跨项目任务编排
2. **调用外部 agentic tool**：逆向 Claude Code 等工具的 agent 架构，在进程内运行
3. **用户自行提供 API**：config.json 配置模型 API，支持 DeepSeek、OpenAI、Claude、本地模型
4. **本地工作流控制台**：workflow 定义、角色库、任务计划、人工审核门、执行记录、产出归档

外部监听、跨工具自动转派和更深国产工具适配不进入当前主线。

## 产品愿景

**CodePanion 要成为个人开发者的 AI IDE**，让用户可以：

1. 在一个 IDE 内管理多个项目
2. 调用外部 agentic coding tool（Codex、Claude Code、OpenCode 等）的能力
3. 使用自己的模型 API（不被供应商锁定）
4. 通过 workflow 编排多步骤、多角色、多模型的开发流程
5. 在关键节点进行人工审核，保持对 AI 的控制
6. 归档所有产出，形成可追踪的开发记录

**CodePanion 不是代码编辑器，而是 AI IDE：它管理项目、编排 workflow、调用 AI 能力，让 AI 成为开发流程的一部分。**
