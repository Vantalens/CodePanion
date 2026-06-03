# CodePanion GUI

This package is the default CodePanion desktop GUI. It uses Tauri, React, and TypeScript, and talks directly to the local Rust daemon over HTTP/WebSocket.

## Development

```bash
npm install
npm run gui:run
```

The Tauri shell starts `codepanion-daemon` automatically when no healthy daemon is available. In development it searches `codepanion-rust/target/release` and `codepanion-rust/target/debug`; set `CODEPANION_DAEMON_PATH` to override.

## Build

```bash
npm run gui:build
```

The production app is emitted by Tauri under `packages/gui/src-tauri/target/release`.

## Verification

```bash
npm --prefix packages/gui test
npm --prefix packages/gui run test:visual
```

The visual check starts Vite, verifies 1200px, 900px, and 390px workbench widths have no horizontal overflow, and refreshes ignored screenshots under `output/playwright`.

## Structure

```text
packages/gui/
├── src/                  # React application
│   ├── daemon-client/    # typed Rust daemon HTTP/WS client
│   ├── state/            # reducers and formatting helpers
│   └── components/       # reusable UI primitives
└── src-tauri/            # Tauri desktop shell and daemon lifecycle commands
```

The old WPF/WebView2 GUI is retained in `packages/gui-wpf-legacy` for one transition cycle.
