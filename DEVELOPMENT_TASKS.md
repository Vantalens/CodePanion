# CodePanion 开发任务与重构路线

## 使用规则

- 本文件记录当前开发任务和重构路线规划
- 所有任务必须符合 [docs/POSITIONING.md](docs/POSITIONING.md) 和 [docs/LOCAL_AI_WORKFLOW.md](docs/LOCAL_AI_WORKFLOW.md)
- 每完成一组可验证改动，必须同步更新本文件状态

状态标记：

- `[ ]` 未开始
- `[-]` 进行中
- `[x]` 已完成
- `[!]` 受阻

---

## 当前产品标准

> **本地优先、供应商中立、面向个人开发者的 Agent AI IDE + AI 工作流控制台。**

CodePanion 核心定位：

1. **个人 Agent AI IDE**：一切在 CodePanion 内进行
2. **模型走外部 API**：DeepSeek 等 OpenAI 兼容后端
3. **agent 架构靠逆向**：Claude Code 等工具的架构在进程内复刻
4. **不 shell 外部 CLI**：不把任务派给外部工具
5. **不用插件**：不依赖 VS Code 等 IDE 插件
6. **不监听外部 IDE**：不监听外部窗口、进程或会话

执行模型：**architecture（进程内 harness）× model（外部 API）两轴**

- `architecture=shell`：spawn 本地命令（测试、构建等非 AI 步骤）
- `architecture=agent`：进程内 agent 运行时调模型 API（逆向自 Claude Code）
  - single-call：无工具权限时，调一次模型即返回
  - tool-use 循环：有 `permissions=read` 时，agent 可多轮调用只读工具

---

## 重构路线规划

### 阶段 1：架构清理（已完成 ✅）

**目标**：彻底下线监听路线残留，确认工作流路线

- [x] **R-01** 删除 adapter-sdk 包（监听路线残留）
- [x] **R-02** 清理 protocol.ts 中的监听外部 IDE 的 schema
  - 删除：`RegisterSourceRequest`、`MonitorEvent`、`MonitorSource`、`SourceKind`、`HandoffTarget`、`WorkflowItem`、`WorkflowThread`、`LaunchHandoff`、`RegisterSession`、`SessionOutput`、`SessionPrompt`、`Reply`、`SessionExit`、`SessionInfo`
  - 保留：`NotifyRequest`、`InitializeWorkspaceRequest`、`ResolveWorkflowGateRequest`、`StartWorkflowRunRequest`、`WsServerEvent`（简化为 3 种）
- [x] **R-03** 确认 agent 架构完全走进程内
  - 验证执行路线：workflow → daemon → agentRuntime → modelClient API
  - 验证 `resolveStepArchitecture`：`provider=local→shell`，其余→`agent`
  - 验证 `daemonAgentExecutor`：读 role prompt、解析 model、构建工具、调 `runAgentLoop`
  - 验证 `runAgentLoop`：tool-use 循环、maxTurns 封顶、实时推送
  - 验证 `chatCompletion`：fetch OpenAI 兼容 API
- [x] **R-04** 构建和测试验证
  - 构建成功
  - 核心测试全部通过
  - daemon bundle 生成成功 (1.8mb)
- [x] **R-05** 文档记录：[docs/ARCHITECTURE_CLEANUP.md](docs/ARCHITECTURE_CLEANUP.md)

**成果**：
- ✅ adapter-sdk 已删除
- ✅ protocol.ts 已清理监听 schema
- ✅ agent 架构确认完全走进程内
- ✅ 执行路线验证通过
- ✅ 测试全部通过

---

### 阶段 2：文档清理（进行中 📝）

**目标**：清理所有文档中的监听路线残留，统一到工作流路线

#### 2.1 核心文档清理

- [ ] **R-10** 清理 [docs/POSITIONING.md](docs/POSITIONING.md)
  - 移除监听路线、handoff、外部 IDE 集成的描述
  - 强化工作流路线、进程内 agent、两轴执行模型
  
- [ ] **R-11** 清理 [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md)
  - 移除监听来源、适配器、handoff 的路线图
  - 更新为工作流路线的迭代计划

- [ ] **R-12** 清理 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
  - 移除 SourceManager、Adapter、HandoffRunner 的架构描述
  - 更新为 workflow → daemon → agentRuntime → modelClient 的架构
  - 补充两轴执行模型的详细说明

- [ ] **R-13** 清理 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
  - 移除监听路线的开发指南
  - 更新为工作流路线的开发指南

- [ ] **R-14** 清理 [docs/API.md](docs/API.md)
  - 移除 `/sources`、`/events`、`/handoff`、`/sessions` 等旧端点
  - 只保留工作流路线的端点：`/workflow/board`、`/workflow/runs`、`/workflow/gates`、`/workspace/initialize`、`/workspace/config`

#### 2.2 辅助文档清理

- [ ] **R-15** 清理 [docs/README.md](docs/README.md)
  - 更新文档索引，移除监听路线相关文档

- [ ] **R-16** 清理 [docs/RETENTION.md](docs/RETENTION.md)
  - 移除监听路线的保留说明

- [ ] **R-17** 检查并清理 [docs/superpowers/](docs/superpowers/) 目录
  - 移除监听路线相关的计划文档

---

