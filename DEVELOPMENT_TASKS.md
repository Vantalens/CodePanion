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
  - [ ] WorkflowArtifactStore 集成（artifacts/delivery）- 需要 P3 完整实现
  - [ ] HumanGateManager 集成（gates）- 需要 P3 完整实现
  - [ ] WebSocket 实时推送（workflow-run-event）- 后续实现

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

目标：GUI 从过渡 workflow board 升级为多项目 AI 开发工作台。

- [ ] **G-01 项目侧栏**
  - 项目列表、添加/删除/编辑。
  - 项目搜索和筛选。
  - 项目切换后恢复上次状态。

- [ ] **G-02 全局任务视图**
  - 全局 runs。
  - 全局 gates。
  - 全局队列。
  - 状态筛选：运行中、等待我、失败、完成。

- [ ] **G-03 当前 run 时间线**
  - step 状态。
  - 实时 stdout/stderr。
  - role/model/provider/permissions 展示。

- [ ] **G-04 Artifact 与 delivery**
  - artifacts 列表。
  - delivery markdown / handoff 复制。
  - 测试结果、审查报告、patch summary 展示。

- [ ] **G-05 Human gate 决策面板**
  - approve / reject / retry。
  - constraints 输入。
  - message 输入。
  - 决策历史。

- [ ] **G-06 模型与 provider 配置**
  - 模型 API 配置编辑。
  - provider 列表和连接测试。
  - 默认模型、默认 provider、角色绑定。

---

## P6：文档与发布质量

- [ ] **P6-01 清理 API 文档**
  - 移除旧 `/sources`、`/events`、`/sessions`、handoff 路线。
  - 只保留 workflow/project/provider 路线。

- [ ] **P6-02 更新开发文档**
  - Rust 命令、测试、性能基准、目录结构。

- [ ] **P6-03 更新用户文档**
  - 安装、启动、模型配置、provider 配置、workspace/project 使用。

- [ ] **P6-04 发布门禁**
  - `npm test` 作为 Node 行为基线。
  - `cargo fmt --all`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `dotnet build packages/gui/CodePanion.Gui.csproj -c Release`
  - `git diff --check`

---

## P7：Rust Daemon 重构

**进度**: 3/4 完成（75%）

目标：用 Rust 重写 daemon 核心，降低资源占用，提升性能。

**预期收益**：
- daemon 空闲内存：80-120MB → 30-40MB（-60~-67%）
- daemon 冷启动：800-1200ms → 200-400ms（-67~-75%）
- daemon 热启动：200-400ms → 50-100ms（-50~-75%）
- workflow 性能：2-3x 提升

**技术栈**：
- HTTP/WS：axum + tokio-tungstenite
- 异步运行时：tokio
- 序列化：serde_json
- 日志：tracing
- CLI：clap

- [x] P7-01 WebSocket 实时推送

- [x] P7-02 Workflow 执行器

- [x] P7-03 CLI 命令

- [ ] **P7-04 测试、迁移与性能基准**
  - 端到端测试（daemon + GUI + CLI）。
  - GUI/VSCode 扩展适配（如需要）。
  - 性能基准测试（内存、启动时间、workflow 执行时间）。
  - 迁移指南和文档更新。
  - 移除 TypeScript daemon 依赖（Express、ws、pino）。
  - 验收：端到端测试覆盖所有场景；性能基准达到目标（内存 < 50MB，冷启动 < 500ms，热启动 < 100ms）；GUI 和 VSCode 扩展正常工作；迁移文档完整；TypeScript daemon 依赖已移除。

---

## 参考文档

- [README.md](README.md) - 项目说明
- [docs/POSITIONING.md](docs/POSITIONING.md) - 产品定位
- [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) - 产品路线
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 架构设计
- [docs/LOCAL_AI_WORKFLOW.md](docs/LOCAL_AI_WORKFLOW.md) - 工作流设计
- [docs/RUST_REWRITE_PLAN.md](docs/RUST_REWRITE_PLAN.md) - Rust 重构计划
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 开发指南
