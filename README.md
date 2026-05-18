# RemindAI

一个本地优先的个人 AI 工作流中控台，用于统一接入、查看、提醒和接管本机上的多个 AI 开发任务，并逐步演进为可编排、可复用的本地 AI 工作流操作台。

## 🎯 核心功能

- **多源工作流汇聚**：统一接收 CLI/PTTY、Codex Desktop 本地工作流、VS Code 扩展和外部适配器事件
- **任务状态总览**：集中查看运行中、等待输入、已完成和异常任务
- **智能提示检测**：自动识别命令行工具执行过程中的输入请求（yes/no 确认、自定义输入等）
- **统一提醒与接管**：系统通知、GUI 时间线和图形界面响应协同工作
- **本地优先**：核心数据保留在本机，后台守护进程低资源运行
- **实时通信**：基于 WebSocket 的实时双向通信

## 📦 项目结构

```
RemindAI/
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
- .NET SDK >= 8.0 (用于 GUI)
- Windows 10/11 或 macOS 或 Linux

### 安装

```bash
# 1. 克隆仓库
git clone https://github.com/yourusername/remindai.git
cd remindai

# 2. 安装依赖
npm install

# 3. 构建 daemon
npm run build

# 4. 全局安装 CLI 工具
cd packages/daemon
npm link
cd ../..

# 5. 验证安装
remindai --version
```

### 首次使用

```bash
# 1. 启动守护进程
remindai start

# 2. 查看状态
remindai status

# 3. 启动 GUI 界面（可选）
npm run gui:run

# 4. 测试通知功能
remindai notify "测试通知" -m "RemindAI 已就绪！"
```

### 使用方法

#### 1. 启动守护进程

```bash
# 启动后台守护进程
remindai start

# 查看守护进程状态
remindai status

# 停止守护进程
remindai stop

# 重启守护进程
remindai restart
```

#### 2. 启动 GUI 界面

```bash
# 运行图形界面（Windows）
npm run gui:run

# 或者直接运行编译后的程序
cd packages/gui/bin/Debug/net8.0-windows
./RemindAI.Gui.exe
```

#### 3. 使用 RemindAI 包装命令

```bash
# 使用 RemindAI 运行需要监控的命令
remindai run -- claude code

# 或者运行其他需要交互的命令
remindai run -- npm install
remindai run -- git commit
remindai run -- python script.py
```

#### 4. 发送通知

```bash
# 发送简单通知
remindai notify "任务完成"

# 发送带消息的通知
remindai notify "构建完成" -m "项目已成功构建"

# 指定通知级别
remindai notify "错误" -m "构建失败" -l error
```

## 💡 使用场景

### 场景 1：统一接管多个 AI 编程任务

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

### 场景 4：多窗口 AI 工作流总览

VS Code 扩展和 CLI 会话会分别注册为监控源。多个 VS Code 窗口、多个 Codex/Claude Code 终端同时工作时，RemindAI 会在 GUI 中按来源显示事件，帮助你从一个界面掌握本机 AI 工作流全局状态。

## 🧭 产品路线

### 阶段 1：个人本地控制台

- 统一接入本机 AI 工具和命令会话
- 汇总任务状态、提醒和等待输入
- 提供上下文查看与统一回复
- 目标：让一个人能够稳定掌控多个并行 AI 任务

### 阶段 2：本地 AI 工作流操作台

- 在统一监控基础上增加工作流模板
- 支持多步骤任务编排和跨工具协作
- 归档任务结果，复用常见流程
- 目标：让一个人不只“看住 AI”，还能更系统地组织 AI 完成复杂工作

### 明确边界

- 不做团队版或多用户协作
- 不把 RemindAI 做成聊天客户端
- 不用企业平台复杂度换取当前阶段的可用性

## 🔧 CLI 命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `remindai start` | 启动守护进程 | `remindai start` |
| `remindai stop` | 停止守护进程 | `remindai stop` |
| `remindai restart` | 重启守护进程 | `remindai restart` |
| `remindai status` | 查看守护进程状态 | `remindai status` |
| `remindai run -- <command>` | 使用 RemindAI 运行命令 | `remindai run -- npm test` |
| `remindai notify <title>` | 发送通知 | `remindai notify "完成" -m "任务已完成"` |
| `remindai sessions` | 查看活动会话 | `remindai sessions` |
| `remindai reply <sessionId> <input>` | 向会话发送响应 | `remindai reply abc123 "yes"` |
| `remindai --version` | 查看版本 | `remindai --version` |
| `remindai --help` | 查看帮助 | `remindai --help` |

## 🔌 多源监控

- CLI/PTTY：使用 `remindai run -- <command>`。
- Codex Desktop：只读同步 `~\.codex\sessions\**\*.jsonl`，镜像所有 Codex 线程的消息、工具调用、输出和代码块。
- VS Code：加载 `packages/vscode-extension/` 扩展，每个 VS Code 窗口独立上报。
- 外部工具：调用 `POST /sources/register` 和 `POST /events`。

详细说明见 [docs/MONITORING_SOURCES.md](docs/MONITORING_SOURCES.md)。

### 常见问题

**Q: 提示 `remindai` 命令未找到？**

A: 需要先执行 `npm link` 来全局安装 CLI：
```bash
cd packages/daemon
npm link
```

**Q: daemon 启动失败？**

A: 检查端口是否被占用，或查看日志：
```bash
remindai status
# 查看配置文件：~/.remindai/config.json
```

**Q: GUI 无法连接到 daemon？**

A: 确保 daemon 正在运行，并检查配置文件中的端口设置是否一致。

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
  "port": 7777,
  "token": "generated-token",
  "promptIdleMs": 800,
  "toast": {
    "enabled": true,
    "soundOnPrompt": true,
    "soundOnDone": true
  },
  "monitors": {
    "cli": true,
    "vscode": true
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
- **GUI**: C#, .NET, WPF
- **通信**: WebSocket, HTTP REST API
- **日志**: Pino

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 联系方式

如有问题或建议，请提交 Issue。
