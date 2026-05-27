# CodePanion API 文档

CodePanion daemon 是跨软件、跨窗口、跨项目的多任务完整操作台的数据与事件中枢。它默认监听 `http://127.0.0.1:7777`，WebSocket 默认路径为 `ws://127.0.0.1:7777/ws`。

除 `GET /health` 外，所有 HTTP API 都需要 `Authorization: Bearer <token>`。token 位于 `~/.codepanion/config.json`。

## 事件协议语义

本轮策略修订保留现有 API，不引入破坏性接口。`source`、`session`、`workflow`、`event` 是 CodePanion 后续适配器 SDK、审计快照和 provider adapter 的稳定语义基础：

- `source`：一个本地工具、窗口、插件、CLI 或外部适配器来源。
- `session`：由 CodePanion 可接管的 CLI/PTTY 会话。
- `event`：来源上报的状态、提醒、完成、失败或等待输入。
- `workflow`：面向 GUI 的统一线程和条目视图，用于汇总跨来源上下文。

API 只描述本地控制台能力，不代表 CodePanion 会读取上游工具的私有状态。接入方必须通过公开 API、CLI/PTTY、扩展或显式适配器上报数据。

## HTTP API

### `GET /health`

健康检查，不需要认证。

```json
{
  "ok": true,
  "pid": 12345,
  "version": "0.1.0"
}
```

### `POST /notify`

发送系统通知并推送 GUI 通知。

```json
{
  "title": "测试通知",
  "message": "中文消息不会乱码",
  "source": "manual",
  "level": "info",
  "sourceId": "optional",
  "sessionId": "optional",
  "windowTitle": "optional",
  "workspace": "optional"
}
```

`level` 可选：`info`、`prompt`、`done`、`error`。

### `POST /sessions`

注册一个 CLI/PTTY 会话。

```json
{
  "command": "claude",
  "args": ["code"],
  "cwd": "D:\\project",
  "cliPid": 12345,
  "source": "cli",
  "sourceId": "optional",
  "windowTitle": "optional",
  "workspace": "optional"
}
```

### `GET /sessions`

返回当前活动会话。

### `GET /sessions/:id/output`

返回会话完整输出和结构化输出块。

### `POST /sessions/:id/output`

追加会话输出。

```json
{
  "chunk": "output text"
}
```

### `POST /sessions/:id/prompt`

标记会话正在等待输入。

```json
{
  "lastLines": "是否继续？",
  "options": ["继续", "取消"]
}
```

### `POST /sessions/:id/reply`

向会话写入回复。

```json
{
  "text": "继续\n"
}
```

### `POST /sessions/:id/exit`

标记会话结束。

```json
{
  "exitCode": 0
}
```

## 工作流来源 API

### `POST /sources/register`

注册一个本地工作流来源。

```json
{
  "kind": "vscode",
  "name": "VS Code",
  "windowTitle": "CodePanion",
  "workspace": "D:\\CodePanion",
  "pid": 12345,
  "capabilities": ["window", "tasks", "terminals"],
  "capabilityLevel": "L2",
  "integrationKind": "extension",
  "privacyBoundary": "explicit-extension"
}
```

`kind` 可选：`cli`、`vscode`、`claude-code`、`codex`、`codex-desktop`、`cursor`、`antigravity`、`ai-ide`、`trae`、`codebuddy`、`lingma`、`marscode`、`codegeex`、`comate`、`qwen-code`、`cc-switch`、`external`。

来源能力应按层级声明：

- `capabilities`：细粒度能力标签，例如 `process-detected`、`window`、`cli-detected`、`code-oss-family`、`plugin-family`。
- `capabilityLevel`：`L1`、`L1-L2`、`L2`、`L2-L3`、`L3`、`L4`。
- `integrationKind`：`cli-pty`、`local-file-sync`、`extension`、`process-scan`、`config-switcher`、`adapter`、`manual`。
- `privacyBoundary`：`explicit-session`、`local-history`、`explicit-extension`、`minimal-process`、`config-switcher`、`explicit-adapter`。

如果调用方未提供后三个字段，daemon 会按 `kind` 和 `capabilities` 派生默认值。进程级识别只表示 L1/L2 能力，不应被外部文档或 UI 描述为深度集成。

### `GET /sources`

返回当前已注册工作流来源。

### `POST /sources/:id/disconnect`

将指定来源标记为离线，并向 observer 广播 `source-disconnected`。

```json
{
  "reason": "extension-deactivated"
}
```

