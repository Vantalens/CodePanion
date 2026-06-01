use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::artifacts::{ArtifactInput, ArtifactType, WorkflowArtifactStore};
use crate::history::WorkflowRunHistory;
use crate::Result;

/// Human gate decision types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GateDecision {
    Approve,
    Reject,
    Retry,
}

/// Request to resolve a human gate
#[derive(Debug, Clone)]
pub struct GateResolution {
    pub decision: GateDecision,
    pub message: Option<String>,
    pub constraints: Vec<String>,
}

/// A paused workflow gate waiting for human decision
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedGate {
    pub run_id: String,
    pub workflow_name: String,
    pub step_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default)]
    pub artifacts: Vec<String>,
    pub paused_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_decision: Option<LastDecision>,
}

/// Last decision made on a gate (for retry cases)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastDecision {
    pub decision: String,
    pub content: String,
    pub at: u64,
}

/// Result of resolving a gate
#[derive(Debug, Clone)]
pub struct GateResolutionResult {
    pub artifact_id: String,
    pub should_resume: bool,
    pub resume_step_id: Option<String>,
    pub updated_values: HashMap<String, String>,
}

/// Human gate manager
pub struct HumanGateManager<'a> {
    history: &'a WorkflowRunHistory,
    artifacts: &'a WorkflowArtifactStore,
}

impl<'a> HumanGateManager<'a> {
    /// Create a new human gate manager
    pub fn new(history: &'a WorkflowRunHistory, artifacts: &'a WorkflowArtifactStore) -> Self {
        Self { history, artifacts }
    }

    /// List all paused gates waiting for human decision
    pub fn list_paused_gates(&self) -> Result<Vec<PausedGate>> {
        let runs = self.history.list()?;
        let latest_decisions = self.collect_latest_decisions()?;

        let gates: Vec<PausedGate> = runs
            .into_iter()
            .filter(|run| {
                if run.status != crate::WorkflowRunStatus::Paused {
                    return false;
                }

                // Check if there's a decision
                if let Some(decision) = latest_decisions.get(&run.id) {
                    // Only show gates with retry or unknown decisions
                    decision.decision == "retry" || decision.decision == "unknown"
                } else {
                    // No decision yet, show the gate
                    true
                }
            })
            .filter_map(|run| {
                // Find the checkpoint step
                let checkpoint = run
                    .steps
                    .iter()
                    .find(|step| step.status == crate::StepStatus::Checkpoint)?;

                let last_decision = latest_decisions.get(&run.id).map(|d| LastDecision {
                    decision: d.decision.clone(),
                    content: d.content.clone(),
                    at: d.created_at,
                });

                Some(PausedGate {
                    run_id: run.id.clone(),
                    workflow_name: run.workflow_name.clone(),
                    step_id: checkpoint.id.clone(),
                    role: None, // TODO: Add role to StepRun
                    tool: None, // TODO: Add tool to StepRun
                    command: checkpoint.command.clone(),
                    args: checkpoint.args.clone(),
                    message: checkpoint.message.clone(),
                    artifacts: vec![], // TODO: Add artifacts to StepRun
                    paused_at: run.ended_at,
                    last_decision,
                })
            })
            .collect();

        Ok(gates)
    }

    /// Resolve a human gate with a decision
    pub fn resolve_gate(
        &self,
        run_id: &str,
        step_id: &str,
        resolution: GateResolution,
    ) -> Result<GateResolutionResult> {
        // Get the paused run
        let run = self
            .history
            .get(run_id)?
            .ok_or_else(|| crate::CodePanionError::NotFound(format!("run {} not found", run_id)))?;

        if run.status != crate::WorkflowRunStatus::Paused {
            return Err(crate::CodePanionError::InvalidInput(
                "run is not paused".to_string(),
            ));
        }

        // Find the checkpoint step
        let _checkpoint = run
            .steps
            .iter()
            .find(|step| step.id == step_id && step.status == crate::StepStatus::Checkpoint)
            .ok_or_else(|| {
                crate::CodePanionError::NotFound(format!("checkpoint step {} not found", step_id))
            })?;

        // Create human-decision artifact
        let mut content_lines = vec![format!(
            "decision={}",
            match resolution.decision {
                GateDecision::Approve => "approve",
                GateDecision::Reject => "reject",
                GateDecision::Retry => "retry",
            }
        )];

        if let Some(message) = &resolution.message {
            content_lines.push(format!("message={}", message));
        }

        if !resolution.constraints.is_empty() {
            content_lines.push(format!(
                "constraints={}",
                resolution.constraints.join(" | ")
            ));
        }

        let artifact_input = ArtifactInput {
            id: None,
            run_id: run_id.to_string(),
            workflow_name: run.workflow_name.clone(),
            step_id: Some(step_id.to_string()),
            role: None, // TODO: Get from checkpoint
            artifact_type: ArtifactType::HumanDecision,
            title: format!(
                "{}/{}: {:?}",
                run.workflow_name, step_id, resolution.decision
            ),
            content: content_lines.join("\n"),
            files: vec![],
            created_at: None,
        };

        let artifact = self.artifacts.append(artifact_input)?;

        // Determine if we should resume
        let should_resume = resolution.decision != GateDecision::Reject;

        // Determine resume step ID
        let resume_step_id = if resolution.decision == GateDecision::Retry {
            // Find the last successful step before the checkpoint
            let checkpoint_idx = run
                .steps
                .iter()
                .position(|step| step.id == step_id)
                .unwrap();

            let mut resume_id = step_id.to_string();
            for i in (0..checkpoint_idx).rev() {
                if run.steps[i].status == crate::StepStatus::Success {
                    resume_id = run.steps[i].id.clone();
                    break;
                }
            }
            Some(resume_id)
        } else if should_resume {
            Some(step_id.to_string())
        } else {
            None
        };

        // Merge constraints into values
        let mut updated_values = run.values.clone();
        if !resolution.constraints.is_empty() {
            updated_values.insert(
                "constraints".to_string(),
                resolution.constraints.join(" | "),
            );
        }

        Ok(GateResolutionResult {
            artifact_id: artifact.id,
            should_resume,
            resume_step_id,
            updated_values,
        })
    }

