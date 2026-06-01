use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBoardResponse {
    pub workflows: Vec<WorkflowDefinition>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub project_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunsResponse {
    pub runs: Vec<WorkflowRunSummary>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunSummary {
    pub run_id: String,
    pub workflow_id: String,
    pub project_id: String,
    pub status: String,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunDetail {
    pub run_id: String,
    pub workflow_id: String,
    pub project_id: String,
    pub status: String,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub steps: Vec<StepSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepSummary {
    pub step_id: String,
    pub name: String,
    pub status: String,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactsResponse {
    pub artifacts: Vec<ArtifactSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSummary {
    pub key: String,
    pub size: u64,
    pub created_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryNoteResponse {
    pub content: String,
    pub created_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatesResponse {
    pub gates: Vec<GateSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateSummary {
    pub run_id: String,
    pub step_id: String,
    pub workflow_id: String,
    pub project_id: String,
    pub message: Option<String>,
    pub paused_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveGateRequest {
    pub decision: String, // "approve" | "reject" | "retry"
    pub message: Option<String>,
    pub constraints: Option<Vec<String>>,
}

// ============================================================================
// Route Handlers
// ============================================================================

/// GET /workflow/board - List workflow definitions
pub async fn get_workflow_board(State(state): State<AppState>) -> Json<WorkflowBoardResponse> {
    // Get all workflows from orchestrator
    let orchestrator = state.orchestrator.lock().unwrap();
    let workflows = orchestrator.list_workflows();

    let workflow_defs = workflows
        .into_iter()
        .map(|w| WorkflowDefinition {
            id: w.workflow_id.clone(),
            name: w.workflow_id.clone(), // TODO: Get actual name from workflow definition
            description: None,           // TODO: Get from workflow definition
            project_id: w.project_id,
        })
        .collect();

    Json(WorkflowBoardResponse {
        workflows: workflow_defs,
    })
}

/// GET /workflow/runs - List workflow runs
pub async fn get_workflow_runs(State(state): State<AppState>) -> Json<WorkflowRunsResponse> {
    let runs = state.scheduler.list_all();

    let run_summaries = runs
        .into_iter()
        .map(|r| WorkflowRunSummary {
            run_id: r.run_id,
            workflow_id: r.workflow_id,
            project_id: r.project_id,
            status: format!("{:?}", r.status),
            started_at: r.started_at,
            completed_at: r.completed_at,
        })
        .collect::<Vec<_>>();

    let total = run_summaries.len();

    Json(WorkflowRunsResponse {
        runs: run_summaries,
        total,
    })
}

/// GET /workflow/runs/:id - Get a single workflow run
pub async fn get_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<WorkflowRunDetail>, StatusCode> {
    let runs = state.scheduler.list_all();

    let run = runs
        .into_iter()
        .find(|r| r.run_id == run_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    // TODO: Get actual steps from workflow history
    let steps = vec![]; // Placeholder

    Ok(Json(WorkflowRunDetail {
        run_id: run.run_id,
        workflow_id: run.workflow_id,
        project_id: run.project_id,
        status: format!("{:?}", run.status),
        started_at: run.started_at,
        completed_at: run.completed_at,
        steps,
    }))
}

/// GET /workflow/runs/:id/artifacts - Get artifacts for a run
pub async fn get_run_artifacts(
    State(_state): State<AppState>,
    Path(_run_id): Path<String>,
) -> Json<ArtifactsResponse> {
    // TODO: Implement artifact listing from WorkflowArtifactStore
    Json(ArtifactsResponse { artifacts: vec![] })
}

/// GET /workflow/runs/:id/delivery - Get delivery note for a run
pub async fn get_run_delivery(
    State(_state): State<AppState>,
    Path(_run_id): Path<String>,
) -> Result<Json<DeliveryNoteResponse>, StatusCode> {
    // TODO: Implement delivery note retrieval
    Err(StatusCode::NOT_FOUND)
}

/// GET /workflow/gates - List paused gates
pub async fn get_workflow_gates(State(_state): State<AppState>) -> Json<GatesResponse> {
    // TODO: Implement gate listing from HumanGateManager
    Json(GatesResponse { gates: vec![] })
}

/// POST /workflow/gates/:run_id/:step_id/resolve - Resolve a gate
pub async fn resolve_gate(
    State(_state): State<AppState>,
    Path((_run_id, _step_id)): Path<(String, String)>,
    Json(_req): Json<ResolveGateRequest>,
) -> Result<StatusCode, StatusCode> {
    // TODO: Implement gate resolution using HumanGateManager
    Ok(StatusCode::OK)
}
