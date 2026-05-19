# CodePanion 开发任务清单

## 使用说明

- `[ ]` 未开始
- `[-]` 进行中
- `[x]` 已完成
- `[!]` 受阻

每完成一个任务，需要同步更新本文件的勾选状态、验收记录和相关文档。

---

## 产品边界

- [x] 定位为本地优先、供应商中立、单入口多出口的 AI 开发工作流控制台 / 控制平面
- [x] 阶段 1 目标：Windows Alpha 个人本地控制台闭环
- [x] 阶段 2 目标：本地 AI 工作流操作台
- [x] 明确保留现有 Windows GUI、本地 daemon、CLI/PTTY、Codex Desktop 同步、VS Code 来源和外部适配器 API
- [x] 明确不做团队版
- [x] 明确不做多用户协作
- [x] 明确不做权限、审批流、共享空间和企业管理能力
- [x] 明确不把 CodePanion 定位为 Codex、Claude Code、Copilot CLI 或 VS Code 的替代品
- [x] 明确不做完整 AI IDE、模型聊天客户端、默认 OCR、全局屏幕读取或 token 二次分销

---

## 当前已具备

- [x] 本地 daemon，提供 HTTP 与 WebSocket API
- [x] CLI/PTTY 会话监控
- [x] 提示检测与回复注入
- [x] GUI 时间线与会话视图
- [x] Codex Desktop 本地工作流同步
- [x] VS Code 来源注册与轻量事件接入
- [x] 外部来源注册 API
- [x] 国产 AI 编程工具进程级广覆盖入口
- [x] 面向开发者的极简前端工作台重设计
- [x] Windows x64 便携版 EXE 发布包
- [-] 文档体系重新定盘
- [x] 报告策略已确定：保留现有产品，升级为本地 AI 开发工作流控制平面

---

# 阶段 1：Windows Alpha 个人本地控制台闭环

## 阶段 1 退出标准

- [-] 用户可以在一个 Windows GUI 中看到所有活跃的本地 AI 任务
  - [x] GUI 使用统一 workflow 视图汇总 CLI/PTTY、Codex Desktop、VS Code、外部适配器和本地 AI 工具来源
  - [x] 左侧任务收件箱可以按当前、待处理、运行中、失败、产物筛选
  - [x] 主工作台可以展示任务上下文、事件流、输出和产物预览
  - [ ] 两个以上真实 `codepanion run --` 会话同时运行时，GUI 能稳定展示独立任务
  - [ ] Codex Desktop、VS Code 来源和 CLI 会话同时存在时，GUI 能正确区分来源、工作区和状态
  - [ ] 真实运行截图或录屏已归档到阶段 1 验收记录
- [-] 等待输入的任务能够被快速发现，且无需切换窗口也能识别
  - [x] `prompt` / `waiting` 状态在任务列表、主区和统计区中有独立优先级
  - [x] 等待输入事件会触发系统通知和 GUI 内消息
  - [x] 任务收件箱支持只看待处理任务
  - [ ] 多个任务同时等待输入时，排序能把最需要处理的任务置顶
  - [ ] 等待输入任务能显示最后上下文、可选项、来源和工作区
  - [ ] 断线重连后等待输入状态不会丢失或误判为普通运行中
- [-] 支持交互的任务可以从 CodePanion 中回复并继续执行
  - [x] CLI/PTTY 会话支持从 GUI 写回 `sessions/:id/reply`
  - [x] 外部 monitor event 支持事件回复通道
  - [x] GUI 会将可回复任务映射到真实 `sessionId` 或 `eventId`
  - [ ] 回复失败时 GUI 能显示明确错误，而不是静默失败
  - [ ] 同时存在多个等待输入会话时，回复只写回目标会话
  - [ ] 事件回复与 CLI 回复的能力边界在 UI 中明确区分
- [ ] Claude Code、Codex、VS Code/Copilot、CLI/PTTY、Codex Desktop 的基础闭环都具备可验证路径
  - [ ] Claude Code 通过 `codepanion run --` 接入的示例命令、预期事件和回复步骤已记录
  - [ ] Codex CLI 通过 `codepanion run --` 接入的示例命令、预期事件和回复步骤已记录
  - [ ] VS Code/Copilot 来源注册、任务结束事件和终端事件的验收步骤已记录
  - [ ] CLI/PTTY 的运行、等待输入、回复、退出码链路已自动化或半自动化验证
  - [ ] Codex Desktop 本地线程同步的扫描窗口、噪音过滤和归档边界已验证
  - [ ] 每类来源都明确标注 L1/L2/L3/L4 能力层级和不可读取的数据
