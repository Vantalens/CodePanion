use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use codepanion_workflow_engine::{
    ArtifactType, DefinitionStore, GateDecision, GateResolution, HumanGateManager,
    WorkflowArtifact, WorkflowRun,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path as FsPath;

use crate::AppState;

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBoardResponse {
    pub workflows: Vec<WorkflowDefinition>,
    pub runs: Vec<WorkflowRunSummary>,
    pub gates: Vec<GateSummary>,
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
pub struct GateHistoryResponse {
    pub history: Vec<ArtifactSummary>,
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
#[serde(rename_all = "camelCase")]
pub struct LaunchWorkflowRequest {
    pub workflow: String,
    pub workspace: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchWorkflowResponse {
    pub run_id: String,
    pub workflow_name: String,
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

/// GET /workflow/board - List workflow definitions, recent runs, and paused gates
pub async fn get_workflow_board(State(state): State<AppState>) -> Json<WorkflowBoardResponse> {
    let definition_workflows = load_definition_store(&state.workflow_definitions_path)
        .map(|store| {
            store
                .workflows
                .into_iter()
                .map(|workflow| WorkflowDefinition {
                    id: workflow.name.clone(),
                    name: workflow.name,
                    description: if workflow.description.is_empty() {
                        None
                    } else {
                        Some(workflow.description)
                    },
                    project_id: String::new(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    // Get all workflows from orchestrator
    let orchestrator = state.orchestrator.lock().unwrap();
    let workflows = orchestrator.list_workflows();

    let mut workflow_defs = definition_workflows;
    workflow_defs.extend(
        workflows
            .into_iter()
            .map(|w| WorkflowDefinition {
                id: w.workflow_id.clone(),
                name: w.workflow_id.clone(),
                description: None,
                project_id: w.project_id,
            })
            .collect::<Vec<_>>(),
    );

    // Get recent runs from scheduler and history
    let history_runs = state.workflow_history.list().unwrap_or_default();
    let scheduler_runs = state.scheduler.list_all();

    let mut runs = history_runs
        .into_iter()
        .take(10) // Limit to 10 most recent from history
        .map(|r| WorkflowRunSummary {
            run_id: r.id,
            workflow_id: r.workflow_name,
            project_id: r.project_id,
            status: format!("{:?}", r.status),
            started_at: Some(r.started_at),
            completed_at: Some(r.ended_at),
        })
        .collect::<Vec<_>>();

    runs.extend(scheduler_runs.into_iter().map(|r| WorkflowRunSummary {
        run_id: r.run_id,
        workflow_id: r.workflow_id,
        project_id: r.project_id,
        status: format!("{:?}", r.status),
        started_at: r.started_at,
        completed_at: r.completed_at,
    }));

    // Get paused gates
    let manager = HumanGateManager::new(&state.workflow_history, &state.workflow_artifacts);
    let gates = manager
        .list_paused_gates()
        .unwrap_or_default()
        .into_iter()
        .map(|gate| {
            let project_id = project_id_for_run(&state, &gate.run_id);
            GateSummary {
                run_id: gate.run_id,
                step_id: gate.step_id,
                workflow_id: gate.workflow_name,
                project_id,
                message: gate.message,
                paused_at: gate.paused_at,
            }
        })
        .collect();

    Json(WorkflowBoardResponse {
        workflows: workflow_defs,
        runs,
        gates,
    })
}

/// POST /workflow/runs - Launch a workflow (GUI compatibility endpoint)
pub async fn launch_workflow(
    State(state): State<AppState>,
    Json(req): Json<LaunchWorkflowRequest>,
) -> Result<Json<LaunchWorkflowResponse>, StatusCode> {
    let store = load_definition_store(&state.workflow_definitions_path)?;
    store.validate().map_err(|_| StatusCode::BAD_REQUEST)?;
    let workflow = store
        .find_workflow(&req.workflow)
        .ok_or(StatusCode::NOT_FOUND)?
        .clone();
    workflow.validate().map_err(|_| StatusCode::BAD_REQUEST)?;

    let run_id = format!(
        "run-{}-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .as_secs(),
        crate::routes::workflow_execution::rand_for_run_id()
    );
    let project_id = req.workspace.unwrap_or_default();

    let runner = state.workflow_runner.lock().await;
    let mut event_rx = runner
        .start_workflow(run_id.clone(), project_id, workflow, HashMap::new())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let broadcaster = state.event_broadcaster.clone();
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if let Some(ws_event) = crate::routes::workflow_execution::convert_to_ws_event(&event) {
                broadcaster.broadcast(ws_event);
            }
        }
    });

    Ok(Json(LaunchWorkflowResponse {
        run_id,
        workflow_name: req.workflow,
    }))
}

/// POST /workflow/runs/:id/cancel - Cancel a workflow run (GUI compatibility endpoint)
pub async fn cancel_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Try to cancel via scheduler first
    if state.scheduler.cancel_run(&run_id).is_ok() {
        return Ok(Json(serde_json::json!({
            "success": true,
            "message": "Workflow cancelled"
        })));
    }

    // Try to cancel via workflow runner
    let runner = state.workflow_runner.lock().await;
    let _ = runner.cancel_workflow(&run_id).await;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Workflow cancellation requested"
    })))
}

/// GET /workflow/runs/:id - Get a single workflow run (GUI compatibility - wrap response)
pub async fn get_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if let Some(run) = state
        .workflow_history
        .get(&run_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let detail = run_detail_from_history_gui_format(run);
        return Ok(Json(serde_json::json!({ "run": detail })));
    }

    let run = state
        .scheduler
        .get_run(&run_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let detail = WorkflowRunDetailGUI {
        id: run.run_id.clone(),
        workflow_name: run.workflow_id.clone(),
        project_id: run.project_id.clone(),
        status: format!("{:?}", run.status),
        started_at: run.started_at,
        completed_at: run.completed_at,
        steps: vec![],
        current_step_id: None,
    };

    Ok(Json(serde_json::json!({ "run": detail })))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowRunDetailGUI {
    pub id: String,
    pub workflow_name: String,
    pub project_id: String,
    pub status: String,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub steps: Vec<StepSummaryGUI>,
    pub current_step_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StepSummaryGUI {
    pub id: String,
    pub name: String,
    pub status: String,
    pub output: String,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
}

fn run_detail_from_history_gui_format(run: WorkflowRun) -> WorkflowRunDetailGUI {
    WorkflowRunDetailGUI {
        id: run.id,
        workflow_name: run.workflow_name,
        project_id: run.project_id,
        status: format!("{:?}", run.status),
        started_at: Some(run.started_at),
        completed_at: Some(run.ended_at),
        steps: run
            .steps
            .into_iter()
            .map(|step| StepSummaryGUI {
                id: step.id.clone(),
                name: step.id,
                status: format!("{:?}", step.status),
                output: step.stdout.unwrap_or_default() + &step.stderr.unwrap_or_default(),
                started_at: step.started_at,
                completed_at: step.ended_at,
            })
            .collect(),
        current_step_id: None,
    }
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
            project_id: r.project_id,
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
        .map(artifact_summary)
        .collect();

    Ok(Json(ArtifactsResponse { artifacts }))
}

fn artifact_summary(artifact: WorkflowArtifact) -> ArtifactSummary {
    ArtifactSummary {
        key: artifact.id,
        artifact_type: artifact.artifact_type,
        title: artifact.title,
        size: artifact.content.len() as u64,
        content: artifact.content,
        files: artifact.files,
        step_id: artifact.step_id,
        role: artifact.role,
        created_at: artifact.created_at,
    }
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
        .map(|gate| {
            let project_id = project_id_for_run(&state, &gate.run_id);
            GateSummary {
                run_id: gate.run_id,
                step_id: gate.step_id,
                workflow_id: gate.workflow_name,
                project_id,
                message: gate.message,
                paused_at: gate.paused_at,
            }
        })
        .collect();

    Json(GatesResponse { gates })
}

/// GET /api/v1/workflow/gates/:run_id/:step_id/history - List prior gate decisions
pub async fn get_gate_history(
    State(state): State<AppState>,
    Path((run_id, step_id)): Path<(String, String)>,
) -> Result<Json<GateHistoryResponse>, StatusCode> {
    let artifacts = state
        .workflow_artifacts
        .get_by_type(&run_id, ArtifactType::HumanDecision)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let history = artifacts
        .into_iter()
        .filter(|artifact| artifact.step_id.as_deref() == Some(step_id.as_str()))
        .map(artifact_summary)
        .collect();

    Ok(Json(GateHistoryResponse { history }))
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

    // If should_resume is true, resume the workflow execution
    if result.should_resume {
        // Try to resume via scheduler if the run is there
        if let Some(_run) = state.scheduler.get_run(&run_id) {
            let _ = state.scheduler.resume_run(&run_id);
        }

        // TODO: If not in scheduler, load from history and restart from resume_step_id
        // This requires implementing workflow resumption in the workflow runner
    }

    Ok(Json(ResolveGateResponse {
        artifact_id: result.artifact_id,
        should_resume: result.should_resume,
        resume_step_id: result.resume_step_id,
        updated_values: result.updated_values,
    }))
}

fn workflow_status_label(run: &WorkflowRun) -> &'static str {
    match run.status {
        codepanion_workflow_engine::WorkflowRunStatus::Success => "success",
        codepanion_workflow_engine::WorkflowRunStatus::Failed => "failed",
        codepanion_workflow_engine::WorkflowRunStatus::Paused => "paused",
        codepanion_workflow_engine::WorkflowRunStatus::DryRun => "dry-run",
    }
}

fn project_id_for_run(state: &AppState, run_id: &str) -> String {
    state
        .workflow_history
        .get(run_id)
        .ok()
        .flatten()
        .map(|run| run.project_id)
        .or_else(|| state.scheduler.get_run(run_id).map(|run| run.project_id))
        .unwrap_or_default()
}

fn load_definition_store(path: &FsPath) -> Result<DefinitionStore, StatusCode> {
    if !path.exists() {
        return Ok(DefinitionStore::new());
    }

    let raw = std::fs::read_to_string(path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    DefinitionStore::from_json(&raw).map_err(|_| StatusCode::BAD_REQUEST)
}
