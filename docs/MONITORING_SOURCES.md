# RemindAI 监控源说明

RemindAI 采用多源工作流事件中心模型。作为个人本地 AI 工作流中控台，daemon 不再只接收 `remindai run --` 包装的 PTY 会话，也会统一接收 Codex Desktop、VS Code 扩展和外部适配器上报的本地工作流事件。

## 支持的来源

| 来源 | 状态 | 能力 | 边界 |
| --- | --- | --- | --- |
| CLI / PTY | 已支持 | 监控 `remindai run -- <command>` 输出、等待输入、退出码 | 只能监控被 RemindAI 启动的命令 |
| Codex Desktop | 第一阶段支持 | 只读同步 `~\.codex\sessions\**\*.jsonl` 中的线程、消息、工具调用、命令输出和代码块 | 不读取 auth、token、cookie，不调用私有网络 API |
| VS Code 扩展 | 第一阶段支持 | 每个 VS Code 窗口注册为独立来源，上报任务结束、终端打开等事件 | 不读取 VS Code 或第三方扩展的私有内部状态 |
| Claude Code / Codex | 第一阶段支持 | 通过 CLI/PTTY 或 VS Code 窗口/终端事件映射为独立会话 | 不强行读取不可公开的内部状态 |
| 外部适配器 | 已支持 API | 任意本地工具可调用 `/sources/register` 和 `/events` 接入控制台 | 需要 daemon token |

## 配置

配置文件位于 `~/.remindai/config.json`。

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

`toast.enabled` 只控制系统通知。GUI 内消息推送由 WebSocket 连接控制，不受 `toast.enabled` 影响。

## 工作流来源 API

所有非 `/health` 请求都需要：

```http
Authorization: Bearer <token>
Content-Type: application/json; charset=utf-8
```

### 注册来源

`POST /sources/register`

```json
{
  "kind": "vscode",
  "name": "VS Code",
  "windowTitle": "RemindAI",
  "workspace": "D:\\RemindAI",
  "capabilities": ["window", "tasks", "terminals"]
}
```

### 上报事件

`POST /events`

```json
{
  "type": "prompt",
  "source": "vscode",
  "sourceId": "<source-id>",
  "title": "需要输入",
  "content": "Claude Code 正在等待确认",
  "options": ["继续", "取消"]
}
```

事件类型：

- `prompt`：需要用户输入。
- `done`：任务或对话完成。
- `error`：任务或对话出错。
- `activity`：普通状态更新。
- `notification`：直接通知。

## 阶段边界

- **阶段 1**：优先提升个人本地控制台的接入质量、任务总览、提醒和接管能力。
- **阶段 2**：在现有来源模型上继续支持工作流模板、任务编排和结果归档。
- 不把多用户协作、权限或共享空间纳入当前产品路线。

## 验收场景

- 两个 VS Code 窗口同时打开时，GUI 应看到两个独立来源。
- 两个 `remindai run --` 会话同时等待输入时，GUI 回复必须写回对应 session。
- 中文标题和正文在 daemon 日志、GUI 日志、WebView 中都不能乱码。