- [-] 主要日常使用链路不会出现失控的内存增长
  - [x] `SessionManager` 输出历史具备大小、条数或时间保留上限
  - [x] `WorkflowManager` 线程、条目和去重集合具备保留策略
  - [x] `SourceManager` 事件与回复具备保留策略
  - [-] GUI 消息列表、任务列表和产物列表具备清理或虚拟化方案
  - [ ] 长时间运行和大量事件压测已记录内存曲线
  - [x] daemon 重启后的最小有用历史恢复不依赖无限内存缓存
- [-] 核心路径具备稳定的自动化验证基线
  - [x] 根目录存在统一测试命令
  - [x] `promptDetector`、`sessionManager`、`sourceManager`、`workflowManager` 有单元测试
  - [x] HTTP 认证、session 注册、输出追加、prompt、reply、exit 有集成测试
  - [x] WebSocket observer 和 CLI socket 的基本消息流有测试
  - [x] VS Code extension manifest 校验纳入验证基线
  - [-] Windows GUI 至少具备构建验证和关键配置读写验证
- [-] 文档能够真实反映当前产品状态和已支持能力
  - [x] README、架构、API、监控源和路线文档已统一为本地 AI 开发工作流控制台 / 控制平面定位
  - [x] 文档明确不做完整 AI IDE、模型聊天客户端、团队协作平台、默认 OCR 或全局屏幕读取
  - [x] 监控源文档已按 L1/L2/L3/L4 描述能力边界
  - [ ] 故障排查和安装说明继续校准为普通用户双击便携版优先
  - [x] 阶段 1 验收清单与真实验证记录保持同步
  - [ ] 文档不得把进程级识别描述成深度接管或私有状态读取

---

## P0：基础与可靠性

### P0.1 建立首方自动化测试基线

- [x] 定义测试框架和目录结构
- [x] 增加根目录统一测试命令
- [x] 为 `promptDetector` 添加单元测试
- [x] 为 `sessionManager` 添加单元测试
- [x] 为 `sourceManager` 添加单元测试
- [x] 为 `workflowManager` 添加单元测试
- [ ] 为 `codexDesktopAdapter` 添加解析测试
- [x] 为关键 HTTP/WebSocket 行为添加集成测试
- [x] 在开发文档中记录本地测试流程
- [x] 运行测试命令并记录通过结果

**验收标准：**

- [x] 全新检出仓库后，可以按文档成功运行测试命令
- [-] 对提示、会话、来源或工作流的修改都有回归覆盖

### P0.2 增加持久化与保留边界

- [x] 明确哪些状态属于实时状态
- [x] 明确哪些状态需要持久化
- [x] 设计工作流线程与关键历史的持久化方案
- [x] 设计会话输出保留策略
- [x] 设计工作流条目保留策略
- [x] 设计来源事件保留策略
- [x] 实现 daemon 重启后的最小历史恢复
- [x] 为持久化和保留策略添加测试
- [x] 在文档中说明持久化、保留和清理规则

**验收标准：**

- [x] daemon 重启后，不会丢失 GUI 继续有用所需的最小历史
- [-] 长时间运行不会出现无限制内存增长
- [-] 保留策略有文档说明，配置化仍待后续补齐

### P0.3 固化阶段 1 验收场景

- [x] 建立阶段 1 验收清单文档
- [ ] 覆盖多个 CLI 会话同时运行
- [-] 覆盖一个或多个会话等待输入
- [x] 覆盖回复准确写回对应会话
- [ ] 覆盖 Codex Desktop 线程接入
- [ ] 覆盖 VS Code 来源注册
- [ ] 覆盖中文文本在 daemon、GUI、WebView 全链路不乱码
- [-] 覆盖 daemon 重启后 GUI 可重新连接
- [x] 将可自动化场景接入测试命令

**验收标准：**

- [-] 后续开发者无需依赖口口相传，也能判断阶段 1 是否仍然成立

---

## P1：基础入口闭环、来源质量与体验完整度

### P1.0 稳定 Alpha 基础入口闭环

