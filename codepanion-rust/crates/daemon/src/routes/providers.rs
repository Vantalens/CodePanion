use crate::AppState;
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use codepanion_workflow_engine::{
    ModelInfo, ModelProvider, ProviderCapability, ProviderConfig, ProviderRegistry, ProviderStatus,
    ProviderType,
};
use serde::{Deserialize, Serialize};

/// Current timestamp in milliseconds
fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

// ============================================================================
// Request Types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProviderRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: ProviderType,
    pub config: ProviderConfig,
    #[serde(default)]
    pub models: Vec<ModelInfo>,
    #[serde(default)]
    pub capabilities: Vec<ProviderCapability>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProviderRequest {
    pub name: Option<String>,
    pub config: Option<ProviderConfig>,
    pub models: Option<Vec<ModelInfo>>,
    pub capabilities: Option<Vec<ProviderCapability>>,
    pub status: Option<ProviderStatus>,
}

#[derive(Debug, Deserialize)]
pub struct ListProvidersQuery {
    #[serde(rename = "type")]
    pub provider_type: Option<String>,
    pub status: Option<String>,
}

// ============================================================================
// Response Types
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProvidersResponse {
    pub providers: Vec<ModelProvider>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResponse {
    pub success: bool,
    pub latency: u64,
    pub models: Vec<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteResponse {
    pub success: bool,
}

// ============================================================================
// Error Response (OpenAI style)
// ============================================================================

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub message: String,
    #[serde(rename = "type")]
    pub error_type: String,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub param: Option<String>,
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> Response {
        let status = match self.error.error_type.as_str() {
            "not_found_error" => StatusCode::NOT_FOUND,
            "invalid_request_error" => StatusCode::BAD_REQUEST,
            "authentication_error" => StatusCode::UNAUTHORIZED,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(self)).into_response()
    }
}

impl ErrorResponse {
    fn not_found(message: String, param: Option<String>) -> Self {
        Self {
            error: ErrorDetail {
                message,
                error_type: "not_found_error".to_string(),
                code: "provider_not_found".to_string(),
                param,
            },
        }
    }

    fn invalid_request(message: String, param: Option<String>) -> Self {
        Self {
            error: ErrorDetail {
                message,
                error_type: "invalid_request_error".to_string(),
                code: "invalid_request".to_string(),
                param,
            },
        }
    }


    fn internal_error(message: String) -> Self {
        Self {
            error: ErrorDetail {
                message,
                error_type: "internal_error".to_string(),
                code: "internal_error".to_string(),
                param: None,
            },
        }
    }
}

// ============================================================================
// Route Handlers
// ============================================================================

/// POST /api/v1/providers - Create a new provider
pub async fn create_provider(
    State(state): State<AppState>,
    Json(req): Json<CreateProviderRequest>,
) -> Result<Json<ModelProvider>, ErrorResponse> {
    // Validate API key
    if req.config.api_key.trim().is_empty() {
        return Err(ErrorResponse::invalid_request(
            "API key is required".to_string(),
            Some("apiKey".to_string()),
        ));
    }

    // Create provider
    let provider = ModelProvider {
        id: ProviderRegistry::generate_id(&req.name),
        name: req.name,
        provider_type: req.provider_type,
        config: req.config,
        models: req.models,
        capabilities: req.capabilities,
        status: ProviderStatus::Active,
        last_tested: None,
        created_at: current_timestamp(),
    };

    state.provider_registry
        .upsert(provider.clone())
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to create provider: {}", e)))?;

    Ok(Json(provider))
}

/// GET /api/v1/providers - List all providers
pub async fn list_providers(
    State(state): State<AppState>,
    Query(query): Query<ListProvidersQuery>,
) -> Result<Json<ListProvidersResponse>, ErrorResponse> {
    let mut providers = state.provider_registry
        .list()
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to list providers: {}", e)))?;

    // Filter by type
    if let Some(provider_type) = query.provider_type {
        let type_lower = provider_type.to_lowercase();
        providers.retain(|p| format!("{:?}", p.provider_type).to_lowercase() == type_lower);
    }

    // Filter by status
    if let Some(status) = query.status {
        let status_lower = status.to_lowercase();
        providers.retain(|p| format!("{:?}", p.status).to_lowercase() == status_lower);
    }

    let total = providers.len();
    Ok(Json(ListProvidersResponse { providers, total }))
}

/// GET /api/v1/providers/:id - Get a single provider
pub async fn get_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ModelProvider>, ErrorResponse> {
    let provider = state.provider_registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get provider: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("Provider {} not found", id), Some("id".to_string()))
        })?;

    Ok(Json(provider))
}

