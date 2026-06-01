# CodePanion 项目重构计划

**日期**: 2026-06-01  
**目标**: 彻底下线监听路线，全面转向工作流路线

---

## 重构背景

### 当前状态

CodePanion 的定位已明确为**个人 Agent AI IDE + 本地 AI 工作流控制台**，核心原则：

1. ✅ 一切在 CodePanion 内进行
2. ✅ 模型走外部 API（DeepSeek）
3. ✅ agent 架构靠逆向（Claude Code）进程内复刻
4. ✅ 不 shell 外部 CLI
5. ✅ 不用插件
6. ✅ 不监听外部 IDE

### 已完成的工作

**阶段 1：架构清理**（2026-06-01 完成）

- ✅ 删除 adapter-sdk 包
- ✅ 清理 protocol.ts 中的监听 schema
- ✅ 确认 agent 架构完全走进程内
- ✅ 验证执行路线：workflow → daemon → agentRuntime → modelClient API
- ✅ 构建和测试验证通过

详见：[docs/ARCHITECTURE_CLEANUP.md](ARCHITECTURE_CLEANUP.md)

### 待完成的工作

1. **文档清理**：清理所有文档中的监听路线残留
2. **GUI 重构**：从监听式会话流转向工作流控制台
3. **功能完善**：完善工作流路线的核心功能

---

## 重构路线图

### 阶段 2：文档清理（预计 1-2 天）

**目标**：清理所有文档中的监听路线残留，统一到工作流路线

#### 优先级 P0：核心文档

| 文档 | 清理内容 | 预计工作量 |
|------|---------|-----------|
| [POSITIONING.md](POSITIONING.md) | 移除监听路线、handoff、外部 IDE 集成的描述；强化工作流路线、进程内 agent、两轴执行模型 | 1h |
| [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) | 移除监听来源、适配器、handoff 的路线图；更新为工作流路线的迭代计划 | 1h |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 移除 SourceManager、Adapter、HandoffRunner；更新为 workflow → daemon → agentRuntime → modelClient；补充两轴执行模型 | 2h |
| [API.md](API.md) | 移除 `/sources`、`/events`、`/handoff`、`/sessions`；只保留工作流路线的端点 | 1h |

#### 优先级 P1：辅助文档

| 文档 | 清理内容 | 预计工作量 |
|------|---------|-----------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | 移除监听路线的开发指南；更新为工作流路线的开发指南 | 1h |
| [README.md](README.md) | 更新文档索引，移除监听路线相关文档 | 0.5h |
| [RETENTION.md](RETENTION.md) | 移除监听路线的保留说明 | 0.5h |
| [superpowers/](superpowers/) | 检查并清理监听路线相关的计划文档 | 1h |

**验收标准**：
- [ ] 所有文档中无监听路线、handoff、外部 IDE 集成的描述
- [ ] 所有文档统一到工作流路线
- [ ] API 文档只包含工作流路线的端点
- [ ] 文档之间无矛盾

---

### 阶段 3：GUI 重构（预计 3-5 天）

**目标**：GUI 从监听式会话流转向工作流控制台

#### 3.1 现状分析

**当前 GUI 架构**（监听式）：
- VS Code 插件面板风格
- 来源分组任务队列
- 会话流 UI
- 接力 PTY 面板
- 收件箱
- session 回复 omnibar

**目标 GUI 架构**（工作流控制台）：
- 顶栏：workspace 选择条 + 连接状态
- 左栏：workflow 定义列表 + 近期 runs + 人工审核门
- 中栏：run 时间线（steps 顺序 + 状态 + 实时输出）
- 右栏：详情（artifacts、delivery、role/model/permission）

#### 3.2 重构步骤

**Step 1：删除旧代码**（预计 0.5 天）

