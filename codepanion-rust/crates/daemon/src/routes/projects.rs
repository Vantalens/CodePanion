use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use codepanion_workflow_engine::{Project, ProjectHealth, ProjectMetadata, ProjectRegistry, ProjectStats};

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
pub struct CreateProjectRequest {
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub metadata: ProjectMetadata,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub path: Option<String>,
    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
    pub metadata: Option<ProjectMetadata>,
}

#[derive(Debug, Deserialize)]
pub struct ListProjectsQuery {
    pub tag: Option<String>,
    pub sort: Option<String>,
}

// ============================================================================
// Response Types
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectsResponse {
    pub projects: Vec<Project>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateProjectResponse {
    pub id: String,
    pub name: String,
    pub last_active_at: u64,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatusResponse {
    pub id: String,
    pub status: String,
    pub health: ProjectHealth,
    pub stats: ProjectStats,
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
                code: "project_not_found".to_string(),
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

/// POST /api/v1/projects - Create a new project
pub async fn create_project(
    State(registry): State<Arc<ProjectRegistry>>,
    Json(req): Json<CreateProjectRequest>,
) -> Result<Json<Project>, ErrorResponse> {
    // Validate path
    let path = PathBuf::from(&req.path);
    ProjectRegistry::validate_path(&path).map_err(|e| {
        ErrorResponse::invalid_request(format!("Invalid path: {}", e), Some("path".to_string()))
    })?;

    // Create project
    let project = Project {
        id: ProjectRegistry::generate_id(&req.name),
        name: req.name,
        path,
        tags: req.tags,
        last_active_at: current_timestamp(),
        description: req.description,
        created_at: current_timestamp(),
        metadata: req.metadata,
    };

    registry
        .upsert(project.clone())
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to create project: {}", e)))?;

    Ok(Json(project))
}

/// GET /api/v1/projects - List all projects
pub async fn list_projects(
    State(registry): State<Arc<ProjectRegistry>>,
    Query(query): Query<ListProjectsQuery>,
) -> Result<Json<ListProjectsResponse>, ErrorResponse> {
    let mut projects = registry
        .list()
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to list projects: {}", e)))?;

    // Filter by tag
    if let Some(tag) = query.tag {
        projects.retain(|p| p.tags.contains(&tag));
    }

    // Sort
    if let Some(sort) = query.sort {
        match sort.as_str() {
            "name" => projects.sort_by(|a, b| a.name.cmp(&b.name)),
            "createdAt" => projects.sort_by_key(|b| std::cmp::Reverse(b.created_at)),
            _ => {} // Default: already sorted by lastActiveAt
        }
    }

    let total = projects.len();
    Ok(Json(ListProjectsResponse { projects, total }))
}

/// GET /api/v1/projects/:id - Get a single project
pub async fn get_project(
    State(registry): State<Arc<ProjectRegistry>>,
    Path(id): Path<String>,
) -> Result<Json<Project>, ErrorResponse> {
    let project = registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get project: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("Project {} not found", id), Some("id".to_string()))
        })?;

    Ok(Json(project))
}

/// PUT /api/v1/projects/:id - Update a project
pub async fn update_project(
    State(registry): State<Arc<ProjectRegistry>>,
    Path(id): Path<String>,
    Json(req): Json<UpdateProjectRequest>,
) -> Result<Json<Project>, ErrorResponse> {
    let mut project = registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get project: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("Project {} not found", id), Some("id".to_string()))
        })?;

    // Update fields
    if let Some(name) = req.name {
        project.name = name;
    }
    if let Some(path) = req.path {
        let new_path = PathBuf::from(&path);
        ProjectRegistry::validate_path(&new_path).map_err(|e| {
            ErrorResponse::invalid_request(format!("Invalid path: {}", e), Some("path".to_string()))
        })?;
        project.path = new_path;
    }
    if let Some(tags) = req.tags {
        project.tags = tags;
    }
    if let Some(description) = req.description {
        project.description = Some(description);
    }
    if let Some(metadata) = req.metadata {
        project.metadata = metadata;
    }

    registry
        .upsert(project.clone())
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to update project: {}", e)))?;

    Ok(Json(project))
}

/// DELETE /api/v1/projects/:id - Delete a project
pub async fn delete_project(
    State(registry): State<Arc<ProjectRegistry>>,
    Path(id): Path<String>,
) -> Result<Json<DeleteResponse>, ErrorResponse> {
    let success = registry
        .remove(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to delete project: {}", e)))?;

    Ok(Json(DeleteResponse { success }))
}

/// POST /api/v1/projects/:id/activate - Activate a project (update lastActiveAt)
pub async fn activate_project(
    State(registry): State<Arc<ProjectRegistry>>,
    Path(id): Path<String>,
) -> Result<Json<ActivateProjectResponse>, ErrorResponse> {
    registry
        .touch(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to activate project: {}", e)))?;

    let project = registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get project: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("Project {} not found", id), Some("id".to_string()))
        })?;

    Ok(Json(ActivateProjectResponse {
        id: project.id,
        name: project.name,
        last_active_at: project.last_active_at,
        status: "active".to_string(),
    }))
}

/// GET /api/v1/projects/:id/status - Get project health status and statistics
pub async fn get_project_status(
    State(registry): State<Arc<ProjectRegistry>>,
    Path(id): Path<String>,
) -> Result<Json<ProjectStatusResponse>, ErrorResponse> {
    let project = registry
        .get(&id)
        .map_err(|e| ErrorResponse::internal_error(format!("Failed to get project: {}", e)))?
        .ok_or_else(|| {
            ErrorResponse::not_found(format!("Project {} not found", id), Some("id".to_string()))
        })?;

    // Check project health
    let path_exists = project.path.exists();
    let is_directory = project.path.is_dir();
    let is_git_repo = project.path.join(".git").exists();

    let health = ProjectHealth {
        path_exists,
        is_directory,
        is_git_repo,
        last_checked: current_timestamp(),
    };

    // TODO: Get stats from workflow history
    let stats = ProjectStats {
        total_runs: 0,
        successful_runs: 0,
        failed_runs: 0,
        last_run_at: None,
    };

    let status = if path_exists && is_directory {
        "active"
    } else {
        "error"
    };

    Ok(Json(ProjectStatusResponse {
        id: project.id,
        status: status.to_string(),
        health,
        stats,
    }))
}
