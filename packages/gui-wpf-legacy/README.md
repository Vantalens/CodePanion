# CodePanion GUI Legacy

[English](README.md) | [简体中文](README.zh-CN.md)

This package contains the legacy Windows WPF/WebView2 GUI for CodePanion. The default GUI has moved to `packages/gui` and is built with Tauri, React, and TypeScript.

## Features

- Project sidebar with project CRUD, search, filtering, and selected-run state restoration.
- Global workspace views for runs, gates, workflows, queues, and project status.
- Current run timeline with step status, stdout/stderr output, role/model/provider metadata, and permission indicators.
- Artifact preview for delivery notes, patch summaries, test results, and review reports.
- Human gate decision panel with approve / reject / retry, constraints, messages, and decision history.
- Provider and model configuration UI for local workflow execution.

## Technology Stack

- .NET 8.0
- WPF (Windows Presentation Foundation)
- WebView2
- Rust daemon HTTP/WebSocket API
- Local HTML/CSS/JavaScript workspace UI

## Build and Run

### Prerequisites

- .NET SDK 8.0 or later
- Windows 10/11
- WebView2 Runtime

### Build

```bash
cd packages/gui
dotnet restore
dotnet build
```

From this legacy package:

```bash
dotnet build CodePanion.Gui.csproj -c Release
```

### Publish

```bash
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Output:

```text
bin/Release/net8.0-windows/win-x64/publish/CodePanion.Gui.exe
```

## Usage

For normal use, start the Tauri desktop application from `packages/gui` or the portable package entry:

```text
CodePanion.exe
```

The GUI connects to the local daemon on the configured port, shows workspace status, and lets users monitor or intervene in workflow execution.

## Project Structure

```text
packages/gui/
├── App.xaml
├── App.xaml.cs
├── MainWindow.xaml
├── MainWindow.xaml.cs
├── Services/
├── Assets/
├── web/
└── CodePanion.Gui.csproj
```

## Development Notes

- Keep GUI behavior aligned with `DEVELOPMENT_TASKS.md` and the Rust daemon API contract.
- Avoid reintroducing old session-monitoring or passive source-listener flows as new product surfaces.
- Prefer local WebView assets and explicit daemon API calls.

## License

MIT