| 文件/目录 | 删除内容 | 影响范围 |
|----------|---------|---------|
| `packages/gui/wwwroot/chat.html` | 旧的会话流 HTML | 主界面 |
| `packages/gui/wwwroot/chat.js` | 旧的会话流逻辑 | 主界面 |
| `packages/gui/wwwroot/chat.css` | 旧的会话流样式 | 主界面 |
| `packages/gui/Services/` | 监听相关的 C# 服务 | 后端 |

**Step 2：实现新 GUI**（预计 2 天）

| 组件 | 功能 | 预计工作量 |
|------|------|-----------|
| `workspace-selector.js` | workspace 选择条 + 最近列表 + localStorage 持久化 | 2h |
| `connection-status.js` | daemon 连接状态显示 | 1h |
| `workflow-list.js` | workflow 定义列表 + 启动按钮 | 2h |
| `run-list.js` | 近期 runs 列表 + 状态筛选 | 2h |
| `gate-list.js` | 人工审核门列表 + 决策按钮 | 2h |
| `run-timeline.js` | run 时间线 + steps 顺序 + 状态染色 + 实时输出 | 4h |
| `run-detail.js` | artifacts + delivery + role/model/permission | 3h |
| `gate-decision.js` | 人工审核门决策面板（approve/reject/retry + constraints） | 2h |

**Step 3：清理协议**（预计 0.5 天）

| 协议 | 操作 | 预计工作量 |
|------|------|-----------|
| webview → host | 移除 `reply`、`event-reply`、`task-action`、`handoff-launch` | 1h |
| webview → host | 保留 `request-workflow-board`、`request-workflow-run`、`request-workflow-launch`、`request-gate-resolve`、`request-run-cancel`、`request-delivery`、`set-workspace` | 1h |
| host → webview | 实现 `workflow-board`、`workflow-run`、`workflow-run-event`、`connection-status` | 2h |

**Step 4：实现 WebSocket 实时更新**（预计 1 天）

| 功能 | 实现内容 | 预计工作量 |
|------|---------|-----------|
| WebSocket 连接 | 连接 daemon `/ws`，处理 `hello`、`notification`、`workflow-run-event` | 2h |
| run-start | 创建 run 卡片，添加到 run 列表 | 1h |
| step-start | 在时间线中添加 step，标记为 running | 1h |
| step-output | 实时追加 stdout/stderr 到 step 输出区，自动滚动 | 2h |
| step-finish | 更新 step 状态（success/failed），显示 exitCode | 1h |
| run-finish | 更新 run 状态，触发 artifacts 拉取 | 1h |

**Step 5：测试和调试**（预计 1 天）

- [ ] 启动 workflow 流程测试
- [ ] 实时输出显示测试
- [ ] 人工审核门决策测试
- [ ] delivery 复制测试
- [ ] workspace 切换测试
- [ ] 连接断开重连测试

**验收标准**：
- [ ] 旧的监听式 GUI 代码已删除
- [ ] 工作流控制台 GUI 实现完整
- [ ] webview ↔ host 协议清理完成
- [ ] WebSocket 实时更新正常工作
- [ ] 所有核心流程测试通过

---

### 阶段 4：功能完善（预计 2-3 天）

**目标**：完善工作流路线的核心功能

#### 4.1 Agent 工具扩展（预计 1 天）

**写工具（slice 2b）**

| 工具 | 功能 | 实现要点 | 预计工作量 |
|------|------|---------|-----------|
| `write_file` | 写文件 | `permissions=write` 门控，cwd 钳 workspace，`ensurePathInside` 防越界 | 2h |
| `run_command` | 执行命令 | `permissions=command` 门控，cwd 钳 workspace，Windows batch-arg 防护 | 2h |
| 测试 | 单元测试 + 集成测试 | 覆盖正常流程、越界拒绝、权限拒绝 | 2h |

**contextPolicy 强制**

| 功能 | 实现要点 | 预计工作量 |
|------|---------|-----------|
| `maxTokens` | 限制上下文预算，超出时截断或拒绝 | 2h |
| `include` / `exclude` | 过滤可读取文件，glob 匹配 | 2h |

