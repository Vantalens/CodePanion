# CodePanion 开发任务与重构路线

## 使用规则

- 本文件只记录当前可执行路线和状态，不再堆叠历史叙事。
- 所有任务必须符合 [docs/POSITIONING.md](docs/POSITIONING.md)、[docs/LOCAL_AI_WORKFLOW.md](docs/LOCAL_AI_WORKFLOW.md)、[docs/RUST_REWRITE_PLAN.md](docs/RUST_REWRITE_PLAN.md)。
- 每完成一组可验证改动，必须同步更新本文件状态。

状态标记：

- `[ ]` 未开始
- `[-]` 进行中
- `[x]` 已完成
- `[!]` 受阻

---

## 当前产品标准

CodePanion 是一个 **Rust 本地全自动 AI IDE**，面向个人开发者，支持全自动 AI 驱动开发、多 AI 角色分工、外部 agentic coding tool 调用、多项目/多任务并行和用户自带模型 API。

当前开发顺序：

1. **Rust daemon 优先**：Node daemon 是过渡实现和行为基线，最终 daemon 以 Rust 为准。
2. **全自动本地开发闭环**：AI 自动拆解、计划、实现、测试、审查、文档和归档。
3. **Provider 能力源并行设计**：Codex、Claude Code、OpenCode、本地模型和国产 AI 编程工具必须能作为 workflow 角色能力源接入。
4. **多项目/多任务并行**：全局 runs、gates、队列、跨项目 artifact 和跨项目依赖。

核心执行模型：

- `architecture=shell`：spawn 本地命令，用于测试、构建等非 AI 步骤。
- `architecture=agent`：进程内 agent runtime，支持 tool-use 循环。
- `provider=api|cli|harness`：外部 agentic coding tool 或内部 harness 能力源。
- `model`：用户在 config.json 中配置的模型 API 或本地模型。

Rust 目标指标：

- daemon 空闲内存 < 50MB
- daemon 冷启动 < 500ms
- daemon 二进制 < 20MB
- workflow 启动 < 50ms
- 实时输出延迟 < 5ms

---

## 当前阻塞

- [x] **B-01 DTO 生成器仍引用旧监听 schema**
  - 现象：`npm test` 在 `scripts/generate-csharp-dtos.mjs` 失败，仍引用已移除的 `MonitorEventSchema.shape`。
  - 影响：Node 行为基线不稳定，Rust 迁移前建议先修复。
  - 验收：`node --test packages/daemon/test/generateCsharpDtos.test.mjs` 通过；`npm run validate:dtos` 通过。

---

## 已完成基线

- [x] **C-01 下线监听路线残留**
  - 删除 adapter-sdk 包。
  - 清理 `protocol.ts` 中外部 IDE 监听 schema。
  - 记录在 [docs/ARCHITECTURE_CLEANUP.md](docs/ARCHITECTURE_CLEANUP.md)。

- [x] **C-02 确认现有进程内 agent 路线**
  - 执行链路：workflow -> daemon -> agentRuntime -> modelClient API。
  - 已有 single-call agent 与只读 tool-use 循环。

- [x] **C-03 用户模型 API 基线**
  - `config.json` 支持 `models`、`defaultModel`、`agent.maxTurns`。
  - `modelClient` 支持 OpenAI-compatible API、tool-use 和取消。

- [x] **C-04 工作流基线**
  - workspace 配置目录。
  - workflow definition schema。
  - run history、artifact、delivery-note。
  - human gate：approve / reject / retry。

- [x] **C-05 文档路线校准**
  - README、POSITIONING、PRODUCT_ROADMAP、ARCHITECTURE、LOCAL_AI_WORKFLOW、DEVELOPMENT、RUST_REWRITE_PLAN 已统一到 Rust 本地全自动 AI IDE 主线。

---

## P0：Rust Daemon 技术验证

目标：证明 Rust 可以承担最终 daemon 架构，并兼容现有 GUI/HTTP/WS 行为基线。

- [x] **R-01 创建 Rust workspace**
  - 目录：`codepanion-rust/`
  - crates：`daemon`、`shared`、`config`、`model-client`、`providers`、`agent-runtime`、`workflow-engine`、`storage`
  - 验收：`cargo fmt --all` 通过；`cargo test --workspace` 通过。

- [x] **R-02 最小 HTTP daemon**
  - 使用 `axum` 或同级 Rust HTTP 框架。
  - 实现 `GET /health`。
  - 验收：无外部依赖 bootstrap HTTP server 已实现；本地启动成功，`GET /health` 返回 ok/pid/version。

- [x] **R-03 最小 WebSocket**
  - 建立 observer 连接。
  - 推送 hello / ping / 简单 event。
  - 验收：单元测试覆盖 WebSocket accept key 和 server text frame；真实 socket smoke 返回 `101 Switching Protocols` 和 hello frame。

