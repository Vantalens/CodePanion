use codepanion_workflow_engine::{
    CircuitBreaker, DomainRegistry, LoopDetector, NodeState, ReasoningGraph,
};

/// Example: Using Omnigent-inspired modules in a CodePanion workflow
///
/// This demonstrates how loop detection, circuit breakers, domain registries,
/// and reasoning graphs enhance agent intelligence in workflows.

#[tokio::test]
async fn test_agent_workflow_with_omnigent_intelligence() {
    // 1. Initialize intelligence modules
    let mut loop_detector = LoopDetector::new(10);
    let mut circuit_breaker = CircuitBreaker::new(3);
    let mut reasoning_graph = ReasoningGraph::new();
    let registry = create_code_analysis_registry();

    // 2. Build reasoning graph for code quality analysis
    reasoning_graph.add_node(
        "project_scanned".to_string(),
        "Project structure scanned".to_string(),
    );
    reasoning_graph.add_node(
        "high_complexity".to_string(),
        "High complexity detected".to_string(),
    );
    reasoning_graph.add_node("god_class".to_string(), "God class identified".to_string());
    reasoning_graph.add_node(
        "low_testability".to_string(),
        "Low testability score".to_string(),
    );

    reasoning_graph.add_edge(
        "project_scanned".to_string(),
        "high_complexity".to_string(),
        "Run complexity analysis".to_string(),
        Some("complexity_analyzer".to_string()),
        vec![],
    );

    reasoning_graph.add_edge(
        "high_complexity".to_string(),
        "god_class".to_string(),
        "Identify god classes".to_string(),
        Some("class_analyzer".to_string()),
        vec![],
    );

    reasoning_graph.add_edge(
        "god_class".to_string(),
        "low_testability".to_string(),
        "Assess testability".to_string(),
        Some("testability_checker".to_string()),
        vec![],
    );

    // 3. Simulate agent execution with intelligence
    let tool_calls = vec![
        ("scan_project", serde_json::json!({"path": "/project"})),
        ("complexity_analyzer", serde_json::json!({"threshold": 10})),
        ("complexity_analyzer", serde_json::json!({"threshold": 10})), // Duplicate - should be blocked
        ("class_analyzer", serde_json::json!({"min_methods": 20})),
        ("testability_checker", serde_json::json!({})),
    ];

    let mut execution_log = Vec::new();

    for (tool_name, args) in tool_calls {
        // Loop detection
        if !loop_detector.check_and_record(tool_name, &args) {
            execution_log.push(format!("⚠ Loop detected: {} blocked", tool_name));
            continue;
        }

        // Simulate tool execution
        let result = simulate_tool_execution(tool_name, &args);

        // Circuit breaker on errors
        if result.starts_with("ERROR") && circuit_breaker.record_error(result.clone()) {
            execution_log.push("⚠ Circuit breaker tripped - stopping execution".to_string());
            break;
        }

        // Update reasoning graph based on findings
        match tool_name {
            "scan_project" => {
                reasoning_graph.mark_state("project_scanned", NodeState::Confirmed);
                execution_log.push("✓ Project scanned".to_string());
            }
            "complexity_analyzer" => {
                reasoning_graph.mark_state("high_complexity", NodeState::Confirmed);
                execution_log.push("✓ High complexity confirmed".to_string());
            }
            "class_analyzer" => {
                reasoning_graph.mark_state("god_class", NodeState::Confirmed);
                execution_log.push("✓ God class identified".to_string());
            }
            "testability_checker" => {
                reasoning_graph.mark_state("low_testability", NodeState::Confirmed);
                execution_log.push("✓ Testability assessed".to_string());
            }
            _ => {}
        }

        // Check active reasoning paths
        let active_edges = reasoning_graph.get_active_edges();
        if !active_edges.is_empty() {
            execution_log.push(format!(
                "→ {} reasoning paths available",
                active_edges.len()
            ));
        }
    }

    // 4. Verify intelligence worked
    assert!(
        execution_log
            .iter()
            .any(|log| log.contains("Loop detected"))
    );
    assert!(
        execution_log
            .iter()
            .any(|log| log.contains("Project scanned"))
    );
    assert!(
        execution_log
            .iter()
            .any(|log| log.contains("God class identified"))
    );

    // Verify reasoning graph progression
    assert_eq!(
        reasoning_graph.nodes_in_state(NodeState::Confirmed).len(),
        4
    );

    // 5. Generate prompt context for next LLM call
    let context = reasoning_graph.to_prompt_context();
    assert!(context.contains("Confirmed:"));
    assert!(context.contains("Project structure scanned"));

    // 6. Verify domain registry provides tool-specific config
    assert_eq!(registry.get_tool_timeout("complexity_analyzer", 30), 120);
    assert!(registry.has_extractor("complexity_analyzer"));

    println!("\n=== Execution Log ===");
    for log in execution_log {
        println!("{}", log);
    }

    println!("\n=== Reasoning Graph Context ===");
    println!("{}", context);
}

