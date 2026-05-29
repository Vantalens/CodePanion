# CodePanion 架构设计文档

## 概述

CodePanion 是一个本地优先、供应商中立、面向个人开发者的 AI 工作流操作台，用于把产品目标拆成可执行任务，让不同 AI 角色和模型协作完成规划、实现、测试、审查、文档和交付归档。核心架构仍是 daemon 事件中心与本地 workflow 模型，但后续开发重心从被动监听外部工具转向用户主动发起的 workflow 编排、角色执行、人工审核和产出归档。

当前架构不废弃。Node daemon、HTTP/WebSocket、WPF/WebView2 GUI、`session` / `workflow` / `event` 语义模型是后续本地 AI 工作流路线的稳定基础。既有 `source` 语义只作为历史兼容层保留，不作为新路线的产品对象。Alpha 阶段继续保留 Windows GUI 和双击 `CodePanion.Gui.exe` 的普通用户入口；Tauri/Avalonia、provider adapter、Enterprise 治理能力和规则跨生态同步放入 Beta 或更后阶段评估。

产品路线分为两个阶段：

1. **Windows Alpha 个人本地 AI 工作流闭环**：先解决 workspace、role、workflow、human gate、artifact 和最小 executor 边界。
2. **本地 AI 工作流执行器增强**：再在闭环稳定后增加更深工具接入、角色模板、跨工具协作和结果归档能力。

第一阶段不做默认系统级 OCR、全局窗口内容读取或外部窗口监听；外部工具只作为用户显式授权的 executor。国产 AI 编程工具采用分层覆盖策略，首批按通义灵码 / Qoder、CodeBuddy、Trae、百度 Comate、CodeGeeX 推进，MarsCode、CodeArts 放入下一梯队验证。CodePanion 明确不以多用户协作或团队平台为目标，也不做通用个人 Agent、聊天聚合器、模型聊天客户端、完整 AI IDE、通用 launcher、系统进程监控器或 token 二次分销平台。

## 架构契约

- **本地优先**：daemon 默认监听 `127.0.0.1`，除健康检查外请求需要本地 token；运行权限保持在当前用户范围内。
- **最小采集**：默认只采集完成本地 workflow 所需的会话状态、事件、必要上下文、角色执行记录和用户明确选择的数据。
- **显式执行**：深度操作优先通过 CLI/PTTY、公开 CLI 或用户授权的 executor 完成。
- **不读私有状态**：不读取账号、token、cookie、插件私有数据库、上游工具私有 API 或全局屏幕内容。
- **能力分层**：L1 表示工具存在识别，L2 表示状态事件，L3 表示可执行 workflow 节点，L4 表示多角色 / 多模型工作流编排。文档和 GUI 不应把低层能力描述为深度集成。
- **接口稳定**：`session`、`workflow`、`event` 是事件协议的核心语义；`source` 仅为现有兼容层，后续新能力应优先围绕 workflow executor 建模。

## 系统架构

### 整体架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                            用户层                                     │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│   │  WPF GUI     │  │  Terminal    │  │  Workflow Executors       │  │
│   │  + WebView2  │  │  + CLI/PTTY  │  │  (Codex / Claude /        │  │
│   │              │  │              │  │   OpenCode / local cmds)  │  │
│   └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
└──────────┼──────────────────┼─────────────────────-┼─────────────────┘
           │ WS+HTTP          │ WS(cli) + HTTP       │ executor launch/result
           │ Bearer token     │ subprotocol token    │ Bearer token
┌──────────┼──────────────────┼─────────────────────-┼─────────────────┐
│ daemon ( Node 20+, 127.0.0.1 only )                                  │
│   ┌──────▼──────────────────▼──────────────────────▼─────────────┐   │
│   │  HTTP / WS Server  (Origin + Token + subprotocol 三层鉴权)    │   │
│   └──┬────────────────────┬───────────────┬─────────────────┬────┘   │
│      │                    │               │                 │        │
│   ┌──▼──────────┐  ┌──────▼─────┐  ┌──────▼──────┐  ┌──────▼─────┐  │
│   │ SessionMgr  │  │ Executor   │  │ WorkflowMgr │  │ Artifact    │  │
│   │ (CLI/PTTY)  │  │ Registry   │  │ (模板+定义) │  │ Store       │  │
│   └──┬──────────┘  └─────┬──────┘  └──────┬──────┘  └─────────────┘  │
│      │                   │                │                          │
│   ┌──▼──────────────┐ ┌──▼─────────────┐ │                          │
│   │ PromptDetector  │ │ Role Runner    │ │                          │
│   │ (PTY 流式扫描)  │ │ Human Gates    │ │                          │
│   │                 │ │ Artifacts      │ │                          │
│   └─────────────────┘ └────────────────┘ │                          │
│                                          ▼                          │
│                       本地持久化：~/.codepanion/{workflows,         │
│                       workflow-runs,workflow-snapshot,templates}    │
└─────────────────────────────────────────────────────────────────────┘
           │                                            │
           │ OS 通知（Toast / osascript / notify-send） │ pino 日志
           ▼                                            ▼
        系统通知中心                              ~/.codepanion/logs
