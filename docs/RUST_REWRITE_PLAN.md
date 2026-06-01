# Rust 重构计划

**日期**: 2026-06-01  
**目标**: 用 Rust 重构 CodePanion，实现本地全自动、多 AI、多项目并行的轻量高性能 AI IDE

---

## 开发原则

- Rust daemon 是目标架构，Node daemon 是过渡实现和行为基线。
- 重构不是简单换语言：必须同时支撑全自动 AI 工作流、多角色分工、高危行为检测和多任务并行。
- 第一轮只做可验证的最小闭环：HTTP/WS、模型客户端、agent runtime、workflow engine 和 storage。
- 每个阶段都要记录内存、启动时间、二进制大小和关键 API 延迟。
- 新增核心能力优先进入 Rust；Node 侧只做必要兼容、测试基线或迁移辅助。

## 重构背景

### 为什么要用 Rust 重构

1. **性能目标**：
   - 当前 Node.js daemon 难以达到 < 100MB 内存占用（空闲）
   - Rust 可以实现更低的内存占用和更快的启动速度
   - Rust 的零成本抽象和无 GC 特性适合高性能场景

2. **轻量目标**：
   - Node.js 运行时本身占用 ~50MB
   - Rust 编译为原生二进制，无运行时开销
   - 可以实现 < 50MB 的安装包大小

3. **核心功能纠正**：
   - 当前架构偏离了"轻量高性能"和"本地全自动开发"的目标
   - 需要重新设计 agent 运行时、workflow 引擎、模型客户端、多任务调度和高危行为审核门
   - Rust 的类型系统和所有权模型可以避免很多运行时错误

### 当前架构的问题

1. **Node.js daemon**：
   - 内存占用高（空闲时 ~150MB）
   - 启动慢（冷启动 ~5s）
   - 依赖多（node_modules 占用 ~200MB）

2. **TypeScript 类型系统**：
   - 运行时无类型检查
   - 容易出现运行时错误
   - 性能开销（需要 V8 JIT）

3. **架构偏差**：
   - Node 实现目前更像过渡工作流控制台，尚未成为最终本地全自动 AI IDE
   - 写文件、跑命令、高危行为检测和自动修复循环还不完整
   - 多项目/多任务并行调度还未落地

---

## Rust 重构路线图

### 阶段 0：技术验证（1-2 天）

**目标**：验证 Rust 技术栈的可行性

- [ ] **V-01** 创建 Rust 项目结构
  - 使用 `cargo new codepanion-daemon --bin`
  - 设置 workspace（daemon、gui-bridge、shared）
  - 配置 `Cargo.toml`（依赖、优化选项）

- [ ] **V-02** 实现最小 HTTP 服务器
  - 使用 `axum` 或 `actix-web`
  - 实现 `/health` 端点
  - 测试启动时间和内存占用

- [ ] **V-03** 实现最小 WebSocket 服务器
  - 实时推送测试
  - 测试延迟和吞吐量

- [ ] **V-04** 实现最小模型客户端
  - 调用 OpenAI 兼容 API
  - 流式响应处理
  - 测试性能

- [ ] **V-05** 性能基准测试
  - 内存占用：目标 < 50MB（空闲）
  - 启动时间：目标 < 500ms
  - 二进制大小：目标 < 20MB

**验收标准**：
- [ ] Rust daemon 内存占用 < 50MB（空闲）
- [ ] Rust daemon 启动时间 < 500ms
- [ ] Rust daemon 二进制大小 < 20MB
- [ ] HTTP/WebSocket 服务器正常工作
- [ ] 模型客户端可以调用 API

---

### 阶段 1：核心模块重构（3-5 天）

**目标**：用 Rust 重写核心模块

#### 1.1 模型客户端（1 天）

- [ ] **M-01** 实现 `ModelClient`
  - OpenAI 兼容 API 客户端
  - 流式响应处理
  - 错误处理和重试
  - 超时和取消

- [ ] **M-02** 实现 `ChatCompletion`
  - 构建请求
  - 解析响应
  - 流式输出

- [ ] **M-03** 实现 `ToolCall` 支持
  - function calling
  - tool-use 循环

**技术栈**：
- `reqwest`：HTTP 客户端
- `serde`：JSON 序列化/反序列化
- `tokio`：异步运行时

#### 1.2 Agent 运行时（2 天）

- [ ] **A-01** 实现 `AgentRuntime`
  - tool-use 循环
  - 上下文管理
  - 权限控制

- [ ] **A-02** 实现 Agent 工具
  - `read_file`：读文件
  - `list_dir`：列目录
  - `write_file`：写文件（高危行为检测）
  - `run_command`：执行命令（高危行为检测）

- [ ] **A-03** 实现高危行为检测
  - 文件删除检测
  - 关键配置修改检测
  - 危险命令检测
  - 网络请求检测
  - git 历史修改检测

**技术栈**：
- `tokio`：异步运行时
- `serde_json`：JSON 处理
- `regex`：正则表达式（危险命令检测）

