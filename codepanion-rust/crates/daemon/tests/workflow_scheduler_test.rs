use std::path::PathBuf;

#[path = "integration/mod.rs"]
mod integration;

use integration::test_helpers::TestDaemon;
use serde_json::json;

// ============================================================================
// Workflow API Tests (Legacy endpoints)
// ============================================================================

#[tokio::test]
async fn test_get_workflow_board() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/workflow/board").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    // Board should return workflow definitions
    assert!(body.is_object() || body.is_array());
}

#[tokio::test]
async fn test_get_workflow_runs() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/workflow/runs").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body.is_array() || body.is_object());
}

#[tokio::test]
async fn test_get_workflow_gates() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/workflow/gates").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body.is_array() || body.is_object());
}

// ============================================================================
// Scheduler API Tests
// ============================================================================

#[tokio::test]
async fn test_list_all_runs() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/api/v1/scheduler/runs").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    // Response should have runs array
    assert!(body.is_object());
    assert!(body["runs"].is_array());
}

#[tokio::test]
async fn test_list_queued_runs() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/api/v1/scheduler/runs/queued").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["runs"].is_array());
}

#[tokio::test]
async fn test_list_running_runs() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/api/v1/scheduler/runs/running").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["runs"].is_array());
}

#[tokio::test]
async fn test_list_completed_runs() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/api/v1/scheduler/runs/completed").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["runs"].is_array());
}

#[tokio::test]
async fn test_get_scheduler_stats() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/api/v1/scheduler/stats").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    // Stats should be an object
    assert!(body.is_object());
}

// ============================================================================
// Global View API Tests
// ============================================================================

#[tokio::test]
async fn test_get_global_runs() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/api/v1/global/runs").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["runs"].is_array());
}

#[tokio::test]
async fn test_get_global_stats() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/api/v1/global/stats").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["totalProjects"].is_number() || body["total_projects"].is_number());
}

// ============================================================================
// Orchestrator API Tests
// ============================================================================

#[tokio::test]
async fn test_list_workflows() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/api/v1/orchestrator/workflows").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["workflows"].is_array() || body.is_array());
}
