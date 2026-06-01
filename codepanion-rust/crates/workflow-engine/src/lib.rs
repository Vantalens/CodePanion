// W-01: Workflow definition
pub mod definition;

// W-02: Step executor
pub mod executor;

// W-03: Run history
pub mod history;

pub use definition::{
    DefinitionStore, WorkflowArchitecture, WorkflowArtifactType, WorkflowContextPolicy,
    WorkflowDefinition, WorkflowPermission, WorkflowProvider, WorkflowStep,
};

pub use executor::{
    DefaultShellExecutor, StepExecutionResult, StepExecutor, StepRun, StepStatus, WorkflowExecutor,
    WorkflowRun, WorkflowRunStatus,
};

pub use history::WorkflowRunHistory;

// 旧的简化版本（保留用于向后兼容）
use codepanion_providers::ProviderDefinition;
use codepanion_shared::{CodePanionError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepArchitecture {
    Shell,
    Agent,
}

#[derive(Debug, Clone)]
pub struct WorkflowStepLegacy {
    pub id: String,
    pub architecture: StepArchitecture,
    pub provider: Option<ProviderDefinition>,
}

#[derive(Debug, Clone)]
pub struct WorkflowDefinitionLegacy {
    pub name: String,
    pub steps: Vec<WorkflowStepLegacy>,
}

impl WorkflowDefinitionLegacy {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            return Err(CodePanionError::InvalidInput(
                "workflow name is required".to_string(),
            ));
        }
        if self.steps.is_empty() {
            return Err(CodePanionError::InvalidInput(
                "workflow requires at least one step".to_string(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_requires_steps() {
        let workflow = WorkflowDefinitionLegacy {
            name: "empty".to_string(),
            steps: vec![],
        };

        assert!(
            workflow
                .validate()
                .unwrap_err()
                .to_string()
                .contains("step")
        );
    }
}
