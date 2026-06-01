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

**进度**: 7/7 完成（100%）

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

- [x] **A-05 高危行为检测**
  - 统一的高危行为检测层，覆盖 5 类风险：
    1. 文件删除操作（命令 + 工具调用）
    2. 关键配置/凭据文件修改（.env、credentials.json、id_rsa、appsettings 等）
    3. 危险命令（复用 A-04 的 CommandRisk）
    4. 网络请求（预留接口，检测可疑外泄域名）
    5. Git 历史修改（force push、reset --hard、rebase 等）
  - 验收：`RiskDetector` 实现 5 类检测方法；`RiskDetection` 定义统一风险结果；`RiskSeverity` 分 4 级（Low/Medium/High/Critical）；所有高危行为标记 `requires_human_gate: true`；8 个测试覆盖文件删除、关键文件修改、危险命令、git 操作、网络请求和安全操作；63 个 agent-runtime 测试全部通过。

- [x] **A-06 自动修复循环**
  - 测试失败 -> 诊断 -> 修复 -> 重跑测试。
  - 超过重试上限进入人工门。
  - 验收：`run_auto_fix_loop` 实现完整循环；`AutoFixConfig` 配置测试命令和重试次数；`AutoFixResult` 记录修复历史；`AutoFixEvent` 支持实时事件推送；`diagnose_test_failure` 和 `generate_fix_plan` 提供占位实现；7 个测试覆盖配置构建、结果结构、事件类型和诊断逻辑；70 个 agent-runtime 测试全部通过。

- [x] **A-07 沙箱隔离执行**
  - 4 层隔离级别：None（无隔离）、PathRestricted（路径限制）、ResourceLimited（资源限制）、NetworkIsolated（网络隔离，未来实现）。
  - 验收：`Sandbox` 实现 4 层隔离级别；`IsolationLevel` 枚举定义隔离级别并支持排序；`SandboxConfig` 配置隔离级别、超时、输出限制；`run_command` 根据隔离级别执行命令；`is_path_allowed` 检查路径是否在 workspace 内；9 个测试覆盖隔离级别排序、配置构建、路径检查、命令执行、高危命令阻止、超时强制执行；79 个 agent-runtime 测试全部通过。

---

## P3：Rust Workflow Engine

目标：迁移并强化现有 workflow 行为基线。

- [x] **W-01 Workflow definition**
  - 解析 workflow、step、role、model、provider、permissions、contextPolicy、artifacts、checkpoint。
  - 验收：实现 `WorkflowDefinition`、`WorkflowStep`、`WorkflowContextPolicy`、`WorkflowPermission`、`WorkflowProvider`、`WorkflowArchitecture`、`WorkflowArtifactType`、`DefinitionStore` 结构；支持 JSON 序列化/反序列化；完整的验证逻辑（标识符、路径、依赖关系、唯一性）；11 个测试全部通过；通过 fmt 和 clippy 检查。

- [x] **W-02 Step executor**
  - 支持 shell / agent / provider 三类执行。
  - 支持依赖顺序、失败短路、取消。
  - 验收：实现 `StepExecutor` trait、`DefaultShellExecutor`、`WorkflowExecutor`；支持 shell 命令执行；支持依赖检查、失败短路、checkpoint；实现 `StepRun`、`WorkflowRun` 状态跟踪；7 个测试全部通过（dry-run、依赖检查、checkpoint、shell 执行、失败处理）；通过 fmt 和 clippy 检查。

- [x] **W-03 Run history**
  - NDJSON 或等价 append-only 存储。
  - 支持坏行跳过、compaction、workspace 隔离。
  - 验收：实现 `WorkflowRunHistory`；支持 NDJSON append-only 存储；支持 list、get、search、append 操作；支持坏行跳过（parse 失败不影响其他记录）；支持自动 compaction（超过阈值时保留最近的 max_runs 条）；支持重复 ID 去重（保留后写入的）；7 个测试全部通过（append、list、get、search、去重、compaction、坏行跳过）；通过 fmt 和 clippy 检查。

