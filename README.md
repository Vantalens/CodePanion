# CodePanion

CodePanion 是一个**新的 AI IDE**，专为个人开发者设计，用于管理多项目的 AI 驱动开发流程。

## 核心特点

1. **调用外部 agentic coding tool**：通过逆向接口或 API 调用 Codex、Claude Code、OpenCode 等外部 AI 编程工具，把它们作为可编排的能力源
2. **用户自行提供 API**：支持用户配置自己的模型 API（DeepSeek、OpenAI、Claude、本地模型等），不依赖特定供应商
3. **多项目同步开发管理**：在一个 IDE 内管理多个项目的 workflow，支持跨项目的任务编排和资源调度
4. **本地工作流控制台**：把产品目标拆成可审核、可执行、可回收的 workflow，通过角色分工、人工审核和产出归档形成闭环

## 核心能力

### 1. 多项目管理

- 在一个 IDE 内管理多个项目，每个项目有独立的 workspace、workflow 和角色配置
- 支持跨项目的任务依赖、资源共享和并行执行
- 统一控制台查看所有项目的 workflow 状态、人工审核门和产出

### 2. 调用外部 agentic coding tool

- **逆向接口**：通过逆向工程复刻 Claude Code、Codex、OpenCode 等工具的 agent 架构，在 CodePanion 进程内运行
- **API 调用**：通过 API 调用外部工具的能力（如果它们提供 API）
- **能力编排**：把外部工具当作可编排的能力源，在 workflow 中组合使用

### 3. 用户自行提供 API

- 用户在 `config.json` 中配置自己的模型 API（DeepSeek、OpenAI、Claude、本地模型等）
- 供应商中立，不依赖特定供应商，不锁定用户
- API key 本地存储（0600 权限保护），不上传到任何服务器

### 4. 本地工作流控制台

- 将产品目标拆成可审核、可执行、可回收的本地工作流任务
- 支持 `规划 / 实现 / 测试 / 审查 / 文档 / 发布检查` 等 AI 角色分工
- 支持多模型协作，也支持同一模型绑定不同角色、权限和上下文策略
- 在需求确认、计划确认、代码审查和最终验收等节点插入人工审核
- 记录任务拆分、角色执行、人工决策、测试结果、审查意见和最终产出
- 保留 `等待我 / 失败 / 需审阅 / 运行中 / 完成` 队列和任务管理动作

### 5. 执行模型：architecture × model 两轴

- **architecture（进程内 harness）**：
  - `shell`：spawn 本地命令（测试、构建等非 AI 步骤）
  - `agent`：进程内 agent 运行时（逆向自 Claude Code 等，支持 tool-use 循环）
- **model（外部 API）**：
  - 用户配置的模型 API（DeepSeek、OpenAI、Claude、本地模型等）
  - 支持同一模型的多角色分工，也支持不同模型在同一 workflow 中协作

## 使用方式

CodePanion 当前以 Windows 本地图形软件的方式提供使用。

下载或生成便携版后，直接运行：

```text
dist/CodePanion-win-x64/CodePanion.Gui.exe
```

图形界面会自动启动本地 daemon。正常使用不需要先打开终端，也不需要手动执行 `npm run gui:run`、`dotnet run` 或 `codepanion start`。

## 产品边界

CodePanion 是：

- **新的 AI IDE**：管理多项目、编排 workflow、调用外部 agentic tool
- **本地工作流控制台**：在 IDE 内编排多步骤、多角色、多模型的本地开发流程
- **供应商中立**：用户自行提供 API，不依赖特定供应商

CodePanion 不是：

- 传统代码编辑器（不和 VS Code / Cursor / Windsurf 在文本编辑体验上正面竞争）
- 模型聊天客户端
- 通用个人 Agent
- 通用启动器
- 系统级进程监控器

CodePanion 当前聚焦于以下核心目标：

> **成为个人开发者的 AI IDE：在一个 IDE 内管理多个项目，调用外部 agentic coding tool，使用自己的模型 API，通过 workflow 编排多步骤、多角色、多模型的开发流程，在关键节点进行人工审核，归档所有产出。**

## 目标用户

- 需要管理多个项目的个人开发者
- 想要使用自己的模型 API（不被供应商锁定）的开发者
- 需要调用外部 agentic coding tool（Codex、Claude Code、OpenCode 等）的开发者
- 需要把产品想法推进到代码、测试、文档和交付记录的个人开发者
- 需要多模型协作、角色权限隔离和人工审核节点的 AI 工作流用户

## 当前技术形态

- Windows GUI：WPF + WebView2
- 本地 daemon：Node.js
- 执行模型：architecture（shell / agent）× model（用户配置的 API）
- 接入方式：
  - 逆向接口：复刻 Claude Code 等工具的 agent 架构，在进程内运行
  - API 调用：调用外部工具的 API（如果它们提供）
  - 用户 API：用户在 config.json 中配置自己的模型 API
- 数据策略：默认本地保存，不读取 token、cookie、私有插件数据库或全局屏幕内容

## 开发者入口

如需进行构建、开发或集成，请从以下文档进入：

- [安装与构建](docs/INSTALL.md)
- [开发说明](docs/DEVELOPMENT.md)
- [产品定位](docs/POSITIONING.md)
- [产品路线](docs/PRODUCT_ROADMAP.md)
- [本地 AI 工作流](docs/LOCAL_AI_WORKFLOW.md)

最小构建流程如下：

```bash
npm install
npm run build
npm run package:windows
```

## 仓库结构

```text
CodePanion/
├── packages/
│   ├── daemon/   # 本地 daemon、CLI、workflow 模型、agent 运行时、模型客户端
│   └── gui/      # Windows 图形界面
├── docs/         # 产品、安装、开发、路线文档
└── scripts/      # 打包与辅助脚本
```

## 许可证

MIT
