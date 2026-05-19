# RemindAI API 文档

RemindAI daemon 是本地 AI 开发工作流控制台 / 控制平面的数据与事件中枢。它默认监听 `http://127.0.0.1:7777`，WebSocket 默认路径为 `ws://127.0.0.1:7777/ws`。

除 `GET /health` 外，所有 HTTP API 都需要 `Authorization: Bearer <token>`。token 位于 `~/.remindai/config.json`。

## 控制平面语义

本轮策略修订保留现有 API，不引入破坏性接口。`source`、`session`、`workflow`、`event` 是 RemindAI 后续适配器 SDK、审计快照和 provider adapter 的稳定语义基础：

- `source`：一个本地工具、窗口、插件、CLI 或外部适配器来源。
- `session`：由 RemindAI 可接管的 CLI/PTTY 会话。
- `event`：来源上报的状态、提醒、完成、失败或等待输入。
- `workflow`：面向 GUI 的统一线程和条目视图，用于汇总跨来源上下文。

API 只描述本地控制台能力，不代表 RemindAI 会读取上游工具的私有状态。接入方必须通过公开 API、CLI/PTTY、扩展或显式适配器上报数据。

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

`kind` 可选：`cli`、`vscode`、`claude-code`、`codex`、`codex-desktop`、`cursor`、`antigravity`、`ai-ide`、`trae`、`codebuddy`、`lingma`、`marscode`、`codegeex`、`comate`、`qwen-code`、`external`。

来源能力应按层级声明在 `capabilities` 中，例如 `process-detected`、`window`、`cli-detected`、`code-oss-family`、`plugin-family`。进程级识别只表示 L1/L2 能力，不应被外部文档或 UI 描述为深度集成。

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

## 后续扩展方向

以下方向会建立在现有 API 语义上，不在当前 Alpha 中引入破坏性改动：

- **适配器 SDK**：围绕 `/sources/register`、`/events`、事件回复和 workflow snapshot 提供更稳定的外部接入规范。
- **审计快照**：基于 `workflow` 与来源事件生成本地导出，不读取上游私有数据库。
- **Provider adapter**：为 Qwen、DeepSeek、GLM、腾讯混元等模型或网关预留路由语义，但 RemindAI 当前不做模型平台或 token 二次分销。
- **跨平台通道**：在 Beta 前评估 Tauri/Avalonia 和 Named Pipe / Unix Domain Socket 等本地通道增强。

## 数据边界

- 不读取账号、token、cookie、浏览器登录态或供应商认证文件。
- 不读取 VS Code、JetBrains 或第三方插件的私有数据库和缓存。
- 不默认启用系统级 OCR、全局屏幕读取或剪贴板扫描。
- 不调用未公开、未授权或易漂移的上游私有 API。

## 编码要求

所有 HTTP 请求体、响应体、WebSocket 消息和日志均按 UTF-8 处理。调用方应发送 `Content-Type: application/json; charset=utf-8`，并避免手动对中文做二次转义。
