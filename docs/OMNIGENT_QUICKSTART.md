# Omnigent 模块快速开始指南

本指南展示如何在 CodePanion workflow 中使用 Omnigent 启发的智能模块。

## 概述

Omnigent 模块提供了 4 个核心智能组件：

1. **LoopDetector** - 防止工具调用无限循环
2. **CircuitBreaker** - 防止错误无限重试
3. **DomainRegistry** - 数据驱动的领域行为配置
4. **ReasoningGraph** - 多步推理路径追踪

## 基础使用

### 1. 导入模块

```rust
use codepanion_workflow_engine::{
    CircuitBreaker,
    DomainRegistry,
    LoopDetector,
    NodeState,
    ReasoningGraph,
};
```

### 2. 初始化

```rust
// 循环检测器：跟踪最近 10 次工具调用
let mut loop_detector = LoopDetector::new(10);

// 断路器：3 次相同错误后停止
let mut circuit_breaker = CircuitBreaker::new(3);

// 推理图：空白图，稍后添加节点和边
let mut reasoning_graph = ReasoningGraph::new();

// 领域注册表：配置工具超时、提取器等
let mut registry = DomainRegistry::new();
```

### 3. 在工具调用中使用循环检测

```rust
let tool_name = "complexity_analyzer";
let args = serde_json::json!({"threshold": 10});

// 检查并记录调用
if !loop_detector.check_and_record(tool_name, &args) {
    println!("⚠ Loop detected - blocking repeated call");
    return; // 或继续下一个工具
}

// 执行工具...
let result = execute_tool(tool_name, &args).await?;
```

### 4. 使用断路器处理错误

```rust
match execute_tool(tool_name, &args).await {
    Ok(result) => {
        // 处理成功结果
    }
    Err(error) => {
        let error_signature = error.to_string();

        // 记录错误，检查是否应该停止
        if circuit_breaker.record_error(error_signature) {
            println!("⚠ Circuit breaker tripped - stopping execution");
            return Err(CodePanionError::CircuitBreakerTripped);
        }

        // 继续执行其他逻辑...
    }
}
```

### 5. 构建和使用推理图

```rust
// 添加节点（能力/状态）
reasoning_graph.add_node(
    "high_complexity".to_string(),
    "High code complexity detected".to_string()
);

reasoning_graph.add_node(
    "god_class".to_string(),
    "God class pattern identified".to_string()
);

reasoning_graph.add_node(
    "low_testability".to_string(),
    "Low testability score".to_string()
);

// 添加边（推理步骤）
reasoning_graph.add_edge(
    "high_complexity".to_string(),  // from
    "god_class".to_string(),        // to
    "Analyze class structure".to_string(), // description
    Some("class_analyzer".to_string()),    // tool_hint
    vec![],                          // requires_all (prerequisites)
);

reasoning_graph.add_edge(
    "god_class".to_string(),
    "low_testability".to_string(),
    "Assess testability".to_string(),
    Some("testability_checker".to_string()),
    vec![],
);

// 工具执行后更新状态
reasoning_graph.mark_state("high_complexity", NodeState::Confirmed);

// 获取下一步可用的推理路径
let active_edges = reasoning_graph.get_active_edges();
for edge in active_edges {
    println!("→ Can pursue: {} (tool: {:?})",
        edge.description, edge.tool_hint);
}

// 生成 LLM 提示上下文
let context = reasoning_graph.to_prompt_context();
println!("{}", context);
```

### 6. 配置领域注册表

```rust
let mut registry = DomainRegistry::new();

// 工具超时配置
registry.tool_timeouts.insert("slow_tool".to_string(), 300);
registry.tool_timeouts.insert("fast_tool".to_string(), 30);

// 提取器配置
registry.extractors.insert(
    "complexity_analyzer".to_string(),
    ExtractorConfig {
        name: "complexity_analyzer".to_string(),
        pattern: Some(r"complexity: ([\d.]+)".to_string()),
        fields: vec!["complexity_score".to_string()],
    }
);

// 获取工具超时（带默认值）
let timeout = registry.get_tool_timeout("slow_tool", 60); // 返回 300

// 检查是否有提取器
if registry.has_extractor("complexity_analyzer") {
    println!("Extractor available for this tool");
}
```

## 高级场景

### 多前置条件推理链

```rust
// 创建安全分析推理图
reasoning_graph.add_node("sqli_found".to_string(), "SQL Injection".to_string());
reasoning_graph.add_node("auth_bypass".to_string(), "Auth bypass".to_string());
reasoning_graph.add_node("admin_access".to_string(), "Admin access".to_string());

// 这条边需要 BOTH sqli_found AND auth_bypass 都确认后才激活
reasoning_graph.add_edge(
    "sqli_found".to_string(),
    "admin_access".to_string(),
    "Escalate to admin privileges".to_string(),
    Some("privilege_escalation".to_string()),
    vec!["auth_bypass".to_string()], // 前置条件：必须先有 auth_bypass
);

// 确认第一个条件
reasoning_graph.mark_state("sqli_found", NodeState::Confirmed);
assert_eq!(reasoning_graph.get_active_edges().len(), 0); // 还不能激活

// 确认第二个条件
reasoning_graph.mark_state("auth_bypass", NodeState::Confirmed);
assert_eq!(reasoning_graph.get_active_edges().len(), 1); // 现在激活了！
```