#### 1.3 Workflow 引擎（2 天）

- [ ] **W-01** 实现 `WorkflowEngine`
  - workflow 定义解析
  - step 执行
  - 状态管理
  - 错误处理

- [ ] **W-02** 实现 `StepExecutor`
  - `shell` executor：spawn 本地命令
  - `agent` executor：调用 agent 运行时

- [ ] **W-03** 实现 `WorkflowManager`
  - workflow 启动
  - workflow 暂停/恢复
  - workflow 取消
  - workflow 状态查询

**技术栈**：
- `tokio`：异步运行时
- `serde`：序列化/反序列化
- `uuid`：生成 run ID

---

### 阶段 2：HTTP/WebSocket 服务器（2-3 天）

**目标**：实现 daemon HTTP/WebSocket 服务器

#### 2.1 HTTP 服务器（1 天）

- [ ] **H-01** 实现 HTTP 路由
  - `GET /health`：健康检查
  - `POST /workspace/initialize`：初始化 workspace
  - `GET /workspace/config`：获取 workspace 配置
  - `POST /workflow/runs`：启动 workflow
  - `GET /workflow/runs/:id`：查询 workflow 状态
  - `POST /workflow/runs/:id/cancel`：取消 workflow
  - `POST /workflow/gates/:id/resolve`：解决人工审核门

- [ ] **H-02** 实现请求/响应处理
  - JSON 序列化/反序列化
  - 错误处理
  - 日志记录

**技术栈**：
- `axum`：HTTP 框架
- `tower`：中间件
- `serde_json`：JSON 处理

#### 2.2 WebSocket 服务器（1 天）

- [ ] **WS-01** 实现 WebSocket 连接
  - 连接建立
  - 心跳检测
  - 断线重连

- [ ] **WS-02** 实现实时推送
  - `workflow-run-event`：workflow 事件
  - `run-start`：run 开始
  - `step-start`：step 开始
  - `step-output`：step 输出
  - `step-finish`：step 结束
  - `run-finish`：run 结束

**技术栈**：
- `axum`：WebSocket 支持
- `tokio`：异步运行时

#### 2.3 配置管理（0.5 天）

- [ ] **C-01** 实现配置加载
  - 读取 `config.json`
  - 解析模型配置
  - 解析 agent 配置

- [ ] **C-02** 实现配置验证
  - schema 验证
  - 默认值填充

**技术栈**：
- `serde`：序列化/反序列化
- `config`：配置管理

---

### 阶段 3：GUI 桥接（1-2 天）

**目标**：实现 GUI 与 Rust daemon 的桥接

#### 3.1 进程管理（1 天）

- [ ] **P-01** 实现 daemon 启动
  - GUI 启动时自动启动 daemon
  - 检测 daemon 是否已运行
  - 端口冲突处理

- [ ] **P-02** 实现 daemon 停止
  - GUI 关闭时停止 daemon
  - 优雅关闭（等待 workflow 完成）

#### 3.2 通信协议（1 天）

- [ ] **C-01** 实现 HTTP 客户端（C#）
  - 调用 daemon HTTP API
  - 错误处理

- [ ] **C-02** 实现 WebSocket 客户端（C#）
  - 连接 daemon WebSocket
  - 接收实时推送
  - 断线重连

**技术栈**：
- C# `HttpClient`
- C# `ClientWebSocket`

---

### 阶段 4：数据迁移（1 天）

**目标**：迁移现有数据到 Rust daemon

- [ ] **D-01** 迁移 workspace 配置
  - `.codepanion/workflow.json`
  - `.codepanion/roles/*.md`

- [ ] **D-02** 迁移 workflow runs
  - `.codepanion/runs/*.json`

- [ ] **D-03** 迁移 artifacts
  - `.codepanion/artifacts/*`

---

### 阶段 5：测试和优化（2-3 天）

**目标**：测试和优化 Rust daemon

#### 5.1 单元测试（1 天）

- [ ] **T-01** 模型客户端测试
- [ ] **T-02** Agent 运行时测试
- [ ] **T-03** Workflow 引擎测试
- [ ] **T-04** HTTP/WebSocket 服务器测试

#### 5.2 集成测试（1 天）

- [ ] **I-01** 端到端测试
  - 启动 workflow
  - 执行 step
  - 实时推送
  - 人工审核门
  - workflow 完成

#### 5.3 性能优化（1 天）

- [ ] **O-01** 内存优化
  - 减少内存分配
  - 使用 `Arc` 共享数据
  - 使用 `Cow` 避免拷贝

- [ ] **O-02** 启动时间优化
  - 延迟加载
  - 并行初始化

- [ ] **O-03** 二进制大小优化
  - 启用 LTO（Link Time Optimization）
  - 启用 strip（去除符号表）
  - 使用 `opt-level = "z"`（优化大小）

---

## Rust 项目结构