/// PUT /api/v1/providers/:id - Update a provider
pub async fn update_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateProviderRequest>,
) -> Result<Json<ModelProvider>, ErrorResponse> {
    let mut provider = state.provider_registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get provider: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("Provider {} not found", id), Some("id".to_string()))
        })?;

    // Update fields
    if let Some(name) = req.name {
        provider.name = name;
    }
    if let Some(config) = req.config {
        provider.config = config;
    }
    if let Some(models) = req.models {
        provider.models = models;
    }
    if let Some(capabilities) = req.capabilities {
        provider.capabilities = capabilities;
    }
    if let Some(status) = req.status {
        provider.status = status;
    }

    state.provider_registry
        .upsert(provider.clone())
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to update provider: {}", e)))?;

    Ok(Json(provider))
}

/// DELETE /api/v1/providers/:id - Delete a provider
pub async fn delete_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DeleteResponse>, ErrorResponse> {
    let success = state.provider_registry
        .remove(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to delete provider: {}", e)))?;

    Ok(Json(DeleteResponse { success }))
}

/// POST /api/v1/providers/:id/test - Test provider connection
pub async fn test_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TestConnectionResponse>, ErrorResponse> {
    let provider = state.provider_registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get provider: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("Provider {} not found", id), Some("id".to_string()))
        })?;

    // TODO: Implement actual connection test
    // For now, just return a mock response
    let start = std::time::Instant::now();

    // Simulate API call delay
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let latency = start.elapsed().as_millis() as u64;

    // Update last_tested timestamp
    state.provider_registry
        .touch(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to update provider: {}", e)))?;

    // Extract model IDs
    let models: Vec<String> = provider.models.iter().map(|m| m.id.clone()).collect();

    Ok(Json(TestConnectionResponse {
        success: true,
        latency,
        models,
        message: "Connection successful".to_string(),
    }))
}

/// GET /api/v1/providers/:id/models - List provider models
pub async fn list_provider_models(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<ModelInfo>>, ErrorResponse> {
    let provider = state.provider_registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get provider: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("Provider {} not found", id), Some("id".to_string()))
        })?;

    Ok(Json(provider.models))
}

/// POST /api/v1/providers/:id/activate - Activate a provider
pub async fn activate_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ModelProvider>, ErrorResponse> {
    // Verify provider exists
    let provider = state
        .provider_registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get provider: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(
                format!("Provider {} not found", id),
                Some("id".to_string()),
            )
        })?;

    // Set as active provider
    state
        .global_config
        .set_active_provider(&id)
        .map_err(|e| {
            ErrorResponse::internal_error(format!("Failed to activate provider: {}", e))
        })?;

    Ok(Json(provider))
}

/// GET /api/v1/providers/active - Get active provider
pub async fn get_active_provider(
    State(state): State<AppState>,
) -> Result<Json<ModelProvider>, ErrorResponse> {
    let active_id = state
        .global_config
        .get_active_provider()
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get active provider: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(
                "No active provider set".to_string(),
                Some("activeProviderId".to_string()),
            )
        })?;

    let provider = state
        .provider_registry
        .get(&active_id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get provider: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(
                format!("Active provider {} not found", active_id),
                Some("id".to_string()),
            )
        })?;

    Ok(Json(provider))
}

/// GET /v1/models - List all models from all providers (OpenAI compatible)
#[derive(Debug, Serialize)]
pub struct ModelListResponse {
    pub object: String,
    pub data: Vec<ModelObject>,
}

