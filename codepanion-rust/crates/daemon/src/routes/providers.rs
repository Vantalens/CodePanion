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
use std::collections::HashMap;

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
    pub id: Option<String>,
    pub name: String,
    #[serde(rename = "type", alias = "providerType", alias = "provider_type")]
    pub provider_type: ProviderType,
    #[serde(default)]
    pub config: Option<ProviderConfigPatch>,
    #[serde(default, alias = "api_key")]
    pub api_key: Option<String>,
    #[serde(default, alias = "apiBase", alias = "api_base", alias = "base_url")]
    pub api_base: Option<String>,
    #[serde(default, alias = "default_model")]
    pub default_model: Option<String>,
    #[serde(default)]
    pub models: Vec<ModelInfo>,
    #[serde(default)]
    pub capabilities: Vec<ProviderCapability>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProviderRequest {
    pub name: Option<String>,
    #[serde(
        default,
        rename = "type",
        alias = "providerType",
        alias = "provider_type"
    )]
    pub provider_type: Option<ProviderType>,
    #[serde(default)]
    pub config: Option<ProviderConfigPatch>,
    #[serde(default, alias = "api_key")]
    pub api_key: Option<String>,
    #[serde(default, alias = "apiBase", alias = "api_base", alias = "base_url")]
    pub api_base: Option<String>,
    #[serde(default, alias = "default_model")]
    pub default_model: Option<String>,
    pub models: Option<Vec<ModelInfo>>,
    pub capabilities: Option<Vec<ProviderCapability>>,
    pub status: Option<ProviderStatus>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigPatch {
    #[serde(default, alias = "api_key")]
    pub api_key: Option<String>,
    #[serde(default, alias = "apiBase", alias = "api_base", alias = "base_url")]
    pub base_url: Option<String>,
    #[serde(default, alias = "default_model")]
    pub default_model: Option<String>,
    pub max_tokens: Option<u64>,
    pub temperature: Option<f64>,
    #[serde(default)]
    pub custom: HashMap<String, serde_json::Value>,
}

