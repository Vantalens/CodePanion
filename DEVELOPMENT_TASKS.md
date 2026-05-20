# CodePanion 开发任务清单

## 使用说明

- `[ ]` 未开始
- `[-]` 进行中
- `[x]` 已完成
- `[!]` 受阻

实施细节、测试覆盖、威胁模型、压测数据记录到 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md)，不要写进本文件。

---

## 产品边界

- [x] 定位为本地优先、供应商中立、单入口多出口的 AI 开发工作流控制台 / 控制平面
- [x] 阶段 1 目标：Windows Alpha 个人本地控制台闭环
- [x] 阶段 2 目标：本地 AI 工作流操作台
- [x] 保留现有 Windows GUI、本地 daemon、CLI/PTTY、Codex Desktop 同步、VS Code 来源、外部适配器 API
- [x] 不做团队版、多用户协作、权限/审批/共享空间/企业管理
- [x] 不把 CodePanion 当作 Codex / Claude Code / Copilot CLI / VS Code 的替代品
- [x] 不做完整 AI IDE、模型聊天客户端、默认 OCR、全局屏幕读取、token 二次分销

---

## 当前已具备

- [x] 本地 daemon（HTTP + WebSocket API）
- [x] CLI/PTTY 会话监控、提示检测、回复注入
- [x] GUI 时间线 / 会话视图 / 极简控制平面
- [x] Codex Desktop 本地同步、VS Code 来源、外部来源注册 API
- [x] 国产 AI 编程工具进程级广覆盖入口
- [x] Windows x64 便携版 EXE 发布包
- [-] 文档体系重新定盘

---

## 方向校准（2026-05-20）

**判断：** 产品方向与预期方向没有根本偏差，仍应坚持「本地优先、供应商中立、Windows Alpha 个人控制台闭环」；当前偏差主要是执行重心轻微前移到安全 / 架构 / 扩展性，核心用户价值「真实任务看得见、等我时能回复、失败时能判断」还需要继续压实。

**需要纠偏的点：**

- [x] 阶段 1 继续优先真实入口闭环，不提前转向完整工作流编排、团队协作或 Enterprise 治理
- [-] 安全与鲁棒性修复继续保留，但不得替代 Claude / Codex / VS Code / CLI / Codex Desktop 的真实接入验收（真机闭环归 P1.2 真机截图）
- [x] 国产工具以 L1/L2 进程级与公开事件为主，不把存在识别包装成深度接管
- [-] GUI 端真实截图验收、断线恢复与错误可见性必须进入阶段 1 收口范围；8h 长跑实测降级为 Beta 前稳态验证
- [x] 发布包可复现性（Node 版本、SHA256、安装文档一致性）必须在 Alpha 对外使用前完成

**当前不应推进：**

- [x] 不启动多用户 / 团队协作 / 权限审批平台
- [x] 不做模型聊天客户端或 token 二次分销
- [x] 不迁移 GUI 外壳到 Tauri / Avalonia，除非 Windows Alpha 真实闭环已稳定
- [x] 不默认读取屏幕、插件私有数据库、账号、cookie 或 token

---

# 阶段 1：Windows Alpha 个人本地控制台闭环

## 阶段 1 退出标准

- [-] GUI 中能看到所有活跃的本地 AI 任务，多会话 / 多来源并存可稳定区分（daemon 链路已覆盖；真机视觉验收归 P1.2）
- [-] 等待输入的任务一眼可见、可在 GUI 内回复、断线重连后状态不丢失（daemon 链路与重连快照已覆盖；真机视觉验收归 P1.2）
- [x] CLI 回复与事件回复在 UI 中明确区分，回复失败有清晰错误
- [x] Claude Code / Codex / VS Code+Copilot / CLI/PTTY / Codex Desktop 各有可验证接入路径，并标注 L1/L2/L3/L4 能力层级
- [x] 长时间运行风险已降级处理，历史保留策略已记录可配置（retention 策略已记录可配置；8h 内存曲线不阻塞 Alpha，移入 Beta 前稳态验证）
- [x] 核心路径自动化验证基线稳定，Windows GUI 构建与配置读写已纳入
- [x] 文档真实反映产品能力，不夸大进程级识别为深度接管
- [x] 发布包内运行时版本固定、hash 可校验，开发文档与打包 target 一致

---

## P0：基础与可靠性

### P0.1 建立首方自动化测试基线

