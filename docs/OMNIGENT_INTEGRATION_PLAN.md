# Omnigent 架构集成方案

## 背景

Omnigent 是从生产环境的安全 agent（NumaSec，17k+ LOC）提取的领域无关 agent 架构。它提供了 CodePanion 当前缺失的核心智能层：ReAct 循环、推理图、结构化记忆、分层规划和后处理管道。

## 核心差距

### Omnigent 拥有但 CodePanion 缺失的

1. **ReAct 循环**
   - 循环检测（MD5 哈希防重复）
   - 断路器（跟踪重复错误）
   - 速率限制（双层：每次迭代 + 总量）
   - 自适应超时
   - 检查点/重放

2. **ReasoningGraph**
   - 节点状态机：UNKNOWN → SUSPECTED → CONFIRMED → EXPLOITED → FAILED
   - 边表示推理步骤，支持 `requires_all` 多前置条件
   - 命名路径链接多步推理

3. **DomainRegistry 模式**
   - 单个可注入数据类
   - 消除全局状态
   - 支持多 agent 实例隔离

4. **后处理管道**
   - Extractors：工具结果 → 结构化 DomainProfile
   - Reflection：异步战略洞察生成
   - Error Recovery：模式匹配恢复指导

5. **上下文管理**
   - 3 层智能修剪（保留 Profile/Plan，压缩中间，保持最近完整）
   - 语义压缩（LLM 驱动）
   - 原子消息组保护

6. **分层规划**
   - 模板匹配 + LLM 细化
   - 阶段跳过条件
   - 宏反思（阶段结束时）

### CodePanion 拥有但 Omnigent 缺失的

1. **Workflow 引擎**
   - 多步骤定义
   - 人工门控
   - 产出物管理

2. **Provider 架构**
   - API/CLI/Harness 三类 provider
   - 外部工具集成（Codex/Claude Code/OpenCode）

3. **多任务并行**
   - 项目隔离
   - 全局队列
   - 取消/恢复

## 集成策略

### 方案 A：在 Rust Daemon 中复刻 Omnigent 核心

将 Omnigent 的核心模块用 Rust 重写，融入 CodePanion 架构：

```
codepanion-rust/crates/
├── agent-runtime/
│   ├── react_loop.rs       # ReAct 循环 + 循环检测 + 断路器
│   ├── reasoning_graph.rs  # 推理图
│   ├── domain_registry.rs  # 领域注册表
│   ├── context_mgr.rs      # 上下文管理
│   └── planner.rs          # 分层规划
├── post_processing/
│   ├── extractors.rs       # 工具结果提取器
│   ├── reflection.rs       # 反思引擎
│   └── error_recovery.rs   # 错误恢复
└── state/
    ├── domain_profile.rs   # 结构化记忆
    └── findings.rs         # 发现验证
```

**优点**：
- 性能最优
- 与 CodePanion 深度集成
- 类型安全

**缺点**：
- 开发周期长
- 需要完整理解 Omnigent 每个模块
- Rust 异步生态学习成本

### 方案 B：Omnigent 作为 Harness Provider

将 Omnigent Python 实现作为 CodePanion 的一个 harness provider：

```
~/.codepanion/providers/omnigent-harness/
├── omnigent/              # Omnigent 核心代码
├── adapter.py             # CodePanion 适配层
└── config.json            # Provider 配置
```

**优点**：
- 快速验证
- 复用现有 325 个测试
- 增量迁移路径

**缺点**：
- Python 启动开销
- 跨语言通信成本
- 依赖隔离复杂

### 方案 C：混合方案（推荐）

**阶段 1：快速验证（1-2 周）**
- 将 Omnigent 作为 Python harness provider 集成
- 验证 ReAct 循环 + ReasoningGraph 在 CodePanion workflow 中的效果
- 收集性能数据和用户反馈

**阶段 2：核心迁移（4-6 周）**
- 将最有价值的模块用 Rust 重写：
  1. ReAct 循环 + 循环检测 + 断路器
  2. DomainRegistry 模式
  3. 上下文管理
