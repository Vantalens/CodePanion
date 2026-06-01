# CodePanion Rust Daemon

This workspace is the target daemon architecture for CodePanion.

Initial crate boundaries:

- `daemon`: process entrypoint, HTTP/WebSocket server, lifecycle.
- `shared`: protocol DTOs, version, common error model.
- `config`: local config and model/provider settings.
- `model-client`: OpenAI-compatible model client.
- `providers`: API/CLI/harness provider registry.
- `agent-runtime`: tool-use loop, permissions, risk gates.
- `workflow-engine`: workflow definitions, runs, gates, scheduler.
- `storage`: workspace/project stores and append-only history.

## Provider Schema

The bootstrap provider crate defines the P1 provider schema:

- `id`: stable provider identifier, such as `codex-cli`.
- `kind`: `api`, `cli`, or `harness`.
- `display_name`: user-facing label.
- `capabilities`: `read`, `write`, `command`, `network`, `delegate`, `streaming`, `cancel`.
- `permissions`: granted workspace/command/network/delegation permissions plus `requires_human_gate`.
- `runtime`: API base URL, CLI command/args, or in-process harness name.

The schema is intentionally dependency-free for the P0/P1 bootstrap. JSON loading can be added after the Rust daemon contract stabilizes.

## Provider Registry

`ProviderRegistry` registers validated provider definitions by stable id, rejects duplicate ids, and returns providers in deterministic order. `ProviderOutput` is the bootstrap normalized output envelope for provider executors:

- `stdout` / `stderr`: captured process or executor output.
- `assistant_text`: model or agent response text.
- `artifacts`: typed content such as delivery notes, patch summaries, test results, or review reports.

`execute_cli_provider` is the bootstrap CLI executor for external agentic coding tools. It runs only configured CLI provider commands, pins `cwd` to the workspace root, clears the parent environment before injecting explicit env overrides, writes the workflow prompt to stdin, accepts only allowlisted extra args, supports timeout and pre/run cancellation, captures stdout/stderr, and returns streamable stdout/stderr events for later WebSocket forwarding.

`execute_api_provider` is the bootstrap API executor for external agentic coding tools. It posts JSON to the configured API provider base URL, supports explicit Bearer API keys with redacted request summaries, reports non-2xx responses with body context, honors pre-flight and response-read cancellation, parses basic token usage, and maps SSE `data:` content chunks to stream events.

Harness providers use the in-process `HarnessExecutor` interface. `agent-runtime` now exposes a bootstrap `InProcessHarness` adapter that implements this interface, maps agent responses to `ProviderOutput`, supports delegated tasks, and marks high-risk requests for human gates.

The first built-in external tool providers are available through `default_external_tool_registry()`:

- `codex-cli`: `codex exec`
- `claude-code-cli`: `claude -p`
- `opencode-cli`: `opencode run`

`config::AppConfig::with_default_external_providers()` loads these definitions for bootstrap runtime configuration.