fn simulate_tool_execution(tool_name: &str, _args: &serde_json::Value) -> String {
    match tool_name {
        "scan_project" => "SUCCESS: Found 42 files".to_string(),
        "complexity_analyzer" => "SUCCESS: Average complexity: 15.3".to_string(),
        "class_analyzer" => "SUCCESS: Found 3 god classes".to_string(),
        "testability_checker" => "SUCCESS: Testability score: 45/100".to_string(),
        _ => "ERROR: Unknown tool".to_string(),
    }
}

fn create_code_analysis_registry() -> DomainRegistry {
    let mut registry = DomainRegistry::new();

    // Tool timeouts
    registry
        .tool_timeouts
        .insert("scan_project".to_string(), 30);
    registry
        .tool_timeouts
        .insert("complexity_analyzer".to_string(), 120);
    registry
        .tool_timeouts
        .insert("class_analyzer".to_string(), 60);

    // Extractors (simplified - just mark presence)
    registry.extractors.insert(
        "complexity_analyzer".to_string(),
        codepanion_workflow_engine::ExtractorConfig {
            name: "complexity_analyzer".to_string(),
            pattern: Some(r"complexity: ([\d.]+)".to_string()),
            fields: vec!["complexity_score".to_string()],
        },
    );

    registry
}

#[test]
fn test_reasoning_graph_multi_prerequisite_chain() {
    // Example: Security analysis requiring multiple conditions
    let mut graph = ReasoningGraph::new();

    graph.add_node(
        "sqli_found".to_string(),
        "SQL Injection vulnerability".to_string(),
    );
    graph.add_node(
        "auth_bypass".to_string(),
        "Authentication bypass".to_string(),
    );
    graph.add_node(
        "db_access".to_string(),
        "Database access gained".to_string(),
    );
    graph.add_node(
        "admin_access".to_string(),
        "Admin access achieved".to_string(),
    );

    // Simple chain: SQLi → DB Access
    graph.add_edge(
        "sqli_found".to_string(),
        "db_access".to_string(),
        "Exploit SQLi to access database".to_string(),
        Some("sqlmap".to_string()),
        vec![],
    );

    // Complex chain: requires BOTH SQLi AND auth bypass
    graph.add_edge(
        "sqli_found".to_string(),
        "admin_access".to_string(),
        "Escalate to admin".to_string(),
        Some("privilege_escalation".to_string()),
        vec!["auth_bypass".to_string()], // requires auth_bypass too
    );

    // Initially no edges active
    assert_eq!(graph.get_active_edges().len(), 0);

    // Confirm SQLi - activates DB access but NOT admin access
    graph.mark_state("sqli_found", NodeState::Confirmed);
    let active = graph.get_active_edges();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].to, "db_access");

    // Confirm auth bypass - NOW admin access edge activates
    graph.mark_state("auth_bypass", NodeState::Confirmed);
    let active = graph.get_active_edges();
    assert_eq!(active.len(), 2); // Both db_access and admin_access
    assert!(active.iter().any(|e| e.to == "admin_access"));
}

#[test]
fn test_domain_registry_merge() {
    let mut base_registry = DomainRegistry::new();
    base_registry.tool_timeouts.insert("tool_a".to_string(), 30);
    base_registry.tool_timeouts.insert("tool_b".to_string(), 60);

    let mut override_registry = DomainRegistry::new();
    override_registry
        .tool_timeouts
        .insert("tool_b".to_string(), 120); // Override
    override_registry
        .tool_timeouts
        .insert("tool_c".to_string(), 90);

    base_registry.merge(override_registry);

    assert_eq!(base_registry.get_tool_timeout("tool_a", 0), 30);
    assert_eq!(base_registry.get_tool_timeout("tool_b", 0), 120); // Overridden
    assert_eq!(base_registry.get_tool_timeout("tool_c", 0), 90);
}
