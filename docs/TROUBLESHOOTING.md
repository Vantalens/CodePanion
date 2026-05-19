# CodePanion 故障排查指南

## 文字乱码

CodePanion 的 HTTP、WebSocket、GUI 日志和 WebView 消息都应使用 UTF-8。若中文标题或正文显示乱码：

1. 确认调用方请求头包含 `Content-Type: application/json; charset=utf-8`。
2. 使用 `codepanion notify "测试通知" -m "这是一条中文消息"` 验证 daemon 到 GUI 的链路。
3. 检查 `~/.codepanion/gui.log` 和 daemon 日志是否已经乱码；如果日志正常但页面乱码，问题在 WebView 渲染层。
4. 不要对中文内容做二次手动转义，直接发送 JSON 字符串。

## 收不到通知

通知分为两个通道：

- 系统通知：由 daemon 的 native notifier 发送，受 `toast.enabled` 控制。
- GUI 通知：由 WebSocket observer 推送，只要求 GUI 已连接 daemon。

排查顺序：

1. `codepanion status` 确认 daemon 正在运行。
2. 检查 `~/.codepanion/config.json` 中 GUI 和扩展使用的 `port`、`token` 是否一致。
3. 发送 `codepanion notify "测试通知" -m "中文消息"`。
4. GUI 未打开时，至少应看到系统通知或 daemon warning。
5. GUI 打开时，时间线应出现 `notification` 消息。

## 多源监控没有事件

1. VS Code 扩展需要加载 `packages/vscode-extension/`，并能读取 `~/.codepanion/config.json` 或手动配置 token。
2. 外部适配器应先调用 `POST /sources/register`，再调用 `POST /events`。
4. GUI 中看不到来源时，调用 `GET /sources` 检查 daemon 是否收到注册。

## 问题现象
GUI 显示"未连接"状态，点击"重新连接"按钮无法连接到 daemon。

## 排查步骤

### 1. 确认 daemon 正在运行

```bash
codepanion status
```

应该显示类似：
```
[codepanion] daemon running (pid=27160, port=7777)
```

如果未运行，启动 daemon：
```bash
codepanion start
```

### 2. 检查配置文件

查看配置文件：
```bash
cat ~/.codepanion/config.json
```

确认 `port` 字段的值（通常是 7777）。

### 3. 测试连接

运行测试脚本：
```bash
cd d:/CodePanion
node test-connection.js
```

如果测试成功，说明 daemon 工作正常，问题可能在 GUI 端。

### 4. 查看 GUI 调试日志

如果你在 Visual Studio 或 VS Code 中运行 GUI，可以在输出窗口看到详细的连接日志。

或者使用 DebugView 工具查看 Windows 调试输出。

## 常见解决方案

### 方案 1：重启 daemon
```bash
codepanion restart
```

### 方案 2：清理并重启
```bash
# 停止 daemon
codepanion stop

# 关闭 GUI（如果正在运行）
taskkill //F //IM CodePanion.Gui.exe

# 重新启动 daemon
codepanion start

# 重新启动 GUI
cd d:/CodePanion
npm run gui:run
```

### 方案 3：检查防火墙
确保 Windows 防火墙没有阻止本地连接（127.0.0.1:7777）。

### 方案 4：检查端口冲突
```bash
netstat -ano | findstr :7777
```

如果端口被其他程序占用，修改配置文件中的端口号。

## 已知问题

### WebSocket 连接超时
- **原因**：C# WebSocket 客户端库可能需要更长的连接时间
- **解决**：点击"重新连接"按钮，通常第二次尝试会成功

### 首次连接失败
- **原因**：GUI 启动时 daemon 可能还未完全就绪
- **解决**：等待几秒后点击"重新连接"

## 调试技巧

### 1. 使用诊断脚本
```bash
cd d:/CodePanion
diagnose.bat
```

### 2. 手动测试 WebSocket
使用 Node.js 测试脚本验证 WebSocket 连接：
```bash
node test-connection.js
```

### 3. 查看 daemon 日志
daemon 的日志通常在：
```
~/.codepanion/daemon.log
```

## 技术细节

### 连接流程
1. GUI 启动时读取 `~/.codepanion/config.json`
2. 发送 HTTP GET 请求到 `http://127.0.0.1:7777/health`
3. 如果健康检查成功，建立 WebSocket 连接到 `ws://127.0.0.1:7777/ws?token=xxx&role=observer`
4. 收到 `hello` 消息后，连接状态变为"已连接"

### 超时设置
- HTTP 健康检查超时：5 秒
- WebSocket 重连间隔：10 秒
- WebSocket 错误重连间隔：30 秒

## 获取帮助

如果以上方法都无法解决问题，请提供以下信息：

1. `codepanion status` 的输出
2. `cat ~/.codepanion/config.json` 的内容
3. `node test-connection.js` 的输出
4. GUI 是否显示"重新连接"按钮
5. 点击"重新连接"后的状态变化

## 改进建议

我们已经在最新版本中改进了连接稳定性：

✅ 增强的错误处理和日志
✅ 自动重连机制
✅ 手动重连按钮
✅ 详细的连接状态显示
✅ 超时检测

如果你仍然遇到连接问题，这可能是 WebSocket 客户端库的兼容性问题。我们正在考虑切换到更稳定的 WebSocket 实现。

