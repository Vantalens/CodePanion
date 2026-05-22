# CodePanion 架构设计文档

## 概述

CodePanion 是一个本地优先、供应商中立、单入口多出口的 AI 开发工作流控制台 / 控制平面，用于统一接入、查看、提醒和接管本机上的多个 AI 开发任务。核心架构是 daemon 事件中心：CLI/PTTY、Codex Desktop 本地会话同步器、本地 AI 编程工具进程扫描、VS Code 扩展和外部适配器统一输出 workflow event，GUI 通过 WebSocket 接收统一事件流，并把分散的任务状态收束到一个本地操作界面。

当前架构不废弃。Node daemon、HTTP/WebSocket、WPF/WebView2 GUI、`source` / `session` / `workflow` / `event` 语义模型是后续控制平面路线的稳定基础。Alpha 阶段继续保留 Windows GUI 和双击 `CodePanion.Gui.exe` 的普通用户入口；Tauri/Avalonia、provider adapter、Enterprise 治理能力和规则跨生态同步放入 Beta 或更后阶段评估。

产品路线分为两个阶段：

1. **Windows Alpha 个人本地控制台**：先解决 Claude Code、Codex、VS Code/Copilot、CLI/PTTY、Codex Desktop 的多源接入、任务总览、提醒、上下文查看和统一回复。
2. **本地 AI 工作流操作台**：再在本地能力基础上增加工作流模板、任务编排、跨工具协作和结果归档。

第一阶段不做默认系统级 OCR 或全局窗口内容读取；多窗口监控优先通过进程级识别、插件、扩展、CLI 包装和显式适配器完成。国产 AI 编程工具采用分层覆盖策略，首批按通义灵码 / Qoder、CodeBuddy、Trae、百度 Comate、CodeGeeX 推进，MarsCode、CodeArts 放入下一梯队验证。CodePanion 明确不以多用户协作或团队平台为目标，也不做通用个人 Agent、聊天聚合器、模型聊天客户端、完整 AI IDE、通用 launcher、系统进程监控器或 token 二次分销平台。

## 架构契约

- **本地优先**：daemon 默认监听 `127.0.0.1`，除健康检查外请求需要本地 token；运行权限保持在当前用户范围内。
- **最小采集**：默认只采集完成控制台能力所需的会话状态、来源元数据、事件、必要上下文和用户明确接入的数据。
- **显式接入**：深度状态优先通过 CLI/PTTY、公开扩展 API、companion extension 或外部适配器接入。
- **不读私有状态**：不读取账号、token、cookie、插件私有数据库、上游工具私有 API 或全局屏幕内容。
- **能力分层**：L1 表示工具存在识别，L2 表示状态事件，L3 表示回复或继续执行，L4 表示工作流编排。文档和 GUI 不应把低层能力描述为深度集成。
- **接口稳定**：`source`、`session`、`workflow`、`event` 是控制平面的核心语义，后续适配器 SDK、审计快照和 provider adapter 都应建立在这些语义上。

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
          │ codepanion run -- <cmd>        │ WebSocket
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
POST /notify
  发送通知
  Body: { message: string, sessionId?: string }

POST /sessions/:id/reply
  发送响应到会话
  Body: { sessionId: string, input: string }

GET /sessions
  获取所有活动会话
  Response: { sessions: Session[] }

GET /health
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
- Windows 使用 PowerShell Toast / BurntToast 可用路径，macOS 使用 `osascript`，Linux 使用 `notify-send`
- 不再依赖 `node-notifier`
- 可配置通知声音、图标

**通知类型**：
```typescript
enum NotificationType {
  PROMPT_DETECTED = 'prompt_detected',
  SESSION_COMPLETE = 'session_complete',
  ERROR = 'error'
}
```

### 7. Workflow Template Engine (`src/workflows/`)

**职责**：把"常用命令"和"跨工具任务流"沉淀为本地可重复运行的入口，覆盖 Codex / Claude Code / npm / git / `codepanion` 自身 CLI 等多种工具。

**两层模型**：

| 层 | 文件 | 数据位置 | 作用 |
| --- | --- | --- | --- |
| 单命令模板 | `templateManager.ts` | `~/.codepanion/workflow-templates.json` | 一个命令 + 占位符参数，`codepanion template run` 直接执行 |
| 多步骤工作流 | `workflowDefinitionManager.ts` | `~/.codepanion/workflows.json` + `~/.codepanion/workflow-runs.json` | 多个步骤、依赖、checkpoint，`runWorkflow` 按依赖图执行；模板可作为步骤的 `template=` 引用 |

**runWorkflow hooks**：

`runWorkflow` 接受可选的 `WorkflowRunHooks`，在四个时刻回调：

- `onWorkflowStart(run)` / `onWorkflowFinish(run)`
- `onStepStart(step, run)` / `onStepFinish(step, run)`

CLI 在 daemon 在线时注入 hooks，把每个步骤映射为 daemon 的 `monitor-event`（来源 `kind=cli`、name=`workflow:<name>`），GUI 因此能实时看到工作流进度而无需轮询历史文件。hooks 失败被 catch 后只打印 warning，不影响真实执行——事件总线不可用永远不应让本地命令半途夭折。

**预置示例**：[`packages/daemon/examples/workflows/`](../packages/daemon/examples/workflows/) 提供 `codex-then-claude-review`、`build-test-audit` 两个开箱模板；`codepanion workflow import --file <json>` 把它们加载到本地。

## 数据流详解

### 场景 1：检测到输入提示

```
1. 用户执行: codepanion run -- claude code
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
codepanion start
```

**流程**：
1. 检查是否已有守护进程运行（通过 PID 文件）
2. 如果已运行，退出
3. 创建守护进程（detached process）
4. 写入 PID 文件到 `~/.codepanion/daemon.pid`
5. 启动 HTTP/WebSocket 服务器
6. 初始化 Session Manager

### 守护进程停止

```bash
codepanion stop
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

- **用户配置**: `~/.codepanion/config.json`
- **PID 文件**: `~/.codepanion/daemon.pid`
- **日志文件**: `~/.codepanion/logs/`

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
class CodePanionError extends Error {
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
codepanion start      # 启动守护进程
```

### 系统服务

#### Windows (NSSM)

```powershell
nssm install CodePanion "C:\Program Files\nodejs\codepanion.cmd" "--daemon"
nssm start CodePanion
```

#### macOS (launchd)

```xml
<!-- ~/Library/LaunchAgents/com.codepanion.daemon.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.codepanion.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/codepanion</string>
        <string>--daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

#### Linux (systemd)

```ini
# ~/.config/systemd/user/codepanion.service
[Unit]
Description=CodePanion Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/codepanion --daemon
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
