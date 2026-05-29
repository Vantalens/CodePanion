# CodePanion

CodePanion 是一个本地优先、供应商中立、面向个人开发者的 **Agent AI IDE**，同时也是一个 **AI 工作流控制台**。

在个人 AI 开发场景中，用户需要把一个产品目标拆成可执行任务，让不同 AI 角色协作完成规划、编码、测试、审查和文档，并在关键节点由人工审核，最终形成可追踪的产品产出闭环。CodePanion 自身就是 Agent IDE：它通过逆向接口和 API 调用 Codex、Claude Code、OpenCode 等外部 AI 编程工具的能力，把它们当作可编排的能力源（而不是被动监听对象，也不是任务接收方），并把整个过程组织成本地可控的 workflow。

## 核心能力

- 将一个产品目标拆成可审核、可执行、可回收的本地工作流任务
- 支持 `规划 / 实现 / 测试 / 审查 / 文档 / 发布检查` 等 AI 角色分工
- 支持多模型协作，也支持同一模型绑定不同角色、权限和上下文策略
- 在需求确认、计划确认、代码审查和最终验收等节点插入人工审核
- 记录任务拆分、角色执行、人工决策、测试结果、审查意见和最终产出
- 保留现有 `等待我 / 失败 / 需审阅 / 运行中 / 完成` 队列和任务管理动作
- 通过逆向接口 / API / CLI 调用 Codex、Claude Code、OpenCode、本地 CLI/PTY 等外部能力（CodePanion 是调用方，不是监听方，也不是被派活的接收方）
- 在 daemon 或 GUI 重启后恢复最近 workflow 状态，保持连续性

## 使用方式

CodePanion 当前以 Windows 本地图形软件的方式提供使用。

下载或生成便携版后，直接运行：

```text
dist/CodePanion-win-x64/CodePanion.Gui.exe
```

图形界面会自动启动本地 daemon。正常使用不需要先打开终端，也不需要手动执行 `npm run gui:run`、`dotnet run` 或 `codepanion start`。

## 产品边界

CodePanion 是：

- 个人 Agent AI IDE（通过逆向接口调用外部 AI 工具 API 的 IDE）
- AI 工作流控制台（在 IDE 内编排多步骤、多角色、多模型的本地开发流程）

CodePanion 不是：

- 传统编辑器型 AI IDE（不和 VS Code / Trae / Comate 等在代码编辑体验上正面竞争）
- 模型聊天客户端
- 通用个人 Agent
- 通用启动器
- 系统级进程监控器

CodePanion 当前聚焦于以下核心目标：

> **把个人 AI 开发过程收束为本地可控的任务拆分、角色协作、人工审核和产品产出闭环；CodePanion 自己调用外部 AI 能力，而不是把任务派给它们。**

## 目标用户

- 需要把产品想法推进到代码、测试、文档和交付记录的个人开发者
- 同时使用 Codex、Claude Code、OpenCode、VS Code、CLI 等工具的重度本地用户
- 需要多模型协作、角色权限隔离和人工审核节点的 AI 工作流用户

## 当前技术形态

- Windows GUI：WPF + WebView2
- 本地 daemon：Node.js
- 接入方式：本地 workflow、角色配置、本地 CLI/PTY，以及通过逆向接口 / API / SDK 调用 Codex、Claude Code、OpenCode 等外部 AI 编程工具的能力
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
