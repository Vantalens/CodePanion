# CodePanion 开发任务

> 本文件记录开发任务和进度。产品定位见 [docs/POSITIONING.md](docs/POSITIONING.md)，架构设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 状态标记

- `[ ]` 未开始
- `[>]` 进行中
- `[x]` 已完成
- `[!]` 受阻

---

## P0：Rust Daemon 技术验证 ✅

- [x] R-01: 创建 Rust workspace
- [x] R-02: 最小 HTTP daemon
- [x] R-03: 最小 WebSocket
- [x] R-04: Rust 模型客户端
- [x] R-05: 性能基准

---

## P1：Provider Registry 与外部 Agentic Tool 调用 ✅

- [x] P-01: 定义 provider schema
- [x] P-02: 实现 Provider Registry
- [x] P-03: CLI provider executor
- [x] P-04: API provider executor
- [x] P-05: Harness provider 接口
- [x] P-06: 首批外部工具 provider

---

## P2：Rust Agent Runtime 与安全工具 ✅

- [x] A-01: Tool-use loop
- [x] A-02: 只读工具（read_file, list_dir）
- [x] A-03: 写入工具（write_file, create_file）
- [x] A-04: 命令工具（run_command，风险分级）
- [x] A-05: 高危行为检测（5 类风险）
- [x] A-06: 自动修复循环
- [x] A-07: 沙箱隔离执行（4 层隔离级别）

---

## P3：Rust Workflow Engine

目标：迁移并强化现有 workflow 行为基线。

- [x] W-01 Workflow definition

- [x] W-02 Step executor

- [x] W-03 Run history

- [x] W-04 Artifact store

- [x] W-05 Human gate

- [x] W-06 HTTP/WS 契约兼容
  - [x] WorkflowArtifactStore 集成（artifacts/delivery）
  - [x] HumanGateManager 集成（gates）
  - [x] WebSocket 实时推送（workflow-run-event）

---

## P4：多项目/多任务并行

目标：一个 IDE 同时管理多个项目和多个 workflow。

- [x] M-01 Project registry

- [x] M-02 Project API (CCS 风格)

- [x] M-02.1 Model Provider API (多模型支持)
  - [ ] API Key 安全存储（加密或使用系统密钥链）- 后续优化
  - [ ] 模型列表缓存（避免频繁请求）- 后续优化
  - [ ] 集成测试（真实 API 调用 mock）- 后续优化

- [x] M-02.2 Provider 切换与模型别名

- [x] M-02.3 环境变量与配置导入（CC Switch 完整兼容）

- [x] M-02.4 CLI 命令工具（CC Switch 完整兼容 Phase 3）

- [x] M-03 多 run scheduler

- [x] M-04 跨项目编排

- [x] M-05 全局视图 API

---

## P5：GUI 工作台

**进度**: 6/6 完成（100%） ✅

目标：GUI 从过渡 workflow board 升级为多项目 AI 开发工作台。

- [x] **G-01 项目侧栏** (已完成 2026-06-02)
  - [x] 项目列表、添加/删除/编辑（完整 CRUD）
  - [x] 项目搜索和筛选（实时搜索）
  - [x] 项目切换后恢复上次状态（selectedRunId、scrollPos）
  - **实现细节**：
    - 前端：projects.js (390行)，纯 HTML/CSS/JavaScript
    - 后端：MainWindow.xaml.cs (5个消息处理器)
    - API：Rust daemon Projects API 完全集成
    - UI：Tokyo Night 配色，模态对话框
    - 提交：bb1ad22, 6a47364

- [x] **G-06 模型与 provider 配置** (已完成 2026-06-02)
  - [x] Provider CRUD (列表、添加、编辑、删除、测试连接)
  - [x] Provider 激活/切换
  - [x] 模型配置 (默认模型、角色绑定)
  - [x] 设置对话框 (标签页切换)
  - **实现细节**：
    - 前端：settings.js (475行)，chat.html/css 扩展
    - 后端：8个消息处理器
    - API：9个 daemon 端点集成
    - UI：设置按钮(⚙️)，900px 模态对话框
    - 提交：2f981a2

