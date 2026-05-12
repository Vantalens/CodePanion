# RemindAI 架构设计文档

## 概述

RemindAI 是一个用于监控命令行工具交互的智能提示系统，主要服务于 AI 编程工具（如 Claude Code、GitHub Copilot）的使用场景。

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         用户层                               │
│  ┌──────────────┐              ┌──────────────┐            │
│  │   Terminal   │              │  GUI Client  │            │
│  │   (用户)     │              │  (C# .NET)   │            │
│  └──────┬───────┘              └──────┬───────┘            │
└─────────┼──────────────────────────────┼──────────────────┘
          │                              │
          │ remindai run -- <cmd>        │ WebSocket
          │                              │
┌─────────┼──────────────────────────────┼──────────────────┐
│         │         守护进程层            │                  │
│  ┌──────▼───────┐              ┌──────▼───────┐          │
│  │  CLI Entry   │              │ HTTP/WS      │          │
│  │  (index.ts)  │              │ Server       │          │
│  └──────┬───────┘              │ (Express)    │          │
│         │                      └──────┬───────┘          │
│         │                             │                   │
│  ┌──────▼───────┐              ┌─────▼────────┐         │
│  │ PTY Runner   │◄────────────►│  Session     │         │
│  │              │              │  Manager     │         │
│  └──────┬───────┘              └──────┬───────┘         │
│         │                             │                   │
│  ┌──────▼───────┐              ┌─────▼────────┐         │
│  │   Prompt     │─────────────►│  Notifier    │         │
│  │   Detector   │              │              │         │
│  └──────────────┘              └──────────────┘         │
└──────────────────────────────────────────────────────────┘
          │                              │
          │ 执行命令                      │ 系统通知
          │                              │
┌─────────▼──────────────────────────────▼──────────────────┐
│                      系统层                                │
│  ┌──────────────┐              ┌──────────────┐          │
│  │   子进程     │              │  通知中心    │          │
│  │   (PTY)      │              │  (OS Native) │          │
│  └──────────────┘              └──────────────┘          │
└──────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. CLI Entry (`src/index.ts`)

**职责**：
- 应用程序入口点
- 解析命令行参数
- 路由到守护进程或 CLI 命令

**关键逻辑**：
```typescript
// 守护进程模式
if (argv.includes('--daemon')) {
  await bootDaemon();
}

// 运行命令模式
if (argv[0] === 'run') {
  await runWithPty({ command, args });
}

// 其他 CLI 命令
await runCli(process.argv);
```

### 2. PTY Runner (`src/pty/runner.ts`)

**职责**：
- 使用伪终端（PTY）包装命令执行
- 捕获命令的所有输入输出
- 将输出传递给 Prompt Detector
- 处理用户输入的转发

**技术实现**：
- 使用 `node-pty` 库创建伪终端
- 保持 TTY 特性（颜色、光标控制等）
- 双向数据流：stdin/stdout/stderr

**数据流**：
```
用户命令 → PTY.spawn() → 子进程
                ↓
         捕获 stdout/stderr
                ↓
         Prompt Detector
                ↓
         检测到提示？
         ├─ 是 → 通知 Daemon
         └─ 否 → 继续输出
```

### 3. Prompt Detector (`src/pty/promptDetector.ts`)

**职责**：
- 分析命令输出，识别输入提示
- 支持多种提示模式
- 提取提示上下文信息

**检测模式**：

| 模式类型 | 正则表达式 | 示例 |
|---------|-----------|------|
| Yes/No 确认 | `\(y/n\)` | `Continue? (y/n)` |
| 默认 Yes | `\[Y/n\]` | `Proceed? [Y/n]` |
| 默认 No | `\[y/N\]` | `Delete? [y/N]` |
| 按键继续 | `Press .* to continue` | `Press Enter to continue` |
| 自定义输入 | `Enter .*:` | `Enter your name:` |

**检测算法**：
```typescript
class PromptDetector {
  private buffer: string = '';
  
  feed(chunk: string): PromptMatch | null {
    this.buffer += chunk;
    
    // 检查是否匹配任何提示模式
    for (const pattern of this.patterns) {
      const match = this.buffer.match(pattern.regex);
      if (match) {
        return {
          type: pattern.type,
          text: match[0],
          context: this.extractContext()
        };
      }
    }
    
    // 保持缓冲区大小
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.slice(-MAX_BUFFER);
    }
    
    return null;
  }
}
```

### 4. Daemon Server (`src/daemon/server.ts`)

**职责**：
- 提供 HTTP REST API
- 提供 WebSocket 实时通信
- 管理客户端连接

**API 端点**：

#### HTTP REST API

```
POST /api/notify
  发送通知
  Body: { message: string, sessionId?: string }

POST /api/reply
  发送响应到会话
  Body: { sessionId: string, input: string }

GET /api/sessions
  获取所有活动会话
  Response: { sessions: Session[] }

GET /api/status
  获取守护进程状态
  Response: { running: boolean, uptime: number, sessions: number }
```

#### WebSocket 协议

```typescript
// 客户端 → 服务器
{
  type: 'subscribe',
  sessionId?: string  // 订阅特定会话，或订阅所有
}

{
  type: 'reply',
  sessionId: string,
  input: string
}

// 服务器 → 客户端
{
  type: 'prompt',
  sessionId: string,
  prompt: {
    text: string,
    type: 'yesno' | 'input' | 'confirm',
    context: string
  }
}

{
  type: 'session_start',
  sessionId: string,
  command: string
}

{
  type: 'session_end',
  sessionId: string,
  exitCode: number
}
```

### 5. Session Manager (`src/daemon/sessionManager.ts`)

**职责**：
- 管理多个命令执行会话
- 跟踪会话状态
- 路由输入输出

**会话生命周期**：
```
创建 → 运行中 → 等待输入 → 继续运行 → 完成/错误
  ↓      ↓         ↓           ↓          ↓
 NEW  RUNNING  WAITING_INPUT  RUNNING   ENDED
```

**数据结构**：
```typescript
interface Session {
  id: string;
  command: string;
  args: string[];
  status: SessionStatus;
  pty: IPty;
  createdAt: Date;
  lastActivity: Date;
  pendingPrompt?: {
    text: string;
    type: PromptType;
    context: string;
  };
}
```

### 6. Notifier (`src/daemon/notifier.ts`)

**职责**：
- 发送跨平台桌面通知
- 支持 Windows、macOS、Linux

**实现**：
- 使用 `node-notifier` 库
- 支持通知点击事件
- 可配置通知声音、图标

**通知类型**：
```typescript
enum NotificationType {
  PROMPT_DETECTED = 'prompt_detected',
  SESSION_COMPLETE = 'session_complete',
  ERROR = 'error'
}
```

## 数据流详解

### 场景 1：检测到输入提示

```
1. 用户执行: remindai run -- claude code
   ↓
2. PTY Runner 启动子进程
   ↓
3. Claude 输出: "Modify file.ts? (y/n)"
   ↓
4. Prompt Detector 检测到 "(y/n)" 模式
   ↓
5. Session Manager 记录等待状态
   ↓
6. Notifier 发送桌面通知
   ↓
7. Daemon Server 通过 WebSocket 推送到 GUI
   ↓
8. GUI 显示提示对话框
   ↓
9. 用户在 GUI 中点击 "Yes"
   ↓
10. GUI 通过 WebSocket 发送响应
    ↓
11. Session Manager 接收响应
    ↓
12. PTY Runner 将 "y\n" 写入子进程 stdin
    ↓
13. Claude 继续执行
```

### 场景 2：命令执行完成

```
1. 子进程退出
   ↓
2. PTY Runner 捕获退出码
   ↓
3. Session Manager 更新会话状态
   ↓
4. Notifier 发送完成通知
   ↓
5. Daemon Server 通过 WebSocket 通知 GUI
   ↓
6. GUI 显示完成消息
   ↓
7. Session Manager 清理会话资源
```

## 进程管理

### 守护进程启动

```bash
remindai start
```

**流程**：
1. 检查是否已有守护进程运行（通过 PID 文件）
2. 如果已运行，退出
3. 创建守护进程（detached process）
4. 写入 PID 文件到 `~/.remindai/daemon.pid`
5. 启动 HTTP/WebSocket 服务器
6. 初始化 Session Manager

### 守护进程停止

```bash
remindai stop
```

**流程**：
1. 读取 PID 文件
2. 发送 SIGTERM 信号
3. 等待进程退出
4. 清理 PID 文件
5. 清理所有活动会话

### PID 文件管理 (`src/daemon/pidfile.ts`)

```typescript
// 写入 PID
function writePidFile(pid: number): void {
  const pidPath = path.join(CONFIG_DIR, 'daemon.pid');
  fs.writeFileSync(pidPath, pid.toString());
}

// 读取 PID
function readPidFile(): number | null {
  const pidPath = path.join(CONFIG_DIR, 'daemon.pid');
  if (!fs.existsSync(pidPath)) return null;
  return parseInt(fs.readFileSync(pidPath, 'utf-8'));
}

// 检查进程是否运行
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);  // 信号 0 只检查不杀死
    return true;
  } catch {
    return false;
  }
}
```

## 配置系统

### 配置文件位置

- **用户配置**: `~/.remindai/config.json`
- **PID 文件**: `~/.remindai/daemon.pid`
- **日志文件**: `~/.remindai/logs/`

### 配置结构 (`src/config.ts`)

```typescript
interface Config {
  daemon: {
    port: number;
    host: string;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  notification: {
    enabled: boolean;
    sound: boolean;
    timeout: number;  // 通知显示时长（秒）
  };
  promptDetection: {
    patterns: PromptPattern[];
    bufferSize: number;
    timeout: number;  // 等待输入超时（秒）
  };
  gui: {
    autoLaunch: boolean;
    theme: 'light' | 'dark' | 'system';
  };
}
```

## 日志系统

使用 `pino` 进行结构化日志记录。

**日志级别**：
- `debug`: 详细调试信息
- `info`: 一般信息（默认）
- `warn`: 警告信息
- `error`: 错误信息

**日志格式**：
```json
{
  "level": 30,
  "time": 1715520000000,
  "pid": 12345,
  "hostname": "dev-machine",
  "module": "pty-runner",
  "sessionId": "abc123",
  "msg": "Command started",
  "command": "claude code"
}
```

## 错误处理

### 错误类型

```typescript
class RemindAIError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public details?: any
  ) {
    super(message);
  }
}

enum ErrorCode {
  DAEMON_NOT_RUNNING = 'DAEMON_NOT_RUNNING',
  DAEMON_ALREADY_RUNNING = 'DAEMON_ALREADY_RUNNING',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  PTY_SPAWN_FAILED = 'PTY_SPAWN_FAILED',
  INVALID_CONFIG = 'INVALID_CONFIG',
  NETWORK_ERROR = 'NETWORK_ERROR'
}
```

### 错误恢复策略

| 错误类型 | 恢复策略 |
|---------|---------|
| PTY 启动失败 | 记录错误，通知用户，清理会话 |
| WebSocket 断开 | 自动重连（指数退避） |
| 守护进程崩溃 | 自动重启（systemd/launchd） |
| 配置文件损坏 | 使用默认配置，警告用户 |

## 性能优化

### 1. 缓冲区管理

- Prompt Detector 使用滑动窗口缓冲区
- 限制缓冲区大小（默认 4KB）
- 避免内存泄漏

### 2. 会话清理

- 自动清理完成的会话（保留 5 分钟）
- 限制最大并发会话数（默认 10）

### 3. WebSocket 优化

- 使用二进制帧传输大数据
- 心跳检测（30 秒）
- 自动重连机制

## 安全考虑

### 1. 本地通信

- 守护进程只监听 `127.0.0.1`
- 不暴露到公网

### 2. 输入验证

- 验证所有 API 输入（使用 Zod）
- 防止命令注入

### 3. 权限控制

- 守护进程以用户权限运行
- 不需要 root/管理员权限

## 扩展性

### 添加新的提示模式

```typescript
// src/pty/promptDetector.ts
const customPattern: PromptPattern = {
  name: 'custom-confirm',
  regex: /Are you sure\? \(yes\/no\)/,
  type: 'yesno',
  extract: (match) => ({
    text: match[0],
    context: match.input.slice(Math.max(0, match.index - 100))
  })
};

detector.addPattern(customPattern);
```

### 添加新的通知渠道

```typescript
// src/daemon/notifier.ts
interface NotificationChannel {
  send(notification: Notification): Promise<void>;
}

class SlackNotifier implements NotificationChannel {
  async send(notification: Notification): Promise<void> {
    // 发送到 Slack
  }
}
```

## 测试策略

### 单元测试

- PTY Runner 模拟
- Prompt Detector 模式匹配
- Session Manager 状态管理

### 集成测试

- 端到端命令执行
- WebSocket 通信
- 通知发送

### 测试工具

- Jest (单元测试)
- Supertest (API 测试)
- ws (WebSocket 测试)

## 部署

### 开发环境

```bash
npm run dev:daemon  # 开发模式
npm run gui:run     # GUI 开发
```

### 生产环境

```bash
npm run build       # 构建
npm install -g .    # 全局安装
remindai start      # 启动守护进程
```

### 系统服务

#### Windows (NSSM)

```powershell
nssm install RemindAI "C:\Program Files\nodejs\remindai.cmd" "--daemon"
nssm start RemindAI
```

#### macOS (launchd)

```xml
<!-- ~/Library/LaunchAgents/com.remindai.daemon.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.remindai.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/remindai</string>
        <string>--daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

#### Linux (systemd)

```ini
# ~/.config/systemd/user/remindai.service
[Unit]
Description=RemindAI Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/remindai --daemon
Restart=on-failure

[Install]
WantedBy=default.target
```

## 未来规划

### 短期目标

- [ ] 完善 GUI 界面
- [ ] 添加更多提示模式
- [ ] 支持自定义通知模板
- [ ] 添加配置 GUI

### 长期目标

- [ ] 支持远程会话（SSH）
- [ ] 插件系统
- [ ] 云同步配置
- [ ] 移动端通知
- [ ] AI 辅助提示识别
