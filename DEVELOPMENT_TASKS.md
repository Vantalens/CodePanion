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

> **CodePanion 是一个新的 AI IDE**，专为个人开发者设计，支持**全自动 AI 驱动开发**和**多项目同步管理**。

CodePanion 核心定位（2026-06-01 更新）：

1. **全自动 AI 驱动开发**：AI 自行进行角色分工（Orchestrator、Planner、Builder、Tester、Reviewer）和任务执行，用户只需观察监控，必要时介入
2. **用户可介入控制**：用户可以随时介入、修改任务方向、自行编辑代码、批准/拒绝/重试任务
3. **调用外部 agentic coding tool**：通过逆向接口或 API 调用 Codex、Claude Code、OpenCode 等
4. **用户自行提供 API**：支持用户配置自己的模型 API（DeepSeek、OpenAI、Claude、本地模型等）
5. **多项目同步开发管理**：在一个 IDE 内管理多个项目的 workflow

执行模型：**architecture（进程内 harness）× model（用户配置的 API）两轴**

- `architecture=shell`：spawn 本地命令（测试、构建等非 AI 步骤）
- `architecture=agent`：进程内 agent 运行时（逆向自 Claude Code，支持 tool-use 循环）
- `model`：用户在 config.json 中配置的模型 API（DeepSeek、OpenAI、Claude、本地模型等）

---

## 重构路线规划

### 阶段 1：架构清理（已完成 ✅）

**目标**：彻底下线监听路线残留，确认工作流路线

- [x] **R-01** 删除 adapter-sdk 包（监听路线残留）
- [x] **R-02** 清理 protocol.ts 中的监听外部 IDE 的 schema
- [x] **R-03** 确认 agent 架构完全走进程内
- [x] **R-04** 构建和测试验证
- [x] **R-05** 文档记录：[docs/ARCHITECTURE_CLEANUP.md](docs/ARCHITECTURE_CLEANUP.md)

**成果**：
- ✅ adapter-sdk 已删除
- ✅ protocol.ts 已清理监听 schema
- ✅ agent 架构确认完全走进程内
- ✅ 执行路线验证通过：workflow → daemon → agentRuntime → modelClient API
- ✅ 测试全部通过

---

### 阶段 2：定位更新（已完成 ✅）

**目标**：更新产品定位为"新的 AI IDE"

- [x] **R-10** 更新 [docs/POSITIONING.md](docs/POSITIONING.md)
  - 明确 CodePanion 是一个新的 AI IDE
  - 强调调用外部 agentic coding tool
  - 强调用户自行提供 API
  - 强调多项目同步开发管理

- [x] **R-11** 更新 [README.md](README.md)
  - 更新核心特点
  - 更新产品边界
  - 更新目标用户

**成果**：
- ✅ 定位明确：CodePanion 是一个新的 AI IDE
- ✅ 核心特点明确：调用外部 agentic tool + 用户自行提供 API + 多项目管理
- ✅ 产品边界明确：不是代码编辑器，是 AI IDE

---

### 阶段 3：多项目管理（规划中 📋）

**目标**：实现在一个 IDE 内管理多个项目

#### 3.1 多项目架构设计

- [ ] **M-01** 设计多项目数据模型
  - 项目列表存储（`~/.codepanion/projects.json`）
  - 项目元数据（名称、路径、最近打开时间、标签、描述）
  - 当前活跃项目（GUI 状态）

- [ ] **M-02** 设计跨项目 workflow 编排
  - 跨项目任务依赖（项目 A 的 workflow 依赖项目 B 的产出）
  - 跨项目资源共享（共享的 role 配置、模板、工具）
  - 跨项目并行执行（同时运行多个项目的 workflow）

#### 3.2 daemon 端实现

- [ ] **M-10** 实现项目管理端点
  - `POST /projects` - 添加项目
  - `GET /projects` - 列出所有项目
  - `GET /projects/:id` - 获取项目详情
  - `PUT /projects/:id` - 更新项目信息
  - `DELETE /projects/:id` - 删除项目
  - `POST /projects/:id/activate` - 激活项目（设为当前项目）

