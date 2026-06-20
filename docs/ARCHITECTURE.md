# CodePanion 架构设计文档

## 概述

CodePanion 是一个本地优先、供应商中立、面向个人开发者的轻量 AI IDE，用于把产品目标拆成可执行任务，让不同 AI 角色和模型协作完成规划、实现、测试、审查、文档和交付归档。最终架构以 Rust daemon 为核心，支撑本地全自动开发 workflow、多 AI 角色分工、高危行为审核门和多项目/多任务并行调度。

当前默认运行时是 Rust daemon。旧 Node daemon 仅作为行为兼容基线保留，不再是 GUI 启动、打包或新增能力的默认路径。Rust daemon 必须持续兼容 GUI 所需的 workflow board、run detail、artifact、delivery、gate resolve 和 WS `workflow-run-event` 契约。既有 `source` / `session` 语义只作为历史兼容或清理对象，不作为新路线的产品对象。

产品路线分为四个阶段：

1. **Rust daemon 技术验证**：验证内存、启动、二进制大小、HTTP/WS、模型客户端和流式输出。
2. **Rust 核心模块迁移**：迁移 model client、agent runtime、tool-use、workflow engine、provider registry、storage 和 HTTP/WS 契约。
3. **本地全自动开发闭环**：实现多 AI 角色分工、自动计划/实现/测试/审查/文档、高危行为检测和人工门。
4. **多项目/多任务并行调度**：实现 projects、全局 runs/gates/队列、跨项目 artifact 和跨项目依赖。

第一阶段不做默认系统级 OCR、全局窗口内容读取或外部窗口监听；外部工具只作为用户显式授权的 executor。国产 AI 编程工具采用分层覆盖策略，首批按通义灵码 / Qoder、CodeBuddy、Trae、百度 Comate、CodeGeeX 推进，MarsCode、CodeArts 放入下一梯队验证。CodePanion 明确不以多用户协作或团队平台为目标，也不做通用个人 Agent、聊天聚合器、模型聊天客户端、完整 AI IDE、通用 launcher、系统进程监控器或 token 二次分销平台。

## 架构契约

- **Rust 优先**：新增 daemon 核心能力在 Rust 实现；Node 实现只作为旧行为基线和迁移参照。
- **本地优先**：daemon 默认监听 `127.0.0.1`，除健康检查外请求需要本地 token；运行权限保持在当前用户范围内。
- **最小采集**：默认只采集完成本地 workflow 所需的会话状态、事件、必要上下文、角色执行记录和用户明确选择的数据。
- **全自动执行 + 高危门控**：低危读写、测试、审查和文档动作可自动推进；删除、关键配置修改、危险命令、网络请求、git 历史修改等高危行为必须进入人工门。
- **不读私有状态**：不读取账号、token、cookie、插件私有数据库、上游工具私有 API 或全局屏幕内容。
- **多任务并行**：workflow run 必须能按项目隔离、并行执行、取消、恢复，并在全局队列中可观察。
- **接口稳定**：`workflow`、`event`、`artifact`、`gate` 是事件协议的核心语义；`source` 仅为历史兼容层，后续新能力应优先围绕 workflow executor 建模。

## Rust 目标架构

Rust daemon 是下一阶段开发入口。它应按模块拆分，而不是照搬 Node 文件结构：

```text
codepanion-rust/
├── crates/
│   ├── daemon/          # axum HTTP/WS, process lifecycle, auth
│   ├── shared/          # DTO, protocol, error model
│   ├── config/          # config.json, model backends, owner-only writes
│   ├── model-client/    # OpenAI-compatible client, streaming, tool calls
│   ├── providers/       # external agentic coding tool API/CLI/harness providers
│   ├── agent-runtime/   # tool-use loop, permissions, high-risk detection
│   ├── workflow-engine/ # definitions, runs, gates, artifacts, scheduler
│   └── storage/         # workspace/project stores, NDJSON history, migration
└── Cargo.toml
```

迁移验收顺序：

1. `/health` + WebSocket hello 可由 GUI 连接。
2. `POST /workflow/runs` 能启动 shell step 并推送 `workflow-run-event`。
3. agent step 能调用 OpenAI-compatible API，并支持只读 tool-use。
4. provider registry 能注册 API provider、CLI provider 和 in-process harness，并把外部工具输出归一为 step output。
5. `write_file` / `run_command` 经过权限和高危行为检测。
6. `GET /workflow/board`、run detail、artifacts、delivery、gates 与现有 GUI 契约兼容。
7. project registry 和多 run scheduler 支持多项目/多任务并行。

## Provider 架构

外部 agentic coding tool 通过 provider 接入 Rust daemon。provider 是 workflow step executor 的一种实现，必须统一遵守 workspace、permission、risk gate、event 和 artifact 契约。

### Provider 类型

| 类型 | 用途 | 例子 |
| --- | --- | --- |
| `api` | 调用外部工具公开 API | Codex API、Claude Code API、OpenCode API（若可用） |
| `cli` | 受控运行外部 CLI | `codex exec`、`claude -p`、`opencode run` |
| `harness` | 在 CodePanion 内复刻 agent 架构 | Claude Code 风格 tool-use、Codex 风格任务执行、OpenCode 风格 subagent |

