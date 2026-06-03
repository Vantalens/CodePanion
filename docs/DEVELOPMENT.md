# CodePanion 开发指南

本文档面向参与 CodePanion 开发的工程师。当前主线是 Rust daemon 驱动的本地全自动 AI IDE：多项目、多任务、多 AI 角色协作、显式 human gate、artifact/delivery 归档和本地 provider 配置。

旧 TypeScript daemon 只保留为兼容基线，不再是 GUI 启动、打包或新功能开发的默认入口。

## 环境要求

- Rust stable toolchain
- Node.js 24.x，用于 Tauri/React GUI、保留的 TypeScript 兼容测试和历史包构建
- WebView2 Runtime（仅 legacy WPF GUI 需要）
- Git

## 项目结构

```text
CodePanion/
├── codepanion-rust/
│   ├── crates/daemon/          # axum HTTP/WS daemon, Rust CLI, GUI-facing API
│   ├── crates/workflow-engine/ # project/provider/config/workflow/scheduler stores
│   ├── crates/agent-runtime/   # tool-use loop and in-process harness
│   ├── crates/providers/       # CLI/API/harness provider executors
│   ├── crates/model-client/    # OpenAI-compatible client
│   ├── crates/config/          # bootstrap config helpers
│   └── crates/shared/          # shared errors/version/contracts
├── packages/gui/               # Tauri + React desktop workspace
├── packages/gui-wpf-legacy/    # legacy WPF + WebView2 desktop workspace
├── packages/daemon/            # legacy TypeScript daemon compatibility baseline
├── docs/
└── scripts/
```

## Common Commands

Rust daemon and CLI:

```bash
cd codepanion-rust
cargo run --release --bin codepanion-daemon -- --serve 8318
cargo run --release --bin codepanion -- --api-url http://127.0.0.1:8318 status
```

Rust verification:

```bash
cd codepanion-rust
cargo fmt --all
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build --release --bin codepanion-daemon --bin codepanion
```

GUI and package:

```bash
npm --prefix packages/gui test
npm --prefix packages/gui run test:visual
npm run gui:build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-portable-package.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-gui-cli.ps1
```

Legacy Node compatibility baseline:

```bash
npm test
```

## Development Rules

- Put new daemon, workflow, provider, scheduler, CLI, and config behavior in `codepanion-rust`.
- GUI startup must prefer the packaged Rust daemon at `daemon/codepanion-daemon.exe`; the Tauri shell owns daemon startup and shutdown for GUI-launched daemons.
- New provider/CLI behavior needs Rust integration tests under `codepanion-rust/crates/daemon/tests/`.
- API additions must update `docs/API.md` and, when user-facing, `docs/INSTALL.md` or `README.md`.
- High-risk file, shell, network, secret, and git-history actions must stay behind explicit risk classification and human gates.

## Release Gate

Before marking release-quality work complete, run:

```bash
npm test
cd codepanion-rust
cargo fmt --all
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build --release --bin codepanion-daemon --bin codepanion
cd ..
npm --prefix packages/gui test
npm --prefix packages/gui run test:visual
npm run gui:build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-portable-package.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-gui-cli.ps1
git diff --check
```

## Debugging

Start a daemon on a non-default port:

```bash
cd codepanion-rust
cargo run --bin codepanion-daemon -- --serve 7777
```

Probe API health:

```bash
curl http://127.0.0.1:7777/health
```

Run CLI against that daemon:

```bash
codepanion --api-url http://127.0.0.1:7777 provider list
codepanion --api-url http://127.0.0.1:7777 model alias fast gpt-4o-mini
codepanion --api-url http://127.0.0.1:7777 config set-effort high
```

## Documentation

- Product direction: [POSITIONING.md](POSITIONING.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- API: [API.md](API.md)
- Current task source of truth: [../DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md)