### 阶段 3：GUI 重构（待规划 🔮）

**目标**：GUI 从监听式会话流转向工作流控制台

#### 3.1 GUI 架构重构

- [ ] **R-20** 删除旧的监听式 GUI 代码
  - 删除 VS Code 插件面板相关代码
  - 删除来源分组任务队列
  - 删除会话流 UI
  - 删除接力 PTY 面板
  - 删除收件箱
  - 删除 session 回复 omnibar

- [ ] **R-21** 实现工作流控制台 GUI
  - 顶栏：workspace 选择条 + 连接状态
  - 左栏：workflow 定义列表 + 近期 runs + 人工审核门
  - 中栏：run 时间线（steps 顺序 + 状态 + 实时输出）
  - 右栏：详情（artifacts、delivery、role/model/permission）

#### 3.2 GUI 协议清理

- [ ] **R-22** 清理 webview ↔ host 协议
  - 移除：`reply`、`event-reply`、`task-action`、`handoff-launch`
  - 保留：`request-workflow-board`、`request-workflow-run`、`request-workflow-launch`、`request-gate-resolve`、`request-run-cancel`、`request-delivery`、`set-workspace`

- [ ] **R-23** 实现 WebSocket 实时更新
  - 接收 `workflow-run-event`（run-start、step-start、step-output、step-finish、run-finish）
  - 实时更新 run 时间线
  - 实时滚动 step-output

---

### 阶段 4：功能完善（待规划 🔮）

**目标**：完善工作流路线的核心功能

#### 4.1 Agent 工具扩展

- [ ] **R-30** 实现写工具（slice 2b）
  - `write_file`：`permissions=write` 门控，cwd 钳 workspace
  - `run_command`：`permissions=command` 门控，Windows batch-arg 防护

- [ ] **R-31** 实现 contextPolicy 强制
  - `maxTokens`：限制上下文预算
  - `include` / `exclude`：过滤可读取文件

#### 4.2 GUI 功能完善

- [ ] **R-32** 实现队列视图
  - 可筛选的状态队列：等待我、失败、需审阅、运行中、完成
  - 状态挂到 workflow 节点和 artifact

- [ ] **R-33** 实现 role/model/permission 展示
  - daemon 暴露 workspace roleBindings 给 board
  - GUI 展示 role 绑定的 model、prompt、permissions、contextPolicy

- [ ] **R-34** 实现 architecture/model 编辑
  - GUI 选择 step 的 architecture（shell / agent）
  - GUI 选择 step 的 model
  - GUI 编辑 config.json 的 models 后端

---

## 当前进度总结

### 已完成 ✅

1. **架构清理**（阶段 1）
   - adapter-sdk 已删除
   - protocol.ts 已清理监听 schema
   - agent 架构确认完全走进程内
   - 执行路线验证通过
   - 测试全部通过

2. **核心功能**（P1-P3）
   - workspace 级配置目录
   - workflow definition schema 扩展
   - 内置角色模板
   - workflow run artifact 历史
   - 人工审核门（approve/reject/retry）
   - delivery-note 生成
   - 执行模型两轴化（architecture × model）
   - single-call agent
   - tool-use 循环（只读）

3. **GUI 基础**（W-20/W-21 部分）
   - 工作流控制台基础布局
   - run 时间线实时更新
   - artifacts 和 delivery 展示

### 进行中 📝

1. **文档清理**（阶段 2）
   - 需要清理所有文档中的监听路线残留

2. **GUI 完善**（W-22/W-23 部分）
   - role/model/permission 展示
   - 队列视图

### 待规划 🔮

1. **GUI 重构**（阶段 3）
   - 删除旧的监听式 GUI 代码
   - 实现完整的工作流控制台

2. **功能完善**（阶段 4）
   - 写工具（write_file / run_command）
   - contextPolicy 强制
   - architecture/model 编辑

---

## 验收标准

### 阶段 1：架构清理 ✅

- [x] adapter-sdk 目录已删除
- [x] protocol.ts 中无监听 schema 残留
- [x] agent 执行路线验证通过
- [x] 构建成功
- [x] 核心测试全部通过

### 阶段 2：文档清理

- [ ] 所有文档中无监听路线、handoff、外部 IDE 集成的描述
- [ ] 所有文档统一到工作流路线
- [ ] API 文档只包含工作流路线的端点

### 阶段 3：GUI 重构

- [ ] 旧的监听式 GUI 代码已删除
- [ ] 工作流控制台 GUI 实现完整
- [ ] webview ↔ host 协议清理完成
- [ ] WebSocket 实时更新正常工作

### 阶段 4：功能完善

- [ ] 写工具实现并测试通过
- [ ] contextPolicy 强制实现并测试通过
- [ ] 队列视图实现
- [ ] role/model/permission 展示实现
- [ ] architecture/model 编辑实现

---

## 参考文档

- [docs/POSITIONING.md](docs/POSITIONING.md) - 产品定位
- [docs/LOCAL_AI_WORKFLOW.md](docs/LOCAL_AI_WORKFLOW.md) - 工作流设计
- [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) - 产品路线图
- [docs/ARCHITECTURE_CLEANUP.md](docs/ARCHITECTURE_CLEANUP.md) - 架构清理记录
- [README.md](README.md) - 项目说明