- [ ] 固化 Claude Code 通过 CLI/PTTY 接入的示例和验收步骤
- [ ] 固化 Codex 通过 CLI/PTTY 或 Codex Desktop 接入的示例和验收步骤
- [ ] 固化 VS Code/Copilot 来源注册与轻量事件的验收步骤
- [ ] 固化 Codex Desktop 本地线程同步的有效窗口和归档边界
- [ ] 确认所有基础入口都能进入统一 workflow 线程视图
- [ ] 确认可回复任务能准确映射回真实 session 或事件回复目标

**验收标准：**

- [ ] Alpha 首批入口可以完成“查看 - 判断 - 回复/回到原工具”的最小闭环

### P1.1 提升来源保真度

- [ ] 定义每类来源应达到的 L1/L2/L3/L4 能力边界和事件质量
- [ ] 统一来源元数据字段
- [ ] 改善 Codex Desktop 线程标题质量
- [x] 过滤 Codex Desktop 内部环境上下文、权限说明和中断元信息
- [x] 限制 Codex Desktop 历史扫描窗口，避免已归档旧线程重新出现在当前任务
- [x] 增加 Trae、CodeBuddy、通义灵码、豆包/MarsCode、CodeGeeX、百度 Comate、Qwen Code 的 L1/L2 进程级来源识别
- [ ] 将国产工具优先级收敛为通义灵码 / Qoder、CodeBuddy、Trae、Comate、CodeGeeX 首批推进，MarsCode、CodeArts 下一梯队验证
- [x] GUI 展示来源连接与离线事件
- [ ] 改善 Codex Desktop 状态识别质量
- [ ] 在公开 API 允许的范围内提升 VS Code 事件价值
- [x] 记录不支持或刻意不读取的数据
- [x] 更新来源说明文档

**验收标准：**

- [ ] GUI 中展示的每个来源，都能帮助用户判断当前最需要关注什么
- [ ] 文档不会把某个来源描述得比真实能力更强

### P1.2 强化 GUI 的任务分诊能力

- [x] 确认前端方向为面向开发者的极简工作台
- [x] 根据前端重设计报告，将 WebView2 界面从对话优先改为控制平面优先
- [x] 增加 Source Rail、任务收件箱、Main Stage、上下文抽屉和底部 Command Bar
- [x] 在 GUI 中展示来源能力层级、数据边界和真实可用动作
- [x] 保留现有颜色体系
- [x] 使用接近 Claude 观感的字体栈
- [x] 将主区从聊天块调整为事件流表达
- [x] 强化等待输入任务的视觉优先级
- [x] 将右侧代码区调整为代码检查器
- [x] 统一空状态文案和视觉结构
- [x] 在 GUI 展示层兜底隐藏历史内部上下文噪音
- [x] 当前视图过滤过期和归档工作流，避免历史错误任务污染当前列表
- [x] 修复主消息流、左侧任务列表、右侧代码检查器的滚动能力
- [x] 工作流等待输入可从 `session:` / `monitor:` 线程映射回真实回复目标
- [x] 产物预览只展示真实代码块，不再展示无意义 `text` 片段
- [x] 优化 Markdown 渲染样式，提高列表、代码和技术摘要可读性
- [x] 建立更清晰的任务优先级排序
- [x] 优化左栏摘要，让任务可扫读性更强
- [x] 强化活跃、等待、运行中、失败和产物分组与筛选
- [x] 在 GUI 中直接浮出“当前最该处理什么”
- [!] 使用真实运行数据截图做最终视觉验收

**验收标准：**

- [ ] 用户面对多个并行任务时，可以一眼判断下一步该处理谁

### P1.3 提升重连与失败场景可靠性

- [ ] 定义 GUI 断线后的可见状态
- [ ] 定义 daemon 重启后的 GUI 重连行为
- [x] 设置窗口保存后真实写回配置并触发 GUI 重载连接配置
- [x] GUI WebSocket 连接日志不再泄露完整 daemon token
- [ ] 增加过期来源处理
- [ ] 增加 daemon 启停状态提示
- [ ] 增强适配器失败日志
- [ ] 增强客户端失败日志
- [ ] 覆盖短暂中断后的恢复验证

**验收标准：**

- [ ] 短暂的 daemon 或 GUI 中断，不会让用户无法判断真实任务状态

---

## P2：阶段 1 产品收口

