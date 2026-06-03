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
    let _workflow_def = json!({
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

    let response = daemon
        .post("/api/v1/scheduler/enqueue", enqueue_request)
        .await
        .unwrap();
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

    #[cfg(target_os = "windows")]
    let (command, args) = ("cmd", vec!["/C", "echo artifact-ready"]);
    #[cfg(not(target_os = "windows"))]
    let (command, args) = ("echo", vec!["artifact-ready"]);

    let execute_request = json!({
        "projectId": "test-project",
        "workflow": {
            "name": "test-artifact-workflow",
            "description": "artifact workflow",
            "params": {},
            "steps": [
                {
                    "id": "build",
                    "architecture": "shell",
                    "command": command,
                    "args": args,
                    "artifacts": ["patch-summary"]
                }
            ],
            "createdAt": 0,
            "updatedAt": 0
        }
    });

    let response = daemon
        .post("/api/v1/workflows/execute", execute_request)
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    let run_id = body["runId"].as_str().unwrap();

    wait_for_run_detail(&daemon, run_id).await;

    let artifacts_response = daemon
        .get(&format!("/workflow/runs/{}/artifacts", run_id))
        .await
        .unwrap();
    assert_eq!(artifacts_response.status(), 200);
    let artifacts: serde_json::Value = artifacts_response.json().await.unwrap();
    let items = artifacts["artifacts"].as_array().unwrap();
    assert!(items.iter().any(|item| item["type"] == "patch-summary"));
    assert!(items.iter().any(|item| item["type"] == "delivery-note"));

    let delivery_response = daemon
        .get(&format!(
            "/workflow/runs/{}/delivery?format=handoff",
            run_id
        ))
        .await
        .unwrap();
    assert_eq!(delivery_response.status(), 200);
    let delivery: serde_json::Value = delivery_response.json().await.unwrap();
    assert_eq!(delivery["format"], "handoff");
    assert!(
        delivery["content"]
            .as_str()
            .unwrap()
            .contains("Please continue this workflow")
    );
}

/// Test workflow gate resolution
#[tokio::test]
async fn test_workflow_gate_resolution() {
    let daemon = TestDaemon::start().await;

    let execute_request = json!({
        "projectId": "test-project",
        "workflow": {
            "name": "test-gate-workflow",
            "description": "gate workflow",
            "params": {},
            "steps": [
                {
                    "id": "review",
                    "architecture": "shell",
                    "command": "echo",
                    "args": ["review"],
                    "checkpoint": true
                }
            ],
            "createdAt": 0,
            "updatedAt": 0
        }
    });

    let response = daemon
        .post("/api/v1/workflows/execute", execute_request)
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    let run_id = body["runId"].as_str().unwrap();

    wait_for_run_detail(&daemon, run_id).await;

    let gates_response = daemon.get("/workflow/gates").await.unwrap();
    assert_eq!(gates_response.status(), 200);
    let gates_data: serde_json::Value = gates_response.json().await.unwrap();
    let gates = gates_data["gates"].as_array().unwrap();
    assert!(gates.iter().any(|gate| gate["runId"] == run_id));

    let resolve_response = daemon
        .post(
            &format!("/workflow/gates/{}/review/resolve", run_id),
            json!({
                "decision": "approve",
                "message": "Looks good",
                "constraints": ["keep docs updated"]
            }),
        )
        .await
        .unwrap();
    assert_eq!(resolve_response.status(), 200);
    let resolved: serde_json::Value = resolve_response.json().await.unwrap();
    assert_eq!(resolved["shouldResume"], true);

    let artifacts_response = daemon
        .get(&format!("/workflow/runs/{}/artifacts", run_id))
        .await
        .unwrap();
    let artifacts: serde_json::Value = artifacts_response.json().await.unwrap();
    assert!(
        artifacts["artifacts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| {
                item["type"] == "human-decision"
                    && item["content"]
                        .as_str()
                        .unwrap()
                        .contains("decision=approve")
            })
    );

    let history_response = daemon
        .get(&format!("/api/v1/workflow/gates/{}/review/history", run_id))
        .await
        .unwrap();
    assert_eq!(history_response.status(), 200);
    let history: serde_json::Value = history_response.json().await.unwrap();
    let decisions = history["history"].as_array().unwrap();
    assert!(decisions.iter().any(|item| {
        item["type"] == "human-decision"
            && item["stepId"] == "review"
            && item["content"]
                .as_str()
                .unwrap()
                .contains("decision=approve")
    }));
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

async fn wait_for_run_detail(daemon: &TestDaemon, run_id: &str) -> serde_json::Value {
    for _ in 0..30 {
        let response = daemon
            .get(&format!("/workflow/runs/{}", run_id))
            .await
            .unwrap();
        if response.status() == 200 {
            return response.json().await.unwrap();
        }
        sleep(Duration::from_millis(100)).await;
    }

    panic!("run detail did not become available for {}", run_id);
}
