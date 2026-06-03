# CodePanion GUI Legacy

[English](README.md) | [简体中文](README.zh-CN.md)

本目录保留旧 WPF/WebView2 GUI。默认 GUI 已迁移到 `packages/gui`，技术栈为 Tauri + React + TypeScript。

本包是 CodePanion 的 Windows 桌面 GUI，基于 C# WPF 和 WebView2 开发。它连接本地 daemon，用于展示项目、workflow run、human gate、artifact 和 provider 设置。

## 功能特性

- 项目侧栏：项目 CRUD、搜索、筛选和 selected-run 状态恢复。
- 全局工作台视图：runs、gates、workflows、队列和项目状态。
- 当前 run 时间线：step 状态、stdout/stderr 输出、role/model/provider 元数据和权限指示。
- Artifact 预览：delivery note、patch summary、test result 和 review report。
- Human gate 决策面板：approve / reject / retry、constraints、message 和决策历史。
- Provider 与模型配置界面，用于本地 workflow 执行。

## 技术栈

- .NET 8.0
- WPF (Windows Presentation Foundation)
- WebView2
- Rust daemon HTTP/WebSocket API
- 本地 HTML/CSS/JavaScript 工作台 UI

## 构建和运行

### 前置要求

- .NET SDK 8.0 或更高版本
- Windows 10/11
- WebView2 Runtime

### 构建

```bash
cd packages/gui
dotnet restore
dotnet build
```

从仓库根目录运行：

```bash
npm run gui:build
npm run gui:run
```

### 发布

```bash
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

输出位置：

```text
bin/Release/net8.0-windows/win-x64/publish/CodePanion.Gui.exe
```

## 使用说明

普通用户直接启动打包后的桌面应用：

```text
CodePanion.Gui.exe
```

GUI 会连接配置端口上的本地 daemon，展示 workspace 状态，并允许用户观察或介入 workflow 执行。

## 项目结构

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

## 开发说明

- GUI 行为应与 `DEVELOPMENT_TASKS.md` 和 Rust daemon API contract 保持一致。
- 不要把旧的 session monitoring 或被动 source listener flow 重新作为新产品表面。
- 优先使用本地 WebView 资源和显式 daemon API 调用。

## License

MIT
