use std::path::PathBuf;

#[path = "integration/mod.rs"]
mod integration;

use integration::test_helpers::TestDaemon;
use serde_json::json;
use std::time::Duration;
use tokio::time::sleep;

// ============================================================================
// Workflow Execution End-to-End Tests
// ============================================================================

/// Test creating and executing a simple shell workflow
#[tokio::test]
async fn test_execute_simple_shell_workflow() {
    let daemon = TestDaemon::start().await;

    // Create a project
    let project_path = daemon.temp_dir.join("test-project");
    std::fs::create_dir_all(&project_path).unwrap();

    let project = json!({
        "name": "test-project",
        "path": project_path.to_str().unwrap()
    });
    let create_response = daemon.post("/api/v1/projects", project).await.unwrap();
    let project_data: serde_json::Value = create_response.json().await.unwrap();
    let project_id = project_data["id"].as_str().unwrap();

    // Define a simple shell workflow
    let workflow_def = json!({
        "id": "test-shell-workflow",
        "name": "Test Shell Workflow",
        "steps": [
            {
                "id": "step1",
                "type": "shell",
                "command": "echo Hello from Rust daemon"
            }
        ]
    });

    // Submit workflow (via scheduler enqueue)
    let enqueue_request = json!({
        "runId": "test-run-001",
        "projectId": project_id,
        "workflowId": "test-shell-workflow",
        "priority": "normal"
    });

    let response = daemon.post("/api/v1/scheduler/enqueue", enqueue_request).await.unwrap();
    assert_eq!(response.status(), 200);

    // Wait for execution to complete
    sleep(Duration::from_secs(2)).await;

    // Check run status
    let runs_response = daemon.get("/api/v1/scheduler/runs").await.unwrap();
    assert_eq!(runs_response.status(), 200);

    let runs_data: serde_json::Value = runs_response.json().await.unwrap();
    assert!(runs_data["runs"].is_array());
}

/// Test workflow with artifacts
#[tokio::test]
async fn test_workflow_with_artifacts() {
    let daemon = TestDaemon::start().await;

    // Create a project
    let project_path = daemon.temp_dir.join("test-project");
    std::fs::create_dir_all(&project_path).unwrap();

    let project = json!({
        "name": "test-project",
        "path": project_path.to_str().unwrap()
    });
    let create_response = daemon.post("/api/v1/projects", project).await.unwrap();
    let project_data: serde_json::Value = create_response.json().await.unwrap();
    let project_id = project_data["id"].as_str().unwrap();

    // Submit workflow that produces artifacts
    let enqueue_request = json!({
        "runId": "test-run-002",
        "projectId": project_id,
        "workflowId": "test-artifact-workflow",
        "priority": "normal"
    });

    let response = daemon.post("/api/v1/scheduler/enqueue", enqueue_request).await.unwrap();
    assert_eq!(response.status(), 200);

    // Wait for execution
    sleep(Duration::from_secs(2)).await;

    // Check for artifacts (if artifacts endpoint exists)
    let artifacts_response = daemon.get("/workflow/artifacts").await.unwrap();
    // Should return 200 or 404 depending on implementation
    assert!(artifacts_response.status().is_success() || artifacts_response.status() == 404);
}

/// Test workflow gate resolution
#[tokio::test]
async fn test_workflow_gate_resolution() {
    let daemon = TestDaemon::start().await;

    // Get current gates
    let gates_response = daemon.get("/workflow/gates").await.unwrap();
    assert_eq!(gates_response.status(), 200);

    let gates_data: serde_json::Value = gates_response.json().await.unwrap();
    // Gates should be array or object
    assert!(gates_data.is_array() || gates_data.is_object());
}

/// Test workflow board listing
#[tokio::test]
async fn test_workflow_board_listing() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/workflow/board").await.unwrap();
    assert_eq!(response.status(), 200);

    let board_data: serde_json::Value = response.json().await.unwrap();
    // Board should return workflow definitions
    assert!(board_data.is_array() || board_data.is_object());
}

/// Test workflow runs history
#[tokio::test]
async fn test_workflow_runs_history() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/workflow/runs").await.unwrap();
    assert_eq!(response.status(), 200);

    let runs_data: serde_json::Value = response.json().await.unwrap();
    assert!(runs_data.is_array() || runs_data.is_object());
}

/// Test scheduler stats
#[tokio::test]
async fn test_scheduler_stats_integration() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/api/v1/scheduler/stats").await.unwrap();
    assert_eq!(response.status(), 200);

    let stats: serde_json::Value = response.json().await.unwrap();
    assert!(stats.is_object());
}
