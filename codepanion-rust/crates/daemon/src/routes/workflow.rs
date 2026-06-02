use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use codepanion_workflow_engine::{
    ArtifactType, GateDecision, GateResolution, HumanGateManager, WorkflowRun,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    #[serde(rename = "type")]
    pub artifact_type: ArtifactType,
    pub title: String,
    pub content: String,
    pub files: Vec<String>,
    pub step_id: Option<String>,
    pub role: Option<String>,
    pub size: u64,
    pub created_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryNoteResponse {
    pub run_id: String,
    pub workflow_name: String,
    pub status: String,
    pub format: String,
    pub content: String,
    pub files: Vec<String>,
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

#[derive(Debug, Deserialize)]
pub struct DeliveryQuery {
    pub format: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveGateResponse {
    pub artifact_id: String,
    pub should_resume: bool,
    pub resume_step_id: Option<String>,
    pub updated_values: HashMap<String, String>,
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
    let history_runs = state.workflow_history.list().unwrap_or_default();
    let scheduler_runs = state.scheduler.list_all();

    let mut run_summaries = history_runs
        .into_iter()
        .map(|r| WorkflowRunSummary {
            run_id: r.id,
            workflow_id: r.workflow_name,
            project_id: String::new(),
            status: format!("{:?}", r.status),
            started_at: Some(r.started_at),
            completed_at: Some(r.ended_at),
        })
        .collect::<Vec<_>>();

    run_summaries.extend(scheduler_runs.into_iter().map(|r| WorkflowRunSummary {
        run_id: r.run_id,
        workflow_id: r.workflow_id,
        project_id: r.project_id,
        status: format!("{:?}", r.status),
        started_at: r.started_at,
        completed_at: r.completed_at,
    }));

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
    if let Some(run) = state
        .workflow_history
        .get(&run_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        return Ok(Json(run_detail_from_history(run)));
    }

    let run = state
        .scheduler
        .get_run(&run_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(WorkflowRunDetail {
        run_id: run.run_id,
        workflow_id: run.workflow_id,
        project_id: run.project_id,
        status: format!("{:?}", run.status),
        started_at: run.started_at,
        completed_at: run.completed_at,
        steps: vec![],
    }))
}

/// GET /workflow/runs/:id/artifacts - Get artifacts for a run
pub async fn get_run_artifacts(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<ArtifactsResponse>, StatusCode> {
    let artifacts = state
        .workflow_artifacts
        .list(Some(&run_id))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .into_iter()
        .map(|artifact| ArtifactSummary {
            key: artifact.id,
            artifact_type: artifact.artifact_type,
            title: artifact.title,
            size: artifact.content.len() as u64,
            content: artifact.content,
            files: artifact.files,
            step_id: artifact.step_id,
            role: artifact.role,
            created_at: artifact.created_at,
        })
        .collect();

    Ok(Json(ArtifactsResponse { artifacts }))
}

/// GET /workflow/runs/:id/delivery - Get delivery note for a run
pub async fn get_run_delivery(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Query(query): Query<DeliveryQuery>,
) -> Result<Json<DeliveryNoteResponse>, StatusCode> {
    let run = state
        .workflow_history
        .get(&run_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let note = state
        .workflow_artifacts
        .get_by_type(&run_id, ArtifactType::DeliveryNote)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .into_iter()
        .max_by_key(|artifact| artifact.created_at)
        .ok_or(StatusCode::NOT_FOUND)?;

    let format = if query.format.as_deref() == Some("handoff") {
        "handoff"
    } else {
        "markdown"
    };
    let header = [
        format!("# CodePanion delivery note: {}", run.workflow_name),
        String::new(),
        format!("- Status: {}", workflow_status_label(&run)),
        format!("- Run ID: {}", run_id),
        format!("- Steps: {}", run.steps.len()),
        String::new(),
    ]
    .join("\n");
    let body = format!("{}{}", header, note.content);
    let content = if format == "handoff" {
        [
            "You are continuing a CodePanion workflow that was previously run.",
            "Below is the delivery note from the prior run; treat it as the source of truth for what has already been done.",
            "",
            "---",
            "",
            &body,
            "",
            "---",
            "",
            "Please continue this workflow:",
            "- If the previous run ended in `paused` or `failed`, focus on the blocker before doing anything else.",
            "- Honor every constraint recorded above; do not regress prior artifacts.",
            "- If the previous run ended in `success`, propose the next iteration consistent with the existing artifacts.",
            "- Return a short patch summary at the end so the next run can be appended.",
        ]
        .join("\n")
    } else {
        body
    };
    let status = workflow_status_label(&run).to_string();

    Ok(Json(DeliveryNoteResponse {
        run_id,
        workflow_name: run.workflow_name,
        status,
        format: format.to_string(),
        content,
        files: note.files,
    }))
}

/// GET /workflow/gates - List paused gates
pub async fn get_workflow_gates(State(state): State<AppState>) -> Json<GatesResponse> {
    let manager = HumanGateManager::new(&state.workflow_history, &state.workflow_artifacts);
    let gates = manager
        .list_paused_gates()
        .unwrap_or_default()
        .into_iter()
        .map(|gate| GateSummary {
            run_id: gate.run_id,
            step_id: gate.step_id,
            workflow_id: gate.workflow_name,
            project_id: String::new(),
            message: gate.message,
            paused_at: gate.paused_at,
        })
        .collect();

    Json(GatesResponse { gates })
}

/// POST /workflow/gates/:run_id/:step_id/resolve - Resolve a gate
pub async fn resolve_gate(
    State(state): State<AppState>,
    Path((run_id, step_id)): Path<(String, String)>,
    Json(req): Json<ResolveGateRequest>,
) -> Result<Json<ResolveGateResponse>, StatusCode> {
    let decision = match req.decision.as_str() {
        "approve" => GateDecision::Approve,
        "reject" => GateDecision::Reject,
        "retry" => GateDecision::Retry,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    let manager = HumanGateManager::new(&state.workflow_history, &state.workflow_artifacts);
    let result = manager
        .resolve_gate(
            &run_id,
            &step_id,
            GateResolution {
                decision,
                message: req.message,
                constraints: req.constraints.unwrap_or_default(),
            },
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(ResolveGateResponse {
        artifact_id: result.artifact_id,
        should_resume: result.should_resume,
        resume_step_id: result.resume_step_id,
        updated_values: result.updated_values,
    }))
}

fn run_detail_from_history(run: WorkflowRun) -> WorkflowRunDetail {
    WorkflowRunDetail {
        run_id: run.id,
        workflow_id: run.workflow_name,
        project_id: String::new(),
        status: format!("{:?}", run.status),
        started_at: Some(run.started_at),
        completed_at: Some(run.ended_at),
        steps: run
            .steps
            .into_iter()
            .map(|step| StepSummary {
                step_id: step.id.clone(),
                name: step.id,
                status: format!("{:?}", step.status),
                started_at: step.started_at,
                completed_at: step.ended_at,
            })
            .collect(),
    }
}

fn workflow_status_label(run: &WorkflowRun) -> &'static str {
    match run.status {
        codepanion_workflow_engine::WorkflowRunStatus::Success => "success",
        codepanion_workflow_engine::WorkflowRunStatus::Failed => "failed",
        codepanion_workflow_engine::WorkflowRunStatus::Paused => "paused",
        codepanion_workflow_engine::WorkflowRunStatus::DryRun => "dry-run",
    }
}
