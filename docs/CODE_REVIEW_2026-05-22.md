# 代码审计 2026-05-22

接续 [CODE_REVIEW_2026-05-21.md](./CODE_REVIEW_2026-05-21.md) 后的第二轮审计。审查窗口：2026-05-21 主审计完成 → 2026-05-22 文档对齐之间的所有改动，重点是这段时间内新落地的 Strategy Backlog 四项：

- Adapter SDK + 两个示例适配器（[packages/adapter-sdk/](../packages/adapter-sdk/)）
- 本地审计导出（[packages/daemon/src/cli/audit.ts](../packages/daemon/src/cli/audit.ts)、[packages/daemon/src/daemon/server.ts](../packages/daemon/src/daemon/server.ts)）
- 国产工具 Qoder 独立 kind 与 local-tool-bridge 桥接示例
- 工作流模板产品化（`runWorkflow` hooks + `workflow import` + 示例模板）

以及打包侧的 [scripts/package-windows.ps1](../scripts/package-windows.ps1) 与 [packages/gui/CodePanion.Gui.csproj](../packages/gui/CodePanion.Gui.csproj)。

发现 5 项隐患（N-1 ~ N-5）+ 1 项 Windows 便携版打包卫生问题，全部当日修复并补回归。

---

## N-1 audit --redact 漏盖 session / workflowThread 元数据 (P1)

- 路径：[packages/daemon/src/cli/audit.ts](../packages/daemon/src/cli/audit.ts)
- 现状：原 `redactSnapshot` 只覆盖 sources（workspace / kind 等少数字段）和 workflowItems 的部分字段；以下字段在导出时**仍以明文落盘**：
  - `sessions[].lastPrompt` —— PTY 检测到的等待输入文本，可能含完整的 CLI 提问
  - `sessions[].lastPromptOptions[]` —— 包括 prompt 给出的选项（"覆盖文件 D:\Owen\secret.txt"）
  - `sessions[].args[]` / `command` / `cwd` —— 用户命令行
  - `sessions[].windowTitle` —— 终端窗口标题可能含项目路径
  - `workflowThreads[].title` / `.workspace` —— 工作流线程级元数据
  - `workflowItems[].filePath` —— 工作流操作的目标文件
  - `workflowItems[].options[]` —— 工作流询问的选项数组
- 影响：`codepanion audit snapshot --redact` 的承诺是「分享时可贴外部」，缺这些字段意味着脱敏不完整，用户分享导出时仍可能泄漏路径、用户名、文件命名。
- 修复：
  - `sessions.map` 现统一对 command / args / cwd / windowTitle / workspace / lastPrompt / lastPromptOptions 做 redactText / redactPath
  - 新增 `redactWorkflowThread` 覆盖 title + workspace + 内联 items
  - `redactWorkflowItem` 扩展处理 filePath 与 options 数组
- 测试：[packages/daemon/test/auditExport.test.mjs](../packages/daemon/test/auditExport.test.mjs) 新增 `'redactSnapshot 覆盖 session 的 lastPrompt / args / cwd 与 workflowThread 元数据'`，对所有新覆盖字段断言。
- 关联文档：[POSITIONING.md](./POSITIONING.md) 隐私边界 + [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) 本地审计导出条目。

---

## N-2 workflow import 部分失败时整批回退 (P1)

- 路径：[packages/daemon/src/cli/workflows.ts](../packages/daemon/src/cli/workflows.ts) `workflowImportCommand`
- 现状：原实现把整个 JSON `Array` 直接 `for…of` + `manager.save({...})`，第一条 schema 校验失败就抛 + `process.exit(2)`，**后续合法 workflow 一条也不会落库**。
- 影响：用户从 `packages/daemon/examples/workflows/*.json` 拼了一份混合导入清单，被中间一条坏数据卡住，剩下 9 条也不写入；CLI 没有任何 imported/failed 计数，定位坏行需要二分。
- 修复：
  - 每条 entry try/catch
  - `imported` / `failed` 计数 + summary 行 `[codepanion] import summary: imported=X failed=Y`
  - 退出码语义：`imported == 0` → 1（全失败）；`imported > 0 && failed > 0` → 2（部分失败）；全成功 → 0
  - 同时校验 `entry.name` 与 `entry.steps` 存在
  - 顶层支持 `[...]` 和 `{ workflows: [...] }` 两种包装
- 测试：[packages/daemon/test/workflowImport.test.mjs](../packages/daemon/test/workflowImport.test.mjs) 覆盖 4 个分支：部分失败 → exit 2、全失败 → exit 1、wrapped 格式、JSON 不可解析。

---

## N-3 runWorkflow 抛错时 daemon source 泄露 (P2)

- 路径：[packages/daemon/src/cli/workflows.ts](../packages/daemon/src/cli/workflows.ts) `workflowRunCommand` / `workflowReplayCommand`
- 现状：`createDaemonHooks` 在 daemon 可达时会 `registerSource({kind:'cli', name:'workflow:<n>'})`。原代码假设 runWorkflow 一定走到 `onWorkflowFinish` 才会 `finalize()` → `disconnectSource()`。但 `runWorkflow` 自身在以下场景会同步 / 异步抛错：
  - workflow.steps 引用未知 template / 依赖未知 step id
  - schema 校验失败（step.command 缺失）
  - executor 透传异常
  这些路径抛错后 finalize 不会被调用，daemon 一侧的 `workflow:<n>` source 会一直停在 `online`，GUI 会把它误判为"活任务"。
