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

- [x] **W-06 HTTP/WS 契约兼容** ✅
  - **描述**: 在 daemon 中实现 workflow 相关的 HTTP 路由（GUI/CLI 兼容）
  
  **核心功能**:
  - Workflow board（workflow 定义列表）
  - Workflow runs（run 列表和详情）
  - Artifacts 查询
  - Delivery note 查询
  - Gates 管理（列出和解决）
  
  **API 端点**:
  ```
  GET  /workflow/board                           # 列出 workflow definitions
  GET  /workflow/runs                            # 列出 workflow runs
  GET  /workflow/runs/:id                        # 获取单个 run
  GET  /workflow/runs/:id/artifacts              # 获取 run 的 artifacts
  GET  /workflow/runs/:id/delivery               # 获取 delivery note
  GET  /workflow/gates                           # 列出 paused gates
  POST /workflow/gates/:run_id/:step_id/resolve  # 解决 gate
  ```
  
  **验收标准**:
  - [x] 7 个 workflow API 端点
  - [x] 与现有 scheduler 和 orchestrator 集成
  - [x] camelCase JSON 响应（GUI 兼容）
  - [x] daemon 启动信息更新
  - [x] 92/92 测试通过
  - [x] cargo clippy 通过
  - [ ] WorkflowArtifactStore 集成（artifacts/delivery）- 需要 P3 完整实现
  - [ ] HumanGateManager 集成（gates）- 需要 P3 完整实现
  - [ ] WebSocket 实时推送（workflow-run-event）- 后续实现

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

- [x] **M-02.2 Provider 切换与模型别名** ✅
  - **描述**: 实现快速切换 API provider 和模型别名解析（CC Switch 兼容核心）
  - **端口**: 复用 8318
  - **API 版本**: `/api/v1`
  
  **核心功能**:
  - 全局配置管理（`~/.codepanion/config.json`）
  - 模型别名解析（`opus` → `claude-opus-4-20250514`）
  - 活跃 provider 管理（快速切换当前使用的 provider）
  - OpenAI 兼容的 `/v1/models` 端点
  
  **新增端点**:
  - `POST /api/v1/providers/:id/activate` - 激活 provider（设置为当前活跃）
  - `GET /api/v1/providers/active` - 获取当前活跃的 provider
  - `GET /v1/models` - 列出所有 provider 的所有模型（OpenAI 兼容格式）
  
  **全局配置结构**:
  ```json
  {
    "version": 1,
    "activeProviderId": "my-deepseek",
    "defaultModel": "opus",
    "modelAliases": {
      "opus": "claude-opus-4-20250514",
      "sonnet": "claude-sonnet-4-20250514",
      "haiku": "claude-haiku-4-20250301"
    }
  }
  ```
  
  **模型别名解析示例**:
  - 用户请求 `opus` → 解析为 `claude-opus-4-20250514`
  - 用户请求 `gpt-4` → 直接使用（非别名）
  - 支持自定义别名：`gpt4` → `gpt-4-turbo`
  
  **验收标准**:
  - [x] GlobalConfig 和 GlobalConfigManager 实现
  - [x] 模型别名解析系统（resolve_model_alias）
  - [x] 活跃 provider 管理（set_active_provider, get_active_provider）
  - [x] POST /api/v1/providers/:id/activate 端点
  - [x] GET /api/v1/providers/active 端点
  - [x] GET /v1/models 端点（OpenAI 兼容格式）
  - [x] 全局配置持久化（~/.codepanion/config.json）
  - [x] 默认 Claude 别名（opus/sonnet/haiku）
  - [x] 7 个单元测试覆盖所有功能
  - [x] cargo fmt + clippy + test 全部通过（66/66 tests）
  - [x] 文档更新

