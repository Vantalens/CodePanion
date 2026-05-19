# 阶段 1 验收清单

本文档用于判断 CodePanion 的 Windows Alpha 个人本地控制台闭环是否仍然成立。阶段 1 的验收目标不是证明 CodePanion 已经是完整 AI IDE，而是证明它可以稳定承担本机 AI 开发任务的统一查看、提醒、上下文判断和可控回复。

## 自动化基线

提交涉及 daemon、协议、GUI、扩展或文档时，至少运行：

```powershell
npm test
npm run build
npm run validate:extensions
dotnet build packages/gui/CodePanion.Gui.csproj -c Release
git diff --check
```

当前 `npm test` 覆盖：

- `promptDetector`：确认 yes/no 与编号选项提示可识别。
- `sessionManager`：确认输出历史和 chunk 数量存在保留上限，并且 prompt 会保留必要上下文。
- `sourceManager`：确认外部来源事件和事件回复存在保留上限。
- `workflowManager`：确认线程、条目、去重集合和最小 workflow 快照恢复存在回归覆盖。
- HTTP 集成测试：确认 `/health`、认证、session 注册、输出追加、prompt、输出读取、session 列表和 exit 链路可用。
- WebSocket 集成测试：确认 observer 能收到 session workflow 事件，CLI socket 能收到目标 session 的 `inject-input`。

## 手动验收场景

这些场景需要真实 Windows GUI、真实终端和 WebView2 环境验证。自动化测试通过只能说明协议和核心状态机成立，不能替代真实产品验收。

- 同时运行两个以上 `codepanion run -- <ai-tool>` 会话，GUI 左侧任务收件箱能稳定显示独立任务。
- 至少一个会话进入等待输入状态，任务排序、主工作台和统计区能突出显示待处理任务。
- 两个会话同时等待输入时，从 GUI 回复其中一个，输入只写回目标 session。
- Codex Desktop 本地线程、VS Code 来源和 CLI/PTTY 会话同时存在时，GUI 能正确区分来源、工作区和状态。
- VS Code extension 能注册来源并发送轻量事件。
- 外部适配器通过 `/sources/register` 和 `/events` 发送 prompt 后，可以通过事件回复通道回写。
- 中文文本经过 daemon、HTTP、WebSocket、GUI 日志和 WebView 后不乱码。
- daemon 重启后，GUI 可重新连接，并能看到最小 workflow 历史快照。
- 真实运行截图或录屏应归档到阶段 1 验收记录；没有截图时，不应把视觉验收标记为完成。

## 持久化与保留规则

当前阶段只做“最小有用历史恢复”，不做完整会话进程恢复。

- `SessionManager`：会话输出 `fullOutput` 最多保留 256 KiB，`outputChunks` 最多保留 1000 条；会话退出后延迟清理，不保证 daemon 重启后恢复 PTY 进程。
- `WorkflowManager`：最多保留 80 个 workflow thread，每个 thread 最多 500 个 item，去重集合会随保留数据重建；快照写入 `~/.codepanion/workflow-snapshot.json`。
- `WorkflowManager` 恢复规则：`done` 和 `error` 状态保持原状态；`running`、`waiting` 等运行态恢复为 `paused`，避免把已断开的历史误判为仍在运行。
- `SourceManager`：最多保留 1000 条来源事件，每个事件最多 50 条回复。
- GUI WebView：当前消息列表最多保留 5000 条，代码检查器最多保留 300 个代码块；后续仍需要真正的长列表虚拟化或更细的清理策略。

## 能力边界

- CodePanion 默认不读取上游工具私有数据库、账号、token、cookie 或全局屏幕内容。
- L1 进程级识别只能表示工具存在或运行，不等于深度状态接管。
- Codex Desktop 同步只能基于本机可见的本地工作流数据和过滤规则，不应被描述为读取私有状态。
- VS Code 和外部适配器能力以公开扩展 API 或显式接入事件为准。
- 阶段 1 不包含团队协作、权限审批、共享空间、模型聊天客户端或 token 分销。

## 当前未完成项

- 真实 GUI 多会话截图或录屏尚未归档。
- `codexDesktopAdapter` 解析测试尚未补齐。
- 长时间运行和大量事件压测的内存曲线尚未记录。
- GUI 列表仍是保留上限方案，不是完整虚拟列表方案。
- 安装、故障排查和发布说明仍需继续清理旧路径。