### P2.1 清理安装与打包流程

- [ ] 确认当前唯一有效的安装路径
- [x] 修正平台支持说明
- [x] 验证 daemon 与 GUI 的启动流程
- [x] 新增 Windows x64 便携版发布脚本
- [x] 发布包内置 Node runtime，支持双击 GUI EXE 后自动启动 daemon
- [-] 清理过时发布说明
- [-] 清理过时安装说明
- [-] 验证新用户可按一份指南完成安装和运行

**验收标准：**

- [ ] 新用户可以只看一份准确指南就完成安装和运行

### P2.2 整理文档体系

- [x] 将产品定位统一为本地 AI 开发工作流控制台 / 控制平面
- [x] 新增产品路线文档
- [x] 将历史报告标记为历史快照
- [x] 新增开发任务清单
- [x] README 和安装说明改为普通用户优先双击便携版 EXE
- [x] 校准 README、架构、来源说明、安装文档中的产品定位和发布路径
- [x] 吸收研究报告中的目标用户、竞品差异、国产工具优先级、模型/provider、商业化、风险和里程碑
- [x] 明确现有产品保留决策：不推倒 Windows Alpha、daemon、GUI、CLI/PTTY、Codex Desktop、VS Code 和外部适配器
- [-] 继续校准故障排查和发布说明
- [x] 每完成一个阶段性里程碑后，同步更新 `DEVELOPMENT_TASKS.md`

**验收标准：**

- [ ] 文档不会夸大当前能力
- [ ] 仓库内的产品定位始终一致

---

# 阶段 2：本地 AI 工作流操作台

## 阶段 2 进入条件

- [ ] 阶段 1 退出标准已经满足
- [ ] 核心自动化测试已经建立
- [ ] 持久化与保留策略已经实现
- [ ] 真实个人使用已经积累出足够证据，能识别值得产品化的重复流程
- [ ] Alpha 基础入口闭环和国产工具首批分层接入已通过验收

## S2.1 工作流模板

- [ ] 保存常见本地工作流为模板
- [ ] 参数化常见输入
- [ ] 支持以更低成本重复运行

## S2.2 多步骤编排

- [ ] 将多个本地 AI 任务串成定义明确的步骤序列
- [ ] 支持依赖关系
- [ ] 支持暂停点和人工检查点
- [ ] 保留清晰可读的本地执行历史

## S2.3 跨工具协作

- [ ] 允许不同本地工具参与同一条工作流
- [ ] 追踪每一步由哪个工具产出
- [ ] 让跨工具交接保持显式、可检查

## S2.4 结果历史与回放

- [ ] 搜索过去的本地工作流
- [ ] 重新打开旧结果
- [ ] 用新输入重跑过去的流程

## 阶段 2 退出标准

- [ ] 重复工作可以被沉淀为可复用的本地工作流
- [ ] 至少有一条多步骤工作流，可以完全在 CodePanion 中执行、检查并再次运行
- [ ] 阶段 2 的能力不会破坏阶段 1 已建立的优点：本地优先、个人可用、可理解、可靠

---

# 推荐执行顺序

- [ ] 里程碑 1：让阶段 1 适合继续扩展
  - [ ] P0.1 建立首方自动化测试基线
  - [ ] P0.2 增加持久化与保留边界
  - [ ] P0.3 固化阶段 1 验收场景
- [-] 里程碑 2：让阶段 1 值得每天使用
  - [-] P1.1 提升来源保真度
  - [-] P1.2 强化 GUI 任务分诊能力
  - [ ] P1.3 提升重连与失败场景可靠性
- [-] 里程碑 3：让阶段 1 可以收口
  - [-] P2.1 清理安装与打包流程
  - [-] P2.2 整理文档体系
- [ ] 里程碑 4：决定是否进入阶段 2
  - [ ] 回顾真实使用证据
  - [ ] 找出频率足够高、值得产品化的重复流程
  - [ ] 只有在此前提下，才启动阶段 2 工作流

---

# Strategy Backlog：报告策略后置能力

这些方向采用报告建议，但不阻塞当前 Windows Alpha：

## B1 国产工具深度适配