- [ ] **M-11** 实现跨项目 workflow 编排
  - 支持 workflow 声明跨项目依赖
  - 支持跨项目的 artifact 引用
  - 支持跨项目的并行执行

- [ ] **M-12** 实现项目级资源管理
  - 共享 role 配置库
  - 共享 workflow 模板库
  - 共享工具配置

#### 3.3 GUI 实现

- [ ] **M-20** 实现项目列表 UI
  - 左侧边栏：项目列表
  - 项目卡片：名称、路径、最近打开时间、标签
  - 项目搜索和筛选
  - 项目添加/删除/编辑

- [ ] **M-21** 实现项目切换
  - 点击项目卡片切换当前项目
  - 切换后自动加载该项目的 workspace、workflow、runs
  - 保留上一个项目的状态（下次切换回来时恢复）

- [ ] **M-22** 实现跨项目视图
  - 全局 workflow 看板（所有项目的 runs）
  - 全局人工审核门（所有项目的 gates）
  - 全局队列视图（所有项目的任务）

---

### 阶段 4：调用外部 agentic coding tool（规划中 📋）

**目标**：通过逆向接口或 API 调用外部 AI 编程工具

#### 4.1 逆向接口设计

- [ ] **A-01** 研究 Claude Code 的 agent 架构
  - 分析 Claude Code 的 tool-use 循环
  - 分析 Claude Code 的文件操作工具
  - 分析 Claude Code 的命令执行工具
  - 分析 Claude Code 的上下文管理策略

- [ ] **A-02** 研究 Codex 的 agent 架构
  - 分析 Codex 的 agent 模式
  - 分析 Codex 的工具集
  - 分析 Codex 的权限控制

- [ ] **A-03** 研究 OpenCode 的 agent 架构
  - 分析 OpenCode 的 agent 管理模式
  - 分析 OpenCode 的角色权限
  - 分析 OpenCode 的任务委派

#### 4.2 agent 架构实现

- [ ] **A-10** 扩展 agent 工具集（基于 Claude Code）
  - `write_file`：写文件（`permissions=write` 门控）
  - `run_command`：执行命令（`permissions=command` 门控）
  - `search_files`：搜索文件（基于 glob 或 ripgrep）
  - `apply_diff`：应用 diff（基于 unified diff 格式）

- [ ] **A-11** 实现 contextPolicy 强制
  - `maxTokens`：限制上下文预算
  - `include` / `exclude`：过滤可读取文件
  - 上下文自动压缩（超出预算时）

- [ ] **A-12** 实现 agent 权限控制
  - `read`：只读文件工具
  - `write`：写文件工具
  - `command`：执行命令工具
  - `network`：网络访问工具
  - `delegate`：委派任务给其他 agent

#### 4.3 API 调用实现

- [ ] **A-20** 实现 Codex API 调用（如果 Codex 提供 API）
  - 研究 Codex API 文档
  - 实现 Codex API 客户端
  - 在 workflow 中集成 Codex API

- [ ] **A-21** 实现 Claude Code API 调用（如果 Claude Code 提供 API）
  - 研究 Claude Code API 文档
  - 实现 Claude Code API 客户端
  - 在 workflow 中集成 Claude Code API

- [ ] **A-22** 实现 OpenCode API 调用（如果 OpenCode 提供 API）
  - 研究 OpenCode API 文档
  - 实现 OpenCode API 客户端
  - 在 workflow 中集成 OpenCode API

---

### 阶段 5：用户自行提供 API（部分完成 ✅）

**目标**：支持用户配置自己的模型 API

#### 5.1 已完成

- [x] **U-01** 实现 config.json 模型配置
  - `models`：模型后端配置（baseURL、apiKey、model、temperature、maxTokens）
  - `defaultModel`：默认模型
  - `agent.maxTurns`：agent 最大轮数

