use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use codepanion_workflow_engine::{WorkflowDependency, WorkflowWithDeps};
use serde::{Deserialize, Serialize};

use crate::AppState;

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterWorkflowRequest {
    pub project_id: String,
    pub workflow_id: String,
    #[serde(default)]
    pub dependencies: Vec<WorkflowDependency>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowListResponse {
    pub workflows: Vec<WorkflowWithDeps>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyGraphResponse {
    pub execution_order: Vec<WorkflowRef>,
    pub edges: Vec<DependencyEdge>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRef {
    pub project_id: String,
    pub workflow_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyEdge {
    pub from_project_id: String,
    pub from_workflow_id: String,
    pub to_project_id: String,
    pub to_workflow_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub error: String,
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::BAD_REQUEST, Json(self)).into_response()
    }
}

// ============================================================================
// Route Handlers
// ============================================================================

/// POST /api/v1/orchestrator/workflows - Register a workflow with dependencies
pub async fn register_workflow(
    State(state): State<AppState>,
    Json(req): Json<RegisterWorkflowRequest>,
) -> Result<StatusCode, ErrorResponse> {
    let workflow = WorkflowWithDeps {
        project_id: req.project_id,
        workflow_id: req.workflow_id,
        dependencies: req.dependencies,
    };

    let mut orchestrator = state.orchestrator.lock().unwrap();
    orchestrator.register_workflow(workflow);

    Ok(StatusCode::CREATED)
}

/// GET /api/v1/orchestrator/workflows - List all registered workflows
pub async fn list_workflows(State(state): State<AppState>) -> Json<WorkflowListResponse> {
    let orchestrator = state.orchestrator.lock().unwrap();
    let workflows = orchestrator.list_workflows();

    Json(WorkflowListResponse { workflows })
}

/// GET /api/v1/orchestrator/workflows/:project_id/:workflow_id - Get a specific workflow
pub async fn get_workflow(
    State(state): State<AppState>,
    Path((project_id, workflow_id)): Path<(String, String)>,
) -> Result<Json<WorkflowWithDeps>, StatusCode> {
    let orchestrator = state.orchestrator.lock().unwrap();
    let workflows = orchestrator.list_workflows();

    workflows
        .into_iter()
        .find(|w| w.project_id == project_id && w.workflow_id == workflow_id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// DELETE /api/v1/orchestrator/workflows/:project_id/:workflow_id - Remove a workflow
pub async fn remove_workflow(
    State(state): State<AppState>,
    Path((project_id, workflow_id)): Path<(String, String)>,
) -> StatusCode {
    let mut orchestrator = state.orchestrator.lock().unwrap();
    orchestrator.remove_workflow(&project_id, &workflow_id);

    StatusCode::OK
}

/// GET /api/v1/orchestrator/workflows/:project_id/:workflow_id/dependencies - Get workflow dependencies
pub async fn get_dependencies(
    State(state): State<AppState>,
    Path((project_id, workflow_id)): Path<(String, String)>,
) -> Json<Vec<WorkflowDependency>> {
    let orchestrator = state.orchestrator.lock().unwrap();
    let deps = orchestrator.get_dependencies(&project_id, &workflow_id);

    Json(deps)
}

/// POST /api/v1/orchestrator/workflows/:project_id/:workflow_id/resolve - Resolve dependencies
pub async fn resolve_dependencies(
    State(state): State<AppState>,
    Path((project_id, workflow_id)): Path<(String, String)>,
) -> Result<Json<DependencyGraphResponse>, ErrorResponse> {
    let orchestrator = state.orchestrator.lock().unwrap();

    let graph = orchestrator
        .resolve_dependencies(&project_id, &workflow_id)
        .map_err(|e| ErrorResponse {
            error: e.to_string(),
        })?;

    // Convert to response format
    let execution_order = graph
        .execution_order
        .into_iter()
        .map(|(project_id, workflow_id)| WorkflowRef {
            project_id,
            workflow_id,
        })
        .collect();

    let edges = graph
        .edges
        .into_iter()
        .flat_map(|((from_project, from_workflow), deps)| {
            deps.into_iter().map(move |(to_project, to_workflow)| {
                DependencyEdge {
                    from_project_id: from_project.clone(),
                    from_workflow_id: from_workflow.clone(),
                    to_project_id: to_project,
                    to_workflow_id: to_workflow,
                }
            })
        })
        .collect();

    Ok(Json(DependencyGraphResponse {
        execution_order,
        edges,
    }))
}

/// GET /api/v1/orchestrator/workflows/:project_id/:workflow_id/has-dependencies - Check if workflow has dependencies
pub async fn has_dependencies(
    State(state): State<AppState>,
    Path((project_id, workflow_id)): Path<(String, String)>,
) -> Json<serde_json::Value> {
    let orchestrator = state.orchestrator.lock().unwrap();
    let has_deps = orchestrator.has_dependencies(&project_id, &workflow_id);

    Json(serde_json::json!({ "hasDependencies": has_deps }))
}