#[derive(Debug, Serialize)]
pub struct ModelObject {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub owned_by: String,
}

pub async fn list_all_models(
    State(state): State<AppState>,
) -> Result<Json<ModelListResponse>, ErrorResponse> {
    let providers = state
        .provider_registry
        .list()
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to list providers: {}", e)))?;

    let mut models = Vec::new();

    for provider in providers {
        for model in provider.models {
            models.push(ModelObject {
                id: model.id,
                object: "model".to_string(),
                created: provider.created_at / 1000, // Convert to seconds
                owned_by: provider.name.clone(),
            });
        }
    }

    Ok(Json(ModelListResponse {
        object: "list".to_string(),
        data: models,
    }))
}

/// POST /api/v1/config/import - Import configuration from CC Switch or Claude Code
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportConfigRequest {
    pub source: String, // "ccm" or "claude"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

pub async fn import_config(
    State(state): State<AppState>,
    Json(req): Json<ImportConfigRequest>,
) -> Result<Json<codepanion_workflow_engine::ImportResult>, ErrorResponse> {
    use codepanion_workflow_engine::{import_ccm_config, import_claude_settings};
    use std::path::PathBuf;

    let result = match req.source.as_str() {
        "ccm" => {
            let path = if let Some(p) = req.file_path {
                PathBuf::from(p)
            } else {
                dirs::home_dir()
                    .ok_or_else(|| {
                        ErrorResponse::internal_error("Failed to determine home directory".to_string())
                    })?
                    .join(".ccm_config")
            };

            let (providers, global_config) = import_ccm_config(&path).map_err(|e| {
                ErrorResponse::invalid_request(format!("Failed to import CC Switch config: {}", e), None)
            })?;

            // Save global config
            state.global_config.save(&global_config).map_err(|e| {
                ErrorResponse::internal_error(format!("Failed to save global config: {}", e))
            })?;

            // TODO: Save providers to registry (need provider ID generation)
            codepanion_workflow_engine::ImportResult {
                providers_imported: providers.len(),
                aliases_imported: global_config.model_aliases.len(),
                env_vars_imported: global_config.env.len(),
                active_provider: global_config.active_provider_id,
            }
        }
        "claude" => {
            let path = if let Some(p) = req.file_path {
                PathBuf::from(p)
            } else {
                dirs::home_dir()
                    .ok_or_else(|| {
                        ErrorResponse::internal_error("Failed to determine home directory".to_string())
                    })?
                    .join(".claude")
                    .join("settings.json")
            };

            let global_config = import_claude_settings(&path).map_err(|e| {
                ErrorResponse::invalid_request(format!("Failed to import Claude Code settings: {}", e), None)
            })?;

            let aliases_count = global_config.model_aliases.len();
            let env_count = global_config.env.len();

            // Merge with existing config
            let mut existing = state.global_config.load().map_err(|e| {
                ErrorResponse::internal_error(format!("Failed to load global config: {}", e))
            })?;

            existing.model_aliases.extend(global_config.model_aliases);
            existing.env.extend(global_config.env);
            if global_config.default_model.is_some() {
                existing.default_model = global_config.default_model;
            }
            if !global_config.available_models.is_empty() {
                existing.available_models = global_config.available_models;
            }
            if global_config.effort_level.is_some() {
                existing.effort_level = global_config.effort_level;
            }

            state.global_config.save(&existing).map_err(|e| {
                ErrorResponse::internal_error(format!("Failed to save global config: {}", e))
            })?;

            codepanion_workflow_engine::ImportResult {
                providers_imported: 0,
                aliases_imported: aliases_count,
                env_vars_imported: env_count,
                active_provider: None,
            }
        }
        "auto" => {
            codepanion_workflow_engine::auto_import().map_err(|e| {
                ErrorResponse::internal_error(format!("Failed to auto-import: {}", e))
            })?
        }
        _ => {
            return Err(ErrorResponse::invalid_request(
                format!(
                    "Invalid source: {}. Must be 'ccm', 'claude', or 'auto'",
                    req.source
                ),
                Some("source".to_string()),
            ));
        }
    };

    Ok(Json(result))
}


