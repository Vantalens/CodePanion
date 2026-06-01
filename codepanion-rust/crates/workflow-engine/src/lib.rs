// W-01: Workflow definition
pub mod definition;

// W-02: Step executor
pub mod executor;

// W-03: Run history
pub mod history;

// W-04: Artifact store
pub mod artifacts;

// W-05: Human gate
pub mod human_gate;

// M-01: Project registry
pub mod project;

// M-02.1: Model provider registry
pub mod model_provider;

// M-02.2: Global configuration
pub mod global_config;

pub use definition::{
    DefinitionStore, WorkflowArchitecture, WorkflowArtifactType, WorkflowContextPolicy,
    WorkflowDefinition, WorkflowPermission, WorkflowProvider, WorkflowStep,
};

pub use executor::{
    DefaultShellExecutor, StepExecutionResult, StepExecutor, StepRun, StepStatus, WorkflowExecutor,
    WorkflowRun, WorkflowRunStatus,
};

pub use history::WorkflowRunHistory;

pub use artifacts::{ArtifactInput, ArtifactType, WorkflowArtifact, WorkflowArtifactStore};

pub use human_gate::{
    GateDecision, GateResolution, GateResolutionResult, HumanGateManager, PausedGate,
};

pub use project::{Project, ProjectHealth, ProjectMetadata, ProjectRegistry, ProjectStats};

pub use model_provider::{
    ModelInfo, ModelPricing, ModelProvider, ProviderCapability, ProviderConfig, ProviderRegistry,
    ProviderStatus, ProviderType,
};

pub use global_config::{GlobalConfig, GlobalConfigManager};

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