- [x] **W-04 Artifact store**
  - plan、patch-summary、test-result、review-report、human-decision、delivery-note。
  - 验收：实现 `WorkflowArtifactStore`；支持 6 种 artifact 类型（plan、patch-summary、test-result、review-report、human-decision、delivery-note）；支持 NDJSON append-only 存储；支持 append、list、get_by_type 操作；支持坏行跳过（parse 失败不影响其他记录）；支持自动 compaction（超过阈值时保留最近的 max_artifacts 条）；支持自定义 artifact ID；7 个测试全部通过（append、list、filter by run_id、filter by type、custom id、compaction、坏行跳过）；通过 fmt 和 clippy 检查。

- [x] **W-05 Human gate**
  - approve / reject / retry。
  - constraints 注入后续 step。
  - 决策记录为 artifact。
  - 验收：实现 `HumanGateManager`；支持 3 种决策类型（approve、reject、retry）；支持 list_paused_gates() 列出等待决策的 gates；支持 resolve_gate() 解决 gate 并创建 human-decision artifact；支持 constraints 注入到 workflow values；retry 决策自动找到上一个成功的 step 作为恢复点；approve/reject 决策后 gate 从列表中移除；retry 决策后 gate 保留并显示 last_decision；7 个测试全部通过（list gates、approve、reject、retry、constraints、filter approved、keep retry）；通过 fmt 和 clippy 检查。

- [ ] **W-06 HTTP/WS 契约兼容**（daemon 集成任务）
  - 在 daemon crate 中实现 HTTP 路由：
    - `/workflow/board` - 列出 workflow definitions
    - `/workflow/runs` - 列出 workflow runs
    - `/workflow/runs/:id` - 获取单个 run
    - `/workflow/runs/:id/artifacts` - 获取 run 的 artifacts
    - `/workflow/runs/:id/delivery` - 获取 delivery note
    - `/workflow/gates` - 列出 paused gates
    - `/workflow/gates/:runId/:stepId/resolve` - 解决 gate
  - 实现 WebSocket 事件推送：
    - `workflow-run-event` - workflow 执行事件
  - 注：此任务需要在 daemon crate 中集成 workflow-engine，不在 workflow-engine crate 范围内。

---

## P4：多项目/多任务并行

目标：一个 IDE 同时管理多个项目和多个 workflow。

- [x] **M-01 Project registry**
  - `~/.codepanion/projects.json`
  - 项目名称、路径、标签、最近活动时间、描述。
  - 验收：实现 `ProjectRegistry`；支持 list、get、upsert、remove、touch、search 操作；支持按 name、path、tags、description 搜索；支持按 last_active_at 排序；支持路径验证；支持自动生成唯一 ID；11 个测试全部通过（list empty、upsert and get、list sorted、remove、touch、search by name/tag/description、upsert updates、generate id、validate path）；通过 fmt 和 clippy 检查。

- [x] **M-02 Project API (CCS 风格)**
  - **描述**: HTTP API Server，CCS 兼容架构，供 GUI/CLI 调用
  - **端口**: 8318（避免与 CCS 8317 冲突）
  - **API 版本**: `/api/v1`
  - **风格**: RESTful + OpenAI 兼容格式
  
  **核心端点**:
  - `POST /api/v1/projects` - 创建项目
  - `GET /api/v1/projects` - 列出所有项目（支持 `?tag=rust&sort=lastActiveAt`）
  - `GET /api/v1/projects/:id` - 获取单个项目
  - `PUT /api/v1/projects/:id` - 更新项目
  - `DELETE /api/v1/projects/:id` - 删除项目
  - `POST /api/v1/projects/:id/activate` - 激活项目（更新 lastActiveAt）
  - `GET /api/v1/projects/:id/status` - 项目健康状态和统计
  
  **数据结构扩展**:
  - `Project.metadata`: 支持 runtime、model、custom 字段
  - `ProjectHealth`: 路径存在性、Git 仓库检查
  - `ProjectStats`: 运行统计（totalRuns、successfulRuns、failedRuns）
  
  **错误响应格式**（OpenAI 风格）:
  ```json
  {
    "error": {
      "message": "Project not found",
      "type": "not_found_error",
      "code": "project_not_found",
      "param": "id"
    }
  }
  ```
  
  **CORS 配置**:
  - 允许来源：`http://localhost:3000`, `http://localhost:8318`
  - 允许方法：GET, POST, PUT, DELETE, OPTIONS
  - 允许头部：content-type, authorization, x-request-id
  
  **验收标准**:
  - [x] 7 个端点全部实现并通过测试
  - [x] Project 结构扩展（metadata、health、stats）
  - [x] OpenAI 风格错误响应
  - [x] CORS 配置正确（支持 localhost:3000 和 8318）
  - [x] 查询参数支持（tag 过滤、sort 排序）
  - [x] 健康检查端点（路径验证、Git 检测）
  - [x] 单元测试（请求/响应序列化）
  - [x] 集成测试（完整 HTTP 流程）
  - [x] cargo fmt + clippy + test 全部通过
  - [x] 文档更新（API 规范、使用示例）