- [ ] 通义灵码 / Qoder：评估 CLI、IDE companion 或公开接口接入路径
- [ ] CodeBuddy：评估 CodeBuddy IDE、CodeBuddy Code 和外部工具互操作路径
- [ ] Trae：评估本地原生适配、Code OSS 系能力和 Skills 桥接可能性
- [ ] Comate：评估插件型 IDE 助手和独立 AI IDE 的弱耦合接入
- [ ] CodeGeeX：评估 IDE companion 与本地模型桥接价值
- [ ] MarsCode、CodeArts：作为下一梯队做企业适配验证

## B2 适配器 SDK 与控制平面扩展

- [ ] 为 `/sources/register`、`/events`、事件回复和 workflow snapshot 编写适配器 SDK 草案
- [ ] 定义外部适配器的能力声明、错误处理和版本兼容策略
- [ ] 设计本地审计快照导出格式

## B3 Provider adapter 预留

- [ ] 研究 Qwen、DeepSeek、GLM、腾讯混元的 provider adapter 抽象
- [ ] 明确 provider adapter 只做任务路由和工具互操作预留，不做 token 二次分销
- [ ] 设计本地模型 runtime 的 `provider=local` 预留边界

## B4 Pro / Enterprise 后续能力

- [ ] 设计 Community / Pro / Enterprise 产品层级说明
- [ ] 设计本地审计导出、敏感目录边界、规则模板和组织规则同步的最小形态
- [ ] 明确这些能力不等同于阶段 1 团队协作平台

## B5 跨平台 GUI 评估

- [ ] 在 Alpha 稳定后评估 Tauri、Avalonia 或继续 WPF/WebView2 的成本
- [ ] 评估 Named Pipe / Unix Domain Socket 等本地通道增强
- [ ] 只有在 Windows Alpha 价值被验证后，再决定是否迁移 GUI 外壳

---

# 下一段开发切片

- [x] 完成报告策略吸收到 README、产品路线、架构、API、监控源和文档中心
- [x] 清理旧路线报告、预览输出、一次性测试脚本、旧发布清单和已跟踪生成 bundle
- [ ] 用真实 GUI 运行数据做滚动、来源识别、等待任务视觉验收截图
- [-] 建立首方自动化测试基线，已覆盖 `promptDetector`、`sessionManager`、`sourceManager`、`workflowManager`、关键 HTTP/WebSocket 行为
- [x] 把阶段 1 验收场景转成可重复执行的检查清单
- [-] 设计并确定持久化与保留方案，已落地内存保留上限和 workflow 最小快照恢复，配置化仍待补齐
- [ ] 清理故障排查和用户指南中的旧启动路径

---

# 最近验证记录

- [x] `git grep` 确认旧报告、旧测试脚本、预览输出和旧发布清单不再被文档引用
- [x] `git diff --check` 通过（仅有 Windows 换行提示）
- [x] `npm run build` 通过，确认 daemon bundle 可由构建流程重新生成
- [x] `npm run gui:build` 通过，0 警告、0 错误
- [x] GUI Release 构建已关闭离线 NuGet 审计噪音，当前为 0 警告、0 错误
- [x] `npm run gui:run` 在 GUI 已运行时会跳过重复构建和启动，避免 Debug exe 锁定导致的 MSB3026 刷屏
- [x] `npm run build` 已覆盖国产 AI 工具进程级来源扫描器编译和 daemon bundle 打包
- [x] `npm run package:windows` 通过，已生成 `dist/CodePanion-win-x64/CodePanion.Gui.exe`、`runtime/node.exe` 和 `daemon/daemon.cjs`
- [x] `git check-ignore -v dist packages/gui/bin packages/gui/obj` 确认发布和构建产物不会进入 git
- [x] 修复已归档 Codex Desktop 历史任务误显示为当前错误任务的问题
- [x] `npm test` 通过，11 项测试通过，覆盖提示检测、会话输出保留、workflow 保留、workflow 最小快照恢复、来源事件保留、HTTP session 生命周期和 WebSocket 回复注入
- [x] `npm run build` 通过，确认 daemon TypeScript 和 bundle 可构建
- [x] `npm run validate:extensions` 通过，确认 VS Code extension manifest 仍有效
- [x] `git diff --check` 通过（仅有 Windows 换行提示）
- [x] `dotnet build packages/gui/CodePanion.Gui.csproj -c Release` 通过，验证 GUI 设置保存和日志脱敏改动可编译
- [x] 修复工作流提示无法回复的问题，并降噪右侧无意义 text 预览