`reason` 可选。来源不存在时返回 `404`。

### `POST /events`

上报统一工作流事件。

```json
{
  "type": "done",
  "source": "codex",
  "sourceId": "source-id",
  "title": "任务已结束",
  "content": "Codex 会话已完成",
  "windowTitle": "Codex",
  "workspace": "D:\\CodePanion"
}
```

`type` 可选：`prompt`、`done`、`error`、`activity`、`notification`。

## WebSocket API

WebSocket 鉴权通过 `Sec-WebSocket-Protocol` 子协议传递，不再把 token 放进 URL query，避免被日志、浏览器历史或代理记录暴露。客户端需要同时声明角色协议和 token 协议。

observer 连接：

```text
URL: ws://127.0.0.1:7777/ws?role=observer
Sec-WebSocket-Protocol: codepanion.observer, codepanion.token.<token>
```

CLI 会话连接：

```text
URL: ws://127.0.0.1:7777/ws?role=cli&sessionId=<session-id>
Sec-WebSocket-Protocol: codepanion.cli, codepanion.token.<token>
```

observer 事件：

- `hello`
- `session-registered`
- `session-output`
- `session-prompt`
- `session-exited`
- `notification`
- `source-registered`
- `source-disconnected`
- `monitor-event`
- `workflow-snapshot`
- `workflow-event`

CLI WebSocket 关闭码：

- `4400 missing sessionId`：`role=cli` 但 URL 未提供 `sessionId`。
- `4404 no such session`：提供的 `sessionId` 不存在或已经不可接管。

## Workflow API

### `GET /workflow/snapshot`

返回当前所有 workflow 线程和已同步条目。第一阶段会包含 Codex Desktop 本地会话同步结果。

### `GET /workflow/threads`

返回 workflow 线程列表。

### `GET /workflow/threads/:id`

返回单个 workflow 线程及其条目。

Workflow 条目统一为 `message`、`tool_call`、`command`、`file_change`、`artifact`、`prompt`、`status`。状态统一为 `running`、`waiting`、`done`、`error`、`paused`。

CLI 会话事件：

- `inject-input`

## 审计 API

### `GET /audit/snapshot`

返回当前 daemon 内存中（按 `retention` 滚动窗口保留的）来源、事件、回复、会话、工作流线程与条目的合并快照。供 `codepanion audit export` CLI 与本地分析脚本使用，不读取上游工具私有数据库。

**Query 参数**：

- `since`：可选，epoch 毫秒数字字符串。仅返回时间戳 ≥ `since` 的事件、回复、会话和工作流条目。非法值返回 `400`。

**响应**（`schemaVersion=1`）：

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": 1779410536204,
  "since": null,
  "daemonVersion": "0.x.y",
  "sources": [ /* MonitorSource[] */ ],
  "events": [ /* MonitorEvent + { id, timestamp }[] */ ],
  "eventReplies": [ /* { eventId, sourceId?, text, timestamp }[] */ ],
  "sessions": [ /* SessionInfo[] */ ],
  "workflowThreads": [ /* WorkflowThread[] */ ],
  "workflowItems": [ /* WorkflowItem[] */ ]
}
```

详细使用方式与脱敏选项见 [docs/LOCAL_AUDIT.md](LOCAL_AUDIT.md)。

## 后续扩展方向

以下方向会建立在现有 API 语义上，不在当前 Alpha 中引入破坏性改动：

- **适配器 SDK**：围绕 `/sources/register`、`/events`、事件回复和 workflow snapshot 提供更稳定的外部接入规范。
- **Provider adapter**：为 Qwen、DeepSeek、GLM、腾讯混元等模型或网关预留路由语义，但 CodePanion 当前不做模型平台或 token 二次分销。
- **跨平台通道**：在 Beta 前评估 Tauri/Avalonia 和 Named Pipe / Unix Domain Socket 等本地通道增强。

## 数据边界

- 不读取账号、token、cookie、浏览器登录态或供应商认证文件。
- 不读取 VS Code、JetBrains 或第三方插件的私有数据库和缓存。
- 不默认启用系统级 OCR、全局屏幕读取或剪贴板扫描。
- 不调用未公开、未授权或易漂移的上游私有 API。

## 编码要求

所有 HTTP 请求体、响应体、WebSocket 消息和日志均按 UTF-8 处理。调用方应发送 `Content-Type: application/json; charset=utf-8`，并避免手动对中文做二次转义。