- [x] **M-02.3 环境变量与配置导入（CC Switch 完整兼容）** ✅
  - **描述**: 实现环境变量支持、分层配置优先级、CC Switch 配置导入
  - **端口**: 复用 8318
  - **API 版本**: `/api/v1`
  
  **核心功能**:
  - 环境变量支持（`ANTHROPIC_*` 系列）
  - 分层配置优先级（环境变量 > 文件配置 > 默认值）
  - CC Switch 配置导入（`~/.ccm_config`）
  - Claude Code 配置导入（`~/.claude/settings.json`）
  - 自动检测和导入
  
  **支持的环境变量**:
  - `ANTHROPIC_MODEL` - 覆盖默认模型
  - `ANTHROPIC_BASE_URL` - API 端点 URL
  - `ANTHROPIC_AUTH_TOKEN` - API 密钥
  - `ANTHROPIC_DEFAULT_OPUS_MODEL` - Opus 别名映射
  - `ANTHROPIC_DEFAULT_SONNET_MODEL` - Sonnet 别名映射
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL` - Haiku 别名映射
  - `ANTHROPIC_EFFORT_LEVEL` - 努力级别（low/medium/high/xhigh/max）
  
  **新增端点**:
  - `POST /api/v1/config/import` - 导入配置
    - `source: "ccm"` - 导入 CC Switch 配置
    - `source: "claude"` - 导入 Claude Code 配置
    - `source: "auto"` - 自动检测并导入
    - `filePath` (可选) - 自定义配置文件路径
  
  **配置优先级**:
  ```
  环境变量 (ANTHROPIC_*)
    ↓ 覆盖
  文件配置 (~/.codepanion/config.json)
    ↓ 覆盖
  默认值 (内置 Claude 别名)
  ```
  
  **导入示例**:
  ```bash
  # 导入 CC Switch 配置
  POST /api/v1/config/import
  {
    "source": "ccm",
    "filePath": "~/.ccm_config"  // 可选
  }
  
  # 导入 Claude Code 配置
  POST /api/v1/config/import
  {
    "source": "claude",
    "filePath": "~/.claude/settings.json"  // 可选
  }
  
  # 自动检测并导入
  POST /api/v1/config/import
  {
    "source": "auto"
  }
  ```
  
  **验收标准**:
  - [x] 环境变量支持（7 个 ANTHROPIC_* 变量）
  - [x] load_resolved() 方法（应用环境变量覆盖）
  - [x] ResolvedConfig 结构（解析后的配置）
  - [x] import_ccm_config() 函数
  - [x] import_claude_settings() 函数
  - [x] auto_import() 函数（自动检测）
  - [x] POST /api/v1/config/import 端点
  - [x] 配置合并逻辑（Claude settings 合并到现有配置）
  - [x] 11 个单元测试（8 个环境变量 + 3 个导入）
  - [x] cargo fmt + clippy + test 全部通过（77/77 tests）
  - [x] 文档更新

- [x] **M-02.4 CLI 命令工具（CC Switch 完整兼容 Phase 3）** ✅
  - **描述**: 实现命令行工具，提供 provider、model、config 管理命令
  - **二进制**: `codepanion`
  
  **核心功能**:
  - Provider 管理命令（list、active、switch、add、remove、test、import）
  - Model 管理命令（list、alias）
  - Config 管理命令（set-model、set-effort）
  - 全局 --api-url 选项（支持自定义 daemon 地址）
  
  **Provider 命令**:
  ```bash
  codepanion provider list                    # 列出所有 provider
  codepanion provider active                  # 查看当前活跃 provider
  codepanion provider switch <id>             # 切换 provider
  codepanion provider add <id> --name ... --provider-type ... --api-key ... --base-url ... --default-model ...
  codepanion provider remove <id>             # 删除 provider
  codepanion provider test <id>               # 测试连接
  codepanion provider import --source <ccm|claude|auto> [--file <path>]
  ```
  
  **Model 命令**:
  ```bash
  codepanion model list                       # 列出所有模型
  codepanion model alias <alias> <model-id>   # 设置别名
  ```
  
  **Config 命令**:
  ```bash
  codepanion config set-model <model>         # 设置默认模型
  codepanion config set-effort <level>        # 设置努力级别
  ```
  
  **使用示例**:
  ```bash
  # 快速切换 API
  codepanion provider switch deepseek-main
  
  # 从 CC Switch 导入配置
  codepanion provider import --source ccm
  
  # 查看所有可用模型
  codepanion model list
  
  # 自定义 API URL
  codepanion --api-url http://localhost:9000 provider list
  ```
  
  **验收标准**:
  - [x] CLI 架构设计（clap 框架）
  - [x] Provider 子命令（7 个命令）
  - [x] Model 子命令（2 个命令）
  - [x] Config 子命令（2 个命令）
  - [x] 全局 --api-url 选项
  - [x] HTTP 客户端集成（reqwest）
  - [x] 友好的输出格式（表格、状态符号）
  - [x] 错误处理和用户提示
  - [x] 编译成功（cargo build --bin codepanion）
  - [x] cargo clippy 通过
  - [x] CLI 文档（docs/CLI.md）

- [x] **M-03 多 run scheduler** ✅
  - **描述**: 实现全局 run 调度器，支持多 workflow 并行执行、优先级队列、cancel/pause/resume
  
  **核心功能**:
  - 全局 run 队列（优先级调度）
  - 并发控制（max_concurrent_runs）
  - 队列大小限制（max_queue_size）
  - Run 状态管理（Queued、Running、Paused、Completed、Failed、Cancelled）
  - Cancel/Pause/Resume 操作
  - 按项目隔离查询
  - 统计信息（queued/running/completed 计数）
  
  **数据结构**:
  ```rust
  pub enum RunPriority { Low, Normal, High, Urgent }
  pub enum RunStatus { Queued, Running, Paused, Completed, Failed, Cancelled }
  
  pub struct ScheduledRun {
      run_id, project_id, workflow_id,
      priority, status,
      queued_at, started_at, completed_at,
      error
  }
  
  pub struct RunScheduler {
      queue: VecDeque<ScheduledRun>,      // 优先级队列
      running: HashMap<String, ScheduledRun>,  // 运行中的 run
      completed: Vec<ScheduledRun>,       // 已完成的 run
  }
  ```
  
  **API 端点**:
  ```
  POST   /api/v1/scheduler/enqueue              # 入队新 run
  GET    /api/v1/scheduler/runs                 # 列出所有 run
  GET    /api/v1/scheduler/runs/queued          # 列出队列中的 run
  GET    /api/v1/scheduler/runs/running         # 列出运行中的 run
  GET    /api/v1/scheduler/runs/completed       # 列出已完成的 run
  GET    /api/v1/scheduler/runs/:run_id         # 获取特定 run
  GET    /api/v1/scheduler/projects/:project_id/runs  # 按项目查询
  POST   /api/v1/scheduler/runs/:run_id/cancel  # 取消 run
  POST   /api/v1/scheduler/runs/:run_id/pause   # 暂停 run
  POST   /api/v1/scheduler/runs/:run_id/resume  # 恢复 run
  GET    /api/v1/scheduler/stats                # 获取统计信息
  DELETE /api/v1/scheduler/completed            # 清空已完成的 run
  ```
  
  **调度逻辑**:
  - 优先级调度：Urgent > High > Normal > Low
  - 并发控制：running.len() < max_concurrent_runs 时才 dequeue
  - Cancel 逻辑：从 queue 或 running 中移除，标记为 Cancelled
  - Pause/Resume：只能操作 running 状态的 run
  - 队列满时拒绝新 run（可配置 max_queue_size）
  
  **验收标准**:
  - [x] RunScheduler 核心实现（enqueue、dequeue、状态管理）
  - [x] 优先级调度（高优先级先执行）
  - [x] 并发控制（max_concurrent_runs）
  - [x] Cancel/Pause/Resume 操作
  - [x] 按项目查询（list_by_project）
  - [x] 统计信息（get_stats）
  - [x] 7 个单元测试（优先级、并发、取消、暂停恢复、队列限制）
  - [x] API 路由集成（11 个端点）
  - [x] daemon 启动信息更新
  - [x] 84/84 测试通过
  - [x] cargo clippy 通过

- [x] **M-04 跨项目编排** ✅
  - **描述**: 实现跨项目 workflow 依赖声明、artifact 引用、依赖解析和拓扑排序
  
  **核心功能**:
  - Workflow 依赖声明（跨项目、跨 workflow）
  - Artifact 跨项目引用（project_id + run_id + artifact_key）
  - 依赖解析（拓扑排序、循环检测）
  - 执行顺序计算（DFS 后序遍历）
  - 依赖图可视化（execution_order + edges）
  
  **数据结构**:
  ```rust
  pub struct WorkflowDependency {
      project_id, workflow_id,
      required_artifacts: Vec<String>,
      optional: bool
  }
  
  pub struct ArtifactReference {
      project_id, run_id, artifact_key
  }
  
  pub struct WorkflowWithDeps {
      project_id, workflow_id,
      dependencies: Vec<WorkflowDependency>
  }
  
  pub struct DependencyGraph {
      execution_order: Vec<(project_id, workflow_id)>,  // 拓扑排序结果
      edges: HashMap<(from), Vec<(to)>>                 // 依赖边
  }
  
  pub struct CrossProjectOrchestrator {
      workflows: HashMap<(project_id, workflow_id), WorkflowWithDeps>
  }
  ```
  
  **API 端点**:
  ```
  POST   /api/v1/orchestrator/workflows                              # 注册 workflow 依赖
  GET    /api/v1/orchestrator/workflows                              # 列出所有 workflow
  GET    /api/v1/orchestrator/workflows/:project_id/:workflow_id     # 获取特定 workflow
  DELETE /api/v1/orchestrator/workflows/:project_id/:workflow_id     # 移除 workflow
  GET    /api/v1/orchestrator/workflows/:project_id/:workflow_id/dependencies  # 获取依赖
  POST   /api/v1/orchestrator/workflows/:project_id/:workflow_id/resolve       # 解析依赖
  GET    /api/v1/orchestrator/workflows/:project_id/:workflow_id/has-dependencies  # 检查是否有依赖
  ```
  
  **依赖解析算法**:
  - DFS 拓扑排序（后序遍历）
  - 循环依赖检测（stack 集合）
  - 依赖先执行（递归访问依赖，再加入当前节点）
  - 支持菱形依赖（Diamond dependency）
  - 支持跨项目依赖（project-1:build → project-2:deploy）
  
  **使用场景**:
  ```json
  // 注册 workflow 依赖
  POST /api/v1/orchestrator/workflows
  {
    "projectId": "project-2",
    "workflowId": "deploy",
    "dependencies": [{
      "projectId": "project-1",
      "workflowId": "build",
      "requiredArtifacts": ["dist.zip"],
      "optional": false
    }]
  }
  
  // 解析依赖
  POST /api/v1/orchestrator/workflows/project-2/deploy/resolve
  {
    "executionOrder": [
      {"projectId": "project-1", "workflowId": "build"},
      {"projectId": "project-2", "workflowId": "deploy"}
    ],
    "edges": [{
      "fromProjectId": "project-2",
      "fromWorkflowId": "deploy",
      "toProjectId": "project-1",
      "toWorkflowId": "build"
    }]
  }
  ```
  
  **验收标准**:
  - [x] CrossProjectOrchestrator 核心实现
  - [x] WorkflowDependency 和 ArtifactReference 数据结构
  - [x] 依赖解析（拓扑排序）
  - [x] 循环依赖检测
  - [x] 菱形依赖支持
  - [x] 跨项目依赖支持
  - [x] 8 个单元测试（简单依赖、跨项目、循环、菱形、查询）
  - [x] API 路由集成（7 个端点）
  - [x] daemon 启动信息更新
  - [x] 92/92 测试通过
  - [x] cargo clippy 通过

- [x] **M-05 全局视图 API** ✅
  - **描述**: 实现全局视图 API，聚合所有项目的 runs、统计信息
  
  **核心功能**:
  - 全局 runs 查询（跨所有项目）
  - 按状态过滤（queued、running、completed）
  - 全局统计信息（scheduler、projects、workflows）
  - 聚合现有功能（scheduler + project_registry + orchestrator）
  
  **API 端点**:
  ```
  GET /api/v1/global/runs              # 所有 runs（跨项目）
  GET /api/v1/global/runs/queued       # 所有队列中的 runs
  GET /api/v1/global/runs/running      # 所有运行中的 runs
  GET /api/v1/global/runs/completed    # 所有已完成的 runs
  GET /api/v1/global/stats             # 全局统计信息
  ```
  
  **响应格式**:
  ```json
  // GET /api/v1/global/runs
  {
    "runs": [...],
    "total": 10
  }
  
  // GET /api/v1/global/stats
  {
    "scheduler": {
      "queuedCount": 5,
      "runningCount": 3,
      "completedCount": 10,
      "maxConcurrentRuns": 3,
      "maxQueueSize": 100
    },
    "totalProjects": 5,
    "totalWorkflows": 12
  }
  ```
  
  **验收标准**:
  - [x] 全局 runs API（5 个端点）
  - [x] 聚合 scheduler、project_registry、orchestrator 数据
  - [x] daemon 启动信息更新
  - [x] 92/92 测试通过
  - [x] cargo clippy 通过

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

- [x] **P7-01 WebSocket 实时推送** ✅
  - 使用 axum 实现 HTTP 服务器。
  - 使用 axum WebSocket 实现 WebSocket。
  - 兼容现有 `/workflow/*` API 路由。
  - 实现 WS `workflow-run-event` 实时推送。
  - 支持 CORS 和错误处理中间件。
  - 验收：实现 axum 服务器；支持 `/workflow/board`、`/workflow/runs`、`/workflow/runs/:id`、`/workflow/runs/:id/artifacts`、`/workflow/runs/:id/delivery`、`/workflow/gates`、`/workflow/gates/:runId/:stepId/resolve` 路由；WebSocket 支持 `workflow-run-event` 推送；测试覆盖所有路由和 WS 连接；与现有 GUI/CLI 协议兼容。
  
  **实现细节**:
  - EventBroadcaster：管理 WebSocket 连接和事件广播
  - WebSocket handler：处理连接升级、事件转发、断线清理
  - RunScheduler 集成：在状态变更时触发事件（queued、running、completed、failed、cancelled、paused）
  - `/ws` 端点：WebSocket 连接入口
  - 7 个 broadcaster 测试 + 1 个 handler 测试
  - 依赖：axum (ws feature)、futures、tokio
  
  **验收标准**:
  - [x] EventBroadcaster 实现（subscribe、unsubscribe、broadcast）
  - [x] WebSocket handler 实现（连接升级、事件转发）
  - [x] RunScheduler 事件回调集成
  - [x] `/ws` 路由注册
  - [x] WorkflowRunEvent 结构（eventType、runId、projectId、workflowId、status、timestamp）
  - [x] 8 个单元测试通过
  - [x] cargo test --workspace 通过（214 tests）
  - [x] cargo clippy 通过（0 warnings）
  - [x] cargo fmt 通过

- [x] **P7-02 Workflow 执行器** ✅
  - 集成 P3 workflow engine（W-01 到 W-06）。
  - 集成 P2 agent runtime（A-01 到 A-07）。
  - 实现 fire-and-forget 续跑逻辑。
  - 支持 workflow 取消、暂停、恢复。
  - 实时输出推送到 WebSocket。
  - 验收：`WorkflowRunner` 集成 workflow engine 和 agent runtime；支持启动、取消、暂停、恢复 workflow；实时输出通过 WS 推送；测试覆盖完整 workflow 生命周期；与 TypeScript daemon 行为一致。
  - **实现细节**：
    - [x] 创建 `workflow_runner.rs` 模块
    - [x] 实现 `AgentStepExecutor`（集成 agent runtime）
    - [x] 实现 `WorkflowRunner`（管理后台执行）
    - [x] 实现 `WorkflowRunnerEvent`（实时事件推送）
    - [x] 添加 workflow execution HTTP 端点（`/api/v1/workflows/execute`, `/cancel`, `/pause`, `/resume`, `/active`）
    - [x] 集成到 daemon AppState
    - [x] 连接 WorkflowRunnerEvent 到 WebSocket broadcaster
    - [x] 2 个单元测试（lifecycle, cancel）
    - [x] cargo test 通过（216 tests）
    - [x] cargo clippy 通过（0 warnings）
  - **技术栈**：
    - tokio spawn（fire-and-forget 后台执行）
    - Arc<AtomicBool>（取消信号）
    - tokio::sync::mpsc::unbounded_channel（事件流）
    - AgentLoopRequest + run_agent_loop（agent 执行）
    - WorkflowExecutor（workflow engine 集成）

- [x] **P7-03 CLI 命令** ✅
  - 使用 clap 实现 CLI 参数解析。
  - `codepanion start` - 启动 daemon。
  - `codepanion stop` - 停止 daemon。
  - `codepanion status` - 查看 daemon 状态。
  - `codepanion workflows` - 列出 workflows。
  - `codepanion workspace` - 管理 workspace。
  - PID 文件管理和进程检测。
  - 验收：实现所有 CLI 命令；PID 文件管理；进程检测和清理；与 TypeScript CLI 行为一致；测试覆盖所有命令和边界情况。
  - **实现细节**：
    - [x] 创建 `daemon_manager.rs` 模块（PID 文件管理、进程检测）
    - [x] 实现 `DaemonManager`（start/stop/status）
    - [x] 实现 `codepanion start` 命令（前台/后台运行）
    - [x] 实现 `codepanion stop` 命令（SIGTERM/taskkill）
    - [x] 实现 `codepanion status` 命令（进程检测 + API 健康检查）
    - [x] 实现 `codepanion workflows` 命令（列出所有/活跃 workflows）
    - [x] 实现 `codepanion workspace` 命令（list/add/remove）
    - [x] 更新 CLI 参数解析（添加新命令）
    - [x] 4 个单元测试（daemon_manager）
    - [x] cargo test 通过（220 tests）
    - [x] cargo clippy 通过（3 warnings - 非关键）
  - **技术栈**：
    - clap（CLI 参数解析）
    - PID 文件（~/.codepanion/daemon.pid）
    - 进程检测（Unix: kill -0, Windows: tasklist）
    - 后台运行（Unix: nohup, Windows: CREATE_NO_WINDOW）
    - reqwest（API 客户端）

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
