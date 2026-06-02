# P5: GUI 工作台实施计划

**日期**: 2026-06-02  
**状态**: 待审批

---

## 当前状况分析

### 现有 GUI 架构
- **技术栈**: WPF (C#) + WebView2 + 纯 HTML/CSS/JavaScript（无框架）
- **通信方式**: WebView2 通过 `window.chrome.webview.postMessage` 与 C# 后端通信
- **布局**: 三栏布局（侧边栏 + 中间时间线 + 右侧详情）
- **数据来源**: Rust daemon HTTP API + WebSocket 实时推送

### 已实现的功能
✅ **Workspace 切换**: 顶栏有 workspace 输入框和最近记录  
✅ **Workflow 列表**: 左侧显示可执行 workflows  
✅ **近期运行**: 左侧显示 runs 列表  
✅ **人工门列表**: 左侧显示 gates 列表  
✅ **Run 时间线**: 中间栏显示选中 run 的 steps  
✅ **Gate 决策面板**: 右侧有 approve/reject/retry 按钮  
✅ **Artifact 列表**: 右侧显示 artifacts  
✅ **Delivery 摘要**: 右侧有复制 Markdown/Handoff 按钮  
✅ **实时推送**: WebSocket 监听 workflow-run-event  

### P5 任务与现状对比

| 任务 | 现状 | 缺失 |
|------|------|------|
| **G-01 项目侧栏** | ⚠️ 只有 workspace，无多项目管理 | 项目列表、添加/删除/编辑、搜索筛选、状态恢复 |
| **G-02 全局任务视图** | ⚠️ 只有当前 workspace 的 runs | 跨项目全局视图、状态筛选 |
| **G-03 当前 run 时间线** | ✅ 基本已实现 | role/model/provider/permissions 展示 |
| **G-04 Artifact 与 delivery** | ✅ 基本已实现 | 测试结果/审查报告格式化 |
| **G-05 Human gate 决策面板** | ✅ 基本已实现 | 决策历史记录 |
| **G-06 模型与 provider 配置** | ❌ 完全缺失 | 全新功能模块 |

---

## 实施策略

### 原则
1. **复用现有架构**: 不引入新框架，继续使用纯 HTML/CSS/JavaScript
2. **渐进式改进**: 每个功能模块独立开发、测试、提交
3. **API 优先**: 确认 Rust daemon API 支持，前端只负责展示和交互

### 技术路线
- **前端**: 纯 JavaScript（ES6+），扩展现有 `chat.js`
- **状态管理**: 扩展现有 `state` 对象
- **UI 组件**: 手写 DOM 操作，复用现有卡片和列表样式
- **通信**: 继续使用 `sendToHost()` + `window.chrome.webview`
- **持久化**: localStorage 保存用户偏好

---

## 任务拆解

### Phase 1: G-01 项目侧栏（P0，2天）

**目标**: 将 workspace 升级为多项目管理

#### UI 改造
- 顶栏 workspace 改为项目选择器
- 添加"项目管理"按钮，打开项目列表对话框
- 项目列表对话框：列表、添加、编辑、删除、搜索

#### API 集成
- GET /api/v1/projects
- POST /api/v1/projects
- PUT /api/v1/projects/:id
- DELETE /api/v1/projects/:id

---

### Phase 2: G-06 模型与 provider 配置（P0，2天）

**目标**: 全新功能模块

#### UI 新建
- 顶栏添加"设置"按钮
- Provider 列表、添加、编辑、删除、测试连接
- 模型配置、角色绑定

#### API 集成
- GET /api/v1/providers
- POST /api/v1/providers
- POST /api/v1/providers/:id/test
- GET /v1/models

---

### Phase 3: G-02 全局任务视图（P0，1天）

**目标**: 跨项目全局视图

#### UI 改造
- 左侧栏添加"全局"标签页
- 状态筛选按钮（运行中/等待/失败/完成）

#### API 集成
- GET /api/v1/global/runs
- GET /api/v1/global/runs/running
- GET /api/v1/global/stats

---

### Phase 4-6: 增强功能（P1-P2，2天）

- G-03: run 时间线增强
- G-04: Artifact 格式化
- G-05: Gate 决策历史

---

## 实施顺序

### Week 1: 核心功能（P0）
1. G-01 项目侧栏 (2天)
2. G-06 模型与 provider 配置 (2天)
3. G-02 全局任务视图 (1天)

### Week 2: 增强功能（P1-P2）
4. G-03/G-04/G-05 (2天)
5. 测试和 bug 修复 (1天)

---

## API 依赖确认

### Rust daemon 已提供（✅）
- ✅ Projects API (GET/POST/PUT/DELETE)
- ✅ Providers API (GET/POST/PUT/DELETE/test)
- ✅ Global API (GET /api/v1/global/runs)
- ✅ Models API (GET /v1/models)

### 需要补充（可选）
- ❌ GET /workflow/gates/:runId/:stepId/history（决策历史）

---

## 验收标准

- ✅ 可以管理多个项目（CRUD + 搜索）
- ✅ 可以查看全局任务视图（跨项目 + 筛选）
- ✅ 可以配置 providers 和模型
- ✅ UI 流畅，操作响应快
- ✅ 与 Rust daemon API 完全兼容

---

**下一步**: 等待用户确认计划，然后开始 Phase 1: G-01 项目侧栏