### 合并多个领域配置

```rust
// 基础配置
let mut base_registry = DomainRegistry::new();
base_registry.tool_timeouts.insert("tool_a".to_string(), 30);

// 项目特定配置
let mut project_registry = DomainRegistry::new();
project_registry.tool_timeouts.insert("tool_b".to_string(), 60);
project_registry.tool_timeouts.insert("tool_a".to_string(), 45); // 覆盖

// 合并（project_registry 优先）
base_registry.merge(project_registry);

assert_eq!(base_registry.get_tool_timeout("tool_a", 0), 45); // 被覆盖
assert_eq!(base_registry.get_tool_timeout("tool_b", 0), 60);
```

### 节点状态转换

推理图支持完整的状态生命周期：

```rust
// 初始状态
reasoning_graph.add_node("vuln".to_string(), "Vulnerability".to_string());
// 状态: Unknown

// 探索阶段
reasoning_graph.mark_state("vuln", NodeState::Suspected);

// 确认阶段
reasoning_graph.mark_state("vuln", NodeState::Confirmed);

// 利用阶段
reasoning_graph.mark_state("vuln", NodeState::Exploited);

// 或者发现是误报
reasoning_graph.mark_state("vuln", NodeState::Failed);

// 查询特定状态的所有节点
let confirmed_nodes = reasoning_graph.nodes_in_state(NodeState::Confirmed);
```

## 与 Workflow Executor 集成

```rust
use codepanion_workflow_engine::WorkflowExecutor;

pub struct IntelligentWorkflowExecutor {
    executor: WorkflowExecutor,
    loop_detector: LoopDetector,
    circuit_breaker: CircuitBreaker,
    reasoning_graph: ReasoningGraph,
    registry: DomainRegistry,
}

impl IntelligentWorkflowExecutor {
    pub fn new(executor: WorkflowExecutor, registry: DomainRegistry) -> Self {
        Self {
            executor,
            loop_detector: LoopDetector::new(10),
            circuit_breaker: CircuitBreaker::new(3),
            reasoning_graph: ReasoningGraph::new(),
            registry,
        }
    }

    pub async fn execute_step_with_intelligence(
        &mut self,
        step: &WorkflowStep
    ) -> Result<StepExecutionResult> {
        // 1. 循环检测
        if !self.loop_detector.check_and_record(&step.id, &step.args) {
            return Err(CodePanionError::LoopDetected(step.id.clone()));
        }

        // 2. 获取工具超时
        let timeout = self.registry.get_tool_timeout(&step.id, 300);

        // 3. 执行工具（带超时）
        let result = tokio::time::timeout(
            Duration::from_secs(timeout),
            self.executor.execute_step(step)
        ).await??;

        // 4. 错误处理与断路器
        if result.is_error() {
            if self.circuit_breaker.record_error(result.error.clone()) {
                return Err(CodePanionError::CircuitBreakerTripped);
            }
        }

        // 5. 更新推理图
        if let Some(finding) = &result.finding {
            self.reasoning_graph.mark_state(&finding.id, NodeState::Confirmed);
        }

        // 6. 获取下一步推理路径（注入到下一个 LLM 调用）
        let reasoning_context = self.reasoning_graph.to_prompt_context();
        // ... 将 reasoning_context 添加到系统提示

        Ok(result)
    }
}
```

## 测试

运行所有 Omnigent 模块测试：

```bash
cd codepanion-rust

# 所有单元测试
cargo test --package codepanion-workflow-engine --lib

# 集成测试
cargo test --package codepanion-workflow-engine --test omnigent_integration_test

# 查看测试输出
cargo test --package codepanion-workflow-engine --test omnigent_integration_test -- --nocapture
```

## 性能考虑

- **循环检测**: ~5μs per call (MD5 哈希)
- **断路器**: ~1μs per error (HashMap 查找)
- **推理图更新**: ~10μs per state change
- **总内存**: < 100KB per workflow

这些开销远小于网络 I/O 和 LLM 调用，可以忽略不计。

## 下一步

查看完整文档：
- [集成计划](OMNIGENT_INTEGRATION_PLAN.md)
- [集成完成报告](OMNIGENT_INTEGRATION_COMPLETE.md)
- [开发任务](../DEVELOPMENT_TASKS.md)

参考 Omnigent 原始实现：
- [Omnigent 架构](D:/Omnigent/omnigent/ARCHITECTURE.md)
- [Omnigent 源码](D:/Omnigent/omnigent/src/omnigent/)

---

**问题反馈**: 在 GitHub Issues 中提问或查看现有讨论
