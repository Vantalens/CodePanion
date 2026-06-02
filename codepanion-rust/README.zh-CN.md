# CodePanion Rust Daemon

[English](README.md) | [简体中文](README.zh-CN.md)

本 workspace 是 CodePanion 的目标 daemon 架构。它用于替换早期 TypeScript daemon，为本地 AI 开发工作流提供更低内存、更快启动、更安全的 Rust 运行时。

## Crate 边界

- `daemon`：进程入口、HTTP/WebSocket server、生命周期。
- `shared`：协议 DTO、版本、通用错误模型。
- `config`：本地配置和模型/provider 设置。
- `model-client`：OpenAI-compatible 模型客户端。
- `providers`：API/CLI/harness provider registry。
- `agent-runtime`：tool-use loop、权限、风险门控。
- `workflow-engine`：workflow 定义、runs、gates、scheduler。
- `storage`：workspace/project stores 和 append-only history。

## Provider Schema

provider crate 定义 CodePanion workflow 使用的 provider schema：

- `id`：稳定 provider 标识，例如 `codex-cli`。
- `kind`：`api`、`cli` 或 `harness`。
- `display_name`：用户可见名称。
- `capabilities`：`read`、`write`、`command`、`network`、`delegate`、`streaming`、`cancel`。
- `permissions`：workspace/command/network/delegation 权限，以及 `requires_human_gate`。
- `runtime`：API base URL、CLI command/args 或进程内 harness 名称。

schema 保持轻依赖，便于稳定验证 daemon contract。

## Provider Registry

`ProviderRegistry` 按稳定 id 注册已验证的 provider definition，拒绝重复 id，并以确定性顺序返回 provider。

`ProviderOutput` 是 provider executor 的标准输出封装：

- `stdout` / `stderr`：捕获的进程或 executor 输出。
- `assistant_text`：模型或 agent 回复文本。
- `artifacts`：delivery note、patch summary、test result、review report 等结构化内容。

## Executors

`execute_cli_provider` 用于运行配置好的 CLI provider command，以接入外部 agentic coding tool。它会把 `cwd` 固定到 workspace root，清理继承环境变量后只注入显式 overrides，通过 stdin 写入 workflow prompt，只接受 allowlist extra args，支持 timeout 和 cancellation，捕获 stdout/stderr，并返回可流式转发的输出事件。

`execute_api_provider` 向配置好的 API provider base URL 发送 JSON，支持显式 Bearer API key 和脱敏请求摘要，带 body context 报告非 2xx 响应，在读取响应时支持取消，解析基础 token usage，并把 SSE `data:` chunk 映射为 stream event。

Harness provider 使用进程内 `HarnessExecutor` 接口。`agent-runtime` 暴露 `InProcessHarness`，把 agent response 映射为 `ProviderOutput`，支持 delegated task，并为高风险请求标记 human gate。

## 内置外部工具 Provider

`default_external_tool_registry()` 包含：

- `codex-cli`：`codex exec`
- `claude-code-cli`：`claude -p`
- `opencode-cli`：`opencode run`

`config::AppConfig::with_default_external_providers()` 会为 bootstrap runtime configuration 加载这些定义。