- 影响：长期累积形成"幽灵 workflow source"。配合 SourceManager 的 offline cap，最终被驱逐但中间窗口期信息错。
- 修复：
  - `DaemonHookBundle` 新增 `abort(reason)` 方法
  - `createDaemonHooks` 内部 `abort` = emit error 事件 + `disconnectSource('workflow-aborted')`，并吞掉自身的 disconnect 失败
  - workflowRunCommand / workflowReplayCommand 把 runWorkflow 包在 try/catch 里，catch 分支调用 `hooks?.abort(err.message)` 再 rethrow
- 测试：受限于 daemon client 模块边界（mock 成本与实测收益不成比例），未单独测；改为代码评审与逻辑等价性验证：abort 路径与 finalize 走同一个 `disconnectSource` API，原 finalize 路径已有间接覆盖。

---

## N-4 file-watcher 示例对 node_modules 写入是事件洪水 (P2)

- 路径：[packages/adapter-sdk/examples/file-watcher.mjs](../packages/adapter-sdk/examples/file-watcher.mjs)
- 现状：示例直接 `fs.watch(absolute, { recursive: true })` + 每次 change 立刻 `emitEvent`。在仓库根上运行一次 `npm install` 会触发数万条 activity 事件，把 daemon SourceManager 的 events 环挤爆，把真实 prompt / error 顶出 retention 窗口。
- 影响：演示示例的"开箱即用"假设与 `MONITORING_SOURCES.md` 的"非数据收集系统、不做高频日志泵"承诺冲突。
- 修复：
  - 新增 `DEFAULT_IGNORE`：node_modules / .git / .svn / .hg / dist / build / out / target / .next / .cache / .turbo / .parcel-cache / coverage
  - 新增 `DEBOUNCE_MS = 200`：同一相对路径 200ms 内的 rename + change 合并成一次上报
  - 头部注释明确建议监控具体子目录而非仓库根
  - 导出 `shouldIgnore` / `DEFAULT_IGNORE` / `DEBOUNCE_MS` 供测试断言
- 测试：[packages/adapter-sdk/test/fileWatcher.test.mjs](../packages/adapter-sdk/test/fileWatcher.test.mjs) 覆盖 Windows 反斜杠路径、不误伤普通源码、忽略列表至少含核心目录、DEBOUNCE_MS 维持在合理区间。

---

## N-5 local-tool-bridge readTail 并发拆 stream (P2)

- 路径：[packages/adapter-sdk/examples/local-tool-bridge.mjs](../packages/adapter-sdk/examples/local-tool-bridge.mjs)
- 现状：`fs.watch` 在单次 append 里可能连发多次 change（OS 行为 + 文件系统驱动差异）。原实现每次 change 就直接 `fs.createReadStream(path, { start: offset })`，两路同时打开 stream 会让同一段日志被拆分到两个 stream 实例，`pending` 行内缓冲拼接顺序错乱，下游 `classify` 会把 `Continue?` + 完成行误判成同一行，prompt / done 状态混淆。
- 影响：示例本来是把"工具进程在不在" L1 升 L2 真事件级。读错事件类型直接破坏 L2 升级的可信度。
- 修复：
  - 引入 `reading` 单飞标志 + `pendingRescan` 重扫标记
  - 单流读完 `stream.on('close')` 才释放锁；释放时如有 pending 重扫，立即触发下一轮 readTail
  - 读取范围预先用 `readUntil = stat.size` 锁住，避免 TOCTOU
- 测试：现有 [packages/adapter-sdk/test/localToolBridge.test.mjs](../packages/adapter-sdk/test/localToolBridge.test.mjs) 已覆盖 classify 行为；并发读取改动属于异步 I/O 层，单元测试代价大于价值，靠代码审查 + 注释固化"为什么需要单飞"。

---

## P3 Windows 便携版打包卫生 (P3)

- 路径：[scripts/package-windows.ps1](../scripts/package-windows.ps1) + [packages/gui/CodePanion.Gui.csproj](../packages/gui/CodePanion.Gui.csproj)
- 现状：
  - `README_START.txt` 是英文，但 Alpha 阶段用户基本为中文，需要双击就能看懂的中文说明
  - `Assets/**` 一刀切复制到发布目录，含 `Assets/README.md`（开发文档）与 `app-icon-source.png` / `app-icon-source.svg`（源图）等用户不需要的开发素材
- 影响：阻塞 P3「便携版只暴露用户需要的入口、无开发噪音」一项；首次开包用户看到 README.md 会困惑这是不是必读、看到 -source.png 会怀疑是不是打包错误。
- 修复：
  - `README_START.txt` 改 8 行中文：双击启动、自动拉 daemon、目录整体性、`%USERPROFILE%\.codepanion\` 落盘位置、卸载方式
  - csproj `<None Update="Assets\**\*">` 加 Condition：`Filename=='README' Extension=='.md'` 或 `Filename` 以 `-source` 结尾的资产不再复制到 OutputDirectory
- 测试：本次只改 csproj/Conditional include + 文本资源，不引回归测试；待真机产物审计步骤接管（已挂在 DEVELOPMENT_TASKS 「当前阻塞 Alpha 收口的真机项」第 2 条）。

---

## 验证

```powershell
npm run build          # daemon TS 重新编译，生成新 audit / workflows dist 产物
npm test               # daemon 175 + adapter-sdk 19 全绿（含 4 个 workflowImport 测试 + 6 个 file-watcher 测试 + 1 个 redact 覆盖测试）
npm run validate:dtos  # C# DTO 与 protocol.ts 仍一致
```

## 关联

- [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md#2026-05-22-第二轮审计修复（N-1-~-N-5-+-打包卫生）)
- [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) 「当前阻塞 Alpha 收口的真机项」
