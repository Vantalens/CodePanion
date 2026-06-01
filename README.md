# CodePanion

CodePanion 是一个**本地优先、轻量高性能的新 AI IDE**，专为个人开发者设计，目标是用 Rust daemon 承载**全自动 AI 驱动开发**、**多 AI 角色分工**和**多项目/多任务同步开发管理**。

> 当前开发主线：先完成 Rust 重构技术验证与核心模块迁移，再把全自动本地 AI 工作流、多角色协作、高危行为审核门和多项目并行调度做成可真实使用的闭环。现有 Node daemon + WPF/WebView2 GUI 是过渡实现和行为基线，不是最终性能架构。

## 核心特点

1. **Rust 轻量高性能**：daemon 目标 < 50MB 空闲内存、< 500ms 冷启动、二进制 < 20MB
2. **本地全自动 AI 开发工作流**：输入目标后，AI 自动拆解、计划、实现、测试、审查、文档和归档
3. **多 AI 角色分工**：Orchestrator、Planner、Builder、Tester、Reviewer、Docs Writer 可绑定不同模型或能力源协作
4. **AI 自主审核 + 高危门控**：低危开发动作自动推进，高危行为交给用户判断
5. **多项目/多任务同步开发**：一个 IDE 同时管理多个项目、多个 workflow、全局 runs/gates/队列
6. **用户自行提供 API**：支持 DeepSeek、OpenAI、Claude、本地模型等，不做 token 二次分销
7. **外部 agentic coding tool 调用能力**：必须能把 Codex、Claude Code、OpenCode 等作为 workflow 角色的能力源，通过公开 API、CLI executor 或进程内复刻的 agent 架构调用

## 性能指标

### Rust daemon 目标
- daemon 空闲：< 50MB
- 运行 1 个 workflow：< 300MB
- 多项目/多任务并行：< 500MB
- 二进制：< 20MB

### 硬盘占用
- 安装包（压缩）：< 30MB
- 安装后：< 100MB
- 日志和缓存：< 50MB（自动清理）

### 启动时间
- daemon 冷启动：< 500ms
- daemon 热启动：< 100ms
- GUI 总冷启动：< 3s
- GUI 热启动：< 1s

### 执行延迟
- workflow 启动延迟：< 50ms
- step 执行延迟：< 20ms（不含模型 API 调用）
- 实时输出延迟：< 5ms
- GUI 更新延迟：< 16ms（60fps）

## 核心能力

### 1. 轻量高性能

- **内存占用极低**：daemon < 100MB（空闲）、GUI < 50MB（空闲）、运行 workflow < 500MB
- **硬盘占用低**：安装包 < 50MB、安装后 < 150MB、不内置模型和大型依赖
- **性能极强**：启动时间 < 3s、workflow 启动延迟 < 100ms、实时输出延迟 < 10ms
- **启动快速**：冷启动 < 3s、热启动 < 1s

### 2. 全自动 AI 驱动开发

- **AI 自行角色分工**：Orchestrator 拆解任务 → Planner 制定计划 → Builder 实现代码 → Tester 运行测试 → Reviewer 审查代码 → Doc Writer 编写文档
- **自动任务执行**：AI 自动执行每个角色的任务，无需用户手动触发每一步
- **智能决策**：AI 根据上一步的结果自动决定下一步（例如测试失败 → 自动修复 → 重新测试）
- **持续运行**：workflow 可以持续运行，直到完成或遇到高危行为

### 3. AI 自主审核

- **AI 自己审核代码**：Reviewer 角色自动审查代码的安全性、性能、可维护性
- **只有高危行为才需要用户判断**：
  - 删除文件/目录
  - 修改关键配置（数据库连接、API key、权限配置）
  - 执行危险命令（rm -rf、格式化磁盘、修改系统配置）
  - 网络请求（发送数据到外部服务器）
  - 修改 git 历史（rebase、force push）
- **低危行为自动通过**：
  - 创建文件/目录
  - 修改代码
  - 运行测试
  - 提交代码
  - 编写文档
- **AI 自动修复问题**：测试失败 → AI 自动分析 → AI 自动修复 → 重新测试

### 4. 用户操作简单

- **输入目标**：用户只需输入一句话，例如「给这个项目添加用户认证功能」
- **观察监控**：用户通过 GUI 实时查看 workflow 进度、每个 step 的输出、AI 的决策
- **必要时介入**：只有高危行为才需要用户判断，其他时候 AI 自动完成
- **无需复杂配置**：
  - 默认配置开箱即用
  - 只需配置模型 API（一次性）
  - 不需要配置角色、权限、上下文策略（使用默认值）
  - 不需要手动编写 workflow 定义（AI 自动生成）

### 5. 多项目管理

- 在一个 IDE 内管理多个项目，每个项目有独立的 workspace、workflow 和角色配置
- 支持跨项目的任务依赖、资源共享和并行执行
- 统一工作台查看所有项目的 workflow 状态、高危行为审核门、全局队列和产出

### 6. 调用外部 agentic coding tool

外部 agentic coding tool 是 CodePanion 的一等能力源。CodePanion 不替代 Codex、Claude Code、OpenCode，而是把它们纳入本地 workflow：

