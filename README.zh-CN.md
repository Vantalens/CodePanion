# CodePanion

[English](README.md) | [简体中文](README.zh-CN.md)

**本地优先、供应商中立的 AI IDE 与多 Agent 编程工作台。**

CodePanion 面向个人开发者，帮助你在本机多个项目中运行自动化 AI 开发工作流。它把你自己的模型 API、AI 编程工具、本地命令、workflow 自动化、高风险操作确认门和项目产出统一放进一个可观察的桌面工作台。

CodePanion 不是新的聊天窗口，也不是传统代码编辑器。它是一个本地 AI 开发控制层，用来把一个产品目标推进成可计划、可执行、可测试、可审查、可归档的开发工作。

## 为什么需要 CodePanion

- **本地优先开发工作台**：项目、workflow run、gate、artifact、provider 配置和执行历史围绕本地 workspace 管理。
- **自带模型 API**：支持 OpenAI-compatible API、DeepSeek、Claude、本地模型和其他 provider，不做 token 二次分销，也不绑定供应商。
- **多 Agent 编程工作流**：一个任务可以拆分给 Orchestrator、Planner、Builder、Tester、Reviewer、Docs Writer 等角色。
- **多项目执行**：在一个桌面工作台中管理多个项目和多条 workflow。
- **高风险操作人工确认**：低风险步骤可以自动推进；删除文件、危险命令、敏感配置变更、网络动作和 git 历史变更需要用户确认。
- **外部 AI 编程工具接入**：Codex、Claude Code、OpenCode、CLI executor、API provider 和进程内 agent harness 都可以作为 workflow 能力源。

## 适合谁使用

CodePanion 适合这些开发者：

- 同时维护多个本地仓库，希望集中观察 AI 开发进度；
- 已经使用 AI 编程工具，希望减少在终端、IDE 和独立 AI 工具之间来回切换；
- 想要本地优先自动化，同时对高风险操作保留明确确认权；
- 希望使用自己的模型账号和 API key；
- 需要实际面向开发任务的 AI workflow 系统，而不是通用聊天机器人。

## 核心工作流

```text
目标 -> 计划 -> 实现 -> 测试 -> 审查 -> 人工确认 -> 产出归档 -> 交付
```

一个 workflow 可以把不同角色分配给不同模型或工具。例如，一个 provider 负责制定计划，另一个 provider 修改代码，shell step 运行测试，Reviewer 角色在交付前审查结果。

## 当前状态

CodePanion 正在从早期 TypeScript daemon 迁移到 Rust daemon。Rust daemon 是当前产品主线，目标是降低内存占用、提升启动速度、强化执行安全，并提供更稳定的多任务调度能力。

当前 Rust daemon 验证结果：

| 指标 | 结果 |
|---|---:|
| 空闲内存 | 约 11.82 MB |
| daemon 二进制大小 | 约 3.98 MB |
| 核心 HTTP API 测试 | 100% 通过 |
| Workflow 执行端到端测试 | 100% 通过 |

Windows 桌面界面使用 WPF + WebView2。TypeScript daemon 仍作为过渡实现和行为兼容基线保留；目标运行时是 Rust。

## 使用 CodePanion

### Windows 桌面应用

普通用户推荐从 Windows 便携版进入：

```text
CodePanion.Gui.exe
```

桌面应用提供项目管理、全局 workflow 视图、run 时间线、artifact 预览、human gate 决策和 provider 配置。

### Rust Daemon

开发者可以从源码运行 Rust daemon：

```bash
cd codepanion-rust
cargo run --release --bin codepanion-daemon -- --serve 7777
```

健康检查：

```bash
curl http://localhost:7777/health
```

构建 CLI：

```bash
cd codepanion-rust
cargo build --release --bin codepanion
```

常用 CLI 命令：

```bash
codepanion provider list
codepanion provider switch <provider-id>
codepanion model list
```

## 产品边界

CodePanion 是：

- 本地优先的 AI 开发工作台；
- 面向个人软件开发的多 Agent workflow 系统；
- 模型 API、AI 编程工具、本地工具和项目产出的协调层；
- 让用户保留高风险操作控制权的桌面工作台。

CodePanion 不是：

- 传统代码编辑器；
- 通用 AI 聊天客户端；
- token 分销平台；
- 通用个人助手；
- 企业审批系统；
- 系统进程监控器。

## 安全原则

- API key 保存在本地配置中。
- CodePanion 不读取外部工具的私有 token、cookie、插件数据库、闭源内部状态或全局屏幕内容。
- CLI 执行必须有受控工作目录、参数边界、超时、取消、输出捕获和风险分级。
- 高风险操作必须经过 human gate。

## 文档

- [安装说明](docs/INSTALL.md)
- [开发指南](docs/DEVELOPMENT.md)
- [产品定位](docs/POSITIONING.md)
- [产品路线](docs/PRODUCT_ROADMAP.md)
- [架构设计](docs/ARCHITECTURE.md)
- [本地 AI 工作流](docs/LOCAL_AI_WORKFLOW.md)
- [Rust 迁移指南](docs/RUST_MIGRATION_GUIDE.md)

## 从源码构建

```bash
npm install
npm run build
npm run package:windows
```

Rust 检查：

```bash
cd codepanion-rust
cargo fmt --all
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## 仓库结构

```text
CodePanion/
├── codepanion-rust/   # Rust daemon、workflow engine、provider、agent runtime
├── packages/
│   ├── daemon/        # TypeScript 过渡 daemon 和行为基线
│   └── gui/           # Windows WPF + WebView2 桌面应用
├── docs/              # 产品、架构、开发和迁移文档
├── scripts/           # 构建、打包和验证脚本
└── README.md
```

## License

MIT
