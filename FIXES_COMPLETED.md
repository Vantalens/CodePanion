# Issues and Vulnerabilities Status

**Date**: 2026-06-04

## Fixed and Verified

- NPM dependency vulnerabilities: upgraded GUI tooling to `vite@8.0.16` and `vitest@4.1.8`; `npm audit --audit-level=moderate` reports 0 vulnerabilities.
- Rust dependency vulnerabilities: installed and ran `cargo audit`; no advisories were reported for the workspace lockfile.
- Rust daemon HTTP auth: non-health routes support Bearer token auth from `CODEPANION_DAEMON_TOKEN` or `~/.codepanion/config.json`.
- Rust daemon WebSocket auth: `/ws` accepts the GUI token subprotocol and rejects unauthenticated WebSocket upgrades when auth is enabled.
- GUI-managed Rust daemon startup: Tauri passes the configured token to the daemon process.
- Rust CLI auth: CLI API calls read the same daemon token source and attach Bearer auth.
- Provider API key exposure: provider list/get/create/update/active responses redact `config.apiKey`; stored secrets are preserved for execution.
- Provider connection testing: `/api/v1/providers/:id/test` now performs a real OpenAI-compatible `/models` probe and marks failed providers as `error`.
- CC Switch import: `source=ccm` now persists imported providers instead of only reporting a count.
- GUI workflow launch: `POST /workflow/runs` now loads the requested workflow from the Rust daemon `workflows.json` definition registry and starts the real workflow runner.
- Workflow board: `/workflow/board` now includes workflow definitions loaded from the same Rust daemon definition registry.
- Workflow execution validation: `POST /api/v1/workflows/execute` rejects invalid workflow definitions before starting a run.
- Workflow cancellation: daemon-run shell steps are cancellable and emit `WorkflowCancelled` instead of waiting for long commands to finish.
- Workflow history and gates: completed Rust workflow runs now retain `projectId`, including gate summaries restored from history.
- Global runs API: `/api/v1/global/runs` now returns the GUI run-card shape (`id`, `workflowName`, `status`, `stepCount`, current step fields) instead of raw scheduler internals.
- Default Tauri GUI workbench: settings now supports project create/update/delete/activate and provider create/update/delete/activate flows.
- Tauri shell scope: docs now limit the default shell contract to daemon lifecycle, auth config bridge, restricted URL opening, and shutdown cleanup.
- CI vulnerability gates: GitHub Actions now runs `npm audit`, Rust workspace `cargo audit`, and Tauri lockfile `cargo audit`.
- Prior GUI review findings in `.claude/code_review_findings.json` remain marked `FIXED`.

## Verification

- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `npm test`
- `npm run build -w packages/gui`
- `npm run gui:build`
- `npm audit --audit-level=moderate`
- `cargo audit`
- `git diff --check`

## Notes

- `temp_skill_review/` is an unrelated untracked directory in the workspace and was not modified by this pass.