    /// Collect latest decisions for each run
    fn collect_latest_decisions(&self) -> Result<HashMap<String, LatestDecision>> {
        let artifacts = self.artifacts.list(None)?;
        let mut decisions = HashMap::new();

        // Artifacts are sorted by createdAt descending, so first occurrence is latest
        for artifact in artifacts {
            if artifact.artifact_type != ArtifactType::HumanDecision {
                continue;
            }

            if decisions.contains_key(&artifact.run_id) {
                continue;
            }

            let first_line = artifact.content.lines().next().unwrap_or("");
            let decision = if let Some(stripped) = first_line.strip_prefix("decision=") {
                stripped.to_string()
            } else {
                "unknown".to_string()
            };

            decisions.insert(
                artifact.run_id.clone(),
                LatestDecision {
                    decision,
                    content: artifact.content.clone(),
                    created_at: artifact.created_at,
                },
            );
        }

        Ok(decisions)
    }
}

#[derive(Debug, Clone)]
struct LatestDecision {
    decision: String,
    content: String,
    created_at: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::executor::{StepRun, StepStatus, WorkflowRun, WorkflowRunStatus};
    use tempfile::TempDir;

    fn temp_stores() -> (TempDir, WorkflowRunHistory, WorkflowArtifactStore) {
        let dir = TempDir::new().unwrap();
        let history_path = dir.path().join("history.ndjson");
        let artifacts_path = dir.path().join("artifacts.ndjson");
        let history = WorkflowRunHistory::new(history_path);
        let artifacts = WorkflowArtifactStore::new(artifacts_path);
        (dir, history, artifacts)
    }

    fn create_paused_run(id: &str, step_id: &str) -> WorkflowRun {
        WorkflowRun {
            id: id.to_string(),
            workflow_name: "test-workflow".to_string(),
            status: WorkflowRunStatus::Paused,
            values: HashMap::new(),
            started_at: 1000,
            ended_at: 2000,
            steps: vec![
                StepRun {
                    id: "step-1".to_string(),
                    status: StepStatus::Success,
                    command: Some("echo".to_string()),
                    args: vec!["hello".to_string()],
                    exit_code: Some(0),
                    started_at: Some(1000),
                    ended_at: Some(1500),
                    message: None,
                    stdout: Some("hello\n".to_string()),
                    stderr: None,
                    truncated: false,
                },
                StepRun {
                    id: step_id.to_string(),
                    status: StepStatus::Checkpoint,
                    command: None,
                    args: vec![],
                    exit_code: None,
                    started_at: Some(1500),
                    ended_at: Some(2000),
                    message: Some("Waiting for approval".to_string()),
                    stdout: None,
                    stderr: None,
                    truncated: false,
                },
            ],
        }
    }

    #[test]
    fn test_list_paused_gates() {
        let (_dir, history, artifacts) = temp_stores();

        // Create a paused run
        let run = create_paused_run("run-1", "gate-1");
        history.append(&run).unwrap();

        let manager = HumanGateManager::new(&history, &artifacts);
        let gates = manager.list_paused_gates().unwrap();

        assert_eq!(gates.len(), 1);
        assert_eq!(gates[0].run_id, "run-1");
        assert_eq!(gates[0].step_id, "gate-1");
        assert_eq!(gates[0].workflow_name, "test-workflow");
        assert!(gates[0].last_decision.is_none());
    }