- 保留 Python harness 用于复杂推理场景

**阶段 3：深度融合（6-8 周）**
- 迁移 ReasoningGraph
- 迁移后处理管道
- 迁移分层规划

## 立即可执行的行动

### 1. 在 workflow-engine 中添加循环检测

```rust
// codepanion-rust/crates/workflow-engine/src/loop_detection.rs
use std::collections::{HashMap, VecDeque};
use md5::{Md5, Digest};

pub struct LoopDetector {
    recent_calls: VecDeque<String>,
    max_history: usize,
}

impl LoopDetector {
    pub fn new(max_history: usize) -> Self {
        Self {
            recent_calls: VecDeque::with_capacity(max_history),
            max_history,
        }
    }

    pub fn check_and_record(&mut self, tool_name: &str, args: &serde_json::Value) -> bool {
        let hash = self.compute_hash(tool_name, args);
        
        if self.recent_calls.contains(&hash) {
            return false; // 检测到循环
        }
        
        if self.recent_calls.len() >= self.max_history {
            self.recent_calls.pop_front();
        }
        self.recent_calls.push_back(hash);
        true
    }

    fn compute_hash(&self, tool_name: &str, args: &serde_json::Value) -> String {
        let mut hasher = Md5::new();
        hasher.update(tool_name.as_bytes());
        hasher.update(args.to_string().as_bytes());
        format!("{:x}", hasher.finalize())
    }
}
```

### 2. 添加断路器模式

```rust
// codepanion-rust/crates/workflow-engine/src/circuit_breaker.rs
use std::collections::HashMap;

pub struct CircuitBreaker {
    error_counts: HashMap<String, usize>,
    threshold: usize,
}

impl CircuitBreaker {
    pub fn new(threshold: usize) -> Self {
        Self {
            error_counts: HashMap::new(),
            threshold,
        }
    }

    pub fn record_error(&mut self, error_signature: String) -> bool {
        let count = self.error_counts.entry(error_signature).or_insert(0);
        *count += 1;
        *count >= self.threshold // 返回是否应该停止
    }

    pub fn reset(&mut self) {
        self.error_counts.clear();
    }
}
```

### 3. 创建 DomainRegistry 数据结构

```rust
// codepanion-rust/crates/agent-runtime/src/domain_registry.rs
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainRegistry {
    pub extractors: HashMap<String, ExtractorConfig>,
    pub reflectors: HashMap<String, ReflectorConfig>,
    pub chains: HashMap<String, Vec<ChainStep>>,
    pub plan_templates: HashMap<String, Vec<PhaseTemplate>>,
    pub error_patterns: HashMap<String, ErrorPattern>,
    pub tool_timeouts: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractorConfig {
    pub name: String,
    pub pattern: Option<String>,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectorConfig {
    pub name: String,
    pub prompt_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainStep {
    pub description: String,
    pub tool_hint: Option<String>,
    pub requires_all: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseTemplate {
    pub name: String,
    pub objective: String,
    pub steps: Vec<TaskStep>,
    pub skip_condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStep {
    pub description: String,
    pub tool_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPattern {
    pub indicators: Vec<String>,
    pub guidance: String,
    pub retry_tool: Option<String>,
    pub give_up: bool,
}

impl Default for DomainRegistry {
    fn default() -> Self {
        Self {
            extractors: HashMap::new(),
            reflectors: HashMap::new(),
            chains: HashMap::new(),
            plan_templates: HashMap::new(),
            error_patterns: HashMap::new(),
            tool_timeouts: HashMap::new(),
        }
    }
}
```

### 4. 实现 ReasoningGraph