- **公开 API 调用**：外部工具提供稳定 API 时，作为 provider client 接入 workflow step。
- **CLI executor 调用**：外部工具只提供 CLI 时，以受控 `cwd`、参数白名单、超时、取消和输出捕获运行。
- **进程内架构复刻**：研究 Claude Code、Codex、OpenCode 的 agent/tool-use 结构，把可复用的 agent 架构实现到 CodePanion daemon 内。
- **能力编排**：Planner、Builder、Tester、Reviewer 等角色可以绑定不同模型或外部工具；一个 workflow 可组合多个能力源。
- **安全边界**：不读取 token、cookie、插件私有数据库、闭源工具私有状态或全局屏幕内容；网络/API/命令调用按权限和高危行为门控。

### 7. 用户自行提供 API

- 用户在 `config.json` 中配置自己的模型 API（DeepSeek、OpenAI、Claude、本地模型等）
- 供应商中立，不依赖特定供应商，不锁定用户
- API key 本地存储（0600 权限保护），不上传到任何服务器

## 使用场景

### 场景 1：全自动开发新功能（AI 自主审核）

1. 用户输入：「给这个项目添加用户认证功能」
2. Orchestrator 拆解任务：需求澄清 → 技术方案 → 实现 → 测试 → 审查 → 文档
3. Planner 制定计划：数据库设计、API 设计、前端设计
4. Builder 实现代码：自动编写代码、创建文件、修改配置
5. Tester 运行测试：自动运行测试、发现问题、修复问题
6. Reviewer 审查代码：检查安全性、性能、可维护性（AI 自主审核，自动通过）
7. Doc Writer 编写文档：API 文档、用户文档、变更记录
8. **用户只在高危行为时介入**：例如删除旧的认证代码、修改数据库配置

### 场景 2：用户介入修改方向

1. AI 正在实现用户认证功能
2. 用户发现 AI 使用了 JWT，但用户想用 Session
3. 用户暂停 workflow，添加约束：「使用 Session 而不是 JWT」
4. AI 重新生成计划，使用 Session 实现
5. AI 继续执行，AI 自主审核，自动通过

### 场景 3：高危行为需要用户判断

1. AI 实现了用户认证功能，需要删除旧的认证代码
2. AI 检测到高危行为：删除文件 `old-auth.js`
3. GUI 弹出审核门：「AI 想要删除文件 old-auth.js，是否允许？」
4. 用户查看文件内容，确认可以删除，点击「允许」
5. AI 继续执行

### 场景 4：多项目并行开发（轻量高性能）

1. 用户同时管理 3 个项目：项目 A、项目 B、项目 C
2. 项目 A：AI 正在实现新功能
3. 项目 B：AI 正在修复 bug
4. 项目 C：AI 正在重构代码
5. CodePanion 内存占用 < 500MB，性能流畅
6. 用户在一个 IDE 内查看所有项目的进度，只在高危行为时介入

## 使用方式

CodePanion 提供两种使用方式：

### 1. GUI 应用（主要方式）
Windows 本地图形软件，提供完整的可视化界面。

### 2. CLI 工具（辅助方式）
命令行工具，用于快速管理 provider、模型和配置。

#### 安装 CLI
```bash
cd codepanion-rust
cargo build --release --bin codepanion
# 二进制文件位于 target/release/codepanion
```

#### 快速开始
```bash
# 启动 daemon
codepanion-daemon --serve

# 查看所有 provider
codepanion provider list

# 切换 provider
codepanion provider switch deepseek-main

# 导入 CC Switch 配置
codepanion provider import --source ccm

# 查看所有可用模型
codepanion model list
```

详细文档：[CLI 使用指南](docs/CLI.md)

下载或生成便携版后，直接运行：

```text
dist/CodePanion-win-x64/CodePanion.Gui.exe
```

图形界面会自动启动本地 daemon。正常使用不需要先打开终端，也不需要手动执行 `npm run gui:run`、`dotnet run` 或 `codepanion start`。

## 产品边界

CodePanion 是：

- **轻量高性能的新 AI IDE**：内存占用极低、硬盘占用低、启动快速、性能极强
- **全自动 AI 驱动开发**：AI 自行进行角色分工和任务执行，AI 自主审核代码
- **用户操作简单**：输入目标 → 观察监控 → 必要时介入，无需复杂配置
- **多项目管理**：在一个 IDE 内管理多个项目
- **供应商中立**：用户自行提供 API，不依赖特定供应商

CodePanion 不是：

- 传统代码编辑器（不和 VS Code / Cursor / Windsurf 在文本编辑体验上正面竞争）
- 重量级 IDE（不内置代码编辑器、调试器、终端、git GUI）
- 模型聊天客户端
- 通用个人 Agent
- 通用启动器
- 系统级进程监控器

CodePanion 当前聚焦于以下核心目标：

> **成为个人开发者的轻量高性能 AI IDE：输入产品目标，AI 自动完成开发工作（角色分工、任务执行、自主审核），用户观察监控项目进程，只在高危行为时介入。**

## 目标用户

- 需要轻量高性能 AI IDE 的个人开发者
- 需要全自动 AI 驱动开发的个人开发者
- 想要简单操作（输入目标 → 观察监控 → 必要时介入）的开发者
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
- 性能优化：按需加载、进程内运行、流式处理、自动清理、异步 I/O、并行执行、缓存优化

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
