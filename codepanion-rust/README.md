# CodePanion Rust Daemon

[English](README.md) | [简体中文](README.zh-CN.md)

This workspace is the target daemon architecture for CodePanion. It replaces the early TypeScript daemon with a lower-memory, faster, safer Rust runtime for local AI development workflows.

## Crate Boundaries

- `daemon`: process entrypoint, HTTP/WebSocket server, lifecycle.
- `shared`: protocol DTOs, version, common error model.
- `config`: local config and model/provider settings.
- `model-client`: OpenAI-compatible model client.
- `providers`: API/CLI/harness provider registry.
- `agent-runtime`: tool-use loop, permissions, risk gates.
- `workflow-engine`: workflow definitions, runs, gates, scheduler.
- `storage`: workspace/project stores and append-only history.

## Provider Schema

The provider crate defines the provider schema used by CodePanion workflows:

- `id`: stable provider identifier, such as `codex-cli`.
- `kind`: `api`, `cli`, or `harness`.
- `display_name`: user-facing label.
- `capabilities`: `read`, `write`, `command`, `network`, `delegate`, `streaming`, `cancel`.
- `permissions`: granted workspace/command/network/delegation permissions plus `requires_human_gate`.
- `runtime`: API base URL, CLI command/args, or in-process harness name.

The schema stays dependency-light so the daemon contract remains easy to validate.

## Provider Registry

`ProviderRegistry` registers validated provider definitions by stable id, rejects duplicate ids, and returns providers in deterministic order.

`ProviderOutput` is the normalized output envelope for provider executors:

- `stdout` / `stderr`: captured process or executor output.
- `assistant_text`: model or agent response text.
- `artifacts`: typed content such as delivery notes, patch summaries, test results, or review reports.

## Executors

`execute_cli_provider` runs configured CLI provider commands for external agentic coding tools. It pins `cwd` to the workspace root, clears inherited environment variables before injecting explicit overrides, writes the workflow prompt to stdin, accepts only allowlisted extra args, supports timeout and cancellation, captures stdout/stderr, and returns streamable output events.

`execute_api_provider` posts JSON to configured API provider base URLs, supports explicit Bearer API keys with redacted request summaries, reports non-2xx responses with body context, honors cancellation while reading responses, parses basic token usage, and maps SSE `data:` chunks to stream events.

Harness providers use the in-process `HarnessExecutor` interface. `agent-runtime` exposes `InProcessHarness`, maps agent responses to `ProviderOutput`, supports delegated tasks, and marks high-risk requests for human gates.

## Built-In External Tool Providers

`default_external_tool_registry()` includes:

- `codex-cli`: `codex exec`
- `claude-code-cli`: `claude -p`
- `opencode-cli`: `opencode run`

`config::AppConfig::with_default_external_providers()` loads these definitions for bootstrap runtime configuration.
