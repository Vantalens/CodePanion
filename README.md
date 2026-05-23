# CodePanion

CodePanion 是一个本地优先、供应商中立、面向跨软件 / 跨窗口 / 跨项目场景的多任务操作平台。

在多任务并行工作场景中，用户往往需要同时在 VS Code、多开终端、Codex、Claude Code 及其他工具之间切换。任务的等待输入、人工审批、执行失败与完成结果分散在不同窗口中，容易造成阻塞点遗漏与处理延迟。CodePanion 通过统一的图形界面汇聚这些任务，帮助用户在单一工作台中完成查看、提醒、处理与继续执行。

## 核心能力

- 统一汇聚来自多种来源的任务，并在单一界面中集中呈现
- 按 `等待我 / 失败 / 需审阅 / 运行中 / 完成` 的优先级组织任务队列
- 将等待输入、失败状态与关键上下文前置展示，降低遗漏风险
- 折叠命令输出与低价值状态信息，减少主界面干扰
- 支持 `置顶 / 稍后 / 归档 / 恢复 / 批量整理 / 优先级 / 手动排序` 等任务管理动作
- 支持在图形界面中完成必要交互，例如回复、继续执行与复制诊断上下文
- 支持生成面向 `Codex / Claude Code / OpenCode` 的标准化任务转交包
- 支持在图形界面中直接启动任务转交，并跟踪发起转交、确认接手、回流与清除转交等责任状态
- 在 daemon 或 GUI 重启后恢复最近任务状态，保持连续性

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

> **将分散在多个软件、多个窗口与多个项目中的任务集中到一个图形工作台中统一管理。**

## 目标用户

- 同时运行多个 AI 编程任务的个人开发者
- 同时管理多个终端、多个项目与多个窗口的重度本地用户
- 对本地优先、工具中立与能力边界透明有明确要求的任务管理用户

## 当前技术形态

- Windows GUI：WPF + WebView2
- 本地 daemon：Node.js
- 接入方式：CLI/PTTY、Codex Desktop、本地适配器、VS Code 来源事件等
- 数据策略：默认本地保存，不读取 token、cookie、私有插件数据库或全局屏幕内容

## 开发者入口

如需进行构建、开发或集成，请从以下文档进入：

- [安装与构建](docs/INSTALL.md)
- [用户指南](docs/USER_GUIDE.md)
- [开发说明](docs/DEVELOPMENT.md)
- [产品定位](docs/POSITIONING.md)
- [产品路线](docs/PRODUCT_ROADMAP.md)
- [监控来源](docs/MONITORING_SOURCES.md)

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
