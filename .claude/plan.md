# P7-04 实施计划：Rust Daemon 测试、迁移与性能基准

## 任务概述

完成 Rust daemon 重构的最后阶段，包括端到端测试、性能基准测试、GUI/CLI 适配、迁移文档和 TypeScript daemon 依赖清理。

## 当前状态分析

### 已完成
- ✅ Rust daemon 核心实现（P7-01 ~ P7-03）
  - HTTP/WebSocket 服务器（axum + tokio-tungstenite）
  - Workflow 执行器（definition、executor、history、artifacts、gates）
  - Project registry 和 Provider registry
  - Multi-run scheduler 和 Cross-project orchestrator
  - CLI 命令工具（provider、model、config import）
  - WebSocket 实时推送（EventBroadcaster）
- ✅ Rust workspace 单元测试：92 passed
- ✅ Release 编译成功：4.0MB 二进制文件

### 待完成
1. **端到端测试**（daemon + GUI + CLI）
2. **性能基准测试**（内存、启动时间、workflow 执行）
3. **GUI/CLI 适配验证**
4. **迁移文档和指南**
5. **TypeScript daemon 依赖清理**
6. **P3 未完成的集成**（WorkflowArtifactStore、HumanGateManager、WebSocket 推送）

### 技术背景
- **Node daemon**：26 个测试文件（packages/daemon/test/*.test.mjs），stress-workflow.mjs 性能基准
- **Rust daemon**：8318 端口，兼容 Node daemon HTTP API
- **GUI**：WPF + WebView2，DaemonClient 连接 daemon WebSocket
- **打包**：scripts/package-windows.ps1 生成便携版

## 验收标准

1. **性能目标**
   - daemon 空闲内存：< 50MB
   - daemon 冷启动：< 500ms
   - daemon 热启动：< 100ms
   - workflow 执行延迟：< 50ms

2. **测试覆盖**
   - 端到端测试覆盖所有核心场景
   - 性能基准达到目标
   - GUI 和 CLI 正常工作

3. **文档完整性**
   - 迁移指南
   - API 文档更新
   - 性能基准报告

4. **清理完成**
   - TypeScript daemon 依赖已移除
   - 旧代码已标记或删除

---

## 实施阶段

### 阶段 1：端到端测试设计与实现（2-3 天）

#### 1.1 测试架构设计（0.5 天）

**目标**：设计端到端测试框架，复用 Node daemon 测试场景

**任务**：
- 分析现有 26 个 Node daemon 测试文件，识别核心场景
- 设计 Rust daemon 端到端测试架构（Rust 集成测试 vs Node 测试脚本）
- 定义测试辅助工具（daemon 启动/停止、HTTP/WebSocket 客户端）

**关键场景**：
1. HTTP API 契约测试
   - Project API：CRUD、激活、状态查询
   - Provider API：CRUD、测试、激活、模型列表
   - Workflow API：board、runs、gates、artifacts、delivery
   - Scheduler API：enqueue、列表、取消、暂停/恢复
   - Global View API：跨项目聚合
2. WebSocket 实时推送测试
   - 连接/断线/重连
   - workflow-run-event 推送
   - 事件顺序和完整性
3. Workflow 执行测试
   - 简单 shell workflow
   - agent workflow（如果已实现）
   - gate resolve 流程
   - artifact 生成
4. 多项目并行测试
   - 同时运行多个 workflow
   - 项目隔离验证
5. CLI 命令测试
   - provider/model 管理
   - config import（CC Switch 兼容性）

**产出**：
- `codepanion-rust/tests/integration/` 目录结构
- 测试辅助模块：`test_helpers.rs`（daemon 启动、HTTP 客户端、断言宏）

#### 1.2 HTTP API 集成测试（1 天）

**任务**：
- 实现 Project API 测试（创建、列表、更新、删除、激活、状态）
- 实现 Provider API 测试（CRUD、测试连接、激活、模型列表）
- 实现 Scheduler API 测试（enqueue、列表、取消、暂停/恢复）
- 实现 Orchestrator API 测试（注册、依赖解析）
- 实现 Global View API 测试（跨项目聚合）
- 实现 Workflow API 测试（board、runs、gates、artifacts、delivery）

**技术栈**：
- `reqwest` 客户端
- `tokio::test` 异步测试
- `serde_json` 响应解析

**产出**：
- `tests/integration/http_api_test.rs`
- 覆盖所有 HTTP 端点的集成测试

#### 1.3 WebSocket 实时推送测试（0.5 天）

**任务**：
- 实现 WebSocket 连接测试
- 实现事件推送测试（workflow-run-event）
- 实现断线重连测试
- 验证事件顺序和完整性

**技术栈**：
- `tokio-tungstenite` WebSocket 客户端
- `futures` stream 处理

**产出**：
- `tests/integration/websocket_test.rs`

#### 1.4 Workflow 执行测试（0.5 天）

**任务**：
- 实现简单 shell workflow 测试
- 实现 gate resolve 流程测试
- 实现 artifact 生成测试
- 实现 delivery note 测试
- 实现多步骤 workflow 测试

**产出**：
- `tests/integration/workflow_execution_test.rs`

#### 1.5 CLI 命令测试（0.5 天）

**任务**：
- 实现 provider 管理测试（list、switch、import）
- 实现 model 管理测试（list）
- 实现 config import 测试（CC Switch 兼容性）
- 验证 CLI 输出格式

**技术栈**：
- `std::process::Command` 调用 CLI
- 输出解析和断言

**产出**：
- `tests/integration/cli_test.rs`

---

### 阶段 2：性能基准测试（1-2 天）

#### 2.1 基准测试框架设计（0.5 天）

**目标**：设计性能基准测试，对标 stress-workflow.mjs

**任务**：
- 分析 stress-workflow.mjs（300s × 100 ev/s 压测）
- 设计 Rust 性能基准测试框架
- 定义性能指标采集方法（内存、启动时间、延迟）

**关键指标**：
1. **内存占用**
   - daemon 空闲内存
   - daemon 运行 1/3 个 workflow 时内存
   - 内存增长率
2. **启动时间**
   - daemon 冷启动时间
   - daemon 热启动时间
3. **执行延迟**
   - workflow 启动延迟
   - step 执行延迟
   - HTTP 响应延迟
4. **吞吐量**
   - 并发 workflow 数量
   - event 处理速率

**产出**：
- `codepanion-rust/benches/` 目录
- 基准测试配置（Cargo.toml benches 配置）

#### 2.2 内存和启动时间基准（0.5 天）

**任务**：
- 实现 daemon 空闲内存测量
- 实现 daemon 冷/热启动时间测量
- 实现 workflow 执行时内存测量
- 对比 Node daemon 基线

**技术栈**：
- `std::process::Command` 启动 daemon
- `sysinfo` crate 或 Windows API 查询进程内存
- `std::time::Instant` 测量启动时间

**产出**：
- `benches/memory_benchmark.rs`
- `benches/startup_benchmark.rs`

#### 2.3 Workflow 执行性能基准（0.5 天）

**任务**：
- 实现 workflow 启动延迟测量
- 实现 step 执行延迟测量
- 实现 HTTP 响应延迟测量
- 实现并发 workflow 吞吐量测试

**产出**：
- `benches/workflow_performance.rs`

#### 2.4 压力测试（0.5 天）

**目标**：复现 stress-workflow.mjs 压测场景

**任务**：
- 实现高并发 event 处理测试（100 ev/s × 300s）
- 测量 WebSocket 推送延迟
- 测量磁盘 I/O 频率（debounce 效果）
- 验证内存不超过阈值

**产出**：
- `benches/stress_test.rs`
- 性能报告（对比 Node daemon）

---

### 阶段 3：GUI/CLI 适配验证（1 天）

#### 3.1 GUI 适配验证（0.5 天）

**目标**：验证 WPF GUI 能连接 Rust daemon

**任务**：
- 修改 DaemonClient 配置（如果需要）
- 验证 WebSocket 连接和事件接收
- 验证 HTTP API 调用（workflow board、gates、artifacts）
- 验证工作流控制台显示
- 测试 GUI 完整流程（启动 daemon、连接、启动 workflow、查看进度）

**可能需要的修改**：
- DaemonClient 端口配置（7777 → 8318）
- WebSocket 协议兼容性
- HTTP 响应格式兼容性

**产出**：
- GUI 适配修改（如果需要）
- GUI 手动测试清单

#### 3.2 CLI 适配验证（0.5 天）

**目标**：验证 CLI 命令正常工作

**任务**：
- 验证 `codepanion provider list/switch/import` 命令
- 验证 `codepanion model list` 命令
- 验证 CLI 输出格式
- 测试 CC Switch 配置导入

**产出**：
- CLI 手动测试清单
- CLI 使用文档更新（如果需要）

---

### 阶段 4：迁移文档和指南（1 天）

#### 4.1 迁移指南编写（0.5 天）

**目标**：编写从 Node daemon 到 Rust daemon 的迁移指南

**任务**：
- 编写迁移步骤（停止 Node daemon、启动 Rust daemon）
- 记录配置文件兼容性
- 记录 API 兼容性和差异
- 编写数据迁移说明（如果需要）
- 记录已知问题和限制

**产出**：
- `docs/RUST_MIGRATION.md`

#### 4.2 API 文档更新（0.5 天）

**目标**：更新 API 文档，移除旧路线

**任务**：
- 清理 `docs/API.md`（移除旧 `/sources`、`/events`、`/sessions`、handoff 路线）
- 更新端点列表（只保留 workflow/project/provider 路线）
- 补充缺失的端点文档
- 添加 WebSocket 事件文档

**产出**：
- `docs/API.md` 更新

---

### 阶段 5：P3 未完成集成（1 天）

#### 5.1 WorkflowArtifactStore 集成（0.3 天）

**任务**：
- 在 workflow execution 中集成 ArtifactStore
- 实现 `/workflow/runs/:id/artifacts` 端点
- 实现 artifact 生成和存储
- 添加测试

**产出**：
- 完整的 artifact 生成和查询流程

#### 5.2 HumanGateManager 集成（0.3 天）

**任务**：
- 在 workflow execution 中集成 HumanGateManager
- 实现 `/workflow/gates` 和 `/workflow/gates/:runId/:stepId/resolve` 端点
- 实现 gate 暂停和恢复逻辑
- 添加测试

**产出**：
- 完整的 gate 流程

#### 5.3 WebSocket 实时推送完善（0.4 天）

**任务**：
- 完善 workflow-run-event 推送
- 添加 run-start、step-start、step-output、step-finish、run-finish 事件
- 验证 GUI 接收和显示
- 添加测试

**产出**：
- 完整的实时推送流程

---

### 阶段 6：依赖清理和发布门禁（0.5 天）

#### 6.1 TypeScript daemon 依赖清理（0.3 天）

**目标**：移除 TypeScript daemon 依赖

**任务**：
- 识别仅用于 Node daemon 的依赖（Express、ws、pino）
- 保留用于测试和打包的依赖
- 更新 `package.json`
- 验证 `npm test` 仍可运行（测试 Rust daemon）

**清理候选**：
- `express`（如果 Rust daemon 完全替代）
- `ws`（如果 Rust daemon 完全替代）
- `pino`（如果 Rust daemon 使用 tracing）
- 其他 Node daemon 专用依赖

**产出**：
- 精简的 `package.json`

#### 6.2 发布门禁配置（0.2 天）

**目标**：配置发布前检查

**任务**：
- 更新 `npm test` 脚本（包括 Rust 测试）
- 配置 `cargo fmt --all`
- 配置 `cargo test --workspace`
- 配置 `cargo clippy --workspace --all-targets -- -D warnings`
- 配置 `dotnet build packages/gui/CodePanion.Gui.csproj -c Release`
- 配置 `git diff --check`

**产出**：
- `.github/workflows/ci.yml`（如果使用 GitHub Actions）
- 或本地检查脚本

---

## 关键风险和缓解措施

### 风险 1：性能目标未达标

**风险描述**：Rust daemon 可能无法达到 < 50MB 空闲内存和 < 500ms 冷启动目标

**缓解措施**：
1. 使用 `cargo build --release` 启用优化
2. 启用 LTO（Link Time Optimization）
3. 使用 `strip` 去除符号表
4. 优化启动时延迟加载
5. 如果内存仍超标，分析内存分配热点（`cargo flamegraph`）

### 风险 2：GUI/CLI 不兼容

**风险描述**：GUI 或 CLI 可能无法连接 Rust daemon 或 API 不兼容

**缓解措施**：
1. 优先验证 HTTP API 契约（端点、请求/响应格式）
2. 使用 Node daemon 测试作为基线
3. 添加 API 兼容性测试
4. 如果发现不兼容，优先修复 Rust daemon

### 风险 3：测试覆盖不足

**风险描述**：端到端测试可能无法覆盖所有场景

**缓解措施**：
1. 复用 Node daemon 26 个测试文件的场景
2. 优先覆盖核心流程（workflow 执行、gate resolve、artifact 生成）
3. 手动测试补充自动化测试不足

### 风险 4：迁移文档不完整

**风险描述**：用户可能无法顺利从 Node daemon 迁移到 Rust daemon

**缓解措施**：
1. 编写详细的迁移步骤
2. 记录已知问题和限制
3. 提供回退方案（保留 Node daemon 作为备用）

---

## 时间估算

| 阶段 | 任务 | 预计工作量 | 日历时间 |
|------|------|-----------|---------|
| 阶段 1 | 端到端测试设计与实现 | 16h | 2-3 天 |
| 阶段 2 | 性能基准测试 | 8h | 1-2 天 |
| 阶段 3 | GUI/CLI 适配验证 | 4h | 1 天 |
| 阶段 4 | 迁移文档和指南 | 4h | 1 天 |
| 阶段 5 | P3 未完成集成 | 4h | 1 天 |
| 阶段 6 | 依赖清理和发布门禁 | 2h | 0.5 天 |
| **总计** | **38h** | **6-8 天** |

---

## 实施优先级

### P0（必须完成）
1. HTTP API 集成测试（阶段 1.2）
2. Workflow 执行测试（阶段 1.4）
3. 内存和启动时间基准（阶段 2.2）
4. GUI 适配验证（阶段 3.1）
5. P3 未完成集成（阶段 5）

### P1（重要）
1. WebSocket 实时推送测试（阶段 1.3）
2. Workflow 执行性能基准（阶段 2.3）
3. CLI 适配验证（阶段 3.2）
4. 迁移指南编写（阶段 4.1）

### P2（可选）
1. 测试架构设计（阶段 1.1）
2. CLI 命令测试（阶段 1.5）
3. 压力测试（阶段 2.4）
4. API 文档更新（阶段 4.2）
5. 依赖清理（阶段 6）

---

## 技术选择

### 测试框架
- **Rust 集成测试**：`#[tokio::test]` + `reqwest` + `tokio-tungstenite`
- **Node 测试脚本**：复用现有 `packages/daemon/test/*.test.mjs`（调用 Rust daemon）

### 性能基准
- **Rust benchmarks**：`criterion` crate（如果需要精确基准）
- **自定义脚本**：`std::time::Instant` + `sysinfo`（内存测量）

### 文档格式
- **Markdown**：`docs/RUST_MIGRATION.md`、`docs/API.md`

---

## 下一步行动

### 立即开始（阶段 1.1 + 1.2）

1. **创建测试目录结构**
   ```bash
   mkdir -p codepanion-rust/tests/integration
   touch codepanion-rust/tests/integration/test_helpers.rs
   touch codepanion-rust/tests/integration/http_api_test.rs
   ```

2. **实现测试辅助模块**
   - daemon 启动/停止
   - HTTP 客户端封装
   - 断言宏

3. **实现 HTTP API 集成测试**
   - Project API
   - Provider API
   - Scheduler API
   - Workflow API

4. **运行测试并修复 bug**
   ```bash
   cargo test --test http_api_test
   ```

---

## 成功标准

✅ **测试覆盖**
- 所有 HTTP API 端点有集成测试
- WebSocket 实时推送有测试
- Workflow 执行核心流程有测试
- CLI 命令有测试

✅ **性能达标**
- daemon 空闲内存 < 50MB
- daemon 冷启动 < 500ms
- daemon 热启动 < 100ms
- workflow 执行延迟 < 50ms

✅ **适配验证**
- GUI 能连接 Rust daemon 并正常工作
- CLI 命令正常工作
- CC Switch 配置导入正常工作

✅ **文档完整**
- 迁移指南编写完成
- API 文档更新完成
- 已知问题记录完整

✅ **清理完成**
- TypeScript daemon 依赖已移除
- 发布门禁配置完成
- 代码质量检查通过

---

## 参考资料

- [RUST_REWRITE_PLAN.md](../docs/RUST_REWRITE_PLAN.md) - Rust 重构计划
- [DEVELOPMENT_TASKS.md](../DEVELOPMENT_TASKS.md) - 开发任务清单
- [API.md](../docs/API.md) - API 文档
- Node daemon 测试：`packages/daemon/test/*.test.mjs`
- 性能压测：`scripts/stress-workflow.mjs`
