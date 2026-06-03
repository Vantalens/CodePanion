# GUI/CLI verification report

Date: 2026-06-03 09:09:03
Daemon: Rust daemon
Result: PASS
Port: 4656
PID: 34764

## HTTP API
- Health: HTTP 200 /health
- Projects: HTTP 200 /api/v1/projects
- Providers: HTTP 200 /api/v1/providers
- Scheduler: HTTP 200 /api/v1/scheduler/runs
- Workflow Board: HTTP 200 /workflow/board
- Models: HTTP 200 /v1/models

## CLI
- provider list: PASS
- model list: PASS
- status: PASS

## GUI
- Release build: PASS