### Provider 契约

每个 provider 必须声明：

- `id` / `kind` / `displayName`
- 支持的能力：read、write、command、network、delegate、streaming、cancel
- 默认权限：readWorkspace、writeWorkspace、runCommand、useNetwork、delegateTask
- 是否默认要求人工门：`requiresHumanGate`
- runtime：`api.baseUrl`、`cli.command + args` 或 `harness.name`
- 对 workspace cwd、文件范围、环境变量和网络访问的约束
- 输出映射：stdout/stderr、assistant text、tool calls、artifacts、delivery-note preview

Rust bootstrap 已提供 `ProviderRegistry`，按稳定 `id` 注册 provider，并拒绝重复 id。所有 executor 后续都必须归一为 `ProviderOutput`，再由 workflow engine 映射到 step output、artifact、delivery-note 和 GUI 事件。

CLI provider 的 bootstrap executor 只运行用户配置的 `cli.command + args`，强制 `cwd = workspace root`，额外参数必须命中 allowlist，父进程环境默认清空后只注入显式 env，workflow prompt 通过 stdin 传给外部工具，支持 timeout 和取消，并把 stdout/stderr 同时归档为 `ProviderOutput` 与可转发到 WebSocket 的 stream event。

API provider 的 bootstrap executor 只调用用户配置的 `api.baseUrl`，默认使用 OpenAI-compatible `/chat/completions` 路径，API key 只作为显式 Bearer header 注入，日志和请求摘要必须脱敏。非 2xx 响应进入统一错误模型，请求前与响应读取期间都必须响应取消，usage 字段归一为 token 统计，SSE `data:` 内容 chunk 映射为 step-output stream event。

Harness provider 通过进程内 `HarnessExecutor` 接口复用 Rust agent runtime。provider 层负责校验权限、取消和 high-risk 标记；agent-runtime 层实现 `InProcessHarness`，把 agent 响应归一为 `ProviderOutput`，并把 subagent/role 委派记录为 delegated task。高危 harness 请求必须设置 `requires_human_gate`，由 workflow engine 后续转成人工门。

首批内置外部工具 provider 模板：

- `codex-cli`：`codex exec`
- `claude-code-cli`：`claude -p`
- `opencode-cli`：`opencode run`

这些模板不会绕过 CLI executor 的 cwd、参数、环境、超时、取消和输出捕获约束；默认声明写入、命令和委派能力，因此默认需要 human gate。

Provider 不允许读取外部工具的私有 token、cookie、插件数据库、闭源内部状态或全局屏幕内容。CLI provider 只能通过用户显式配置的命令和凭据运行；API provider 只能使用用户配置的 API endpoint/key；harness provider 只能复刻通用 agent 结构，不伪装成拥有闭源内部能力。

## 系统架构

