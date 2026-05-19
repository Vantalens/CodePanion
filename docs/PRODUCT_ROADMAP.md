# CodePanion 产品路线

## 产品定位

CodePanion 是一个本地优先、供应商中立、单入口多出口的 AI 开发工作流控制台 / 控制平面。它服务于已经在本机同时使用多个 AI 编程工具的开发者，把终端、IDE、独立 AI 编辑器和本地适配器中的会话、状态、等待输入、结果和上下文统一收束到一个可直接交互的图形工作台中。

现有产品不推倒重做。当前的 Windows GUI、本地 daemon、CLI/PTTY、Codex Desktop 同步、VS Code 来源注册、外部适配器 API 和统一 workflow 模型，都是控制平面路线的基础资产。

## 市场判断与差异化

AI 编程已经进入多会话、多工具、多模型并存阶段。CodePanion 不和 Cursor、Trae、Windsurf、VS Code/Copilot 这类 AI IDE 正面竞争，也不做模型聊天客户端；它要做的是比简单工具切换器更强的本地工作流控制层。

核心差异化：

1. **供应商中立**：不绑定单一 IDE、模型或云平台。
2. **本地优先**：状态、日志、规则和操作默认留在本机。
3. **可直接交互**：用户能在一个 GUI 中查看上下文、回复、批准、终止、回到原工具或打开工作区。
4. **能力边界透明**：按 L1/L2/L3/L4 描述来源能力，不把进程级识别包装成深度集成。

## 目标用户

- **重度个人开发者**：同时跑 Claude Code、Codex、VS Code/Copilot、多个 CLI 任务或多个项目窗口，需要知道谁在运行、谁在等待输入、谁失败。
- **AI-native 独立开发者 / 学生**：频繁切换 Trae、CodeBuddy、通义灵码 / Qoder、Comate、CodeGeeX 等工具，希望用一个本地入口管理上下文和历史。
- **企业研发骨干**：关注私有码仓、内网环境、工具中立、本地留痕和后续审计治理。当前阶段不做团队协作平台，但中后期为私有部署、审计导出和治理能力保留路线。

## 产品保留决策

- **保留当前入口**：Windows Alpha 继续以 `CodePanion.Gui.exe` 双击运行为普通用户路径。
- **保留当前技术栈**：Alpha 阶段继续使用 Node daemon、HTTP/WebSocket、WPF/WebView2 GUI，不立即迁移 Tauri 或 Avalonia。
- **保留当前核心能力**：CLI/PTTY 包装、提示检测、直接回复、系统通知、GUI 时间线、Codex Desktop 本地同步、VS Code 来源注册、外部适配器 API、本地 AI 工具进程识别。
- **后置评估**：Tauri/Avalonia 跨平台 GUI、provider adapter、Enterprise 治理能力和规则跨生态同步进入 Strategy Backlog，不作为 Alpha 阻塞项。

## 核心原则

1. **先控制，后编排**：先解决“看得见、接得住、回得去”，再解决“能组织、能复用、能自动化”。
2. **先真实闭环，后广泛承诺**：先让 Claude Code、Codex、VS Code/Copilot、CLI/PTTY、Codex Desktop 的基础闭环可靠，再做更深适配。
3. **分层描述来源能力**：L1 工具存在识别，L2 状态事件，L3 回复或继续执行，L4 工作流编排。
4. **不卖模型调用**：商业化围绕控制台能力、工作流管理、本地审计、隐私和中立性，不做 token 二次分销。

## Alpha：Windows 个人本地控制台闭环

### 目标

让一个人能够从一个 Windows GUI 稳定掌控本机上的多个 AI 开发任务。

### 关键能力

- Claude Code、Codex、VS Code/Copilot、CLI/PTTY、Codex Desktop 的基础接入闭环
- 任务运行、等待输入、完成和失败状态汇总
- GUI 时间线、上下文查看、系统通知和直接回复
- 持久化与保留边界，避免 daemon 重启后丢失最小有用历史
- 自动化测试基线，覆盖提示检测、来源、workflow 和关键 HTTP/WebSocket 行为

### 成功标准

- 单窗口中能同时看见 3 个以上活跃会话
- 至少支持等待输入、完成、失败三类状态
- 可接管任务能从 CodePanion 中直接回复并继续执行
- 文档真实反映当前能力，不夸大国产工具或闭源 IDE 支持深度

## Beta：国产工具与规则模板扩展

### 目标

在 Alpha 闭环稳定后，扩大首批国产工具接入，并加入轻量规则模板与本地历史能力。

### 工具优先级

1. 通义灵码 / Qoder、Qoder CLI
2. CodeBuddy IDE / CodeBuddy Code
3. Trae
4. 百度 Comate
5. CodeGeeX
6. MarsCode、CodeArts 进入下一梯队验证

### 关键能力

- 对首批工具按 L1/L2/L3 分层推进，不强行读取闭源私有状态
- 适配器 SDK 草案，降低外部工具接入成本
- 本地工作流模板、规则模板、任务历史和回放基础
- Tauri/Avalonia 跨平台 GUI 评估，但只在 Alpha 稳定后决定是否迁移

### 成功标准

- 首批国产工具接入后，常见会话能够完成“查看 - 决策 - 继续执行”的闭环
- 用户能明确区分每个来源当前支持的是识别、状态、回复还是编排

## GA 与长期商业化

### 产品层级

- **Community**：本地 daemon、基础 GUI、Claude/Codex/VS Code/CLI 基础接入、任务查看、手动回复。
- **Pro**：多工具聚合、任务看板、规则模板、历史归档、失败转派、账号/工具配置管理。
- **Enterprise**：私有部署、审计导出、策略中心、敏感目录边界、组织规则同步、离线或内网模式。

### 边界

Enterprise 是中后期治理方向，不改变当前阶段不做团队协作平台的原则。短期不做多用户协作、共享空间、权限审批流、token 分销或模型调用平台。

## 明确不做

- 不做完整 AI IDE
- 不做模型聊天客户端
- 不做团队协作平台
- 不做默认系统级 OCR 或全局屏幕读取
- 不读取 token、cookie、私有插件数据库或上游工具私有 API
- 不把 CodePanion 定位为 Codex、Claude Code、VS Code、Cursor、Trae 或 CodeBuddy 的替代品

## 当前开发优先级

1. 补齐 Alpha 的测试基线、持久化和阶段验收清单
2. 稳定 Claude/Codex/VS Code/CLI/Codex Desktop 的最小可用闭环
3. 提升 GUI 任务分诊能力，让用户一眼判断当前最该处理什么
4. 校准多源接入文档，按能力分层描述国产工具支持范围
5. 在真实使用证据足够后，再启动 Beta 的适配器 SDK、规则模板和跨平台评估