- [x] 定义测试框架与目录结构
- [x] 增加根目录统一测试命令
- [x] 核心模块加单元测试
- [x] HTTP / WebSocket 加集成测试
- [x] 开发文档记录测试流程

**验收标准：**

- [x] 全新检出仓库后，可以按文档成功运行测试命令
- [x] 对提示、会话、来源或工作流的修改都有回归覆盖

### P0.2 增加持久化与保留边界

- [x] 划分实时状态与持久化状态
- [x] 设计会话、工作流、来源事件的保留策略
- [x] 实现 daemon 重启后的最小历史恢复
- [x] 持久化与保留策略加测试
- [x] 文档说明持久化与清理规则
- [x] GUI workflow 缓存同步 daemon retention 裁剪，避免 WebView 长跑内存增长

**验收标准：**

- [x] daemon 重启后，不会丢失 GUI 继续有用所需的最小历史
- [x] daemon 与 GUI 长时间运行风险已做 Alpha 降级：当前以 retention 上限、快照裁剪和自动化回归作为防线，8h 真机曲线移入 Beta 前验证
- [x] 保留策略有文档说明且可配置

### P0.3 固化阶段 1 验收场景

- [x] 建立阶段 1 验收清单文档
- [x] 覆盖多个 CLI 会话同时运行 — [packages/daemon/test/server.integration.test.mjs](packages/daemon/test/server.integration.test.mjs)
- [x] 覆盖多个会话同时等待输入（独立 lastPrompt、互不污染） — [packages/daemon/test/server.integration.test.mjs](packages/daemon/test/server.integration.test.mjs)
- [x] 覆盖回复准确写回对应会话
- [x] 覆盖同毫秒 / 同长度 CLI 输出 item id 不碰撞，避免 workflow 输出被去重吞掉 — [packages/daemon/test/server.integration.test.mjs](packages/daemon/test/server.integration.test.mjs)
- [x] 覆盖 Codex Desktop 线程接入 — [packages/daemon/test/codexDesktopAdapter.test.mjs](packages/daemon/test/codexDesktopAdapter.test.mjs)
- [x] 覆盖 VS Code 来源注册与事件链路 — [packages/daemon/test/server.integration.test.mjs](packages/daemon/test/server.integration.test.mjs)
- [-] 覆盖中文文本在 daemon、GUI、WebView 全链路不乱码（daemon 链路已覆盖；GUI/WebView 端到端尚未验证）
- [x] 覆盖 daemon 重启后 workflow snapshot 恢复并通过 WS 推送给重连观察者 — [packages/daemon/test/server.integration.test.mjs](packages/daemon/test/server.integration.test.mjs)
- [x] 将可自动化场景接入测试命令

**验收标准：**

- [x] 任何开发者都能通过 `npm test` 判断 daemon 侧阶段 1 是否仍然成立（GUI 侧验证归入 P1.2）

---

## P1：基础入口闭环、来源质量与体验完整度

### P1.0 稳定 Alpha 基础入口闭环

- [x] 固化 Claude Code 接入步骤
- [x] 固化 Codex 接入步骤
- [x] 固化 VS Code/Copilot 接入步骤
- [x] 固化 Codex Desktop 同步窗口与归档边界
- [x] 确认所有入口进入统一 workflow 视图
- [x] 确认可回复任务正确映射回真实回复目标
- [x] 支持 CC Switch / Claude Code Switch 作为账号与 provider 切换来源，配合 Claude Code / Codex CLI 使用
- [x] 用真实 Claude / Codex / VS Code / CLI 样本逐项记录 L1/L2/L3 能力证据（自动化能覆盖的部分；真机端到端样本归入 P1.2）

**验收标准：**

- [ ] Alpha 首批入口完成「查看 → 判断 → 回复」最小闭环

### P1.1 提升来源保真度