- [x] **G-02 全局任务视图** (已完成 2026-06-02)
  - [x] 全局 runs（跨项目）
  - [x] 全局 gates（跨项目）
  - [x] 全局 workflows（跨项目）
  - [x] 标签切换（项目/全局）- 三个区域独立
  - [x] 状态筛选（全部/运行中/队列/失败/完成）
  - **实现细节**：
    - 前端：标签按钮 + 筛选按钮 + 逻辑 (150+ 行)
    - 后端：3个全局 API 处理器
    - UI：内联标签头，颜色编码筛选按钮
    - 提交：4b6ef7c

- [x] **G-03 当前 run 时间线** (已完成 2026-06-02)
  - [x] step 状态（pending/running/success/failed/cancelled）
  - [x] 实时 stdout/stderr（已有）
  - [x] role/model/provider 展示
  - [x] permissions 图标展示（📖✏️⚙️🌐🔧）
  - **实现细节**：
    - 增强 renderStepRow() 显示 meta 信息
    - Permissions 映射为图标
    - 提交：52f48ad

- [x] **G-04 Artifact 与 delivery** (已完成 2026-06-02)
  - [x] artifacts 列表（已有）
  - [x] delivery markdown / handoff 复制（已有）
  - [x] 测试结果表格化（test-results.json）
  - [x] 审查报告 markdown 渲染（code-review.md）
  - [x] patch summary 展示（patch-summary.md）
  - **实现细节**：
    - applyArtifacts() 特殊格式化逻辑
    - .artifact-table CSS
    - .artifact-preview 预览区
    - 提交：52f48ad

- [x] **G-05 Human gate 决策面板** (已完成 2026-06-02)
  - [x] approve / reject / retry（已有）
  - [x] constraints 输入（已有）
  - [x] message 输入（已有）
  - [x] 决策历史对话框
  - [x] 历史记录显示（时间、决策、约束、备注）
  - **实现细节**：
    - gate 历史对话框 (700px)
    - 历史按钮 + 3个函数 (90+ 行)
    - 后端：gate-history API 处理器
    - UI：颜色编码决策类型（绿/红/橙）
    - 提交：52f48ad

**P5 总结**：
- 代码量：~2200 行（前端 + 后端）
- 提交数：6 次
- 功能：6 个主要功能全部完成
- 架构：纯 JS + WPF/WebView2 + Rust daemon API

---

## P6：文档与发布质量 ✅

- [x] **P6-01 清理 API 文档**
  - 移除旧 `/sources`、`/events`、`/sessions`、handoff 路线。
  - 只保留 workflow/project/provider 路线。

- [x] **P6-02 更新开发文档**
  - Rust 命令、测试、性能基准、目录结构。

- [x] **P6-03 更新用户文档**
  - 安装、启动、模型配置、provider 配置、workspace/project 使用。

- [x] **P6-04 发布门禁**
  - `npm test` 作为 Node 行为基线。
  - `cargo fmt --all`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `npm run gui:build`
  - `git diff --check`

---

## P7：Rust Daemon 重构

**进度**: 4/4 完成（100%） ✅

目标：用 Rust 重写 daemon 核心，降低资源占用，提升性能。

**实际收益**（超预期）：
- daemon 空闲内存：80-120MB → **11.82MB**（-90%）
- daemon 二进制：N/A → **3.98MB**
- daemon 冷启动：800-1200ms → ~823ms（-30%，可优化）
- HTTP API：100% 核心功能验证通过

**技术栈**：
- HTTP/WS：axum + tokio-tungstenite
- 异步运行时：tokio
- 序列化：serde_json
- 日志：tracing
- CLI：clap

- [x] P7-01 WebSocket 实时推送

- [x] P7-02 Workflow 执行器

- [x] P7-03 CLI 命令

