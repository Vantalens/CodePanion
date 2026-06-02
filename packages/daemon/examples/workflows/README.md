# CodePanion Workflow Examples

[English](README.md) | [简体中文](README.zh-CN.md)

This directory contains ready-to-import multi-step workflow templates for CodePanion.

Use `codepanion workflow import --file <json>` to load an example into the local workflow store (`~/.codepanion/workflows.json`), then run it with `codepanion workflow run <name>`. While the workflow runs, step progress is forwarded through the daemon event bus for the GUI.

## Templates

| File | Name | Purpose |
| --- | --- | --- |
| [`codex-then-claude-review.json`](./codex-then-claude-review.json) | `codex-then-claude-review` | Codex drafts changes, a human checkpoint pauses execution, then Claude Code reviews the result. |
| [`build-test-audit.json`](./build-test-audit.json) | `build-test-audit` | Local pre-delivery build, test, and audit export. |

## Usage

```powershell
# Import an example
codepanion workflow import --file packages/daemon/examples/workflows/build-test-audit.json

# Inspect a workflow
codepanion workflow show build-test-audit

# Dry run: parse steps without executing commands
codepanion workflow run build-test-audit --dry-run

# Execute; checkpoint steps pause unless --yes is provided
codepanion workflow run codex-then-claude-review --yes --set feature=add-dark-mode

# Reuse parameters from a previous run
codepanion workflow replay <runId>
```

## Customization

`workflow import` accepts three JSON shapes:

- A single workflow object: `{ "name": "...", "steps": [...] }`
- An array: `[ { "name": "..." }, { "name": "..." } ]`
- An object with a `workflows` key: `{ "workflows": [ ... ] }`

Each step requires at least `id` plus `command` or `template`. Optional fields include `tool`, `args`, `values`, `dependsOn`, and `checkpoint`.

Parameter parsing uses `{param}` placeholders. Runtime values can be supplied with `--set key=value`; otherwise defaults from the `params` block are used.

## GUI Integration

When the daemon is online, `codepanion workflow run` / `replay` registers a temporary source (`kind=cli`, `name=workflow:<name>`) and pushes step start / finish / failure / checkpoint events to the GUI activity stream. When the run finishes, the source disconnects automatically. If the daemon is offline, the command falls back to pure CLI behavior.