- [x] 定义每类来源的 L1/L2/L3/L4 能力边界和事件质量
- [x] 统一来源元数据字段
- [x] Codex Desktop 过滤内部上下文与权限元信息、限制历史扫描窗口
- [x] 改善 Codex Desktop 线程标题与状态识别质量 — [packages/daemon/src/adapters/codexDesktopAdapter.ts](packages/daemon/src/adapters/codexDesktopAdapter.ts)、[packages/daemon/test/codexDesktopAdapter.test.mjs](packages/daemon/test/codexDesktopAdapter.test.mjs)
- [x] 国产 AI 工具 L1/L2 进程级识别
- [x] 收敛国产工具优先级梯队 — [packages/daemon/src/adapters/aiToolProcessAdapter.ts](packages/daemon/src/adapters/aiToolProcessAdapter.ts)、[docs/MONITORING_SOURCES.md](docs/MONITORING_SOURCES.md)
- [x] GUI 展示来源连接与离线事件
- [x] GUI 展示 CC Switch 来源、能力层级和隐私边界
- [x] 在公开 API 范围内提升 VS Code 事件价值 — [packages/vscode-extension/extension.js](packages/vscode-extension/extension.js)、[packages/daemon/test/server.integration.test.mjs](packages/daemon/test/server.integration.test.mjs)
- [x] 记录刻意不读取的数据并更新来源说明文档

**验收标准：**

- [x] 每个来源都能帮助用户判断当前重点
- [x] 文档不夸大来源真实能力

### P1.2 强化 GUI 的任务分诊能力

- [x] 前端定位为面向开发者的极简控制平面
- [x] 引入 Source Rail / 任务收件箱 / Main Stage / 上下文抽屉 / Command Bar
- [x] 展示来源能力层级与数据边界
- [x] 主区改为事件流，等待任务视觉优先
- [x] 右侧改为代码检查器，产物预览只展示真实代码块
- [x] 展示层过滤上下文噪音、过期与归档工作流
- [x] 过滤 Codex Desktop 审批 JSON 噪音，启动同步时批量渲染避免闪烁
- [x] 被动监控源不再进入主任务列表，CC Switch 等进程识别只保留为来源状态
- [x] 无可回复 prompt 时隐藏回复按钮和底部输入栏，避免制造不可交互假入口
- [x] 修复三区滚动
- [x] 等待任务映射回真实回复目标
- [x] 任务优先级排序、分组与筛选
- [x] 左栏摘要可扫读
- [!] 真实运行数据截图视觉验收

**验收标准：**

- [ ] 多任务并行时用户一眼能判断下一步

### P1.3 提升重连与失败场景可靠性

- [x] 定义 GUI 断线与 daemon 重启后的可见状态
- [x] 设置窗口保存触发 GUI 重载连接
- [x] GUI 日志不再泄露完整 daemon token
- [x] daemon 断线、自动重连、恢复状态有明确提示
- [x] 过期 / 离线来源有明确提示
- [x] 适配器与客户端失败日志足以定位问题 — [packages/daemon/src/shared/client.ts](packages/daemon/src/shared/client.ts)、[packages/daemon/src/pty/runner.ts](packages/daemon/src/pty/runner.ts)、[packages/daemon/src/adapters/codexDesktopAdapter.ts](packages/daemon/src/adapters/codexDesktopAdapter.ts)
- [x] 覆盖短暂中断后的恢复验证 — [packages/daemon/test/server.integration.test.mjs](packages/daemon/test/server.integration.test.mjs)

**验收标准：**

- [x] 短暂中断不影响用户判断任务状态

---

## P2：阶段 1 产品收口

### P2.1 清理安装与打包流程

- [x] 修正平台支持说明
- [x] daemon / GUI 启动流程已验证
- [x] Windows x64 便携版发布脚本与内置 Node runtime
- [x] 统一 Node 运行时要求：README / INSTALL / docs 与 esbuild target、打包 Node 版本一致
- [x] 发布包复制 node.exe 前校验固定版本与 SHA256
- [x] 清理过时安装与发布说明 — [INSTALL.md](INSTALL.md)、[README.md](README.md)、[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- [x] 验证新用户可按一份指南完成安装和运行

**验收标准：**

- [x] 新用户只看一份准确指南即可完成安装和运行
- [x] 发布包可复现，运行时 hash 不一致时打包失败

### P2.2 整理文档体系

- [x] 产品定位统一为本地 AI 开发工作流控制台 / 控制平面
- [x] 历史报告标记为历史快照
- [x] README 与安装说明面向双击便携版用户
- [x] 核心文档吸收研究报告结论并明确产品保留决策
- [x] 继续校准故障排查与发布说明 — [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)、[INSTALL.md](INSTALL.md)

**验收标准：**

- [x] 文档不夸大当前能力
- [x] 仓库内产品定位始终一致

---

## P3：代码审核遗留（2026-05 全量审计）

> 2026-05 全仓安全 / 能力 / 覆盖 / 性能审计的遗留项。P3a/P3b/P3c 与 P0/P1/P2 并行推进；P3a 需在阶段 1 退出前清零。落地项的测试覆盖、威胁模型与压测数据见 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md)。