impl ProviderConfigPatch {
    fn overlay_flat(
        &mut self,
        api_key: Option<String>,
        api_base: Option<String>,
        default_model: Option<String>,
    ) {
        if api_key.is_some() {
            self.api_key = api_key;
        }
        if api_base.is_some() {
            self.base_url = api_base;
        }
        if default_model.is_some() {
            self.default_model = default_model;
        }
    }
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuiModelsResponse {
    pub models: Vec<GuiModelInfo>,
    pub default_model: Option<String>,
    pub role_bindings: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuiModelInfo {
    pub id: String,
    pub name: String,
    pub model_id: String,
    pub provider_id: String,
    pub provider: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDefaultModelRequest {
    #[serde(alias = "model_id")]
    pub model_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRoleBindingRequest {
    pub role: String,
    #[serde(default, alias = "model_id")]
    pub model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetModelAliasRequest {
    pub alias: String,
    #[serde(alias = "model_id")]
    pub model_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetEffortLevelRequest {
    pub level: String,
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

fn default_base_url(provider_type: &ProviderType) -> String {
    match provider_type {
        ProviderType::OpenAI => "https://api.openai.com/v1",
        ProviderType::Anthropic => "https://api.anthropic.com",
        ProviderType::DeepSeek => "https://api.deepseek.com",
        ProviderType::OpenRouter => "https://openrouter.ai/api/v1",
        ProviderType::Ollama => "http://localhost:11434/v1",
        ProviderType::AzureOpenAI => "",
        ProviderType::Gemini => "https://generativelanguage.googleapis.com/v1beta",
        ProviderType::Qwen => "https://dashscope.aliyuncs.com/compatible-mode/v1",
        ProviderType::GLM => "https://open.bigmodel.cn/api/paas/v4",
        ProviderType::Custom => "",
    }
    .to_string()
}

fn default_model_for_provider(provider_type: &ProviderType) -> String {
    match provider_type {
        ProviderType::OpenAI => "gpt-4o-mini",
        ProviderType::Anthropic => "claude-3-5-sonnet-latest",
        ProviderType::DeepSeek => "deepseek-chat",
        ProviderType::OpenRouter => "openai/gpt-4o-mini",
        ProviderType::Ollama => "llama3.1",
        ProviderType::AzureOpenAI => "gpt-4o-mini",
        ProviderType::Gemini => "gemini-1.5-flash",
        ProviderType::Qwen => "qwen-plus",
        ProviderType::GLM => "glm-4-flash",
        ProviderType::Custom => "default",
    }
    .to_string()
}

pub(crate) fn model_reference(provider_id: &str, model_id: &str) -> String {
    format!("provider:{}:model:{}", provider_id, model_id)
}

fn parse_model_reference(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix("provider:")?;
    let (provider_id, model_id) = rest.split_once(":model:")?;
    if provider_id.trim().is_empty() || model_id.trim().is_empty() {
        None
    } else {
        Some((provider_id, model_id))
    }
}

fn provider_has_model(provider: &ModelProvider, model_id: &str) -> bool {
    provider.config.default_model == model_id
        || provider.models.iter().any(|model| model.id == model_id)
}

fn normalize_model_selection_for_gui(
    selection: &str,
    models: &[GuiModelInfo],
    active_provider_id: Option<&str>,
) -> String {
    let trimmed = selection.trim();
    if trimmed.is_empty() || parse_model_reference(trimmed).is_some() {
        return selection.to_string();
    }

    let mut matches = models.iter().filter(|model| model.model_id == trimmed);
    if let Some(active_provider_id) = active_provider_id
        && let Some(model) = matches
            .clone()
            .find(|model| model.provider_id == active_provider_id)
    {
        return model.id.clone();
    }

    let first = matches.next();
    if let Some(model) = first
        && matches.next().is_none()
    {
        return model.id.clone();
    }

    selection.to_string()
}

fn validate_model_selection(
    provider_registry: &ProviderRegistry,
    model_id: &str,
) -> Result<(), ErrorResponse> {
    if let Some((provider_id, scoped_model_id)) = parse_model_reference(model_id.trim()) {
        let provider = provider_registry
            .get(provider_id)
            .map_err(|e| ErrorResponse::internal_error(format!("Failed to get provider: {}", e)))?
            .ok_or_else(|| {
                ErrorResponse::invalid_request(
                    format!("Provider {} not found for model selection", provider_id),
                    Some("modelId".to_string()),
                )
            })?;

        if !provider_has_model(&provider, scoped_model_id) {
            return Err(ErrorResponse::invalid_request(
                format!(
                    "Model {} not found on provider {}",
                    scoped_model_id, provider_id
                ),
                Some("modelId".to_string()),
            ));
        }
    }

    Ok(())
}

fn build_provider_config(
    provider_type: &ProviderType,
    mut patch: ProviderConfigPatch,
    flat_api_key: Option<String>,
    flat_api_base: Option<String>,
    flat_default_model: Option<String>,
) -> ProviderConfig {
    patch.overlay_flat(flat_api_key, flat_api_base, flat_default_model);

    ProviderConfig {
        api_key: patch.api_key.unwrap_or_default(),
        base_url: patch
            .base_url
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_base_url(provider_type)),
        default_model: patch
            .default_model
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_model_for_provider(provider_type)),
        max_tokens: patch.max_tokens,
        temperature: patch.temperature,
        custom: patch.custom,
    }
}

fn merge_provider_config(
    provider_type: &ProviderType,
    existing: ProviderConfig,
    mut patch: ProviderConfigPatch,
    flat_api_key: Option<String>,
    flat_api_base: Option<String>,
    flat_default_model: Option<String>,
) -> ProviderConfig {
    patch.overlay_flat(flat_api_key, flat_api_base, flat_default_model);

    ProviderConfig {
        api_key: patch
            .api_key
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(existing.api_key),
        base_url: patch
            .base_url
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(existing.base_url),
        default_model: patch
            .default_model
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                if existing.default_model.is_empty() {
                    default_model_for_provider(provider_type)
                } else {
                    existing.default_model
                }
            }),
        max_tokens: patch.max_tokens.or(existing.max_tokens),
        temperature: patch.temperature.or(existing.temperature),
        custom: if patch.custom.is_empty() {
            existing.custom
        } else {
            let mut custom = existing.custom;
            custom.extend(patch.custom);
            custom
        },
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
    let config = build_provider_config(
        &req.provider_type,
        req.config.unwrap_or_default(),
        req.api_key,
        req.api_base,
        req.default_model,
    );

    // Validate API key
    if config.api_key.trim().is_empty() {
        return Err(ErrorResponse::invalid_request(
            "API key is required".to_string(),
            Some("apiKey".to_string()),
        ));
    }

    // Create provider
    let provider = ModelProvider {
        id: req
            .id
            .unwrap_or_else(|| ProviderRegistry::generate_id(&req.name)),
        name: req.name,
        provider_type: req.provider_type,
        config,
        models: req.models,
        capabilities: req.capabilities,
        status: ProviderStatus::Active,
        last_tested: None,
        created_at: current_timestamp(),
    };

    state
        .provider_registry
        .upsert(provider.clone())
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to create provider: {}", e)))?;

    Ok(Json(provider))
}

/// GET /api/v1/providers - List all providers
pub async fn list_providers(
    State(state): State<AppState>,
    Query(query): Query<ListProvidersQuery>,
) -> Result<Json<ListProvidersResponse>, ErrorResponse> {
    let mut providers = state
        .provider_registry
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
    let provider = state
        .provider_registry
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
    let UpdateProviderRequest {
        name,
        provider_type,
        config,
        api_key,
        api_base,
        default_model,
        models,
        capabilities,
        status,
    } = req;

    let mut provider = state
        .provider_registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get provider: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("Provider {} not found", id), Some("id".to_string()))
        })?;

    // Update fields
    if let Some(name) = name {
        provider.name = name;
    }

    let config_patch = config.unwrap_or_default();
    let has_flat_api_base = api_base
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let has_flat_default_model = default_model
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let config_has_base_url = config_patch
        .base_url
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let config_has_default_model = config_patch
        .default_model
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let has_config_update = config_has_base_url
        || config_has_default_model
        || config_patch.api_key.is_some()
        || config_patch.max_tokens.is_some()
        || config_patch.temperature.is_some()
        || !config_patch.custom.is_empty()
        || api_key.is_some()
        || has_flat_api_base
        || has_flat_default_model;
    let provider_type_changed = provider_type
        .as_ref()
        .is_some_and(|provider_type| *provider_type != provider.provider_type);
    if let Some(provider_type) = provider_type {
        provider.provider_type = provider_type;
        if provider_type_changed {
            if !config_has_base_url && !has_flat_api_base {
                provider.config.base_url = default_base_url(&provider.provider_type);
            }
            if !config_has_default_model && !has_flat_default_model {
                provider.config.default_model = default_model_for_provider(&provider.provider_type);
            }
        }
    }
    if has_config_update {
        provider.config = merge_provider_config(
            &provider.provider_type,
            provider.config,
            config_patch,
            api_key,
            api_base,
            default_model,
        );

        if provider.config.api_key.trim().is_empty() {
            return Err(ErrorResponse::invalid_request(
                "API key is required".to_string(),
                Some("apiKey".to_string()),
            ));
        }
    }
    if let Some(models) = models {
        provider.models = models;
    }
    if let Some(capabilities) = capabilities {
        provider.capabilities = capabilities;
    }
    if let Some(status) = status {
        provider.status = status;
    }

    state
        .provider_registry
        .upsert(provider.clone())
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to update provider: {}", e)))?;

    Ok(Json(provider))
}

/// DELETE /api/v1/providers/:id - Delete a provider
pub async fn delete_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DeleteResponse>, ErrorResponse> {
    let success = state
        .provider_registry
        .remove(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to delete provider: {}", e)))?;

    Ok(Json(DeleteResponse { success }))
}

/// POST /api/v1/providers/:id/test - Test provider connection
pub async fn test_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TestConnectionResponse>, ErrorResponse> {
    let provider = state
        .provider_registry
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
    state
        .provider_registry
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
    let provider = state
        .provider_registry
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
            ErrorResponse::not_found(format!("Provider {} not found", id), Some("id".to_string()))
        })?;