- [x] **R-04 Rust 模型客户端**
  - OpenAI-compatible `/chat/completions`。
  - 支持非流式、流式、tool_calls、取消。
  - 验收：本地 TCP mock server 单测覆盖成功、非 2xx 错误、预取消、tool_calls、SSE streaming。

- [x] **R-05 性能基准**
  - 记录空闲内存、冷启动时间、二进制大小、`/health` 延迟、WS 事件延迟。
  - 验收：`codepanion-rust/scripts/measure-baseline.ps1` 可重复执行；基准记录见 [codepanion-rust/benchmarks/baseline-2026-06-01.md](codepanion-rust/benchmarks/baseline-2026-06-01.md)。

---

## P1：Provider Registry 与外部 Agentic Tool 调用

目标：Codex、Claude Code、OpenCode 等必须能作为 workflow 角色能力源接入，而不是只做文档概念。

- [x] **P-01 定义 provider schema**
  - 字段：`id`、`kind`、`displayName`、`capabilities`、`permissions`、`runtime`。
  - kind：`api` / `cli` / `harness`。
  - capabilities：read / write / command / network / delegate / streaming / cancel。
  - 验收：`codepanion-rust/crates/providers` 已定义 `ProviderDefinition`、`ProviderPermissions`、`ProviderRuntime`；测试覆盖 schema 字段和 kind/runtime 校验。

- [x] **P-02 实现 Provider Registry**
  - 注册、查询、校验 provider。
  - provider 输出统一映射为 step output、artifact、delivery-note。
  - 验收：`ProviderRegistry` 支持注册、查询、稳定列表和重复 id 拒绝；`ProviderOutput` / `ProviderArtifact` 定义统一输出 envelope。

- [x] **P-03 CLI provider executor**
  - 受控 `cwd = workspace root`。
  - 参数白名单、环境变量策略、超时、取消。
  - stdout/stderr 捕获和 WS streaming。
  - 验收：`execute_cli_provider` 覆盖受控 cwd、allowlisted extra args、显式 env、timeout、cancel、stdout/stderr capture 和可转发 stream events。

- [x] **P-04 API provider executor**
  - 统一请求/响应/错误模型。
  - API key 本地配置与日志脱敏。
  - token/usage 统计。
  - 流式输出映射为 `step-output`。
  - 验收：`execute_api_provider` 支持 JSON POST、Bearer key 脱敏、非 2xx 错误、usage 解析、预取消和 SSE content chunk event。

- [x] **P-05 Harness provider 接口**
  - 复用 Rust agent runtime。
  - 支持 tool-use、任务委派、权限声明和高危行为检测。
  - 验收：provider crate 已定义 `HarnessExecutor`、`HarnessExecutionRequest`、`HarnessExecutionResult`、`HarnessDelegatedTask` 和 `HarnessRisk`；agent-runtime crate 已提供 `InProcessHarness` adapter，测试覆盖权限拒绝、任务委派、取消和 high-risk human gate 标记。

- [x] **P-06 首批外部工具 provider**
  - Codex CLI provider：受控调用 `codex exec`。
  - Claude Code CLI provider：受控调用 `claude -p`。
  - OpenCode CLI provider：受控调用 `opencode run`。
  - 若外部工具提供稳定 API，再实现对应 API provider。
  - 验收：`default_external_tool_registry()` 注册 `codex-cli`、`claude-code-cli`、`opencode-cli`；`AppConfig::with_default_external_providers()` 可加载首批外部工具 provider。

---

## P2：Rust Agent Runtime 与安全工具

目标：实现能自动开发的 agent runtime，而不是只读问答。

- [x] **A-01 Tool-use loop**
  - 模型 -> tool call -> tool result -> 模型续答。
  - 支持 max turns、取消、错误回填。
  - 验收：`run_agent_loop` 实现完整循环；`AgentLoopEvent` 支持实时推送；`AgentToolRunner` trait 定义工具执行接口；测试覆盖 request builder、event types 和基础循环逻辑。

- [x] **A-02 只读工具**
  - `read_file`
  - `list_dir`
  - `search_files`（暂未实现，后续补充）
  - 所有路径必须限制在 workspace 内。
  - 验收：`ReadonlyTools` 实现 `read_file` 和 `list_dir`；`ensure_path_inside` 实现纯词法路径安全检查；测试覆盖路径越界拒绝、文件读取、目录列出、错误处理和空 workspace 场景；17 个测试全部通过。

