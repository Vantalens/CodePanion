use axum::{Json, extract::State};
use codepanion_workflow_engine::{RunStatus, ScheduledRun, SchedulerStats};
use serde::Serialize;

use crate::AppState;

// ============================================================================
// Response Types
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalRunsResponse {
    pub runs: Vec<GlobalRunSummary>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalRunSummary {
    pub id: String,
    pub workflow_name: String,
    pub project_id: String,
    pub status: String,
    pub step_count: usize,
    pub current_step_id: Option<String>,
    pub current_step_status: Option<String>,
    pub queued_at: u64,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
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
    let runs = global_run_summaries(state.scheduler.list_all());
    let total = runs.len();

    Json(GlobalRunsResponse { runs, total })
}

/// GET /api/v1/global/runs/queued - Get all queued runs across all projects
pub async fn get_global_queued_runs(State(state): State<AppState>) -> Json<GlobalRunsResponse> {
    let runs = global_run_summaries(state.scheduler.list_queued());
    let total = runs.len();

    Json(GlobalRunsResponse { runs, total })
}

/// GET /api/v1/global/runs/running - Get all running runs across all projects
pub async fn get_global_running_runs(State(state): State<AppState>) -> Json<GlobalRunsResponse> {
    let runs = global_run_summaries(state.scheduler.list_running());
    let total = runs.len();

    Json(GlobalRunsResponse { runs, total })
}

/// GET /api/v1/global/runs/completed - Get all completed runs across all projects
pub async fn get_global_completed_runs(State(state): State<AppState>) -> Json<GlobalRunsResponse> {
    let runs = global_run_summaries(state.scheduler.list_completed());
    let total = runs.len();

    Json(GlobalRunsResponse { runs, total })
}

fn global_run_summaries(runs: Vec<ScheduledRun>) -> Vec<GlobalRunSummary> {
    runs.into_iter().map(global_run_summary).collect()
}

fn global_run_summary(run: ScheduledRun) -> GlobalRunSummary {
    GlobalRunSummary {
        id: run.run_id,
        workflow_name: run.workflow_id,
        project_id: run.project_id,
        status: run_status_label(run.status).to_string(),
        step_count: 0,
        current_step_id: None,
        current_step_status: None,
        queued_at: run.queued_at,
        started_at: run.started_at,
        completed_at: run.completed_at,
    }
}

fn run_status_label(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Queued => "queued",
        RunStatus::Running => "running",
        RunStatus::Paused => "paused",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Cancelled => "cancelled",
    }
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
