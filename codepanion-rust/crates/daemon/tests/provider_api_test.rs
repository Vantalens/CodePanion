use std::path::PathBuf;

#[path = "integration/mod.rs"]
mod integration;

use integration::test_helpers::TestDaemon;
use serde_json::json;

// ============================================================================
// Provider API Tests
// ============================================================================

#[tokio::test]
async fn test_create_provider() {
    let daemon = TestDaemon::start().await;

    let provider = json!({
        "id": "deepseek-test",
        "name": "DeepSeek Test",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-chat"
        }
    });

    let response = daemon.post("/api/v1/providers", provider).await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["id"], "deepseek-test");
    assert_eq!(body["name"], "DeepSeek Test");
}

#[tokio::test]
async fn test_list_providers() {
    let daemon = TestDaemon::start().await;

    // Create a provider first
    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": "https://api.example.com"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    // List providers
    let response = daemon.get("/api/v1/providers").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["providers"].is_array());
    assert!(body["providers"].as_array().unwrap().len() > 0);
}

#[tokio::test]
async fn test_get_provider() {
    let daemon = TestDaemon::start().await;

    // Create a provider
    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    // Get the provider
    let response = daemon.get("/api/v1/providers/test-provider").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["id"], "test-provider");
    assert_eq!(body["name"], "Test Provider");
}

#[tokio::test]
async fn test_update_provider() {
    let daemon = TestDaemon::start().await;

    // Create a provider
    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    // Update the provider
    let update = json!({
        "name": "Updated Provider",
        "config": {
            "apiKey": "sk-updated"
        }
    });
    let response = daemon.put("/api/v1/providers/test-provider", update).await.unwrap();
    assert_eq!(response.status(), 200);

    // Verify update
    let get_response = daemon.get("/api/v1/providers/test-provider").await.unwrap();
    let body: serde_json::Value = get_response.json().await.unwrap();
    assert_eq!(body["name"], "Updated Provider");
}

#[tokio::test]
async fn test_delete_provider() {
    let daemon = TestDaemon::start().await;

    // Create a provider
    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    // Delete the provider
    let response = daemon.delete("/api/v1/providers/test-provider").await.unwrap();
    assert_eq!(response.status(), 200);

    // Verify deletion
    let get_response = daemon.get("/api/v1/providers/test-provider").await.unwrap();
    assert_eq!(get_response.status(), 404);
}

#[tokio::test]
async fn test_activate_provider() {
    let daemon = TestDaemon::start().await;

    // Create a provider
    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    // Activate the provider
    let response = daemon.post("/api/v1/providers/test-provider/activate", json!({})).await.unwrap();
    assert_eq!(response.status(), 200);

    // Verify it's active
    let active_response = daemon.get("/api/v1/providers/active").await.unwrap();
    assert_eq!(active_response.status(), 200);
    let active_body: serde_json::Value = active_response.json().await.unwrap();
    assert_eq!(active_body["id"], "test-provider");
}

#[tokio::test]
async fn test_list_all_models() {
    let daemon = TestDaemon::start().await;

    // Create a provider with models
    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test"
        },
        "models": [
            {"id": "model-1", "name": "Model 1"},
            {"id": "model-2", "name": "Model 2"}
        ]
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    // List all models (OpenAI-compatible endpoint)
    let response = daemon.get("/v1/models").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["data"].is_array());
}