```rust
// codepanion-rust/crates/agent-runtime/src/reasoning_graph.rs
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeState {
    Unknown,
    Suspected,
    Confirmed,
    Exploited,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub state: NodeState,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub description: String,
    pub tool_hint: Option<String>,
    pub requires_all: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasoningGraph {
    pub nodes: HashMap<String, Node>,
    pub edges: Vec<Edge>,
}

impl ReasoningGraph {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            edges: Vec::new(),
        }
    }

    pub fn add_node(&mut self, id: String, description: String) {
        self.nodes.insert(id.clone(), Node {
            id,
            state: NodeState::Unknown,
            description,
        });
    }

    pub fn add_edge(&mut self, from: String, to: String, description: String, 
                    tool_hint: Option<String>, requires_all: Vec<String>) {
        self.edges.push(Edge {
            from,
            to,
            description,
            tool_hint,
            requires_all,
        });
    }

    pub fn mark_state(&mut self, node_id: &str, state: NodeState) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.state = state;
        }
    }

    pub fn get_active_edges(&self) -> Vec<&Edge> {
        self.edges.iter().filter(|edge| {
            // 边激活条件：起始节点已确认，且所有前置条件已确认
            let from_confirmed = self.nodes.get(&edge.from)
                .map(|n| n.state == NodeState::Confirmed || n.state == NodeState::Exploited)
                .unwrap_or(false);

            if !from_confirmed {
                return false;
            }

            if edge.requires_all.is_empty() {
                return true;
            }

            edge.requires_all.iter().all(|req| {
                self.nodes.get(req)
                    .map(|n| n.state == NodeState::Confirmed || n.state == NodeState::Exploited)
                    .unwrap_or(false)
            })
        }).collect()
    }

    pub fn to_prompt_context(&self) -> String {
        let mut ctx = String::from("## Reasoning Graph\n\n");
        
        // 已确认节点
        let confirmed: Vec<_> = self.nodes.values()
            .filter(|n| n.state == NodeState::Confirmed || n.state == NodeState::Exploited)
            .collect();
        
        if !confirmed.is_empty() {
            ctx.push_str("### Confirmed:\n");
            for node in confirmed {
                ctx.push_str(&format!("- {} ({})\n", node.description, node.id));
            }
            ctx.push('\n');
        }

        // 可用边（下一步推理路径）
        let active_edges = self.get_active_edges();
        if !active_edges.is_empty() {
            ctx.push_str("### Available Reasoning Paths:\n");
            for edge in active_edges {
                let to_desc = self.nodes.get(&edge.to)
                    .map(|n| n.description.as_str())
                    .unwrap_or("?");
                ctx.push_str(&format!("- {} → {} ({})\n", 
                    edge.description, to_desc, edge.to));
                if let Some(tool) = &edge.tool_hint {
                    ctx.push_str(&format!("  Tool: {}\n", tool));
                }
            }
        }

        ctx
    }
}
```

### 5. 添加上下文管理器

```rust
// codepanion-rust/crates/agent-runtime/src/context_manager.rs
use serde_json::Value;

pub struct ContextManager {
    pub max_tokens: usize,
    pub recent_window_size: usize,
}

impl ContextManager {
    pub fn new(max_tokens: usize, recent_window_size: usize) -> Self {
        Self {
            max_tokens,
            recent_window_size,
        }
    }

    pub fn should_trim(&self, messages: &[Value]) -> bool {
        let estimated_tokens = self.estimate_tokens(messages);
        estimated_tokens > self.max_tokens
    }

    pub fn trim_messages(&self, messages: &[Value]) -> Vec<Value> {
        if messages.len() <= self.recent_window_size {
            return messages.to_vec();
        }

        let mut trimmed = Vec::new();
        
        // 保留系统消息（第一条）
        if let Some(first) = messages.first() {
            if first.get("role").and_then(|r| r.as_str()) == Some("system") {
                trimmed.push(first.clone());
            }
        }

        // 压缩中间消息
        let middle_start = if messages[0].get("role").and_then(|r| r.as_str()) == Some("system") { 1 } else { 0 };
        let middle_end = messages.len().saturating_sub(self.recent_window_size);
        
        for msg in &messages[middle_start..middle_end] {
            trimmed.push(self.compress_message(msg));
        }

        // 保留最近窗口完整
        for msg in &messages[middle_end..] {
            trimmed.push(msg.clone());
        }

        trimmed
    }

    fn compress_message(&self, msg: &Value) -> Value {
        let mut compressed = msg.clone();
        if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
            if content.len() > 300 {
                let truncated = format!("{}... [truncated {} chars]", 
                    &content[..300], content.len() - 300);
                compressed["content"] = Value::String(truncated);
            }
        }
        compressed
    }

    fn estimate_tokens(&self, messages: &[Value]) -> usize {
        // 简单估算：4 字符 ≈ 1 token
        messages.iter()
            .filter_map(|m| m.get("content").and_then(|c| c.as_str()))
            .map(|c| c.len() / 4)
            .sum()
    }
}
```

