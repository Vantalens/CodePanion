# CodePanion

**Local-first AI IDE and multi-agent coding workspace for developers.**

CodePanion helps individual developers run autonomous AI development workflows across local projects. It connects your own model APIs, coding agents, local tools, workflow automation, human approval gates, and project artifacts into one observable desktop workspace.

CodePanion is not another chat window and it is not a traditional code editor. It is a local AI development control layer for turning a product goal into planned, executed, tested, reviewed, and archived development work.

[中文介绍](#中文介绍)

## Why CodePanion

- **Local-first development workspace**: projects, workflow runs, gates, artifacts, provider settings, and execution history are managed around local workspaces.
- **Bring your own model API**: use OpenAI-compatible APIs, DeepSeek, Claude, local models, or other providers without token resale or vendor lock-in.
- **Multi-agent coding workflows**: split one task across roles such as Orchestrator, Planner, Builder, Tester, Reviewer, and Docs Writer.
- **Multi-project execution**: manage several projects and workflow runs from one desktop workspace.
- **Human gates for risky actions**: low-risk steps can continue automatically; file deletion, dangerous commands, sensitive config changes, network actions, and git history changes require approval.
- **External coding agent integration**: connect tools such as Codex, Claude Code, OpenCode, CLI executors, API providers, and in-process agent harnesses as workflow capabilities.

## Who It Is For

CodePanion is built for developers who:

- work on multiple local repositories and want one place to watch AI development progress;
- already use coding agents and want to coordinate them instead of switching between terminals, IDEs, and standalone AI tools;
- prefer local-first automation with explicit approval for high-risk actions;
- want to use their own model accounts and API keys;
- need a practical AI development workflow system rather than a general chatbot.

## Core Workflow

```text
Goal -> Plan -> Build -> Test -> Review -> Human Gate -> Artifacts -> Delivery
```

A workflow can assign different roles to different models or tools. For example, one provider can plan, another can edit code, a shell step can run tests, and a reviewer role can inspect the result before delivery.

## Current Status

CodePanion is moving from an early TypeScript daemon to a Rust daemon. The Rust daemon is the current product direction and is designed for lower memory usage, faster startup, safer execution, and better multi-task scheduling.

Current Rust daemon validation:

| Metric | Result |
|---|---:|
| Idle memory | ~11.82 MB |
| Daemon binary size | ~3.98 MB |
| Core HTTP API tests | 100% passing |
| Workflow execution end-to-end tests | 100% passing |

The Windows desktop UI uses WPF + WebView2. The TypeScript daemon remains as a transition baseline for behavior compatibility; the target runtime is Rust.

## Use CodePanion

### Windows Desktop App

For users, the recommended entry is the Windows portable desktop app:

```text
CodePanion.Gui.exe
```

The app provides project management, global workflow views, run timelines, artifact previews, human gate decisions, and provider configuration.

### Rust Daemon

Developers can run the Rust daemon from source:

```bash
cd codepanion-rust
cargo run --release --bin codepanion-daemon -- --serve 7777
```

Health check:

```bash
curl http://localhost:7777/health
```

Build the CLI:

```bash
cd codepanion-rust
cargo build --release --bin codepanion
```

Common CLI commands:

```bash
codepanion provider list
codepanion provider switch <provider-id>
codepanion model list
```

## Product Boundaries

CodePanion is:

- a local-first AI development workspace;
- a multi-agent workflow system for personal software development;
- a coordination layer for model APIs, coding agents, local tools, and project artifacts;
- a desktop workspace that keeps humans in control of high-risk operations.

CodePanion is not:

- a traditional code editor;
- a generic AI chatbot;
- a token resale platform;
- a general personal assistant;
- an enterprise approval system;
- a system process monitor.

## Security Principles

- API keys stay in local configuration.
- CodePanion does not read private tokens, cookies, extension databases, closed-source internal states, or global screen contents from external tools.
- CLI execution must use controlled working directories, argument boundaries, timeouts, cancellation, output capture, and risk classification.
- High-risk operations must pass through a human gate.

## Documentation

- [Installation](docs/INSTALL.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Product Positioning](docs/POSITIONING.md)
- [Product Roadmap](docs/PRODUCT_ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Local AI Workflow](docs/LOCAL_AI_WORKFLOW.md)
- [Rust Migration Guide](docs/RUST_MIGRATION_GUIDE.md)

## Build From Source

```bash
npm install
npm run build
npm run package:windows
```

Rust checks:

```bash
cd codepanion-rust
cargo fmt --all
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## Repository Structure

```text
CodePanion/
├── codepanion-rust/   # Rust daemon, workflow engine, providers, agent runtime
├── packages/
│   ├── daemon/        # TypeScript transition daemon and behavior baseline
│   └── gui/           # Windows WPF + WebView2 desktop app
├── docs/              # Product, architecture, development, and migration docs
├── scripts/           # Build, packaging, and validation scripts
└── README.md
```

## 中文介绍

CodePanion 是一个本地优先、供应商中立的 AI 开发工作台，面向希望在一台电脑上同时管理多个项目、多个 AI 编程工具和多条开发任务的个人开发者。

它不是新的聊天窗口，也不是传统代码编辑器。CodePanion 的目标是把一次开发任务从“输入目标”推进到“计划、执行、测试、审查、产出归档”，并在需要人工判断的高风险操作前停下来让用户确认。

### 核心能力

- **本地优先**：项目配置、workflow 状态、运行产出、模型配置和任务记录围绕本地 workspace 管理。
- **供应商中立**：用户自行配置模型 API，不内置模型、不转售 token、不锁定供应商。
- **多 AI 角色分工**：Orchestrator、Planner、Builder、Tester、Reviewer、Docs Writer 可以绑定不同模型或外部工具。
- **多项目 / 多任务并行**：在一个工作台中查看全局 runs、gates、队列、项目状态和任务产出。
- **高风险操作门控**：删除文件、修改关键配置、危险命令、外部网络请求、git 历史改写等动作交给用户确认。
- **外部 AI 编程工具接入**：Codex、Claude Code、OpenCode、CLI executor、API provider 和本地 agent harness 都可以作为 workflow 能力源。

### 适合用户

- 同时维护多个本地项目，希望集中查看任务进度、运行状态和待处理事项的开发者。
- 已经在使用 Codex、Claude Code、OpenCode 或其他 AI 编程工具，希望把它们纳入同一个本地工作流的人。
- 希望使用自己的模型 API，而不是被某个模型供应商或 token 分销方式绑定的用户。
- 想要让 AI 自动拆解、实现、测试和审查开发任务，但仍保留关键操作确认权的个人开发者。

## License

MIT
