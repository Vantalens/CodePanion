# CodePanion 故障排查指南

本指南覆盖 Windows Alpha 便携版的常见问题。所有命令默认在仓库根目录执行。

---

## 1. daemon / GUI 没连上

GUI 顶部显示「未连接」，或 `codepanion status` 报错。

### 1.1 确认 daemon 是否在跑

```bash
codepanion status
```

正常输出形如：

```
[codepanion] daemon running (pid=27160, port=7777)
```

未运行就启动：

```bash
codepanion start
```

### 1.2 校对配置文件

GUI、CLI、扩展共用同一份 `~/.codepanion/config.json`：

```bash
cat ~/.codepanion/config.json
```

`port` 与 `token` 必须与 GUI、扩展使用的值完全一致。
token 不要写到日志或截图里，复制时注意脱敏。

> daemon 写盘时会把 `config.json` 设为 owner-only（Unix 600 / Windows ACL）。
> 若手动改过权限被拒，删除文件后让 `codepanion start` 重新生成。

### 1.3 端口被占用

```bash
netstat -ano | findstr :7777
```

若端口被其他进程占用，改 `config.json` 的 `port` 后 `codepanion restart`，
GUI 在设置面板保存即可触发自动重连。

### 1.4 Windows 防火墙

只走 `127.0.0.1`，正常情况下防火墙不会拦截。如果企业策略强制拦本地连接，
在防火墙规则里放行 daemon 进程或修改使用的端口。

---

## 2. WebSocket 失败 / 重连不上

GUI 一直停在「重连中」，或 daemon 日志里出现 `ws rejected: ...`。

### 2.1 鉴权方式

daemon 不再接受 query string 形式的 token。WebSocket 握手必须：

- URL：`ws://127.0.0.1:7777/ws?role=observer`（CLI 客户端用 `role=cli&sessionId=...`）
- 头部：`Sec-WebSocket-Protocol: codepanion.token.<你的 token>`
- Origin：来自 GUI WebView2（`http://codepanion.local`）或被显式允许的本地源

日志里见到 `missing or invalid token subprotocol` 说明客户端发的还是老格式；
更新到对应版本的 GUI / 扩展即可。

### 2.2 短暂中断

daemon 短暂离线后再上线，GUI 会自动重连并通过 `hello` 收到 `workflow-snapshot`，
不需要手动操作。如果一直停在重连中：

1. `codepanion status` 确认 daemon 已经在新端口监听。
2. 关掉 GUI 重开，让它重新读取 `config.json`。
3. 看 `~/.codepanion/daemon.log` 有没有 `ws rejected` 的具体原因。

### 2.3 GUI 看不到任何事件

WebSocket 接通但时间线空白：

1. `codepanion notify "测试" -m "ping"` — 应在 GUI 立即出现一条通知。
2. 没出现就说明 observer 没建立或被 Origin 拦了，看 daemon 日志确认。
3. 出现了说明事件通道正常，问题在来源端（VS Code 扩展未注册、Codex Desktop 没有产生 rollout 等）。

---

## 3. 文字乱码

CodePanion 全链路是 UTF-8。出现中文乱码：

1. HTTP 调用方加 `Content-Type: application/json; charset=utf-8`。
2. 用 `codepanion notify "测试通知" -m "这是一条中文消息"` 验证 daemon → GUI 链路。
3. 看 `~/.codepanion/daemon.log` 和 GUI 日志：
   - 日志里就是乱码 → 来源端编码不对
   - 日志正常但页面乱码 → WebView 渲染层问题，提供 GUI 版本号反馈
4. 不要在中文上做二次手动转义，直接发 JSON 字符串。

---

## 4. 多源监控没事件

`GET /sources` 没有期待中的来源，或者来源在但没事件。

1. **VS Code 扩展**：加载 `packages/vscode-extension/`，能读取 `~/.codepanion/config.json` 或在扩展设置里手动配 token。
2. **Codex Desktop**：daemon 启动时会扫描 `~/.codex/sessions/`。没有 rollout 文件就不会出现来源。
3. **外部适配器**：必须先 `POST /sources/register`，再 `POST /events`，否则事件会被丢弃。
4. **CC Switch / 国产 AI 工具**：仅做 L1/L2 进程级识别，能看到来源连接但不会有事件流（设计如此）。

---

## 5. 通知收不到

通知分两路：

- **系统通知**：daemon 本机 toast，受 `toast.enabled` 控制。
- **GUI 通知**：WebSocket 推送，只要 GUI 在跑就能收到。

排查：

1. `codepanion status` 确认 daemon 在跑。
2. `~/.codepanion/config.json` 的 `port` / `token` 与 GUI、扩展一致。
3. `codepanion notify "测试通知" -m "中文消息"`。
4. GUI 关着的情况下，至少应看到系统通知；都没看到就是 toast 通道有问题，查 daemon 日志。
5. GUI 开着，时间线应该出现 `notification` 消息。

---

## 6. 收集反馈所需信息

提交问题时请附上以下内容（注意 token 脱敏）：

1. `codepanion status` 输出
2. `~/.codepanion/config.json` 内容（**抹掉 token**）
3. `~/.codepanion/daemon.log` 末尾 ~50 行
4. GUI 版本号与操作系统版本
5. 复现步骤

---

## 7. 已知限制

- 当前只支持 Windows x64 便携版。其他平台靠源码自行构建，未列入 Alpha 支持范围。
- WebSocket 鉴权使用 subprotocol token，不支持 URL query token。老客户端必须升级。
- 国产 AI 工具仅做进程级识别，不会读取它们的私有数据库 / 账号 / cookie。

更多产品边界见 [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) 的「产品边界」与「方向校准」章节。