```
codepanion-rust/
├── Cargo.toml                 # workspace 配置
├── daemon/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs            # daemon 入口
│       ├── config.rs          # 配置管理
│       ├── server.rs          # HTTP/WebSocket 服务器
│       ├── models/
│       │   ├── mod.rs
│       │   ├── client.rs      # 模型客户端
│       │   └── agent.rs       # agent 运行时
│       ├── workflow/
│       │   ├── mod.rs
│       │   ├── engine.rs      # workflow 引擎
│       │   ├── executor.rs    # step executor
│       │   └── manager.rs     # workflow 管理器
│       └── tools/
│           ├── mod.rs
│           ├── file.rs        # 文件工具
│           ├── command.rs     # 命令工具
│           └── safety.rs      # 高危行为检测
├── shared/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── protocol.rs        # 协议定义
│       └── types.rs           # 共享类型
└── gui-bridge/
    ├── Cargo.toml
    └── src/
        ├── lib.rs
        └── ffi.rs             # C# FFI（可选）
```

---

## 技术栈

### 核心依赖

- `tokio`：异步运行时
- `axum`：HTTP/WebSocket 框架
- `reqwest`：HTTP 客户端
- `serde`：序列化/反序列化
- `serde_json`：JSON 处理
- `uuid`：生成 ID
- `tracing`：日志记录
- `anyhow`：错误处理

### 可选依赖

- `tower`：中间件
- `tower-http`：HTTP 中间件
- `regex`：正则表达式
- `config`：配置管理
- `clap`：命令行参数解析

---

## 性能目标

### 内存占用

- daemon 空闲：< 50MB（目标 < 30MB）
- daemon 运行 1 个 workflow：< 150MB
- daemon 运行 3 个 workflow：< 300MB

### 硬盘占用

- daemon 二进制：< 20MB（目标 < 15MB）
- 安装包（压缩）：< 30MB
- 安装后：< 100MB

### 启动时间

- daemon 冷启动：< 500ms（目标 < 300ms）
- daemon 热启动：< 100ms

### 执行延迟

- workflow 启动延迟：< 50ms
- step 执行延迟：< 20ms（不含模型 API 调用）
- 实时输出延迟：< 5ms
- HTTP 响应延迟：< 10ms

---

## 风险和挑战

### 技术风险

1. **Rust 学习曲线**：团队需要学习 Rust
   - **缓解措施**：从简单模块开始，逐步重构

2. **异步编程复杂性**：Rust 异步编程比 Node.js 复杂
   - **缓解措施**：使用 `tokio` 和 `axum`，参考成熟项目

3. **C# 互操作**：GUI 与 Rust daemon 的互操作
   - **缓解措施**：使用 HTTP/WebSocket，避免 FFI

### 项目风险

1. **重构时间长**：预计 10-15 天
   - **缓解措施**：分阶段重构，保持 Node.js 版本可用

2. **功能回归**：重构可能引入 bug
   - **缓解措施**：编写测试，逐步迁移

3. **用户影响**：重构期间用户无法使用
   - **缓解措施**：在分支上重构，完成后合并

---

## 时间估算

| 阶段 | 预计工作量 | 日历时间 |
|------|-----------|---------|
| 阶段 0：技术验证 | 8h | 1-2 天 |
| 阶段 1：核心模块重构 | 24h | 3-5 天 |
| 阶段 2：HTTP/WebSocket 服务器 | 16h | 2-3 天 |
| 阶段 3：GUI 桥接 | 8h | 1-2 天 |
| 阶段 4：数据迁移 | 4h | 1 天 |
| 阶段 5：测试和优化 | 16h | 2-3 天 |
| **总计** | **76h** | **10-16 天** |

---

## 下一步行动

### 立即开始（阶段 0：技术验证）

1. **创建 Rust 项目**
   ```bash
   cargo new codepanion-rust --bin
   cd codepanion-rust
   ```

2. **添加依赖**
   ```toml
   [dependencies]
   tokio = { version = "1", features = ["full"] }
   axum = "0.7"
   reqwest = { version = "0.11", features = ["json", "stream"] }
   serde = { version = "1", features = ["derive"] }
   serde_json = "1"
   uuid = { version = "1", features = ["v4"] }
   tracing = "0.1"
   tracing-subscriber = "0.3"
   anyhow = "1"
   ```

3. **实现最小 HTTP 服务器**
   ```rust
   use axum::{routing::get, Router};
   
   #[tokio::main]
   async fn main() {
       let app = Router::new().route("/health", get(|| async { "OK" }));
       let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
       axum::serve(listener, app).await.unwrap();
   }
   ```

4. **测试性能**
   ```bash
   cargo build --release
   time ./target/release/codepanion-rust
   ps aux | grep codepanion-rust  # 查看内存占用
   ls -lh ./target/release/codepanion-rust  # 查看二进制大小
   ```

---

## 参考文档

- [Rust 官方文档](https://doc.rust-lang.org/)
- [Tokio 文档](https://tokio.rs/)
- [Axum 文档](https://docs.rs/axum/)
- [Reqwest 文档](https://docs.rs/reqwest/)
- [Serde 文档](https://serde.rs/)
