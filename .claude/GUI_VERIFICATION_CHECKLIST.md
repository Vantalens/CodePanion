# GUI/CLI 适配验证清单

**日期**: 2026-06-02
**任务**: P7-04 阶段 3 - GUI/CLI 适配验证

---

## 验证目标

验证 WPF GUI 和 CLI 能够正常连接和使用 Rust daemon。

---

## 前置条件

1. ✅ Rust daemon 编译成功
2. ✅ HTTP API 测试通过
3. ✅ Workflow 执行测试通过
4. ⏳ GUI 和 daemon 同时运行

---

## 验证清单

### 1. Daemon 启动验证

- [ ] **启动 daemon**: `cargo run --release --bin codepanion-daemon -- --serve 7777`
- [ ] **验证健康检查**: `curl http://localhost:7777/health`
- [ ] **验证端点列表**: 确认所有端点可访问

### 2. GUI 连接验证

#### 2.1 启动 GUI
```bash
cd packages/gui
dotnet run
```

#### 2.2 验证连接
- [ ] GUI 启动成功
- [ ] 显示 "Connected to daemon" 或类似状态
- [ ] 没有连接错误或超时

#### 2.3 验证项目管理
- [ ] 可以列出项目
- [ ] 可以创建新项目
- [ ] 可以切换项目
- [ ] 项目状态正确显示

#### 2.4 验证 Workflow 视图
- [ ] 可以查看 workflow board
- [ ] 可以查看 workflow runs
- [ ] 可以查看运行状态
- [ ] 实时更新工作正常

#### 2.5 验证 WebSocket 连接
- [ ] WebSocket 连接成功
- [ ] 接收到事件推送
- [ ] 事件格式正确
- [ ] 断线重连正常

### 3. CLI 命令验证

#### 3.1 Provider 管理
```bash
# 列出 providers
cargo run --bin codepanion -- provider list

# 切换 provider
cargo run --bin codepanion -- provider switch <provider-id>

# 导入 provider
cargo run --bin codepanion -- provider import <file>
```

- [ ] `provider list` 正常工作
- [ ] `provider switch` 正常工作
- [ ] `provider import` 正常工作

#### 3.2 Model 管理
```bash
# 列出 models
cargo run --bin codepanion -- model list
```

- [ ] `model list` 正常工作
- [ ] 显示所有可用模型

#### 3.3 Config 导入
```bash
# 导入配置
cargo run --bin codepanion -- config import <file>
```

- [ ] `config import` 正常工作
- [ ] CC Switch 兼容性验证

### 4. 端到端场景验证

#### 场景 1：创建项目并执行 workflow
1. [ ] GUI 创建新项目
2. [ ] 选择一个 workflow
3. [ ] 执行 workflow
4. [ ] 查看实时输出
5. [ ] 验证结果正确

#### 场景 2：多项目切换
1. [ ] 创建多个项目
2. [ ] 在 GUI 中切换项目
3. [ ] 验证状态正确保存
4. [ ] 验证 workflow 隔离

#### 场景 3：Gate 决策
1. [ ] 执行包含 gate 的 workflow
2. [ ] GUI 显示 gate 决策面板
3. [ ] 做出决策（approve/reject）
4. [ ] 验证 workflow 继续执行

---

## 已知问题和限制

### 潜在问题
1. **端口冲突**: GUI 可能期望固定端口
2. **WebSocket 路径**: 可能需要调整 WebSocket 路由
3. **事件格式**: TypeScript 和 Rust 事件格式可能不一致

### 解决方案
1. 检查 GUI 配置文件中的 daemon 地址
2. 查看 WebSocket 路由实现
3. 对比事件格式并调整

---

## 验证结果

### 成功标准
- [ ] GUI 能成功连接 Rust daemon
- [ ] 所有核心功能正常工作
- [ ] 没有严重错误或崩溃
- [ ] WebSocket 实时推送正常

### 失败处理
如果验证失败：
1. 记录错误日志
2. 确定是 GUI 问题还是 daemon 问题
3. 修复并重新验证

---

## 实际验证记录

### 日期: _______________

#### Daemon 启动
- 启动命令: 
- 启动时间: 
- 内存占用: 
- 状态: ⬜ 成功 / ⬜ 失败

#### GUI 连接
- GUI 版本: 
- 连接状态: ⬜ 成功 / ⬜ 失败
- 错误信息: 

#### 功能验证
- 项目管理: ⬜ ✓ / ⬜ ✗
- Workflow 视图: ⬜ ✓ / ⬜ ✗
- WebSocket: ⬜ ✓ / ⬜ ✗
- CLI 命令: ⬜ ✓ / ⬜ ✗

#### 发现的问题
1. 
2. 
3. 

#### 需要修复的项
1. 
2. 
3. 

---

## 下一步

验证完成后：
- [ ] 更新 DEVELOPMENT_TASKS.md
- [ ] 提交验证结果
- [ ] 继续下一个任务（迁移文档）
