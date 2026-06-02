use std::path::PathBuf;

#[path = "integration/mod.rs"]
mod integration;

use integration::test_helpers::TestDaemon;
use serde_json::json;

#[tokio::test]
async fn test_health_endpoint() {
    let daemon = TestDaemon::start().await;

    let response = daemon.get("/health").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["ok"], true);
    assert!(body["version"].is_string());
}

#[tokio::test]
async fn test_create_project() {
    let daemon = TestDaemon::start().await;

    // Use daemon's temp directory for project path
    let project_path = daemon.temp_dir.join("test-project");
    std::fs::create_dir_all(&project_path).unwrap();

    let project = json!({
        "name": "test-project",
        "path": project_path.to_str().unwrap(),
        "description": "Test project",
        "tags": ["rust", "test"]
    });

    let response = daemon.post("/api/v1/projects", project).await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["id"].is_string());
    assert_eq!(body["name"], "test-project");
}

#[tokio::test]
async fn test_list_projects() {
    let daemon = TestDaemon::start().await;

    // Create a project first
    let project_path = daemon.temp_dir.join("test-project");
    std::fs::create_dir_all(&project_path).unwrap();

    let project = json!({
        "name": "test-project",
        "path": project_path.to_str().unwrap()
    });
    daemon.post("/api/v1/projects", project).await.unwrap();

    // List projects
    let response = daemon.get("/api/v1/projects").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["projects"].is_array());
    assert!(body["projects"].as_array().unwrap().len() > 0);
    assert_eq!(body["total"], 1);
}

#[tokio::test]
async fn test_get_project() {
    let daemon = TestDaemon::start().await;

    // Create a project
    let project_path = daemon.temp_dir.join("test-project");
    std::fs::create_dir_all(&project_path).unwrap();

    let project = json!({
        "name": "test-project",
        "path": project_path.to_str().unwrap()
    });
    let create_response = daemon.post("/api/v1/projects", project).await.unwrap();
    let created: serde_json::Value = create_response.json().await.unwrap();
    let project_id = created["id"].as_str().unwrap();

    // Get the project
    let response = daemon.get(&format!("/api/v1/projects/{}", project_id)).await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["id"], project_id);
    assert_eq!(body["name"], "test-project");
}

#[tokio::test]
async fn test_update_project() {
    let daemon = TestDaemon::start().await;

    // Create a project
    let project_path = daemon.temp_dir.join("test-project");
    std::fs::create_dir_all(&project_path).unwrap();

    let project = json!({
        "name": "test-project",
        "path": project_path.to_str().unwrap()
    });
    let create_response = daemon.post("/api/v1/projects", project).await.unwrap();
    let created: serde_json::Value = create_response.json().await.unwrap();
    let project_id = created["id"].as_str().unwrap();

    // Update the project
    let update = json!({
        "name": "updated-project",
        "description": "Updated description"
    });
    let response = daemon.put(&format!("/api/v1/projects/{}", project_id), update).await.unwrap();
    assert_eq!(response.status(), 200);

    // Verify update
    let get_response = daemon.get(&format!("/api/v1/projects/{}", project_id)).await.unwrap();
    let body: serde_json::Value = get_response.json().await.unwrap();
    assert_eq!(body["name"], "updated-project");
    assert_eq!(body["description"], "Updated description");
}

#[tokio::test]
async fn test_delete_project() {
    let daemon = TestDaemon::start().await;

    // Create a project
    let project_path = daemon.temp_dir.join("test-project");
    std::fs::create_dir_all(&project_path).unwrap();

    let project = json!({
        "name": "test-project",
        "path": project_path.to_str().unwrap()
    });
    let create_response = daemon.post("/api/v1/projects", project).await.unwrap();
    let created: serde_json::Value = create_response.json().await.unwrap();
    let project_id = created["id"].as_str().unwrap();

    // Delete the project
    let response = daemon.delete(&format!("/api/v1/projects/{}", project_id)).await.unwrap();
    assert_eq!(response.status(), 200);

    // Verify deletion
    let get_response = daemon.get(&format!("/api/v1/projects/{}", project_id)).await.unwrap();
    assert_eq!(get_response.status(), 404);
}

#[tokio::test]
async fn test_activate_project() {
    let daemon = TestDaemon::start().await;

    // Create a project
    let project_path = daemon.temp_dir.join("test-project");
    std::fs::create_dir_all(&project_path).unwrap();

    let project = json!({
        "name": "test-project",
        "path": project_path.to_str().unwrap()
    });
    let create_response = daemon.post("/api/v1/projects", project).await.unwrap();
    let created: serde_json::Value = create_response.json().await.unwrap();
    let project_id = created["id"].as_str().unwrap();

    // Activate the project
    let response = daemon.post(&format!("/api/v1/projects/{}/activate", project_id), json!({})).await.unwrap();
    assert_eq!(response.status(), 200);
}

#[tokio::test]
async fn test_get_project_status() {
    let daemon = TestDaemon::start().await;

    // Create a project
    let project_path = daemon.temp_dir.join("test-project");
    std::fs::create_dir_all(&project_path).unwrap();

    let project = json!({
        "name": "test-project",
        "path": project_path.to_str().unwrap()
    });
    let create_response = daemon.post("/api/v1/projects", project).await.unwrap();
    let created: serde_json::Value = create_response.json().await.unwrap();
    let project_id = created["id"].as_str().unwrap();

    // Get project status
    let response = daemon.get(&format!("/api/v1/projects/{}/status", project_id)).await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["health"].is_object());
    assert!(body["stats"].is_object());
}
