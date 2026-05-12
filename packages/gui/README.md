# RemindAI GUI

RemindAI 的图形用户界面，基于 C# WPF 开发。

## 功能特性

- ✅ 实时显示活动会话列表
- ✅ WebSocket 连接到 daemon
- ✅ 提示对话框（支持 yes/no 和自定义输入）
- ✅ 系统托盘集成
- ✅ 日志查看
- ✅ 设置界面

## 技术栈

- .NET 8.0
- WPF (Windows Presentation Foundation)
- Websocket.Client 5.1.2
- Newtonsoft.Json 13.0.3
- Hardcodet.NotifyIcon.Wpf 1.1.0

## 构建和运行

### 前置要求

- .NET SDK 8.0 或更高版本
- Windows 10/11

### 构建

```bash
# 从项目根目录
cd packages/gui

# 恢复依赖
dotnet restore

# 构建
dotnet build

# 运行
dotnet run
```

或者使用根目录的 npm 脚本：

```bash
# 从项目根目录
npm run gui:build   # 构建
npm run gui:run     # 运行
```

### 发布

```bash
# 发布为单文件可执行程序
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true

# 输出位置：bin/Release/net8.0-windows/win-x64/publish/RemindAI.Gui.exe
```

## 使用说明

### 启动

1. 确保 RemindAI daemon 正在运行：
   ```bash
   remindai start
   ```

2. 启动 GUI：
   ```bash
   npm run gui:run
   ```

3. GUI 会自动连接到 daemon（默认端口 7777）

### 主要功能

#### 会话列表

- 显示所有活动会话
- 实时更新会话状态（运行中/等待输入/已结束）
- 查看会话详情

#### 提示对话框

当命令需要输入时，会自动弹出对话框：

- 显示提示信息和上下文
- 支持选项按钮（如果有编号选项）
- 支持自定义文本输入
- 自动添加换行符

#### 系统托盘

- 最小化到系统托盘
- 双击托盘图标显示主窗口
- 右键菜单：显示窗口、查看连接状态、退出

#### 日志

- 实时显示连接状态、会话事件等日志
- 支持清空日志

#### 设置

- 通用设置：开机启动、通知设置、主题
- 连接设置：查看端口和 token
- 关于：版本信息和项目链接

## 项目结构

```
packages/gui/
├── App.xaml                    # 应用程序定义
├── App.xaml.cs                 # 应用程序代码
├── MainWindow.xaml             # 主窗口界面
├── MainWindow.xaml.cs          # 主窗口代码
├── PromptDialog.xaml           # 提示对话框界面
├── PromptDialog.xaml.cs        # 提示对话框代码
├── SettingsWindow.xaml         # 设置窗口界面
├── SettingsWindow.xaml.cs      # 设置窗口代码
├── Models/
│   └── SessionViewModel.cs     # 会话视图模型
├── Services/
│   └── DaemonClient.cs         # Daemon 客户端服务
├── icon.ico                    # 应用程序图标
└── RemindAI.Gui.csproj         # 项目文件
```

## 开发

### 添加新功能

1. 在 `Services/` 目录添加新的服务类
2. 在 `Models/` 目录添加新的模型类
3. 在 XAML 文件中设计界面
4. 在对应的 `.xaml.cs` 文件中实现逻辑

### 调试

在 Visual Studio 或 VS Code 中打开项目：

```bash
# 使用 Visual Studio
start RemindAI.Gui.csproj

# 使用 VS Code
code .
```

按 F5 开始调试。

## 已知问题

- [ ] 图标文件 `icon.ico` 需要创建
- [ ] 设置保存功能未完全实现
- [ ] 需要添加更多错误处理

## 未来计划

- [ ] 支持自定义主题
- [ ] 添加会话输出查看器
- [ ] 支持快捷回复模板
- [ ] 添加统计和历史记录
- [ ] 支持多语言

## 许可证

MIT