- [x] **M-02.1 Model Provider API (多模型支持)** ✅
  - **描述**: 统一的模型 API 管理，支持 Claude、DeepSeek、OpenAI 等多种 API
  - **端口**: 复用 8318
  - **API 版本**: `/api/v1`
  
  **核心端点**:
  - `POST /api/v1/providers` - 添加 provider 配置
  - `GET /api/v1/providers` - 列出所有 providers
  - `GET /api/v1/providers/:id` - 获取单个 provider
  - `PUT /api/v1/providers/:id` - 更新 provider
  - `DELETE /api/v1/providers/:id` - 删除 provider
  - `POST /api/v1/providers/:id/test` - 测试 provider 连接
  - `GET /api/v1/providers/:id/models` - 列出 provider 支持的模型
  
  **支持的 Provider 类型**:
  - `openai` - OpenAI API (GPT-4, GPT-3.5, etc.)
  - `anthropic` - Claude API (Claude 3.5 Sonnet, Claude 3 Opus, etc.)
  - `deepseek` - DeepSeek API (DeepSeek-V3, DeepSeek-Coder, etc.)
  - `openrouter` - OpenRouter (300+ models)
  - `ollama` - Ollama 本地模型
  - `azure-openai` - Azure OpenAI Service
  - `gemini` - Google Gemini API
  - `qwen` - 阿里通义千问
  - `glm` - 智谱 GLM
  - `custom` - 自定义 OpenAI 兼容端点
  
  **Provider 配置结构**:
  ```json
  {
    "id": "my-deepseek",
    "name": "DeepSeek V3",
    "type": "deepseek",
    "config": {
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.deepseek.com/v1",
      "defaultModel": "deepseek-chat",
      "maxTokens": 8192,
      "temperature": 0.7
    },
    "models": [
      {
        "id": "deepseek-chat",
        "name": "DeepSeek Chat",
        "contextWindow": 64000,
        "maxOutputTokens": 8192,
        "pricing": {
          "input": 0.14,
          "output": 0.28,
          "currency": "USD",
          "per": 1000000
        }
      },
      {
        "id": "deepseek-coder",
        "name": "DeepSeek Coder",
        "contextWindow": 64000,
        "maxOutputTokens": 8192
      }
    ],
    "capabilities": ["chat", "streaming", "function-calling"],
    "status": "active",
    "lastTested": 1780306700000,
    "createdAt": 1780306599000
  }
  ```
  
  **Claude API 配置示例**:
  ```json
  {
    "id": "my-claude",
    "name": "Claude API",
    "type": "anthropic",
    "config": {
      "apiKey": "sk-ant-xxx",
      "baseUrl": "https://api.anthropic.com/v1",
      "defaultModel": "claude-3-5-sonnet-20241022",
      "maxTokens": 8192
    },
    "models": [
      {
        "id": "claude-3-5-sonnet-20241022",
        "name": "Claude 3.5 Sonnet",
        "contextWindow": 200000,
        "maxOutputTokens": 8192,
        "pricing": {
          "input": 3.0,
          "output": 15.0,
          "currency": "USD",
          "per": 1000000
        }
      },
      {
        "id": "claude-3-opus-20240229",
        "name": "Claude 3 Opus",
        "contextWindow": 200000,
        "maxOutputTokens": 4096,
        "pricing": {
          "input": 15.0,
          "output": 75.0,
          "currency": "USD",
          "per": 1000000
        }
      }
    ]
  }
  ```
  
  **OpenRouter 配置示例**:
  ```json
  {
    "id": "my-openrouter",
    "name": "OpenRouter",
    "type": "openrouter",
    "config": {
      "apiKey": "sk-or-xxx",
      "baseUrl": "https://openrouter.ai/api/v1",
      "defaultModel": "anthropic/claude-3.5-sonnet"
    }
  }
  ```
  
  **测试连接响应**:
  ```json
  {
    "success": true,
    "latency": 234,
    "models": ["deepseek-chat", "deepseek-coder"],
    "message": "Connection successful"
  }
  ```
  
  **错误响应**:
  ```json
  {
    "error": {
      "message": "Invalid API key",
      "type": "authentication_error",
      "code": "invalid_api_key",
      "param": "apiKey"
    }
  }
  ```
  
  **验收标准**:
  - [x] 7 个端点全部实现并通过测试
  - [x] 支持 10+ 种 provider 类型（openai、anthropic、deepseek、openrouter、ollama、azure-openai、gemini、qwen、glm、custom）
  - [x] Provider 配置结构（id、name、type、config、models、capabilities、status）
  - [x] ProviderRegistry 实现（list、get、upsert、remove、touch、search）
  - [x] 测试连接功能（验证 API Key、列出可用模型）
  - [x] OpenAI 风格错误响应
  - [x] 单元测试（9 个测试覆盖所有功能）
  - [x] cargo fmt + clippy + test 全部通过（59/59 tests）
  - [x] 文档更新（支持的 provider 列表、配置示例）
  - [ ] API Key 安全存储（加密或使用系统密钥链）- 后续优化
  - [ ] 模型列表缓存（避免频繁请求）- 后续优化
  - [ ] 集成测试（真实 API 调用 mock）- 后续优化

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

