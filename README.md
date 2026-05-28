# CodePanion

CodePanion 是一个本地优先、供应商中立、面向个人开发者的 AI 工作流操作台。

在个人 AI 开发场景中，用户需要把一个产品目标拆成可执行任务，让不同 AI 角色协作完成规划、编码、测试、审查和文档，并在关键节点由人工审核，最终形成可追踪的产品产出闭环。CodePanion 的方向是保留本地 daemon、GUI 和 workflow 基础，放弃外部监听路线，专注自己掌控的本地 AI 工作流。

## 核心能力

- 将一个产品目标拆成可审核、可执行、可回收的本地工作流任务
- 支持 `规划 / 实现 / 测试 / 审查 / 文档 / 发布检查` 等 AI 角色分工
- 支持多模型协作，也支持同一模型绑定不同角色、权限和上下文策略
- 在需求确认、计划确认、代码审查和最终验收等节点插入人工审核
- 记录任务拆分、角色执行、人工决策、测试结果、审查意见和最终产出
- 保留现有 `等待我 / 失败 / 需审阅 / 运行中 / 完成` 队列和任务管理动作
- 将 Codex、Claude Code、OpenCode、CLI/PTTY 等作为 workflow 执行器，而不是监听对象
- 在 daemon 或 GUI 重启后恢复最近 workflow 状态，保持连续性

## 使用方式

CodePanion 当前以 Windows 本地图形软件的方式提供使用。

下载或生成便携版后，直接运行：

```text
dist/CodePanion-win-x64/CodePanion.Gui.exe
```

图形界面会自动启动本地 daemon。正常使用不需要先打开终端，也不需要手动执行 `npm run gui:run`、`dotnet run` 或 `codepanion start`。

## 产品边界

CodePanion 不是：

- 完整 AI IDE
- 模型聊天客户端
- 通用个人 Agent
- 通用启动器
- 系统级进程监控器

CodePanion 当前聚焦于以下核心目标：

> **把个人 AI 开发过程收束为本地可控的任务拆分、角色协作、人工审核和产品产出闭环。**

## 目标用户

- 需要把产品想法推进到代码、测试、文档和交付记录的个人开发者
- 同时使用 Codex、Claude Code、OpenCode、VS Code、CLI 等工具的重度本地用户
- 需要多模型协作、角色权限隔离和人工审核节点的 AI 工作流用户

## 当前技术形态

- Windows GUI：WPF + WebView2
- 本地 daemon：Node.js
- 接入方式：本地 workflow、角色配置、CLI/PTTY 执行器、Codex / Claude Code / OpenCode 任务执行等
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
│   ├── daemon/   # 本地 daemon、CLI、workflow 模型、接入层
│   └── gui/      # Windows 图形界面
├── docs/         # 产品、安装、开发、路线文档
└── scripts/      # 打包与辅助脚本
```

## 许可证

MIT