- [x] **P7-04 测试、迁移与性能基准** (100% 完成)
  - [x] **测试架构设计**（阶段 1.1）：创建 TestDaemon 测试框架、HTTP 客户端封装、临时目录隔离
  - [x] **HTTP API 集成测试**（阶段 1.2）：38/38 daemon integration tests passed (100%)
    - [x] Project API: 9/9 tests (100%)
    - [x] Workflow/Scheduler API: 12/12 tests (100%)
    - [x] Provider API: 14/14 tests (100%)
    - [x] WebSocket API: 3/3 tests (100%)
  - [x] **性能基准测试**（阶段 2.1-2.2）：二进制 3.98MB、内存 11.82MB、冷启动 ~823ms
    - [x] 创建 benchmark-daemon.ps1 自动化脚本
    - [x] 二进制大小：3.98 MB ✓ (目标 < 20 MB，超预期 5x)
    - [x] 空闲内存：11.82 MB ✓ (目标 < 50 MB，超预期 4x)
    - [x] 冷启动：~823 ms (目标 < 500 ms，可优化)
  - [x] **Workflow 执行端到端测试**（阶段 1.4）：7/7 tests passed (100%)
    - [x] Shell workflow 执行
    - [x] Workflow artifacts 生成
    - [x] Workflow gate 决策
    - [x] Workflow board 列表
    - [x] Workflow runs 历史
    - [x] Scheduler stats 集成
  - [x] **GUI/CLI 适配验证**（阶段 3）：验证工具已创建
    - [x] 创建自动化验证脚本 (verify-gui-cli.ps1)
    - [x] 创建手动验证清单
    - [x] 基于集成测试验证 HTTP API 兼容性（100%）
    - [x] CLI 命令已实现并可用
    - [x] GUI/CLI smoke 验证（scripts/verify-gui-cli.ps1）
    - [x] 验证 WebSocket 事件格式（workflow-run-event / workflow-started / workflow-completed）
  - [x] WebSocket 实时推送测试（阶段 1.3，P1）
  - [x] CLI 命令测试（阶段 1.5，P2）
  - [x] **迁移指南和文档更新**（阶段 4，P1）：已创建 RUST_MIGRATION_GUIDE.md
    - [x] 快速开始指南（3步启动）
    - [x] 完整兼容性说明
    - [x] 分步迁移流程（8步）
    - [x] API 差异对比
    - [x] 配置迁移说明
    - [x] 故障排查指南
    - [x] 命令对照表
  - [x] P3 未完成集成（阶段 5：Artifacts/Gates/WebSocket，P1）
    - [x] WorkflowArtifactStore 集成到 Rust daemon state 与 `/workflow/runs/:id/artifacts`
    - [x] HumanGateManager 集成到 `/workflow/gates` 与 `/workflow/gates/:runId/:stepId/resolve`
    - [x] Workflow execution 持久化 run history、step artifacts、delivery-note
  - [x] 移除 TypeScript daemon 依赖（阶段 6，P2）：GUI/打包默认走 Rust daemon；旧 Node daemon 仅显式环境变量回退
  - **验收**：`cargo fmt --all` ✓；`cargo test --workspace` ✓；`cargo clippy --workspace --all-targets -- -D warnings` ✓；`cargo build --release --bin codepanion-daemon --bin codepanion` ✓；`npm test` ✓；GUI 隔离输出 Release build ✓；portable package + validate ✓；`scripts/verify-gui-cli.ps1` ✓；核心 API / Provider / WebSocket / Workflow execution / CLI 测试 100% 通过 ✓；性能指标超预期 ✓；迁移文档已完成 ✓；冷启动 < 500ms 作为后续优化项保留，不阻塞本阶段完成

---

## P8：Tauri + React GUI 现代化

**进度**: 5/5 完成（100%） ✅

目标：把默认 GUI 从 WPF/WebView2 直接替换为 Tauri + React + TypeScript，并保留 WPF legacy 一轮。

- [x] T-01 迁移旧 WPF GUI 到 `packages/gui-wpf-legacy`
- [x] T-02 新建 `packages/gui` Tauri + React + TypeScript 应用
- [x] T-03 实现 Codex 式线程工作台、typed daemon client、WS run event reducer
- [x] T-04 切换 `gui:run`、`gui:build`、`package:windows` 默认入口
- [x] T-05 更新文档、legacy 测试路径和 portable package 验证脚本

**验收**：`npm --prefix packages/gui test` ✓；`npm --prefix packages/gui run test:visual` ✓；`npm --prefix packages/gui run build` ✓；`npm run gui:build` ✓；`npm run package:windows` ✓；`scripts/validate-portable-package.ps1` ✓

---

## 参考文档

- [README.md](README.md) - 项目说明
- [docs/POSITIONING.md](docs/POSITIONING.md) - 产品定位
- [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) - 产品路线
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 架构设计
- [docs/LOCAL_AI_WORKFLOW.md](docs/LOCAL_AI_WORKFLOW.md) - 工作流设计
- [docs/RUST_REWRITE_PLAN.md](docs/RUST_REWRITE_PLAN.md) - Rust 重构计划
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 开发指南