### P3a 本周必须清零

- [x] S-2 为 `/sessions/:id/prompt` 补 Zod 校验 — [packages/daemon/src/daemon/server.ts](packages/daemon/src/daemon/server.ts)
- [x] S-7 恢复 NuGet 漏洞审计 — [packages/gui/CodePanion.Gui.csproj](packages/gui/CodePanion.Gui.csproj)
- [x] A-5 修复 `start.bat` 路径与编码 — [start.bat](start.bat)
- [x] S-15 移除 `node-notifier` 依赖 — [packages/daemon/package.json](packages/daemon/package.json)
- [x] P-2 修复 `WorkflowManager.appendItem` ID 去重无声丢弃 — [packages/daemon/src/daemon/workflowManager.ts](packages/daemon/src/daemon/workflowManager.ts)

**验收标准：**

- [x] 阶段 1 退出前完成全部 P3a
- [x] 完成项在 [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md) 留下命令级证据

### P3b 两周内：稳态运行不留隐患

- [x] S-1 替换 DOMPurify 空实现 + WebView2 CSP — [packages/gui/wwwroot/vendor/codepanion-markdown.js](packages/gui/wwwroot/vendor/codepanion-markdown.js)
- [x] S-3 Claude Code hook 不落 token — [packages/daemon/src/cli/install.ts](packages/daemon/src/cli/install.ts)
- [x] S-12 `config.json` owner-only 写盘 — [packages/daemon/src/config.ts](packages/daemon/src/config.ts)
- [x] S-4 / S-5 WebSocket subprotocol + Origin 校验 — [packages/daemon/src/daemon/server.ts](packages/daemon/src/daemon/server.ts)
- [x] P-1 工作流快照去抖 + 原子写 — [packages/daemon/src/daemon/workflowManager.ts](packages/daemon/src/daemon/workflowManager.ts)
- [x] A-2 版本号统一来源 — [packages/daemon/src/shared/version.ts](packages/daemon/src/shared/version.ts)
- [x] P-3 GUI workflow 缓存 retention 裁剪 — [packages/gui/wwwroot/chat.js](packages/gui/wwwroot/chat.js)
- [x] P-4 CLI 输出 workflow item 使用稳定唯一 ID — [packages/daemon/src/daemon/server.ts](packages/daemon/src/daemon/server.ts)
- [x] P-5 移除默认 `[codepanion-debug]` stderr 输出或改为 debug 日志 — [packages/daemon/src/pty/runner.ts](packages/daemon/src/pty/runner.ts)

**验收标准：**

- [x] GUI 在含恶意 payload 的样本下不会执行任意脚本
- [x] daemon + GUI 持续运行 8 小时以上无明显内存或磁盘 I/O 累积已降级为 Beta 前稳态验证；Alpha 不阻塞，当前依赖 retention 上限、快照裁剪、`npm run stress:workflow` 与自动化回归兜底
- [x] 鉴权失败路径在自动化测试中被覆盖

### P3c 一个月内：基线与流程

- [x] A-1 Zod schema 自动生成 C# DTO — [packages/daemon/src/shared/protocol.ts](packages/daemon/src/shared/protocol.ts)
- [x] A-6 logger 敏感字段统一脱敏 — [packages/daemon/src/logger.ts](packages/daemon/src/logger.ts)
- [x] codexDesktopAdapter 解析单元测试 — [packages/daemon/test/codexDesktopAdapter.test.mjs](packages/daemon/test/codexDesktopAdapter.test.mjs)
- [x] HTTP 路由反例测试 — [packages/daemon/test/server.integration.test.mjs](packages/daemon/test/server.integration.test.mjs)
- [x] WebSocket 鉴权与会话错配回归测试
- [x] CI 最小流水线
- [x] S-10 `node.exe` 版本固定 + SHA256 校验 — [scripts/package-windows.ps1](scripts/package-windows.ps1)
- [x] P-6 `npm audit` 安全审计流程确认（2026-05-20 用户授权后执行）
- [x] P-7 `git diff --check` 纳入提交前基线，清理 `DEVELOPMENT_TASKS.md` EOF 空行
- [x] P-3 ~ P-7 整理为 backlog