- [x] **U-02** 实现 modelClient（OpenAI 兼容）
  - 支持 DeepSeek、OpenAI、Claude（通过 OpenAI 兼容层）
  - 支持 tool-use（function calling）
  - 支持 AbortSignal（run cancel）

#### 5.2 待完成

- [ ] **U-10** GUI 实现模型配置编辑
  - 模型列表展示
  - 添加/删除/编辑模型后端
  - 测试模型连接
  - 设置默认模型

- [ ] **U-11** 支持更多模型 API
  - 本地模型（Ollama、LM Studio）
  - 国产模型（通义千问、文心一言、智谱 AI）
  - 自定义 API（用户自己部署的模型服务）

- [ ] **U-12** 实现模型使用统计
  - 记录每个模型的调用次数、token 消耗
  - 展示模型使用统计（按项目、按 workflow、按时间）
  - 导出统计报告

---

### 阶段 6：GUI 重构（规划中 📋）

**目标**：GUI 从监听式会话流转向 AI IDE

#### 6.1 删除旧代码

- [ ] **G-01** 删除旧的监听式 GUI 代码
  - 删除 VS Code 插件面板相关代码
  - 删除来源分组任务队列
  - 删除会话流 UI
  - 删除接力 PTY 面板
  - 删除收件箱
  - 删除 session 回复 omnibar

#### 6.2 实现新 GUI（AI IDE）

- [ ] **G-10** 实现顶栏
  - 项目选择器（当前项目 + 最近项目列表）
  - 全局搜索（跨项目搜索 workflow、runs、artifacts）
  - 连接状态（daemon 连接状态）
  - 用户设置（模型配置、主题、语言）

- [ ] **G-11** 实现左侧边栏
  - 项目列表（所有项目 + 添加项目按钮）
  - workflow 定义列表（当前项目的 workflows）
  - 近期 runs（当前项目的最近 runs）
  - 人工审核门（当前项目的 paused gates）

- [ ] **G-12** 实现中央区域
  - run 时间线（steps 顺序 + 状态染色 + 实时输出）
  - step 详情（command、args、exitCode、stdout、stderr）
  - 实时滚动（step-output 实时追加）

- [ ] **G-13** 实现右侧边栏
  - artifacts 列表（plan、patch-summary、test-result、review-report、delivery-note）
  - delivery 复制（markdown / handoff 格式）
  - role/model/permission 展示
  - contextPolicy 展示

- [ ] **G-14** 实现人工审核门决策面板
  - approve / reject / retry 按钮
  - constraints 输入（多行文本）
  - message 输入（可选）
  - 决策历史展示

#### 6.3 实现 WebSocket 实时更新

- [ ] **G-20** 实现 WebSocket 连接
  - 连接 daemon `/ws`
  - 处理 `hello`、`notification`、`workflow-run-event`
  - 断线重连

- [ ] **G-21** 实现 run 实时更新
  - `run-start`：创建 run 卡片
  - `step-start`：添加 step 到时间线
  - `step-output`：实时追加输出
  - `step-finish`：更新 step 状态
  - `run-finish`：更新 run 状态，拉取 artifacts

---

### 阶段 7：文档清理（待规划 📋）

**目标**：清理所有文档中的监听路线残留

- [ ] **D-01** 清理 [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md)
- [ ] **D-02** 清理 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [ ] **D-03** 清理 [docs/API.md](docs/API.md)
- [ ] **D-04** 清理 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [ ] **D-05** 清理 [docs/README.md](docs/README.md)
- [ ] **D-06** 清理 [docs/RETENTION.md](docs/RETENTION.md)
- [ ] **D-07** 检查并清理 [docs/superpowers/](docs/superpowers/) 目录

---

## 当前进度总结

### 已完成 ✅

1. **架构清理**（阶段 1）
   - adapter-sdk 已删除
   - protocol.ts 已清理监听 schema
   - agent 架构确认完全走进程内
   - 执行路线验证通过
   - 测试全部通过