- [x] **A-03 写入工具**
  - `write_file`
  - `apply_diff`（暂未实现，后续补充）
  - `create_file`
  - 写入前后必须产出 patch summary。
  - 验收：`WriteTools` 实现 `write_file` 和 `create_file`；`generate_patch_summary` 生成修改摘要；测试覆盖新建文件、覆盖文件、父目录创建、路径越界拒绝、大小限制、已存在文件拒绝；29 个测试全部通过。

- [x] **A-04 命令工具**
  - `run_command`
  - cwd 钳在 workspace root。
  - 命令风险分级、超时、取消、输出截断。
  - 验收：`CommandTools` 实现 `run_command`，cwd 强制钳在 workspace root；`classify_command` 实现 safe/medium/high 三级风险分级（覆盖删除、提权、git 历史改写、网络外泄等 8 类高危模式）；high 风险命令默认拒绝执行并标记需 human gate；支持超时（默认 30s）、取消（Arc<AtomicBool>）、输出截断（stdout/stderr 各 32KB）；21 个命令工具测试 + 4 个真实 mock-server tool-use loop 测试全部通过。

- [ ] **A-05 高危行为检测**
  - 删除文件/目录。
  - 修改关键配置、凭据、权限文件。
  - 危险命令。
  - 网络请求。
  - git 历史修改。
  - 验收：高危动作必须进入 human gate。

- [ ] **A-06 自动修复循环**
  - 测试失败 -> 诊断 -> 修复 -> 重跑测试。
  - 超过重试上限进入人工门。

---

## P3：Rust Workflow Engine

目标：迁移并强化现有 workflow 行为基线。

- [ ] **W-01 Workflow definition**
  - 解析 workflow、step、role、model、provider、permissions、contextPolicy、artifacts、checkpoint。

- [ ] **W-02 Step executor**
  - 支持 shell / agent / provider 三类执行。
  - 支持依赖顺序、失败短路、取消。

- [ ] **W-03 Run history**
  - NDJSON 或等价 append-only 存储。
  - 支持坏行跳过、compaction、workspace 隔离。

- [ ] **W-04 Artifact store**
  - plan、patch-summary、test-result、review-report、human-decision、delivery-note。

- [ ] **W-05 Human gate**
  - approve / reject / retry。
  - constraints 注入后续 step。
  - 决策记录为 artifact。

- [ ] **W-06 HTTP/WS 契约兼容**
  - `/workflow/board`
  - `/workflow/runs`
  - `/workflow/runs/:id`
  - `/workflow/runs/:id/artifacts`
  - `/workflow/runs/:id/delivery`
  - `/workflow/gates`
  - `/workflow/gates/:runId/:stepId/resolve`
  - WS `workflow-run-event`

---

## P4：多项目/多任务并行

目标：一个 IDE 同时管理多个项目和多个 workflow。

- [ ] **M-01 Project registry**
  - `~/.codepanion/projects.json`
  - 项目名称、路径、标签、最近活动时间、描述。

- [ ] **M-02 Project API**
  - `POST /projects`
  - `GET /projects`
  - `GET /projects/:id`
  - `PUT /projects/:id`
  - `DELETE /projects/:id`
  - `POST /projects/:id/activate`

- [ ] **M-03 多 run scheduler**
  - 多 workflow 并行。
  - 全局队列。
  - 取消、暂停、恢复。
  - 按项目隔离 cwd、history、artifacts。

- [ ] **M-04 跨项目编排**
  - workflow 声明跨项目依赖。
  - artifact 跨项目引用。
  - 共享 role 配置库、workflow 模板库、工具配置。

- [ ] **M-05 全局视图 API**
  - 全局 runs。
  - 全局 gates。
  - 全局任务队列。

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

- [ ] **D-01 清理 API 文档**
  - 移除旧 `/sources`、`/events`、`/sessions`、handoff 路线。
  - 只保留 workflow/project/provider 路线。

- [ ] **D-02 更新开发文档**
  - Rust 命令、测试、性能基准、目录结构。

- [ ] **D-03 更新用户文档**
  - 安装、启动、模型配置、provider 配置、workspace/project 使用。

- [ ] **D-04 发布门禁**
  - `npm test` 作为 Node 行为基线。
  - `cargo fmt --all`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `dotnet build packages/gui/CodePanion.Gui.csproj -c Release`
  - `git diff --check`

---

## 参考文档

- [README.md](README.md) - 项目说明
- [docs/POSITIONING.md](docs/POSITIONING.md) - 产品定位
- [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md) - 产品路线
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 架构设计
- [docs/LOCAL_AI_WORKFLOW.md](docs/LOCAL_AI_WORKFLOW.md) - 工作流设计
- [docs/RUST_REWRITE_PLAN.md](docs/RUST_REWRITE_PLAN.md) - Rust 重构计划
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 开发指南
