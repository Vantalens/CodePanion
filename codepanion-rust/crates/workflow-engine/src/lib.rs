use codepanion_providers::ProviderDefinition;
use codepanion_shared::{CodePanionError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepArchitecture {
    Shell,
    Agent,
}

#[derive(Debug, Clone)]
pub struct WorkflowStep {
    pub id: String,
    pub architecture: StepArchitecture,
    pub provider: Option<ProviderDefinition>,
}

#[derive(Debug, Clone)]
pub struct WorkflowDefinition {
    pub name: String,
    pub steps: Vec<WorkflowStep>,
}

impl WorkflowDefinition {
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
        let workflow = WorkflowDefinition {
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
