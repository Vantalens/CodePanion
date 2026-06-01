use axum::{Json, extract::State};
use codepanion_workflow_engine::{ScheduledRun, SchedulerStats};
use serde::Serialize;

use crate::AppState;

// ============================================================================
// Response Types
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalRunsResponse {
    pub runs: Vec<ScheduledRun>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalStatsResponse {
    pub scheduler: SchedulerStats,
    pub total_projects: usize,
    pub total_workflows: usize,
}

// ============================================================================
// Route Handlers
// ============================================================================

/// GET /api/v1/global/runs - Get all runs across all projects
pub async fn get_global_runs(State(state): State<AppState>) -> Json<GlobalRunsResponse> {
    let runs = state.scheduler.list_all();
    let total = runs.len();

    Json(GlobalRunsResponse { runs, total })
}

/// GET /api/v1/global/runs/queued - Get all queued runs across all projects
pub async fn get_global_queued_runs(State(state): State<AppState>) -> Json<GlobalRunsResponse> {
    let runs = state.scheduler.list_queued();
    let total = runs.len();

    Json(GlobalRunsResponse { runs, total })
}

/// GET /api/v1/global/runs/running - Get all running runs across all projects
pub async fn get_global_running_runs(State(state): State<AppState>) -> Json<GlobalRunsResponse> {
    let runs = state.scheduler.list_running();
    let total = runs.len();

    Json(GlobalRunsResponse { runs, total })
}

/// GET /api/v1/global/runs/completed - Get all completed runs across all projects
pub async fn get_global_completed_runs(State(state): State<AppState>) -> Json<GlobalRunsResponse> {
    let runs = state.scheduler.list_completed();
    let total = runs.len();

    Json(GlobalRunsResponse { runs, total })
}

/// GET /api/v1/global/stats - Get global statistics
pub async fn get_global_stats(State(state): State<AppState>) -> Json<GlobalStatsResponse> {
    let scheduler_stats = state.scheduler.get_stats();

    // Count projects
    let total_projects = state
        .project_registry
        .list()
        .map(|projects| projects.len())
        .unwrap_or(0);

    // Count workflows
    let orchestrator = state.orchestrator.lock().unwrap();
    let total_workflows = orchestrator.list_workflows().len();

    Json(GlobalStatsResponse {
        scheduler: scheduler_stats,
        total_projects,
        total_workflows,
    })
}
