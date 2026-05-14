# RemindAI 监控源说明

RemindAI 现在采用多源事件中心模型。daemon 不再只接收 `remindai run --` 包装的 PTY 会话，也可以接收 VS Code 扩展、浏览器扩展和外部适配器上报的监控事件。

## 支持的来源

| 来源 | 状态 | 能力 | 边界 |
| --- | --- | --- | --- |
| CLI / PTY | 已支持 | 监控 `remindai run -- <command>` 输出、等待输入、退出码 | 只能监控被 RemindAI 启动的命令 |
| VS Code 扩展 | 第一阶段支持 | 每个 VS Code 窗口注册为独立来源，上报任务结束、终端打开等事件 | 不读取 VS Code 或第三方扩展的私有内部状态 |
| Claude Code / Codex | 第一阶段支持 | 通过 CLI/PTTY 或 VS Code 窗口/终端事件映射为独立会话 | 不强行读取不可公开的内部状态 |
| 浏览器扩展 | 第一阶段支持 Chromium/Edge | 只在 allowlist 域名中监控页面状态，生成结束或错误时上报 | 默认不读取所有网页，用户必须配置 token 和域名 |
| 外部适配器 | 已支持 API | 任意本地工具可调用 `/sources/register` 和 `/events` | 需要 daemon token |

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
    "vscode": true,
    "browserExtension": true,
    "browserAllowlist": [
      "chat.openai.com",
      "chatgpt.com",
      "claude.ai",
      "github.com"
    ]
  }
}
```

`toast.enabled` 只控制系统通知。GUI 内消息推送由 WebSocket 连接控制，不受 `toast.enabled` 影响。

## 监控源 API

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

## 浏览器扩展权限边界

浏览器扩展使用 Manifest V3，默认 content script 会加载到页面，但只有域名匹配 allowlist 时才开始检测状态。扩展不会默认上报页面全文，只上报标题、URL 和检测到的状态摘要。

第一阶段的浏览器状态检测是启发式规则，适合 ChatGPT、Claude 等常见 Web 对话页面的“生成结束/错误”提醒。更精确的站点规则应按域名单独增加。

## 验收场景

- 两个 VS Code 窗口同时打开时，GUI 应看到两个独立来源。
- 两个 `remindai run --` 会话同时等待输入时，GUI 回复必须写回对应 session。
- 浏览器扩展在 allowlist 页面检测到生成结束后，GUI 应收到 `browser-extension` 来源的完成事件。
- 中文标题和正文在 daemon 日志、GUI 日志、WebView 中都不能乱码。