## 测试计划

### 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loop_detection() {
        let mut detector = LoopDetector::new(10);
        let args = serde_json::json!({"target": "example.com"});
        
        assert!(detector.check_and_record("nmap", &args));
        assert!(!detector.check_and_record("nmap", &args)); // 第二次应该被阻止
    }

    #[test]
    fn test_circuit_breaker() {
        let mut breaker = CircuitBreaker::new(3);
        let error = "Connection timeout".to_string();
        
        assert!(!breaker.record_error(error.clone()));
        assert!(!breaker.record_error(error.clone()));
        assert!(breaker.record_error(error.clone())); // 第 3 次应该断路
    }

    #[test]
    fn test_reasoning_graph() {
        let mut graph = ReasoningGraph::new();
        graph.add_node("sqli".to_string(), "SQL Injection found".to_string());
        graph.add_node("db_access".to_string(), "Database access".to_string());
        graph.add_edge("sqli".to_string(), "db_access".to_string(), 
                      "Dump database".to_string(), Some("sqlmap".to_string()), vec![]);
        
        // 起始未激活
        assert_eq!(graph.get_active_edges().len(), 0);
        
        // 确认 SQLi 后激活
        graph.mark_state("sqli", NodeState::Confirmed);
        assert_eq!(graph.get_active_edges().len(), 1);
    }
}
```

### 集成测试

创建一个完整的 workflow 测试：

```rust
// codepanion-rust/crates/daemon/tests/omnigent_integration_test.rs
#[tokio::test]
async fn test_react_loop_with_reasoning_graph() {
    // 1. 创建 workflow
    // 2. 添加 agent step
    // 3. 验证循环检测生效
    // 4. 验证推理图更新
    // 5. 验证上下文修剪
}
```

## 迁移路线图

### Week 1-2：基础设施
- [x] 创建 `agent-runtime` crate
- [ ] 实现 LoopDetector
- [ ] 实现 CircuitBreaker
- [ ] 实现 DomainRegistry
- [ ] 单元测试覆盖率 > 80%

### Week 3-4：推理图
- [ ] 实现 ReasoningGraph
- [ ] 集成到 workflow executor
- [ ] 在 agent step 中注入推理图上下文
- [ ] 测试多步推理场景

### Week 5-6：上下文管理
- [ ] 实现 ContextManager
- [ ] 集成到 model client
- [ ] 测试长对话修剪
- [ ] 性能基准测试

### Week 7-8：后处理管道
- [ ] 实现 Extractor 框架
- [ ] 实现 Reflection 引擎
- [ ] 实现 Error Recovery
- [ ] 端到端测试

### Week 9-10：分层规划
- [ ] 实现 TaskPlanner
- [ ] 模板系统
- [ ] LLM 细化集成
- [ ] 宏反思

## 成功指标

1. **循环检测率** > 95%
2. **断路器触发准确率** > 90%
3. **上下文修剪后 token 减少** > 40%
4. **推理图路径发现率** > 80%
5. **整体 workflow 成功率提升** > 30%

## 参考资料

- [Omnigent 源码](D:/Omnigent/omnigent/src/omnigent/)
- [Omnigent 架构文档](D:/Omnigent/omnigent/ARCHITECTURE.md)
- [CodePanion 架构文档](D:/CodePanion/docs/ARCHITECTURE.md)