    #[test]
    fn test_resolve_gate_approve() {
        let (_dir, history, artifacts) = temp_stores();

        let run = create_paused_run("run-1", "gate-1");
        history.append(&run).unwrap();

        let manager = HumanGateManager::new(&history, &artifacts);
        let resolution = GateResolution {
            decision: GateDecision::Approve,
            message: Some("Looks good".to_string()),
            constraints: vec![],
        };

        let result = manager.resolve_gate("run-1", "gate-1", resolution).unwrap();

        assert!(result.should_resume);
        assert_eq!(result.resume_step_id, Some("gate-1".to_string()));
        assert!(result.updated_values.is_empty());

        // Verify artifact was created
        let artifacts_list = artifacts.list(Some("run-1")).unwrap();
        assert_eq!(artifacts_list.len(), 1);
        assert_eq!(artifacts_list[0].artifact_type, ArtifactType::HumanDecision);
        assert!(artifacts_list[0].content.contains("decision=approve"));
    }

    #[test]
    fn test_resolve_gate_reject() {
        let (_dir, history, artifacts) = temp_stores();

        let run = create_paused_run("run-1", "gate-1");
        history.append(&run).unwrap();

        let manager = HumanGateManager::new(&history, &artifacts);
        let resolution = GateResolution {
            decision: GateDecision::Reject,
            message: Some("Not ready".to_string()),
            constraints: vec![],
        };

        let result = manager.resolve_gate("run-1", "gate-1", resolution).unwrap();

        assert!(!result.should_resume);
        assert_eq!(result.resume_step_id, None);
    }

    #[test]
    fn test_resolve_gate_retry() {
        let (_dir, history, artifacts) = temp_stores();

        let run = create_paused_run("run-1", "gate-1");
        history.append(&run).unwrap();

        let manager = HumanGateManager::new(&history, &artifacts);
        let resolution = GateResolution {
            decision: GateDecision::Retry,
            message: Some("Try again".to_string()),
            constraints: vec![],
        };

        let result = manager.resolve_gate("run-1", "gate-1", resolution).unwrap();

        assert!(result.should_resume);
        // Should resume from the last successful step (step-1)
        assert_eq!(result.resume_step_id, Some("step-1".to_string()));
    }

    #[test]
    fn test_resolve_gate_with_constraints() {
        let (_dir, history, artifacts) = temp_stores();

        let run = create_paused_run("run-1", "gate-1");
        history.append(&run).unwrap();

        let manager = HumanGateManager::new(&history, &artifacts);
        let resolution = GateResolution {
            decision: GateDecision::Approve,
            message: None,
            constraints: vec!["Add tests".to_string(), "Update docs".to_string()],
        };

        let result = manager.resolve_gate("run-1", "gate-1", resolution).unwrap();

        assert!(result.should_resume);
        assert_eq!(
            result.updated_values.get("constraints"),
            Some(&"Add tests | Update docs".to_string())
        );

        // Verify artifact contains constraints
        let artifacts_list = artifacts.list(Some("run-1")).unwrap();
        assert!(
            artifacts_list[0]
                .content
                .contains("constraints=Add tests | Update docs")
        );
    }

    #[test]
    fn test_list_gates_filters_approved() {
        let (_dir, history, artifacts) = temp_stores();

        let run = create_paused_run("run-1", "gate-1");
        history.append(&run).unwrap();

        // Approve the gate
        let manager = HumanGateManager::new(&history, &artifacts);
        let resolution = GateResolution {
            decision: GateDecision::Approve,
            message: None,
            constraints: vec![],
        };
        manager.resolve_gate("run-1", "gate-1", resolution).unwrap();

        // Gate should not appear in list anymore (approved gates are filtered out)
        let gates = manager.list_paused_gates().unwrap();
        assert_eq!(gates.len(), 0);
    }

    #[test]
    fn test_list_gates_keeps_retry() {
        let (_dir, history, artifacts) = temp_stores();

        let run = create_paused_run("run-1", "gate-1");
        history.append(&run).unwrap();

        // Retry the gate
        let manager = HumanGateManager::new(&history, &artifacts);
        let resolution = GateResolution {
            decision: GateDecision::Retry,
            message: Some("Try again".to_string()),
            constraints: vec![],
        };
        manager.resolve_gate("run-1", "gate-1", resolution).unwrap();

        // Gate should still appear (retry gates stay open)
        let gates = manager.list_paused_gates().unwrap();
        assert_eq!(gates.len(), 1);
        assert!(gates[0].last_decision.is_some());
        assert_eq!(gates[0].last_decision.as_ref().unwrap().decision, "retry");
    }
}