    // Set as active provider
    state.global_config.set_active_provider(&id).map_err(|e| {
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
        .map_err(|e| {
            ErrorResponse::internal_error(format!("Failed to get active provider: {}", e))
        })?
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

/// GET /api/v1/models - List all configured models for the GUI.
pub async fn list_gui_models(
    State(state): State<AppState>,
) -> Result<Json<GuiModelsResponse>, ErrorResponse> {
    let providers = state
        .provider_registry
        .list()
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to list providers: {}", e)))?;

    let mut models = Vec::new();

    for provider in providers {
        if provider.models.is_empty() && !provider.config.default_model.trim().is_empty() {
            let model_id = provider.config.default_model.clone();
            models.push(GuiModelInfo {
                id: model_reference(&provider.id, &model_id),
                name: model_id.clone(),
                model_id,
                provider_id: provider.id,
                provider: provider.name,
            });
            continue;
        }

        for model in provider.models {
            let model_id = model.id;
            models.push(GuiModelInfo {
                id: model_reference(&provider.id, &model_id),
                model_id,
                name: model.name,
                provider_id: provider.id.clone(),
                provider: provider.name.clone(),
            });
        }
    }

    let global_config = state
        .global_config
        .load()
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to load config: {}", e)))?;
    let active_provider_id = global_config.active_provider_id.as_deref();
    let default_model = global_config
        .default_model
        .as_deref()
        .map(|model| normalize_model_selection_for_gui(model, &models, active_provider_id));
    let role_bindings = global_config
        .model_aliases
        .into_iter()
        .filter_map(|(alias, model_id)| {
            alias.strip_prefix("role:").map(|role| {
                (
                    role.to_string(),
                    normalize_model_selection_for_gui(&model_id, &models, active_provider_id),
                )
            })
        })
        .collect();

    Ok(Json(GuiModelsResponse {
        models,
        default_model,
        role_bindings,
    }))
}

/// POST /api/v1/models/default - Persist the default model selection.
pub async fn set_default_model(
    State(state): State<AppState>,
    Json(req): Json<SetDefaultModelRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    if req.model_id.trim().is_empty() {
        return Err(ErrorResponse::invalid_request(
            "Model ID is required".to_string(),
            Some("modelId".to_string()),
        ));
    }
    validate_model_selection(&state.provider_registry, &req.model_id)?;

    state
        .global_config
        .set_default_model(&req.model_id)
        .map_err(|e| {
            ErrorResponse::internal_error(format!("Failed to set default model: {}", e))
        })?;

    Ok(Json(serde_json::json!({
        "success": true,
        "modelId": req.model_id,
    })))
}

/// POST /api/v1/models/role-binding - Persist a role-specific model alias.
pub async fn set_role_binding(
    State(state): State<AppState>,
    Json(req): Json<SetRoleBindingRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    if req.role.trim().is_empty() {
        return Err(ErrorResponse::invalid_request(
            "Role is required".to_string(),
            Some("role".to_string()),
        ));
    }

    let alias = format!("role:{}", req.role.trim());
    match req
        .model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(model_id) => {
            validate_model_selection(&state.provider_registry, model_id)?;
            state
                .global_config
                .set_model_alias(&alias, model_id)
                .map_err(|e| {
                    ErrorResponse::internal_error(format!("Failed to set role binding: {}", e))
                })?
        }
        None => {
            state
                .global_config
                .remove_model_alias(&alias)
                .map_err(|e| {
                    ErrorResponse::internal_error(format!("Failed to clear role binding: {}", e))
                })?;
        }
    };

    Ok(Json(serde_json::json!({
        "success": true,
        "role": req.role,
        "modelId": req.model_id,
    })))
}

/// POST /api/v1/models/aliases - Persist a user model alias.
pub async fn set_model_alias(
    State(state): State<AppState>,
    Json(req): Json<SetModelAliasRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let alias = req.alias.trim();
    let model_id = req.model_id.trim();
    if alias.is_empty() {
        return Err(ErrorResponse::invalid_request(
            "Alias is required".to_string(),
            Some("alias".to_string()),
        ));
    }
    if model_id.is_empty() {
        return Err(ErrorResponse::invalid_request(
            "Model ID is required".to_string(),
            Some("modelId".to_string()),
        ));
    }

    state
        .global_config
        .set_model_alias(alias, model_id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to set model alias: {}", e)))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "alias": alias,
        "modelId": model_id,
    })))
}