```

事件协议后续以三个核心语义为主：`session`（CLI/PTTY 会话）、`workflow`（多步骤定义）、`event`（执行事件）。`source` 仍存在于现有代码与历史接入中，但不作为个人 AI 工作流路线的新主概念。

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

CLI 在 daemon 在线时注入 hooks，把每个步骤映射为 workflow event，GUI 因此能实时看到工作流进度而无需轮询历史文件。hooks 失败被 catch 后只打印 warning，不影响真实执行——事件总线不可用永远不应让本地命令半途夭折。

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

daemon 不引入自定义错误类型层级——`zod` 校验失败回 400、token / Origin / subprotocol 失败回 401/403、未知资源回 404、内部异常通过 [logger.ts](../packages/daemon/src/logger.ts) 的 `maskString` 脱敏后返回 500。客户端按 HTTP 状态码做差异化处理：

- daemon HTTP 失败：`packages/daemon/src/shared/client.ts` 抛 `DaemonHttpError`（包含 method/path/status），CLI 通过 `CODEPANION_DEBUG=1` / `LOG_LEVEL=debug` 暴露细节，PTY stdout 不污染。
- 旧 Adapter SDK 失败：`packages/adapter-sdk/src/index.js` 抛 `CodePanionAdapterError`（包含 status/method/route/cause），仅作为兼容层维护。
- GUI 失败：WPF 端 `async void` 全部包 try/catch（[MainWindow.xaml.cs:95-107](../packages/gui/MainWindow.xaml.cs#L95-L107)），WebSocket 断开走指数退避重连（2s → 30s 上限）。

### 错误恢复策略

| 错误类型 | 恢复策略 |
|---------|---------|
| PTY 启动失败 | runner 立刻退出码 2，把可读原因写到 stderr |
| daemon HTTP 不可达 | CLI/GUI/SDK 各自重试或退避；GUI 显示"未连接"并触发后台重连 |
| WebSocket 断开 | GUI 端 2s → 30s 指数退避；observer 重连后从 hello + sessions/sources/workflow snapshot 完整恢复视图 |
| daemon 进程崩溃 | 由 `DaemonProcessManager.EnsureStartedAsync` 重启 bundle/dist 路径；retention 窗口内的 workflow snapshot 自动回放 |
| 配置文件损坏 | `loadConfig` 报错并退出；新建默认配置由 `codepanion install` 重新生成 |

## 资源监管

详细 retention 策略见 [docs/RETENTION.md](RETENTION.md)。简述：

- **PromptDetector**：滑动窗口缓冲，由 `cfg.promptIdleMs` 控制 idle 检测节流。
- **SessionManager**：限制每个会话保留的 output chunks 与总字符数；exited 会话超出窗口自动裁剪。
- **SourceManager**：旧来源兼容层，限制总事件数、每事件回复数、offline 来源数；超额按时间戳裁掉最老的。
- **WorkflowManager**：限制 thread 数、每 thread item 数、单条 item 内容长度；snapshot 写盘 200ms 去抖。
- **server 输出合并**：高频 PTY 输出 50ms 合并为一条 workflow item，避免计数器爆炸（P2-D）。
- **GUI 端**：`_sessions` 仅裁剪 exited，活跃会话永不丢；`gui.log` 走 `Channel<string>` 异步 + 大小滚动。
- **WebSocket**：observer 接入后立即下发 sessions/sources/workflow 三份 snapshot，避免增量丢失；断线由 GUI 端 2s → 30s 指数退避自动重连。

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

### 接入新的 AI 编程工具

按能力分层选择最低需要的入口：

- **L1（进程存在识别）**：在 [aiToolProcessAdapter.ts](../packages/daemon/src/adapters/aiToolProcessAdapter.ts) `TOOL_PROFILES` 加 profile（参考 `qoder` / `trae`）；不读取私有数据。
- **L2（状态事件）**：用 [packages/adapter-sdk/](../packages/adapter-sdk/) 写一个 bridge 脚本（`local-tool-bridge.mjs` 是最短模板），把工具自己的日志 / 状态文件升级成 `error` / `prompt` / `done` / `activity` 事件。
- **L3（回复 / 继续执行）**：在工具有公开 CLI / 扩展 API 后，复用 `replyToEvent` 与 `inject-input` 路径；不接入插件私有 DB / cookie。

### 添加新的提示检测模式

修改 [packages/daemon/src/pty/promptDetector.ts](../packages/daemon/src/pty/promptDetector.ts) 与配套测试 [test/promptDetector.test.mjs](../packages/daemon/test/promptDetector.test.mjs)，添加新正则并在测试中固化匹配 / 不匹配样本。

### 添加新的通知渠道

[packages/daemon/src/daemon/notifier.ts](../packages/daemon/src/daemon/notifier.ts) 当前覆盖 Windows Toast / macOS osascript / Linux notify-send。不引入聊天聚合（Slack / 邮箱 / IM）通道——这与 [POSITIONING.md](POSITIONING.md) "不做通用个人 Agent" 边界冲突。

## 测试策略

仓库使用 Node 内置 `node:test` + `node:assert`，没有 Jest / Mocha / Supertest 依赖。完整套件入口：根目录 `npm test`（顺序跑 daemon + adapter-sdk + DTO 一致性校验）。

| 维度 | 位置 | 代表用例 |
|------|------|----------|
| 单元 | `packages/daemon/test/promptDetector.test.mjs`、`sessionManager.test.mjs`、`sourceManager.test.mjs` | 状态机迁移、retention 裁剪 |
| 集成（真 daemon） | `packages/daemon/test/server.integration.test.mjs` | HTTP/WS 鉴权、observer 重连 snapshot、并行任务 |
| 兼容适配器 | `packages/daemon/test/codexDesktopAdapter.test.mjs`、`aiToolProcessAdapter.test.mjs` | 旧来源兼容层，不作为新路线扩展入口 |
| 工作流 | `packages/daemon/test/workflowDefinitionManager.test.mjs`、`workflowExamples.test.mjs` | runWorkflow hooks、示例 JSON 与 CLI 解析等价 |
| SDK | `packages/adapter-sdk/test/adapter.test.mjs`、`localToolBridge.test.mjs` | SDK 注册/事件/回复闭环、bridge classify 规则 |
| 协议契约 | `packages/daemon/test/generateCsharpDtos.test.mjs` + `npm run validate:dtos` | C# DTO 与 TS protocol.ts 一致 |
| GUI snapshot | `packages/daemon/test/chatWorkflowSnapshot.test.mjs` | 并行任务、中文 + emoji、failure 复制 |

新增功能时优先在已有同名 test 文件追加用例；新协议字段必须同步 `npm run validate:dtos`。

## 部署

### 开发环境

```bash
npm install
npm run build               # 编译 daemon + 生成 bundle
npm run gui:build           # WPF 调试构建
npm test                    # daemon + adapter-sdk + DTO 一致性
```

### Windows Alpha 用户路径

Windows Alpha 阶段以 `CodePanion.Gui.exe` 双击运行为唯一普通用户路径，不强制 CLI / NSSM / 服务化部署：

- GUI 启动时由 `DaemonProcessManager` 自动 spawn daemon（优先 `packages/daemon/bundle/daemon.cjs`，回退 `dist/daemon-entry.js`）。
- daemon 监听 `127.0.0.1`，token 写入 `~/.codepanion/config.json`（权限 0o600）。
- 退出 GUI 时 daemon 进程随之结束；无需 systemd / launchd / NSSM。
- 打包流程参考 [scripts/package-windows.ps1](../scripts/package-windows.ps1)。

跨平台 GUI（Tauri / Avalonia）与服务化部署都在 [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) 后续路线中，不作为 Alpha 阻塞项。

## 路线衔接

阶段性目标与边界统一由 [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) 与 [POSITIONING.md](POSITIONING.md) 维护，迭代清单在 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md)。本文档只描述当前架构，不再单独维护“未来规划”清单。
