# CodePanion API 文档

CodePanion daemon 是个人本地 AI 工作流操作台的数据与事件中枢。它默认监听 `http://127.0.0.1:7777`，WebSocket 默认路径为 `ws://127.0.0.1:7777/ws`。

除 `GET /health` 外，所有 HTTP API 都需要 `Authorization: Bearer <token>`。token 位于 `~/.codepanion/config.json`。

## 事件协议语义

本轮路线大改暂时保留现有 API，不引入破坏性接口。新能力优先围绕 `session`、`workflow`、`event` 和后续 executor 建模；`source` 仅作为历史兼容语义保留：

- `source`：历史兼容字段，用于旧来源 / 适配层。
- `session`：由 CodePanion 可接管的 CLI/PTTY 会话。
- `event`：来源上报的状态、提醒、完成、失败或等待输入。
- `workflow`：面向 GUI 的统一线程和条目视图，后续承载任务拆分、角色执行、人工审核和 artifact loop。

API 只描述本地工作流能力，不代表 CodePanion 会读取上游工具的私有状态。后续新执行能力应由用户显式调用 executor，不走外部窗口监听或被动状态采集路线。

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

## 旧来源 API

`/sources/*` 与 `/events` 属于旧监听 / 来源接入路线的兼容接口。它们仍可能被现有代码调用，但不再作为新产品能力扩展对象。后续新能力应围绕 workflow executor、角色权限、人工审核门和 artifact loop 建模。

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

返回当前所有 workflow 线程和已同步条目。

### `GET /workflow/threads`

返回 workflow 线程列表。

### `GET /workflow/threads/:id`

返回单个 workflow 线程及其条目。

Workflow 条目统一为 `message`、`tool_call`、`command`、`file_change`、`artifact`、`prompt`、`status`。状态统一为 `running`、`waiting`、`done`、`error`、`paused`。

CLI 会话事件：

- `inject-input`

## 旧审计 API

### `GET /audit/snapshot`

返回当前 daemon 内存中（按 `retention` 滚动窗口保留的）事件、回复、会话、工作流线程与条目的合并快照。该接口是旧路线保留的本地诊断能力，后续是否保留为 artifact 导出，需要在工作流模型实现时重新评估。

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

## 后续扩展方向

以下方向会围绕本地 AI 工作流推进：

- **Workflow executor**：把 Codex、Claude Code、OpenCode、CLI/PTTY 等显式执行能力纳入统一节点模型。
- **Role policy**：为不同角色定义模型、权限、上下文预算和输出契约。
- **Artifact loop**：沉淀计划、变更摘要、测试结果、审查报告、人工决策和交付摘要。

## 数据边界

- 不读取账号、token、cookie、浏览器登录态或供应商认证文件。
- 不读取 VS Code、JetBrains 或第三方插件的私有数据库和缓存。
- 不默认启用系统级 OCR、全局屏幕读取或剪贴板扫描。
- 不调用未公开、未授权或易漂移的上游私有 API。

## 编码要求

所有 HTTP 请求体、响应体、WebSocket 消息和日志均按 UTF-8 处理。调用方应发送 `Content-Type: application/json; charset=utf-8`，并避免手动对中文做二次转义。
