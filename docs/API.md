# RemindAI API 文档

RemindAI daemon 默认监听 `http://127.0.0.1:7777`，WebSocket 默认路径为 `ws://127.0.0.1:7777/ws`。

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

## 多源监控 API

### `POST /sources/register`

注册一个监控来源。

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

`kind` 可选：`cli`、`vscode`、`claude-code`、`codex`、`browser-extension`、`external`。

### `GET /sources`

返回当前已注册监控来源。

### `POST /events`

上报统一监控事件。

```json
{
  "type": "done",
  "source": "browser-extension",
  "sourceId": "source-id",
  "title": "浏览器对话已结束",
  "content": "ChatGPT 已生成完成",
  "windowTitle": "ChatGPT",
  "url": "https://chatgpt.com/"
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

CLI 会话事件：

- `inject-input`

## 编码要求

所有 HTTP 请求体、响应体、WebSocket 消息和日志均按 UTF-8 处理。调用方应发送 `Content-Type: application/json; charset=utf-8`，并避免手动对中文做二次转义。