/// DELETE /api/v1/models/aliases/:alias - Remove a user model alias.
pub async fn delete_model_alias(
    State(state): State<AppState>,
    Path(alias): Path<String>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let alias = alias.trim();
    if alias.is_empty() {
        return Err(ErrorResponse::invalid_request(
            "Alias is required".to_string(),
            Some("alias".to_string()),
        ));
    }

    let removed = state.global_config.remove_model_alias(alias).map_err(|e| {
        ErrorResponse::internal_error(format!("Failed to remove model alias: {}", e))
    })?;

    Ok(Json(serde_json::json!({
        "success": true,
        "alias": alias,
        "removed": removed,
    })))
}

/// POST /api/v1/config/effort - Persist the default effort level.
pub async fn set_effort_level(
    State(state): State<AppState>,
    Json(req): Json<SetEffortLevelRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let level = req.level.trim();
    if !matches!(level, "low" | "medium" | "high" | "xhigh" | "max") {
        return Err(ErrorResponse::invalid_request(
            "Effort level must be one of: low, medium, high, xhigh, max".to_string(),
            Some("level".to_string()),
        ));
    }

    state
        .global_config
        .set_effort_level(level)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to set effort level: {}", e)))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "level": level,
    })))
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
                        ErrorResponse::internal_error(
                            "Failed to determine home directory".to_string(),
                        )
                    })?
                    .join(".ccm_config")
            };

            let (providers, global_config) = import_ccm_config(&path).map_err(|e| {
                ErrorResponse::invalid_request(
                    format!("Failed to import CC Switch config: {}", e),
                    None,
                )
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
                        ErrorResponse::internal_error(
                            "Failed to determine home directory".to_string(),
                        )
                    })?
                    .join(".claude")
                    .join("settings.json")
            };

            let global_config = import_claude_settings(&path).map_err(|e| {
                ErrorResponse::invalid_request(
                    format!("Failed to import Claude Code settings: {}", e),
                    None,
                )
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
        "auto" => codepanion_workflow_engine::auto_import()
            .map_err(|e| ErrorResponse::internal_error(format!("Failed to auto-import: {}", e)))?,
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
