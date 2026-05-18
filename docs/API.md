# RemindAI API 文档

RemindAI daemon 是本地 AI 工作流中控台的数据与事件中枢。它默认监听 `http://127.0.0.1:7777`，WebSocket 默认路径为 `ws://127.0.0.1:7777/ws`。

除 `GET /health` 外，所有 HTTP API 都需要 `Authorization: Bearer <token>`。token 位于 `~/.remindai/config.json`。

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
  "windowTitle": "RemindAI",
  "workspace": "D:\\RemindAI",
  "pid": 12345,
  "capabilities": ["window", "tasks", "terminals"]
}
```

`kind` 可选：`cli`、`vscode`、`claude-code`、`codex`、`codex-desktop`、`cursor`、`antigravity`、`external`。

### `GET /sources`

返回当前已注册工作流来源。

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
  "workspace": "D:\\RemindAI"
}
```

`type` 可选：`prompt`、`done`、`error`、`activity`、`notification`。

## WebSocket API

observer 连接：

```text
ws://127.0.0.1:7777/ws?token=<token>&role=observer
```

CLI 会话连接：

```text
ws://127.0.0.1:7777/ws?token=<token>&role=cli&sessionId=<session-id>
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

## 编码要求

所有 HTTP 请求体、响应体、WebSocket 消息和日志均按 UTF-8 处理。调用方应发送 `Content-Type: application/json; charset=utf-8`，并避免手动对中文做二次转义。