## P7：Rust Daemon 重构

**进度**: 0/4 完成（0%）

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

- [ ] **D-01 HTTP/WS 服务器**
  - 使用 axum 实现 HTTP 服务器。
  - 使用 tokio-tungstenite 实现 WebSocket。
  - 兼容现有 `/workflow/*` API 路由。
  - 实现 WS `workflow-run-event` 实时推送。
  - 支持 CORS 和错误处理中间件。
  - 验收：实现 axum 服务器；支持 `/workflow/board`、`/workflow/runs`、`/workflow/runs/:id`、`/workflow/runs/:id/artifacts`、`/workflow/runs/:id/delivery`、`/workflow/gates`、`/workflow/gates/:runId/:stepId/resolve` 路由；WebSocket 支持 `workflow-run-event` 推送；测试覆盖所有路由和 WS 连接；与现有 GUI/CLI 协议兼容。

- [ ] **D-02 Workflow 执行器**
  - 集成 P3 workflow engine（W-01 到 W-06）。
  - 集成 P2 agent runtime（A-01 到 A-07）。
  - 实现 fire-and-forget 续跑逻辑。
  - 支持 workflow 取消、暂停、恢复。
  - 实时输出推送到 WebSocket。
  - 验收：`WorkflowRunner` 集成 workflow engine 和 agent runtime；支持启动、取消、暂停、恢复 workflow；实时输出通过 WS 推送；测试覆盖完整 workflow 生命周期；与 TypeScript daemon 行为一致。

- [ ] **D-03 CLI 命令**
  - 使用 clap 实现 CLI 参数解析。
  - `codepanion start` - 启动 daemon。
  - `codepanion stop` - 停止 daemon。
  - `codepanion status` - 查看 daemon 状态。
  - `codepanion workflows` - 列出 workflows。
  - `codepanion workspace` - 管理 workspace。
  - PID 文件管理和进程检测。
  - 验收：实现所有 CLI 命令；PID 文件管理；进程检测和清理；与 TypeScript CLI 行为一致；测试覆盖所有命令和边界情况。

- [ ] **D-04 测试、迁移与性能基准**
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
