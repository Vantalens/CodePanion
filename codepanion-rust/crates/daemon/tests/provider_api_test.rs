#[path = "integration/mod.rs"]
mod integration;

use integration::test_helpers::{TestDaemon, start_openai_models_server};
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
    assert_eq!(body["config"]["apiKey"], "[redacted]");
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
    assert!(!body["providers"].as_array().unwrap().is_empty());
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
        "type": "deepseek",
        "config": {
            "apiKey": "sk-updated",
            "baseUrl": "https://api.deepseek.com",
            "defaultModel": "deepseek-chat"
        }
    });
    let response = daemon
        .put("/api/v1/providers/test-provider", update)
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let updated: serde_json::Value = response.json().await.unwrap();
    assert_eq!(updated["type"], "deepseek");
    assert_eq!(updated["config"]["defaultModel"], "deepseek-chat");

    // Verify update
    let get_response = daemon.get("/api/v1/providers/test-provider").await.unwrap();
    let body: serde_json::Value = get_response.json().await.unwrap();
    assert_eq!(body["name"], "Updated Provider");
    assert_eq!(body["type"], "deepseek");
}

#[tokio::test]
async fn test_update_provider_type_resets_default_config_without_config_patch() {
    let daemon = TestDaemon::start().await;

    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": "https://api.openai.com/v1",
            "defaultModel": "gpt-4o-mini"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    let response = daemon
        .put(
            "/api/v1/providers/test-provider",
            json!({
                "name": "Test Provider",
                "type": "deepseek"
            }),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let updated: serde_json::Value = response.json().await.unwrap();
    assert_eq!(updated["type"], "deepseek");
    assert_eq!(updated["config"]["baseUrl"], "https://api.deepseek.com");
    assert_eq!(updated["config"]["defaultModel"], "deepseek-chat");
    assert_eq!(updated["config"]["apiKey"], "[redacted]");
}

#[tokio::test]
async fn test_update_provider_type_resets_unspecified_defaults_with_api_key_patch() {
    let daemon = TestDaemon::start().await;

    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": "https://api.openai.com/v1",
            "defaultModel": "gpt-4o-mini"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    let response = daemon
        .put(
            "/api/v1/providers/test-provider",
            json!({
                "name": "Test Provider",
                "type": "deepseek",
                "config": {
                    "apiKey": "sk-new"
                }
            }),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let updated: serde_json::Value = response.json().await.unwrap();
    assert_eq!(updated["type"], "deepseek");
    assert_eq!(updated["config"]["apiKey"], "[redacted]");
    assert_eq!(updated["config"]["baseUrl"], "https://api.deepseek.com");
    assert_eq!(updated["config"]["defaultModel"], "deepseek-chat");
}

#[tokio::test]
async fn test_update_provider_type_treats_empty_api_base_as_unspecified() {
    let daemon = TestDaemon::start().await;

    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": "https://api.openai.com/v1",
            "defaultModel": "gpt-4o-mini"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    let response = daemon
        .put(
            "/api/v1/providers/test-provider",
            json!({
                "name": "Test Provider",
                "type": "deepseek",
                "config": {
                    "apiKey": "sk-new",
                    "baseUrl": ""
                }
            }),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let updated: serde_json::Value = response.json().await.unwrap();
    assert_eq!(updated["type"], "deepseek");
    assert_eq!(updated["config"]["apiKey"], "[redacted]");
    assert_eq!(updated["config"]["baseUrl"], "https://api.deepseek.com");
    assert_eq!(updated["config"]["defaultModel"], "deepseek-chat");
}

#[tokio::test]
async fn test_provider_responses_do_not_expose_api_keys() {
    let daemon = TestDaemon::start().await;

    let provider = json!({
        "id": "secret-provider",
        "name": "Secret Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-secret",
            "baseUrl": "http://127.0.0.1:1/v1"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    let get_response = daemon
        .get("/api/v1/providers/secret-provider")
        .await
        .unwrap();
    assert_eq!(get_response.status(), 200);
    let body: serde_json::Value = get_response.json().await.unwrap();
    assert_eq!(body["config"]["apiKey"], "[redacted]");

    let list_response = daemon.get("/api/v1/providers").await.unwrap();
    assert_eq!(list_response.status(), 200);
    let list: serde_json::Value = list_response.json().await.unwrap();
    assert_eq!(list["providers"][0]["config"]["apiKey"], "[redacted]");
}

#[tokio::test]
async fn test_provider_connection_test_uses_models_endpoint() {
    let daemon = TestDaemon::start().await;
    let model_server = start_openai_models_server(vec!["model-a", "model-b"]).await;

    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": model_server,
            "defaultModel": "model-a"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    let response = daemon
        .post("/api/v1/providers/test-provider/test", json!({}))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["success"], true);
    assert_eq!(body["models"][0], "model-a");
    assert_eq!(body["models"][1], "model-b");
}

#[tokio::test]
async fn test_provider_connection_test_reports_unreachable_provider() {
    let daemon = TestDaemon::start().await;

    let provider = json!({
        "id": "bad-provider",
        "name": "Bad Provider",
        "type": "custom",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": "http://127.0.0.1:1/v1",
            "defaultModel": "missing"
        }
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    let response = daemon
        .post("/api/v1/providers/bad-provider/test", json!({}))
        .await
        .unwrap();
    assert_eq!(response.status(), 502);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["error"]["code"], "provider_connection_failed");
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
    let response = daemon
        .delete("/api/v1/providers/test-provider")
        .await
        .unwrap();
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
    let response = daemon
        .post("/api/v1/providers/test-provider/activate", json!({}))
        .await
        .unwrap();
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

#[tokio::test]
async fn test_gui_models_include_saved_default_and_role_bindings() {
    let daemon = TestDaemon::start().await;

    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": "http://127.0.0.1:1/v1",
            "defaultModel": "provider-default"
        },
        "models": [
            {"id": "gpt-test", "name": "GPT Test"},
            {"id": "review-model", "name": "Review Model"}
        ]
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();
    let default_ref = "provider:test-provider:model:gpt-test";
    let review_ref = "provider:test-provider:model:review-model";
    daemon
        .post("/api/v1/models/default", json!({ "modelId": default_ref }))
        .await
        .unwrap();
    daemon
        .post(
            "/api/v1/models/role-binding",
            json!({ "role": "reviewer", "modelId": review_ref }),
        )
        .await
        .unwrap();

    let response = daemon.get("/api/v1/models").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    let models = body["models"].as_array().unwrap();
    assert!(models.len() >= 2);
    let gpt_test = models
        .iter()
        .find(|model| model["modelId"] == "gpt-test")
        .expect("gpt-test should be listed");
    assert_eq!(gpt_test["id"], default_ref);
    assert_eq!(gpt_test["providerId"], "test-provider");
    assert_eq!(body["defaultModel"], default_ref);
    assert_eq!(body["roleBindings"]["reviewer"], review_ref);
}

#[tokio::test]
async fn test_gui_models_normalize_legacy_model_selections() {
    let daemon = TestDaemon::start().await;

    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": "http://127.0.0.1:1/v1",
            "defaultModel": "provider-default"
        },
        "models": [
            {"id": "gpt-test", "name": "GPT Test"},
            {"id": "review-model", "name": "Review Model"}
        ]
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();
    daemon
        .post("/api/v1/providers/test-provider/activate", json!({}))
        .await
        .unwrap();
    daemon
        .post("/api/v1/models/default", json!({ "modelId": "gpt-test" }))
        .await
        .unwrap();
    daemon
        .post(
            "/api/v1/models/role-binding",
            json!({ "role": "reviewer", "modelId": "review-model" }),
        )
        .await
        .unwrap();

    let response = daemon.get("/api/v1/models").await.unwrap();
    assert_eq!(response.status(), 200);

    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(
        body["defaultModel"],
        "provider:test-provider:model:gpt-test"
    );
    assert_eq!(
        body["roleBindings"]["reviewer"],
        "provider:test-provider:model:review-model"
    );
}

#[tokio::test]
async fn test_rejects_provider_scoped_model_reference_for_missing_provider_model() {
    let daemon = TestDaemon::start().await;

    let provider = json!({
        "id": "test-provider",
        "name": "Test Provider",
        "type": "openai_compatible",
        "config": {
            "apiKey": "sk-test",
            "baseUrl": "http://127.0.0.1:1/v1",
            "defaultModel": "provider-default"
        },
        "models": [
            {"id": "gpt-test", "name": "GPT Test"}
        ]
    });
    daemon.post("/api/v1/providers", provider).await.unwrap();

    let response = daemon
        .post(
            "/api/v1/models/default",
            json!({ "modelId": "provider:test-provider:model:missing-model" }),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
}

#[tokio::test]
async fn test_model_alias_endpoint_persists_alias() {
    let daemon = TestDaemon::start().await;

    let response = daemon
        .post(
            "/api/v1/models/aliases",
            json!({ "alias": "fast", "modelId": "gpt-4o-mini" }),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let config_path = daemon.temp_dir.join("config.json");
    let config: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(config_path).unwrap()).unwrap();
    assert_eq!(config["modelAliases"]["fast"], "gpt-4o-mini");
}

#[tokio::test]
async fn test_model_alias_endpoint_rejects_empty_alias() {
    let daemon = TestDaemon::start().await;

    let response = daemon
        .post(
            "/api/v1/models/aliases",
            json!({ "alias": " ", "modelId": "gpt-4o-mini" }),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
}

#[tokio::test]
async fn test_delete_model_alias_endpoint_removes_alias() {
    let daemon = TestDaemon::start().await;

    daemon
        .post(
            "/api/v1/models/aliases",
            json!({ "alias": "fast", "modelId": "gpt-4o-mini" }),
        )
        .await
        .unwrap();

    let response = daemon.delete("/api/v1/models/aliases/fast").await.unwrap();
    assert_eq!(response.status(), 200);

    let config_path = daemon.temp_dir.join("config.json");
    let config: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(config_path).unwrap()).unwrap();
    assert!(config["modelAliases"]["fast"].is_null());
}

#[tokio::test]
async fn test_effort_endpoint_persists_supported_level() {
    let daemon = TestDaemon::start().await;

    let response = daemon
        .post("/api/v1/config/effort", json!({ "level": "high" }))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let config_path = daemon.temp_dir.join("config.json");
    let config: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(config_path).unwrap()).unwrap();
    assert_eq!(config["effortLevel"], "high");
}

#[tokio::test]
async fn test_effort_endpoint_rejects_unknown_level() {
    let daemon = TestDaemon::start().await;

    let response = daemon
        .post("/api/v1/config/effort", json!({ "level": "extreme" }))
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
}

#[tokio::test]
async fn test_ccm_import_persists_imported_providers() {
    let daemon = TestDaemon::start().await;
    let config_path = daemon.temp_dir.join(".ccm_config");
    std::fs::write(
        &config_path,
        r#"{
            "providers": {
                "deepseek": {
                    "type": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "api_key": "sk-imported",
                    "models": {
                        "default": "deepseek-chat",
                        "coder": "deepseek-coder"
                    }
                }
            },
            "active": "deepseek"
        }"#,
    )
    .unwrap();

    let response = daemon
        .post(
            "/api/v1/config/import",
            json!({
                "source": "ccm",
                "filePath": config_path.to_str().unwrap()
            }),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["providersImported"], 1);
    assert_eq!(body["activeProvider"], "deepseek");

    let provider_response = daemon.get("/api/v1/providers/deepseek").await.unwrap();
    assert_eq!(provider_response.status(), 200);
    let provider: serde_json::Value = provider_response.json().await.unwrap();
    assert_eq!(provider["type"], "deepseek");
    assert_eq!(provider["config"]["apiKey"], "[redacted]");
    assert_eq!(provider["config"]["defaultModel"], "deepseek-chat");
}
