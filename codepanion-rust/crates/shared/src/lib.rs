pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodePanionError {
    InvalidInput(String),
    NotFound(String),
    PermissionDenied(String),
    Runtime(String),
}

impl std::fmt::Display for CodePanionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) => write!(f, "invalid input: {message}"),
            Self::NotFound(message) => write!(f, "not found: {message}"),
            Self::PermissionDenied(message) => write!(f, "permission denied: {message}"),
            Self::Runtime(message) => write!(f, "runtime error: {message}"),
        }
    }
}

impl std::error::Error for CodePanionError {}

impl From<std::io::Error> for CodePanionError {
    fn from(err: std::io::Error) -> Self {
        Self::Runtime(err.to_string())
    }
}

impl From<serde_json::Error> for CodePanionError {
    fn from(err: serde_json::Error) -> Self {
        Self::Runtime(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, CodePanionError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkflowRunEvent {
    RunStart {
        run_id: String,
        workflow_name: String,
    },
    StepStart {
        run_id: String,
        step_id: String,
    },
    StepOutput {
        run_id: String,
        step_id: String,
        chunk: String,
    },
    StepFinish {
        run_id: String,
        step_id: String,
        status: String,
    },
    RunFinish {
        run_id: String,
        workflow_name: String,
        status: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display_keeps_context() {
        let err = CodePanionError::InvalidInput("missing workflow".to_string());
        assert_eq!(err.to_string(), "invalid input: missing workflow");
    }
}
