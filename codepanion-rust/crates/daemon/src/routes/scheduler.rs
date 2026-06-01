use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use codepanion_workflow_engine::{RunPriority, ScheduledRun, SchedulerStats};
use serde::{Deserialize, Serialize};

use crate::AppState;

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueRunRequest {
    pub run_id: String,
    pub project_id: String,
    pub workflow_id: String,
    #[serde(default)]
    pub priority: RunPriority,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueRunResponse {
    pub run_id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunListResponse {
    pub runs: Vec<ScheduledRun>,
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

/// POST /api/v1/scheduler/enqueue - Enqueue a new run
pub async fn enqueue_run(
    State(state): State<AppState>,
    Json(req): Json<EnqueueRunRequest>,
) -> Result<Json<EnqueueRunResponse>, ErrorResponse> {
    state
        .scheduler
        .enqueue(
            req.run_id.clone(),
            req.project_id,
            req.workflow_id,
            req.priority,
        )
        .map_err(|e| ErrorResponse {
            error: e.to_string(),
        })?;

    Ok(Json(EnqueueRunResponse {
        run_id: req.run_id,
        status: "queued".to_string(),
    }))
}

/// GET /api/v1/scheduler/runs - List all runs
pub async fn list_all_runs(State(state): State<AppState>) -> Json<RunListResponse> {
    let runs = state.scheduler.list_all();
    Json(RunListResponse { runs })
}

/// GET /api/v1/scheduler/runs/queued - List queued runs
pub async fn list_queued_runs(State(state): State<AppState>) -> Json<RunListResponse> {
    let runs = state.scheduler.list_queued();
    Json(RunListResponse { runs })
}

/// GET /api/v1/scheduler/runs/running - List running runs
pub async fn list_running_runs(State(state): State<AppState>) -> Json<RunListResponse> {
    let runs = state.scheduler.list_running();
    Json(RunListResponse { runs })
}

/// GET /api/v1/scheduler/runs/completed - List completed runs
pub async fn list_completed_runs(State(state): State<AppState>) -> Json<RunListResponse> {
    let runs = state.scheduler.list_completed();
    Json(RunListResponse { runs })
}

/// GET /api/v1/scheduler/runs/:run_id - Get a specific run
pub async fn get_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<ScheduledRun>, StatusCode> {
    state
        .scheduler
        .get_run(&run_id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// GET /api/v1/scheduler/projects/:project_id/runs - List runs by project
pub async fn list_project_runs(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Json<RunListResponse> {
    let runs = state.scheduler.list_by_project(&project_id);
    Json(RunListResponse { runs })
}

/// POST /api/v1/scheduler/runs/:run_id/cancel - Cancel a run
pub async fn cancel_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<StatusCode, ErrorResponse> {
    state
        .scheduler
        .cancel_run(&run_id)
        .map_err(|e| ErrorResponse {
            error: e.to_string(),
        })?;

    Ok(StatusCode::OK)
}

/// POST /api/v1/scheduler/runs/:run_id/pause - Pause a run
pub async fn pause_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<StatusCode, ErrorResponse> {
    state
        .scheduler
        .pause_run(&run_id)
        .map_err(|e| ErrorResponse {
            error: e.to_string(),
        })?;

    Ok(StatusCode::OK)
}

/// POST /api/v1/scheduler/runs/:run_id/resume - Resume a run
pub async fn resume_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<StatusCode, ErrorResponse> {
    state
        .scheduler
        .resume_run(&run_id)
        .map_err(|e| ErrorResponse {
            error: e.to_string(),
        })?;

    Ok(StatusCode::OK)
}

/// GET /api/v1/scheduler/stats - Get scheduler statistics
pub async fn get_stats(State(state): State<AppState>) -> Json<SchedulerStats> {
    let stats = state.scheduler.get_stats();
    Json(stats)
}

/// DELETE /api/v1/scheduler/completed - Clear completed runs
pub async fn clear_completed(State(state): State<AppState>) -> StatusCode {
    state.scheduler.clear_completed();
    StatusCode::OK
}
