// D-02: Workflow execution endpoints
//
// POST /api/v1/workflows/execute - 启动 workflow 执行
// POST /api/v1/workflows/:run_id/cancel - 取消 workflow
// POST /api/v1/workflows/:run_id/pause - 暂停 workflow
// POST /api/v1/workflows/:run_id/resume - 恢复 workflow
// GET /api/v1/workflows/active - 列出活跃的 workflow runs

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::AppState;
use crate::workflow_runner::WorkflowRunnerEvent;
use codepanion_workflow_engine::WorkflowDefinition;

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteWorkflowRequest {
    pub project_id: String,
    pub workflow: WorkflowDefinition,
    pub values: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteWorkflowResponse {
    pub run_id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveRunsResponse {
    pub runs: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResponse {
    pub success: bool,
    pub message: String,
}

// ============================================================================
// Route Handlers
// ============================================================================

/// POST /api/v1/workflows/execute - 启动 workflow 执行
pub async fn execute_workflow(
    State(state): State<AppState>,
    Json(req): Json<ExecuteWorkflowRequest>,
) -> Result<Json<ExecuteWorkflowResponse>, StatusCode> {
    // 生成 run_id
    let run_id = format!(
        "run-{}-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        rand::random::<u32>()
    );

    // 启动 workflow（fire-and-forget）
    let runner = state.workflow_runner.lock().await;
    let mut event_rx = runner
        .start_workflow(
            run_id.clone(),
            req.project_id.clone(),
            req.workflow,
            req.values.unwrap_or_default(),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Spawn 后台任务消费事件并推送到 WebSocket
    let broadcaster = state.event_broadcaster.clone();
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            // 将 WorkflowRunnerEvent 转换为 WorkflowRunEvent 并广播
            if let Some(ws_event) = convert_to_ws_event(&event) {
                broadcaster.broadcast(ws_event);
            }
        }
    });

    Ok(Json(ExecuteWorkflowResponse {
        run_id,
        status: "started".to_string(),
    }))
}

/// POST /api/v1/workflows/:run_id/cancel - 取消 workflow
pub async fn cancel_workflow(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<OperationResponse>, StatusCode> {
    let runner = state.workflow_runner.lock().await;

    match runner.cancel_workflow(&run_id).await {
        Ok(_) => Ok(Json(OperationResponse {
            success: true,
            message: format!("workflow {} cancelled", run_id),
        })),
        Err(e) => {
            eprintln!("Failed to cancel workflow {}: {}", run_id, e);
            Err(StatusCode::NOT_FOUND)
        }
    }
}

/// POST /api/v1/workflows/:run_id/pause - 暂停 workflow
pub async fn pause_workflow(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<OperationResponse>, StatusCode> {
    let runner = state.workflow_runner.lock().await;

    match runner.pause_workflow(&run_id).await {
        Ok(_) => Ok(Json(OperationResponse {
            success: true,
            message: format!("workflow {} paused", run_id),
        })),
        Err(e) => {
            eprintln!("Failed to pause workflow {}: {}", run_id, e);
            Err(StatusCode::NOT_IMPLEMENTED)
        }
    }
}

/// POST /api/v1/workflows/:run_id/resume - 恢复 workflow
pub async fn resume_workflow(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<OperationResponse>, StatusCode> {
    let runner = state.workflow_runner.lock().await;

    match runner.resume_workflow(&run_id).await {
        Ok(_) => Ok(Json(OperationResponse {
            success: true,
            message: format!("workflow {} resumed", run_id),
        })),
        Err(e) => {
            eprintln!("Failed to resume workflow {}: {}", run_id, e);
            Err(StatusCode::NOT_IMPLEMENTED)
        }
    }
}

/// GET /api/v1/workflows/active - 列出活跃的 workflow runs
pub async fn list_active_workflows(
    State(state): State<AppState>,
) -> Json<ActiveRunsResponse> {
    let runner = state.workflow_runner.lock().await;
    let runs = runner.list_active_runs().await;

    Json(ActiveRunsResponse { runs })
}

// ============================================================================
// Helper Functions
// ============================================================================

/// 将 WorkflowRunnerEvent 转换为 WorkflowRunEvent（用于 WebSocket 广播）
fn convert_to_ws_event(event: &WorkflowRunnerEvent) -> Option<codepanion_workflow_engine::WorkflowRunEvent> {
    match event {
        WorkflowRunnerEvent::WorkflowStarted { run_id, workflow_id, timestamp } => {
            Some(codepanion_workflow_engine::WorkflowRunEvent {
                event_type: "workflow-started".to_string(),
                run_id: run_id.clone(),
                project_id: "".to_string(), // TODO: 从 context 获取
                workflow_id: workflow_id.clone(),
                status: "running".to_string(),
                timestamp: *timestamp,
            })
        }
        WorkflowRunnerEvent::StepStarted { run_id, step_id, timestamp } => {
            Some(codepanion_workflow_engine::WorkflowRunEvent {
                event_type: "step-started".to_string(),
                run_id: run_id.clone(),
                project_id: "".to_string(),
                workflow_id: step_id.clone(),
                status: "running".to_string(),
                timestamp: *timestamp,
            })
        }
        WorkflowRunnerEvent::StepCompleted { run_id, step_id, status, timestamp, .. } => {
            Some(codepanion_workflow_engine::WorkflowRunEvent {
                event_type: "step-completed".to_string(),
                run_id: run_id.clone(),
                project_id: "".to_string(),
                workflow_id: step_id.clone(),
                status: status.clone(),
                timestamp: *timestamp,
            })
        }
        WorkflowRunnerEvent::WorkflowCompleted { run_id, status, timestamp } => {
            Some(codepanion_workflow_engine::WorkflowRunEvent {
                event_type: "workflow-completed".to_string(),
                run_id: run_id.clone(),
                project_id: "".to_string(),
                workflow_id: "".to_string(),
                status: status.clone(),
                timestamp: *timestamp,
            })
        }
        WorkflowRunnerEvent::WorkflowCancelled { run_id, timestamp } => {
            Some(codepanion_workflow_engine::WorkflowRunEvent {
                event_type: "workflow-cancelled".to_string(),
                run_id: run_id.clone(),
                project_id: "".to_string(),
                workflow_id: "".to_string(),
                status: "cancelled".to_string(),
                timestamp: *timestamp,
            })
        }
        WorkflowRunnerEvent::WorkflowPaused { run_id, step_id, reason, timestamp } => {
            Some(codepanion_workflow_engine::WorkflowRunEvent {
                event_type: "workflow-paused".to_string(),
                run_id: run_id.clone(),
                project_id: "".to_string(),
                workflow_id: step_id.clone(),
                status: reason.clone(),
                timestamp: *timestamp,
            })
        }
        WorkflowRunnerEvent::StepOutput { .. } => {
            // StepOutput 不需要转换为 WorkflowRunEvent
            None
        }
    }
}

// 简单的随机数生成（避免依赖 rand crate）
mod rand {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hash, Hasher};

    pub fn random<T: Hash + Default>() -> u32 {
        let state = RandomState::new();
        let mut hasher = state.build_hasher();
        T::default().hash(&mut hasher);
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .hash(&mut hasher);
        hasher.finish() as u32
    }
}