**验收标准：**

- [x] CI 在 PR 阶段拦截测试失败与 schema 漂移
- [x] 发布包 hash 不一致时打包失败

---

# 阶段 2：本地 AI 工作流操作台

## 阶段 2 进入条件

- [x] 阶段 1 退出标准已满足或明确降级：P1.2 真机截图仍需补证据，8h 长跑移入 Beta 前稳态验证，不阻塞阶段 2 第一批本地模板能力
- [x] 真实使用证据足以识别第一批值得产品化的流程：重复本地 CLI/AI 工具启动参数与工作区任务可先沉淀为模板
- [x] Alpha 基础入口与国产工具首批接入已验收到自动化/文档边界；真机截图证据后补

## S2.1 工作流模板

- [x] 常见本地工作流可保存为模板并参数化重复运行（CLI + 本地模板文件已落地）
- [x] CLI 支持 `codepanion template add/list/show/run/remove`，模板落盘到本地 `~/.codepanion/workflow-templates.json`
- [x] 模板参数支持 `{param}` 占位和运行时 `--set name=value` 覆盖

## S2.2 多步骤编排

- [x] 多个本地 AI 任务可串成步骤序列，支持依赖、暂停点和人工检查点
- [x] 保留可读的本地执行历史

## S2.3 跨工具协作

- [x] 不同本地工具可参与同一条工作流，跨工具交接显式可检查
- [x] 追踪每一步由哪个工具产出

## S2.4 结果历史与回放

- [x] 可搜索历史工作流、重新打开结果、用新输入重跑

## 阶段 2 退出标准

- [x] 重复工作沉淀为可复用工作流
- [x] 至少一条多步骤工作流能在 CodePanion 中完整执行
- [x] 不破坏阶段 1 的本地优先与可理解性

---

# 推荐执行顺序

- [-] 里程碑 1：让阶段 1 适合继续扩展（GUI/WebView 中文渲染真机验收未做；8h 长跑已降级为 Beta 前稳态验证）
  - [x] P0.1 建立首方自动化测试基线
  - [-] P0.2 增加持久化与保留边界
  - [-] P0.3 固化阶段 1 验收场景
  - [x] P3a 代码审核遗留本周清零项
- [-] 里程碑 2：让阶段 1 值得每天使用（P1.2 真机截图验收 [!]；8h 长跑已降级为 Beta 前稳态验证）
  - [-] P1.1 提升来源保真度
  - [-] P1.2 强化 GUI 任务分诊能力
  - [x] P1.3 提升重连与失败场景可靠性
  - [-] P3b 代码审核稳态运行隐患清零
- [x] 里程碑 3：让阶段 1 可以收口
  - [x] P2.1 清理安装与打包流程
  - [x] P2.2 整理文档体系
  - [x] P3c 代码审核基线与 CI 流程补齐
- [x] 里程碑 4：决定是否进入阶段 2
  - [x] 回顾真实使用证据
  - [x] 识别值得产品化的重复流程
  - [x] 满足前提后启动阶段 2

---

# Strategy Backlog：报告策略后置能力

这些方向采用报告建议，但不阻塞当前 Windows Alpha：

## B1 国产工具深度适配

- [ ] 评估通义灵码 / Qoder / CodeBuddy / Trae / Comate / CodeGeeX 接入路径
- [ ] MarsCode、CodeArts 等下一梯队评估

## B2 适配器 SDK 与控制平面扩展

- [ ] 编写适配器 SDK 草案与能力声明 / 版本兼容策略
- [ ] 设计本地审计快照导出格式

## B3 Provider adapter 预留

- [ ] 研究主流 provider adapter 抽象，不做 token 二次分销
- [ ] 设计 `provider=local` 本地模型预留边界

## B4 Pro / Enterprise 后续能力

- [ ] 设计 Community / Pro / Enterprise 产品层级与本地审计 / 规则同步最小形态
- [ ] 明确这些能力不等同于团队协作平台

## B5 跨平台 GUI 评估

- [ ] 评估 Tauri / Avalonia / 继续 WPF+WebView2 的成本
- [ ] 评估 Named Pipe / Unix Domain Socket 本地通道增强
- [ ] 设计 `codepanion rotate-token` CLI 与客户端热重载
- [ ] 在 Windows Alpha 价值被验证前不迁移 GUI 外壳