2. **定位更新**（阶段 2）
   - 明确 CodePanion 是一个新的 AI IDE
   - 强调调用外部 agentic coding tool
   - 强调用户自行提供 API
   - 强调多项目同步开发管理

3. **用户自行提供 API**（阶段 5 部分）
   - config.json 模型配置
   - modelClient（OpenAI 兼容）
   - 支持 DeepSeek、OpenAI、Claude

4. **核心功能**
   - workspace 级配置目录
   - workflow definition schema 扩展
   - 内置角色模板
   - workflow run artifact 历史
   - 人工审核门（approve/reject/retry）
   - delivery-note 生成
   - 执行模型两轴化（architecture × model）
   - single-call agent
   - tool-use 循环（只读）

### 待完成 📋

1. **多项目管理**（阶段 3）
   - 项目列表、项目切换、跨项目编排

2. **调用外部 agentic coding tool**（阶段 4）
   - 逆向 Claude Code、Codex、OpenCode 的 agent 架构
   - 扩展 agent 工具集（write_file、run_command、search_files、apply_diff）
   - 实现 API 调用（如果外部工具提供 API）

3. **用户自行提供 API**（阶段 5 剩余）
   - GUI 模型配置编辑
   - 支持更多模型 API（本地模型、国产模型、自定义 API）
   - 模型使用统计

4. **GUI 重构**（阶段 6）
   - 删除旧的监听式 GUI 代码
   - 实现新的 AI IDE GUI
   - 实现 WebSocket 实时更新

5. **文档清理**（阶段 7）
   - 清理所有文档中的监听路线残留

---

## 验收标准

### 阶段 1：架构清理 ✅

- [x] adapter-sdk 目录已删除
- [x] protocol.ts 中无监听 schema 残留
- [x] agent 执行路线验证通过
- [x] 构建成功
- [x] 核心测试全部通过

### 阶段 2：定位更新 ✅

- [x] POSITIONING.md 明确 CodePanion 是新的 AI IDE
- [x] README.md 更新核心特点和产品边界
- [x] 强调调用外部 agentic tool + 用户自行提供 API + 多项目管理

### 阶段 3：多项目管理

- [ ] 项目列表 UI 实现
- [ ] 项目切换功能实现
- [ ] 跨项目 workflow 编排实现
- [ ] 跨项目视图实现

### 阶段 4：调用外部 agentic coding tool

- [ ] 逆向 Claude Code 等工具的 agent 架构
- [ ] 扩展 agent 工具集实现并测试通过
- [ ] API 调用实现（如果外部工具提供 API）

### 阶段 5：用户自行提供 API

- [x] config.json 模型配置实现
- [x] modelClient（OpenAI 兼容）实现
- [ ] GUI 模型配置编辑实现
- [ ] 支持更多模型 API
- [ ] 模型使用统计实现

### 阶段 6：GUI 重构

- [ ] 旧的监听式 GUI 代码已删除
- [ ] 新的 AI IDE GUI 实现完整
- [ ] WebSocket 实时更新正常工作
- [ ] 所有核心流程测试通过

### 阶段 7：文档清理

- [ ] 所有文档中无监听路线残留
- [ ] 所有文档统一到 AI IDE 定位
- [ ] API 文档只包含工作流路线的端点

---

## 参考文档

- [docs/POSITIONING.md](docs/POSITIONING.md) - 产品定位
- [docs/LOCAL_AI_WORKFLOW.md](docs/LOCAL_AI_WORKFLOW.md) - 工作流设计
- [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) - 产品路线图
- [docs/ARCHITECTURE_CLEANUP.md](docs/ARCHITECTURE_CLEANUP.md) - 架构清理记录
- [docs/REFACTORING_PLAN.md](docs/REFACTORING_PLAN.md) - 重构计划
- [README.md](README.md) - 项目说明