#### 4.2 GUI 功能完善（预计 1-2 天）

**队列视图**

| 功能 | 实现要点 | 预计工作量 |
|------|---------|-----------|
| 状态筛选 | 等待我、失败、需审阅、运行中、完成 | 2h |
| 状态挂载 | 状态挂到 workflow 节点和 artifact | 1h |
| 队列排序 | 按时间、优先级排序 | 1h |

**role/model/permission 展示**

| 功能 | 实现要点 | 预计工作量 |
|------|---------|-----------|
| daemon 端点 | 暴露 workspace roleBindings 给 board | 1h |
| GUI 展示 | 展示 role 绑定的 model、prompt、permissions、contextPolicy | 2h |

**architecture/model 编辑**

| 功能 | 实现要点 | 预计工作量 |
|------|---------|-----------|
| step 编辑 | GUI 选择 step 的 architecture（shell / agent）和 model | 2h |
| models 编辑 | GUI 编辑 config.json 的 models 后端 | 2h |
| 保存和验证 | 保存到 workflow.json，schema 验证 | 1h |

**验收标准**：
- [ ] 写工具实现并测试通过
- [ ] contextPolicy 强制实现并测试通过
- [ ] 队列视图实现
- [ ] role/model/permission 展示实现
- [ ] architecture/model 编辑实现

---

## 风险和依赖

### 风险

1. **GUI 重构风险**：GUI 代码量大，重构可能遇到意外问题
   - **缓解措施**：分步实现，每步验证，保留旧代码备份

2. **协议兼容性风险**：webview ↔ host 协议变更可能导致通信失败
   - **缓解措施**：先实现新协议，再删除旧协议，保证过渡期兼容

3. **测试覆盖风险**：GUI 重构后测试覆盖可能不足
   - **缓解措施**：编写端到端测试，覆盖核心流程

### 依赖

1. **daemon 端点稳定**：GUI 依赖 daemon 的 workflow 端点
   - **状态**：✅ 已稳定，测试通过

2. **WebSocket 事件稳定**：GUI 依赖 daemon 的 workflow-run-event
   - **状态**：✅ 已稳定，测试通过

3. **workspace 配置稳定**：GUI 依赖 workspace 的 workflow.json 和 roleBindings
   - **状态**：✅ 已稳定，schema 验证通过

---

## 时间估算

| 阶段 | 预计工作量 | 日历时间 |
|------|-----------|---------|
| 阶段 2：文档清理 | 8h | 1-2 天 |
| 阶段 3：GUI 重构 | 24h | 3-5 天 |
| 阶段 4：功能完善 | 16h | 2-3 天 |
| **总计** | **48h** | **6-10 天** |

---

## 下一步行动

### 立即开始（阶段 2：文档清理）

1. **清理 POSITIONING.md**
   - 移除监听路线、handoff、外部 IDE 集成的描述
   - 强化工作流路线、进程内 agent、两轴执行模型

2. **清理 PRODUCT_ROADMAP.md**
   - 移除监听来源、适配器、handoff 的路线图
   - 更新为工作流路线的迭代计划

3. **清理 ARCHITECTURE.md**
   - 移除 SourceManager、Adapter、HandoffRunner
   - 更新为 workflow → daemon → agentRuntime → modelClient
   - 补充两轴执行模型的详细说明

4. **清理 API.md**
   - 移除 `/sources`、`/events`、`/handoff`、`/sessions`
   - 只保留工作流路线的端点

### 后续计划

- **阶段 3**：GUI 重构（文档清理完成后）
- **阶段 4**：功能完善（GUI 重构完成后）

---

## 参考文档

- [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) - 开发任务
- [ARCHITECTURE_CLEANUP.md](ARCHITECTURE_CLEANUP.md) - 架构清理记录
- [POSITIONING.md](POSITIONING.md) - 产品定位
- [LOCAL_AI_WORKFLOW.md](LOCAL_AI_WORKFLOW.md) - 工作流设计
- [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) - 产品路线图
