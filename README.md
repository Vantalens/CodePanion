# CodePanion

[English](README.md) | [简体中文](README.zh-CN.md)

**Local-first AI IDE and multi-agent coding workspace for developers.**

CodePanion helps individual developers run autonomous AI development workflows across local projects. It connects your own model APIs, coding agents, local tools, workflow automation, human approval gates, and project artifacts into one observable desktop workspace.

CodePanion is not another chat window and it is not a traditional code editor. It is a local AI development control layer for turning a product goal into planned, executed, tested, reviewed, and archived development work.

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

## License

MIT
