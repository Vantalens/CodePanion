# CodePanion 安装指南

CodePanion 当前推荐入口是 Windows 便携版 GUI。GUI 会自动启动随包提供的 Rust daemon；普通用户不需要安装 Node.js 或手动启动 daemon。

## 系统要求

- Windows 10/11 64-bit
- WebView2 Runtime（仅 legacy WPF GUI 需要）
- 4 GB RAM 或以上
- 首次配置 provider 时需要可访问对应模型 API

源码开发还需要：

- Rust stable toolchain
- Node.js 24.x，用于 Tauri/React GUI 和保留的 TypeScript 兼容测试

## 使用 Windows 便携版

构建便携包：

```powershell
npm install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1
```

输出目录：

```text
dist/CodePanion-win-x64/
```

双击启动：

```text
CodePanion.exe
```

便携包必须包含：

```text
CodePanion.exe
codepanion-cli.exe
daemon/codepanion-daemon.exe
README_START.txt
```

验证便携包：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-portable-package.ps1
```

## 从源码运行

构建 Rust daemon 和 CLI：

```powershell
cd codepanion-rust
cargo build --release --bin codepanion-daemon --bin codepanion
```

启动 daemon：

```powershell
target\release\codepanion-daemon.exe --serve 8318
```

健康检查：

```powershell
Invoke-WebRequest http://127.0.0.1:8318/health
```

运行 CLI：

```powershell
target\release\codepanion.exe --api-url http://127.0.0.1:8318 status
target\release\codepanion.exe --api-url http://127.0.0.1:8318 provider list
target\release\codepanion.exe --api-url http://127.0.0.1:8318 model list
```

构建 GUI：

```powershell
npm run gui:build
```

开发环境中 GUI 会优先查找：

```text
codepanion-rust/target/release/codepanion-daemon.exe
codepanion-rust/target/debug/codepanion-daemon.exe
```

也可以用环境变量指定 daemon：

```powershell
$env:CODEPANION_DAEMON_PATH="D:\CodePanion\codepanion-rust\target\release\codepanion-daemon.exe"
```

旧 Node daemon 只在显式设置下面变量时作为开发回退：

```powershell
$env:CODEPANION_ENABLE_LEGACY_NODE_DAEMON="1"
```

## 配置 Provider 和模型

通过 GUI 设置页配置 provider，或使用 CLI：

```powershell
codepanion --api-url http://127.0.0.1:8318 provider add openai-main `
  --name "OpenAI Main" `
  --provider-type openai_compatible `
  --api-key "sk-..." `
  --base-url "https://api.openai.com/v1" `
  --default-model "gpt-4o-mini"

codepanion --api-url http://127.0.0.1:8318 provider switch openai-main
codepanion --api-url http://127.0.0.1:8318 model alias fast gpt-4o-mini
codepanion --api-url http://127.0.0.1:8318 config set-model gpt-4o-mini
codepanion --api-url http://127.0.0.1:8318 config set-effort high
```

本地配置默认写入：

```text
%USERPROFILE%\.codepanion\
```

## 验证

运行完整开发验证：

```powershell
npm test
cd codepanion-rust
cargo fmt --all
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build --release --bin codepanion-daemon --bin codepanion
cd ..
npm run gui:build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-gui-cli.ps1
git diff --check
```

## 故障排查

- GUI 显示未连接：确认 `daemon/codepanion-daemon.exe` 存在，或先运行 `cargo build --release --bin codepanion-daemon`。
- CLI 连接失败：给 CLI 加 `--api-url http://127.0.0.1:<port>`，并确认 `/health` 可访问。
- WebView2 缺失：仅影响 legacy WPF GUI；默认 Tauri GUI 不以 WPF/WebView2 项目作为入口。
- Provider 测试失败：检查 API key、base URL、网络代理和默认模型名称。
- 便携包校验失败：重新运行 `scripts/package-windows.ps1`，不要手工混入旧 `daemon.cjs`、`node_modules` 或 `runtime/node.exe`。

## 下一步

- [项目概述](../README.md)
- [文档中心](README.md)
- [API 文档](API.md)
- [开发指南](DEVELOPMENT.md)
- [Rust 迁移指南](RUST_MIGRATION_GUIDE.md)
