# CodePanion

CodePanion 是一个**新的 AI IDE**，专为个人开发者设计，支持**全自动 AI 驱动开发**和**多项目同步管理**。

## 核心特点

1. **全自动 AI 驱动开发**：AI 自行进行角色分工（Orchestrator、Planner、Builder、Tester、Reviewer）和任务执行，用户只需观察监控，必要时介入
2. **用户可介入控制**：用户可以随时介入、修改任务方向、自行编辑代码、批准/拒绝/重试任务
3. **调用外部 agentic coding tool**：通过逆向接口或 API 调用 Codex、Claude Code、OpenCode 等外部 AI 编程工具
4. **用户自行提供 API**：支持用户配置自己的模型 API（DeepSeek、OpenAI、Claude、本地模型等），不依赖特定供应商
5. **多项目同步开发管理**：在一个 IDE 内管理多个项目的 workflow，支持跨项目的任务编排

## 核心能力

### 1. 全自动 AI 驱动开发

- **AI 自行角色分工**：Orchestrator 拆解任务 → Planner 制定计划 → Builder 实现代码 → Tester 运行测试 → Reviewer 审查代码 → Doc Writer 编写文档
- **自动任务执行**：AI 自动执行每个角色的任务，无需用户手动触发每一步
- **智能决策**：AI 根据上一步的结果自动决定下一步（例如测试失败 → 自动修复 → 重新测试）
- **持续运行**：workflow 可以持续运行，直到完成或遇到需要人工决策的节点

### 2. 用户可介入控制

- **观察监控**：用户通过 GUI 实时查看 workflow 进度、每个 step 的输出、AI 的决策
- **随时介入**：用户可以随时暂停 workflow、修改任务方向、添加约束
- **自行编辑**：用户可以直接编辑代码、修改文件、运行命令
- **批准/拒绝/重试**：在关键节点（需求确认、计划确认、代码审查、最终交付），用户可以批准、拒绝或要求重试
- **修改任务方向**：用户可以在任何时候修改 workflow 的目标、约束、优先级

### 3. 多项目管理

- 在一个 IDE 内管理多个项目，每个项目有独立的 workspace、workflow 和角色配置
- 支持跨项目的任务依赖、资源共享和并行执行
- 统一控制台查看所有项目的 workflow 状态、人工审核门和产出

### 4. 调用外部 agentic coding tool

- **逆向接口**：通过逆向工程复刻 Claude Code、Codex、OpenCode 等工具的 agent 架构，在 CodePanion 进程内运行
- **API 调用**：通过 API 调用外部工具的能力（如果它们提供 API）
- **能力编排**：把外部工具当作可编排的能力源，在 workflow 中组合使用

### 5. 用户自行提供 API

- 用户在 `config.json` 中配置自己的模型 API（DeepSeek、OpenAI、Claude、本地模型等）
- 供应商中立，不依赖特定供应商，不锁定用户
- API key 本地存储（0600 权限保护），不上传到任何服务器

### 6. 执行模型：architecture × model 两轴

- **architecture（进程内 harness）**：
  - `shell`：spawn 本地命令（测试、构建等非 AI 步骤）
  - `agent`：进程内 agent 运行时（逆向自 Claude Code 等，支持 tool-use 循环）
- **model（外部 API）**：
  - 用户配置的模型 API（DeepSeek、OpenAI、Claude、本地模型等）
  - 支持同一模型的多角色分工，也支持不同模型在同一 workflow 中协作

## 使用场景

### 场景 1：全自动开发新功能

1. 用户输入：「给这个项目添加用户认证功能」
2. Orchestrator 拆解任务：需求澄清 → 技术方案 → 实现 → 测试 → 审查 → 文档
3. Planner 制定计划：数据库设计、API 设计、前端设计
4. Builder 实现代码：自动编写代码、创建文件、修改配置
5. Tester 运行测试：自动运行测试、发现问题、修复问题
6. Reviewer 审查代码：检查安全性、性能、可维护性
7. Doc Writer 编写文档：API 文档、用户文档、变更记录
8. 用户在关键节点批准：需求确认、计划确认、代码审查、最终交付

### 场景 2：用户介入修改方向

1. AI 正在实现用户认证功能
2. 用户发现 AI 使用了 JWT，但用户想用 Session
3. 用户暂停 workflow，添加约束：「使用 Session 而不是 JWT」
4. AI 重新生成计划，使用 Session 实现
5. 用户批准新计划，AI 继续执行

### 场景 3：用户自行编辑

1. AI 实现了用户认证功能，但用户不满意某个细节
2. 用户直接编辑代码，修改细节
3. 用户继续 workflow，AI 基于用户的修改继续后续步骤

### 场景 4：多项目并行开发

1. 用户同时管理 3 个项目：项目 A、项目 B、项目 C
2. 项目 A：AI 正在实现新功能
3. 项目 B：AI 正在修复 bug
4. 项目 C：AI 正在重构代码
5. 用户在一个 IDE 内查看所有项目的进度，必要时介入

## 使用方式

CodePanion 当前以 Windows 本地图形软件的方式提供使用。

下载或生成便携版后，直接运行：

```text
dist/CodePanion-win-x64/CodePanion.Gui.exe
```

图形界面会自动启动本地 daemon。正常使用不需要先打开终端，也不需要手动执行 `npm run gui:run`、`dotnet run` 或 `codepanion start`。

## 产品边界

CodePanion 是：

- **新的 AI IDE**：AI 自动完成开发工作，用户观察监控和必要时介入
- **全自动 AI 驱动开发**：AI 自行进行角色分工和任务执行
- **用户可介入控制**：随时介入、修改任务方向、自行编辑
- **多项目管理**：在一个 IDE 内管理多个项目
- **供应商中立**：用户自行提供 API，不依赖特定供应商

CodePanion 不是：

- 传统代码编辑器（不和 VS Code / Cursor / Windsurf 在文本编辑体验上正面竞争）
- 模型聊天客户端
- 通用个人 Agent
- 通用启动器
- 系统级进程监控器

CodePanion 当前聚焦于以下核心目标：

> **成为个人开发者的 AI IDE：输入产品目标，AI 自动完成开发工作（角色分工、任务执行、智能决策），用户观察监控项目进程，可以随时介入、修改任务方向、自行编辑。**

## 目标用户

- 需要全自动 AI 驱动开发的个人开发者
- 想要观察监控 AI 开发进程，必要时介入的开发者
- 需要管理多个项目的个人开发者
- 想要使用自己的模型 API（不被供应商锁定）的开发者
- 需要调用外部 agentic coding tool（Codex、Claude Code、OpenCode 等）的开发者

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