### 整体架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                            用户层                                     │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│   │  Tauri GUI   │  │  Terminal    │  │  Workflow Executors       │  │
│   │  + React     │  │  + CLI/PTTY  │  │  (Codex / Claude /        │  │
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
GET /health
  获取守护进程状态
  Response: { ok: boolean, pid: number, version: string }

GET /api/v1/projects
POST /api/v1/projects
  项目注册与管理

GET /api/v1/providers
POST /api/v1/providers
  Provider 注册与管理

GET /workflow/runs
GET /workflow/gates
  Workflow run、artifact、delivery 和 human gate 查询
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

**预置示例**：workflow 示例由 Rust workflow engine 和 GUI 工作台消费；历史 TypeScript 示例只作为迁移参考，不再是默认导入路径。

## 数据流详解

### 场景 1：执行本地 workflow

```
1. 用户在 GUI 或 CLI 中启动 workflow
   ↓
2. Rust daemon 写入 run history 并调度 step
   ↓
3. step 调用 API provider、CLI provider、harness 或本地命令
   ↓
4. 低风险步骤自动推进，高风险步骤进入 human gate
   ↓
5. artifacts、delivery note 和 gate history 写入本地存储
   ↓
6. WebSocket 推送 workflow-run-event 到 GUI
   ↓
7. GUI 更新 run 时间线、artifact 预览和 gate 面板
```

### 场景 2：Human gate 决策

```
1. workflow step 标记 requires_human_gate
   ↓
2. Rust daemon 写入 pending gate
   ↓
3. GUI 展示 approve / reject / retry 和 constraints 输入
   ↓
4. 用户提交决策
   ↓
5. /workflow/gates/:runId/:stepId/resolve 持久化决策
   ↓
6. workflow 按决策继续、重试或失败
   ↓
7. gate history 在 GUI 中可复查
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

Rust daemon 使用统一错误响应：输入校验失败回 400，未知资源回 404，内部异常回 500。客户端按 HTTP 状态码做差异化处理：

- Rust CLI 失败：命令向 stderr 输出错误并返回非零退出码。
- 旧 Adapter SDK 失败：仅作为兼容层维护，不作为新路线扩展入口。
- GUI 失败：默认 Tauri shell 负责 daemon 生命周期、认证配置桥接、受限外部 URL 打开和关闭清理；React 端通过 typed HTTP/WS client 进入断线态并允许刷新。项目/provider 的 create、update、delete、activate/select 和刷新流程在 React 工作台内完成。tray、原生文件选择、系统剪贴板和通知不属于当前默认 shell 契约，直到有对应实现和测试；legacy WPF 代码保留在 `packages/gui-wpf-legacy` 作为兼容基线。

### 错误恢复策略

| 错误类型 | 恢复策略 |
|---------|---------|
| CLI provider 启动失败 | executor 返回可读 stderr、退出码和风险上下文 |
| daemon HTTP 不可达 | CLI/GUI/SDK 各自重试或退避；GUI 显示"未连接"并触发后台重连 |
| WebSocket 断开 | GUI 端 2s → 30s 指数退避；重连后重新拉取 workflow/project/provider 状态 |
| daemon 进程崩溃 | 由 `DaemonProcessManager.EnsureStartedAsync` 重启 Rust daemon |
| 配置文件损坏 | Rust config manager 报错；用户可备份后删除对应 `.codepanion` 配置文件重新生成 |

## 资源监管

详细 retention 策略见 [docs/RETENTION.md](RETENTION.md)。简述：

- **WorkflowRunHistory**：持久化 run history，支持 GUI run 列表和详情恢复。
- **WorkflowArtifactStore**：持久化 artifacts、delivery note 和 gate 决策记录。
- **RunScheduler**：维护 queued/running/completed 状态，支持全局视图 API。
- **GUI 端**：WebSocket 断开后指数退避重连，并通过 HTTP API 恢复项目、run、gate 和 provider 状态。

## 安全考虑

### 1. 本地通信

- 守护进程只监听 `127.0.0.1`
- 不暴露到公网

### 2. 输入验证

- 验证所有 API 输入（Rust serde 类型和 route-level 校验）
- 防止命令注入

### 3. 权限控制

- 守护进程以用户权限运行
- 不需要 root/管理员权限

## 扩展性

### 接入新的 AI 编程工具

按能力选择 provider 类型：

- **API provider**：OpenAI-compatible HTTP API，适合模型服务和网关。
- **CLI provider**：显式命令、受控 cwd、清空继承环境、stdin prompt、timeout/cancel 和输出捕获。
- **Harness provider**：进程内 agent runtime，用于本地工具循环和 delegated task。

## 测试策略

当前主测试入口是 Rust workspace；根目录 `npm test` 作为旧 TypeScript 兼容基线保留。

| 维度 | 位置 | 代表用例 |
|------|------|----------|
| 单元 | `codepanion-rust/crates/*/src/*.rs` | config、provider、workflow、runtime 纯逻辑 |
| Daemon 集成 | `codepanion-rust/crates/daemon/tests/*_test.rs` | HTTP API、WebSocket、provider、scheduler、workflow execution |
| CLI 集成 | `codepanion-rust/crates/daemon/tests/cli_test.rs` | CLI 命令真实调用 test daemon |
| GUI | `npm run gui:build` + `scripts/verify-gui-cli.ps1` | Tauri GUI 编译、Rust daemon API/CLI smoke |
| 兼容基线 | `npm test` | 旧 TypeScript 行为仍未破坏 |

新增 Rust daemon/CLI 功能时优先在 `codepanion-rust/crates/daemon/tests/` 或对应 crate 单元测试中追加用例。

## 部署

### 开发环境

```bash
npm install
npm run build               # 编译 daemon + 生成 bundle
npm run gui:build           # Tauri GUI 构建
npm test                    # daemon + adapter-sdk + DTO 一致性
```

### Windows Alpha 用户路径

Windows Alpha 阶段以 `CodePanion.exe` 双击运行为唯一普通用户路径，不强制 CLI / NSSM / 服务化部署：

- GUI 启动时由 Tauri command 自动 spawn Rust daemon（优先便携包内 `daemon/codepanion-daemon.exe`，开发环境回退 `codepanion-rust/target/release/codepanion-daemon.exe` 或 debug 构建）。旧 WPF GUI 位于 `packages/gui-wpf-legacy`，不再是默认入口。
- daemon 监听 `127.0.0.1`，token 写入 `~/.codepanion/config.json`（权限 0o600）。
- 退出 GUI 时 daemon 进程随之结束；无需 systemd / launchd / NSSM。
- 打包流程参考 [scripts/package-windows.ps1](../scripts/package-windows.ps1)。

Avalonia 备选壳、服务化部署和非 Windows 分发都在 [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) 后续路线中，不作为 Alpha 阻塞项；默认桌面壳已切到 Tauri + React。

## 路线衔接

阶段性目标与边界统一由 [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) 与 [POSITIONING.md](POSITIONING.md) 维护，迭代清单在 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md)。本文档只描述当前架构，不再单独维护“未来规划”清单。
