# RemindAI

一个智能开发助手工具，用于在 VSCode、Codex 等 AI 编程工具的开发过程中，自动检测需要用户输入的时刻并发送提醒，让开发者可以通过图形界面快速响应。

## 🎯 核心功能

- **智能提示检测**：自动识别命令行工具执行过程中的输入请求（yes/no 确认、自定义输入等）
- **桌面通知**：在需要输入时立即发送系统通知
- **图形界面响应**：通过友好的 GUI 界面进行输入，无需切换到终端
- **后台守护进程**：持续监控命令执行，低资源占用
- **实时通信**：基于 WebSocket 的实时双向通信

## 📦 项目结构

```
remindai-monorepo/
├── packages/
│   ├── daemon/          # Node.js 守护进程和 CLI 工具
│   │   ├── src/
│   │   │   ├── cli/     # 命令行接口
│   │   │   ├── daemon/  # 守护进程核心
│   │   │   ├── pty/     # 伪终端管理
│   │   │   └── shared/  # 共享模块
│   │   └── package.json
│   └── gui/             # C# .NET 图形界面
│       └── RemindAI.Gui.csproj
└── package.json
```

## 🚀 快速开始

### 前置要求

- Node.js >= 18
- .NET SDK >= 6.0 (用于 GUI)
- Windows 10/11 或 macOS 或 Linux

### 安装

```bash
# 安装依赖
npm install

# 构建 daemon
npm run build

# 安装 CLI 工具到系统（可选）
npm install -g packages/daemon
```

### 使用方法

#### 1. 启动守护进程

```bash
# 启动后台守护进程
remindai start

# 查看守护进程状态
remindai status
```

#### 2. 启动 GUI 界面

```bash
# 运行图形界面
npm run gui:run
```

#### 3. 使用 remindai 包装命令

```bash
# 使用 remindai 运行需要监控的命令
remindai run -- claude code

# 或者运行其他需要交互的命令
remindai run -- npm install
remindai run -- git commit
```

## 💡 使用场景

### 场景 1：AI 编程工具交互

在使用 Claude Code、GitHub Copilot CLI 等工具时，经常需要确认操作：

```bash
remindai run -- claude code
```

当 Claude 需要确认文件修改、执行命令等操作时，RemindAI 会：
1. 检测到提示信息
2. 发送桌面通知
3. 在 GUI 中显示提示内容
4. 等待你的响应（yes/no 或自定义输入）
5. 将响应发送回命令行工具

### 场景 2：长时间运行的命令

```bash
remindai run -- npm run build
```

构建完成或需要输入时，立即收到通知，无需一直盯着终端。

### 场景 3：批量操作确认

```bash
remindai run -- git push --force
```

在执行危险操作前，通过 GUI 界面仔细确认。

## 🔧 CLI 命令

| 命令 | 说明 |
|------|------|
| `remindai start` | 启动守护进程 |
| `remindai stop` | 停止守护进程 |
| `remindai status` | 查看守护进程状态 |
| `remindai run -- <command>` | 使用 RemindAI 运行命令 |
| `remindai notify <message>` | 发送测试通知 |
| `remindai reply <sessionId> <input>` | 向会话发送响应 |

## 🏗️ 架构设计

### 核心组件

1. **PTY Runner**
   - 使用伪终端（PTY）包装命令执行
   - 捕获所有输入输出
   - 检测提示模式（prompt detection）

2. **Prompt Detector**
   - 识别常见的输入提示模式
   - 支持 yes/no 问题
   - 支持自定义输入请求
   - 可扩展的模式匹配

3. **Daemon Server**
   - HTTP + WebSocket 服务器
   - 管理多个命令会话
   - 路由通知和响应

4. **Notifier**
   - 跨平台桌面通知
   - 支持 Windows、macOS、Linux

5. **GUI Client**
   - .NET WPF/Avalonia 界面
   - 实时显示提示信息
   - 输入响应界面

### 通信流程

```
命令执行 → PTY → Prompt Detector → Daemon Server → WebSocket → GUI
                                                              ↓
                                                          用户输入
                                                              ↓
命令继续 ← PTY ← Session Manager ← Daemon Server ← WebSocket ← GUI
```

## 📝 配置

配置文件位置：`~/.remindai/config.json`

```json
{
  "daemon": {
    "port": 3721,
    "host": "127.0.0.1"
  },
  "notification": {
    "enabled": true,
    "sound": true
  },
  "promptDetection": {
    "patterns": [
      "\\(y/n\\)",
      "\\[Y/n\\]",
      "Press any key to continue"
    ]
  }
}
```

## 🔍 提示检测模式

RemindAI 可以识别以下常见提示模式：

- `(y/n)` - 是/否确认
- `[Y/n]` - 默认为 Yes 的确认
- `[y/N]` - 默认为 No 的确认
- `Press Enter to continue` - 按键继续
- `Enter your choice:` - 自定义输入
- 自定义正则表达式模式

## 🛠️ 开发

### 开发环境设置

```bash
# 安装依赖
npm install

# 开发模式运行 daemon
npm run dev:daemon

# 构建
npm run build

# 构建 GUI
npm run gui:build
```

### 项目技术栈

- **Daemon**: TypeScript, Node.js, Express, WebSocket, node-pty
- **GUI**: C#, .NET, WPF/Avalonia
- **通信**: WebSocket, HTTP REST API
- **日志**: Pino

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 联系方式

如有问题或建议，请提交 Issue。
