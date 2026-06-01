// W-02: Step executor
//
// 支持 shell / agent / provider 三类执行。
// 支持依赖顺序、失败短路、取消。

use crate::definition::{WorkflowArchitecture, WorkflowDefinition, WorkflowStep};
use codepanion_shared::{CodePanionError, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

/// Step 执行结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepExecutionResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

impl StepExecutionResult {
    pub fn success(stdout: String) -> Self {
        Self {
            exit_code: 0,
            stdout,
            stderr: String::new(),
            truncated: false,
        }
    }

    pub fn failure(exit_code: i32, stderr: String) -> Self {
        Self {
            exit_code,
            stdout: String::new(),
            stderr,
            truncated: false,
        }
    }

    pub fn is_success(&self) -> bool {
        self.exit_code == 0
    }
}

/// Step 运行状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StepStatus {
    Pending,
    Running,
    Success,
    Failed,
    Skipped,
    Checkpoint,
}

/// Step 运行记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepRun {
    pub id: String,
    pub status: StepStatus,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub exit_code: Option<i32>,
    pub started_at: Option<u64>,
    pub ended_at: Option<u64>,
    pub message: Option<String>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub truncated: bool,
}

impl StepRun {
    pub fn new(step: &WorkflowStep) -> Self {
        Self {
            id: step.id.clone(),
            status: StepStatus::Pending,
            command: step.command.clone(),
            args: step.args.clone(),
            exit_code: None,
            started_at: None,
            ended_at: None,
            message: None,
            stdout: None,
            stderr: None,
            truncated: false,
        }
    }

    pub fn mark_running(&mut self) {
        self.status = StepStatus::Running;
        self.started_at = Some(current_timestamp());
    }

    pub fn mark_success(&mut self, result: StepExecutionResult) {
        self.status = StepStatus::Success;
        self.exit_code = Some(result.exit_code);
        self.ended_at = Some(current_timestamp());
        self.stdout = Some(result.stdout);
        self.stderr = Some(result.stderr);
        self.truncated = result.truncated;
    }

    pub fn mark_failed(&mut self, result: StepExecutionResult, message: Option<String>) {
        self.status = StepStatus::Failed;
        self.exit_code = Some(result.exit_code);
        self.ended_at = Some(current_timestamp());
        self.message = message;
        self.stdout = Some(result.stdout);
        self.stderr = Some(result.stderr);
        self.truncated = result.truncated;
    }

    pub fn mark_skipped(&mut self, reason: String) {
        self.status = StepStatus::Skipped;
        self.message = Some(reason);
    }

    pub fn mark_checkpoint(&mut self) {
        self.status = StepStatus::Checkpoint;
        self.message = Some("manual checkpoint required".to_string());
    }
}

/// Workflow 运行状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkflowRunStatus {
    Success,
    Failed,
    Paused,
    DryRun,
}

/// Workflow 运行记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub id: String,
    pub workflow_name: String,
    pub status: WorkflowRunStatus,
    pub values: HashMap<String, String>,
    pub started_at: u64,
    pub ended_at: u64,
    pub steps: Vec<StepRun>,
}

impl WorkflowRun {
    pub fn new(workflow: &WorkflowDefinition, values: HashMap<String, String>) -> Self {
        let timestamp = current_timestamp();
        let id = format!("run-{}-{:x}", timestamp, rand::random::<u32>());

        Self {
            id,
            workflow_name: workflow.name.clone(),
            status: WorkflowRunStatus::Success,
            values,
            started_at: timestamp,
            ended_at: timestamp,
            steps: Vec::new(),
        }
    }
}

/// Step executor trait
pub trait StepExecutor: Send + Sync {
    fn execute_shell(
        &self,
        command: &str,
        args: &[String],
    ) -> impl std::future::Future<Output = Result<StepExecutionResult>> + Send;

    fn execute_agent(
        &self,
        prompt: &str,
        step: &WorkflowStep,
    ) -> impl std::future::Future<Output = Result<StepExecutionResult>> + Send;
}

/// 默认的 shell executor（使用 std::process::Command）
pub struct DefaultShellExecutor;

impl StepExecutor for DefaultShellExecutor {
    async fn execute_shell(&self, command: &str, args: &[String]) -> Result<StepExecutionResult> {
        let output = Command::new(command)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| {
                CodePanionError::Runtime(format!("failed to execute command '{}': {}", command, e))
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let exit_code = output.status.code().unwrap_or(-1);

        Ok(StepExecutionResult {
            exit_code,
            stdout,
            stderr,
            truncated: false,
        })
    }

    async fn execute_agent(
        &self,
        _prompt: &str,
        _step: &WorkflowStep,
    ) -> Result<StepExecutionResult> {
        // Agent execution 需要集成 agent runtime，这里先返回错误
        Err(CodePanionError::Runtime(
            "agent execution not implemented yet".to_string(),
        ))
    }
}

/// Workflow executor
pub struct WorkflowExecutor<E: StepExecutor> {
    executor: E,
}

impl<E: StepExecutor> WorkflowExecutor<E> {
    pub fn new(executor: E) -> Self {
        Self { executor }
    }

    /// 执行 workflow
    pub async fn run(
        &self,
        workflow: &WorkflowDefinition,
        values: HashMap<String, String>,
        dry_run: bool,
    ) -> Result<WorkflowRun> {
        let mut run = WorkflowRun::new(workflow, values);
        let mut successful = HashSet::new();

        if dry_run {
            run.status = WorkflowRunStatus::DryRun;
        }

        for step in &workflow.steps {
            // 检查依赖
            let missing_deps: Vec<_> = step
                .depends_on
                .iter()
                .filter(|dep| !successful.contains(dep.as_str()))
                .cloned()
                .collect();

            if !missing_deps.is_empty() {
                let mut step_run = StepRun::new(step);
                step_run.mark_skipped(format!("missing dependencies: {}", missing_deps.join(", ")));
                run.steps.push(step_run);
                run.status = WorkflowRunStatus::Failed;
                break;
            }

            // 检查 checkpoint
            if step.checkpoint {
                let mut step_run = StepRun::new(step);
                step_run.mark_checkpoint();
                run.steps.push(step_run);
                run.status = WorkflowRunStatus::Paused;
                break;
            }

            // 执行 step
            let mut step_run = StepRun::new(step);

            if dry_run {
                step_run.status = StepStatus::Success;
                run.steps.push(step_run);
                successful.insert(step.id.clone());
                continue;
            }

            step_run.mark_running();

            let result = self.execute_step(step).await;

            match result {
                Ok(exec_result) => {
                    if exec_result.is_success() {
                        step_run.mark_success(exec_result);
                        successful.insert(step.id.clone());
                    } else {
                        step_run.mark_failed(exec_result, None);
                        run.status = WorkflowRunStatus::Failed;
                        run.steps.push(step_run);
                        break;
                    }
                }
                Err(e) => {
                    let error_result = StepExecutionResult::failure(-1, e.to_string());
                    step_run.mark_failed(error_result, Some(format!("executor error: {}", e)));
                    run.status = WorkflowRunStatus::Failed;
                    run.steps.push(step_run);
                    break;
                }
            }

            run.steps.push(step_run);
        }

        run.ended_at = current_timestamp();
        Ok(run)
    }

    /// 执行单个 step
    async fn execute_step(&self, step: &WorkflowStep) -> Result<StepExecutionResult> {
        let architecture = step.resolve_architecture();

        match architecture {
            WorkflowArchitecture::Shell => {
                let command = step.command.as_ref().ok_or_else(|| {
                    CodePanionError::InvalidInput(format!(
                        "step {} has architecture=shell but no command",
                        step.id
                    ))
                })?;

                self.executor.execute_shell(command, &step.args).await
            }
            WorkflowArchitecture::Agent => {
                // 构建 agent prompt（简化版本）
                let prompt = format!("Execute step: {}", step.id);
                self.executor.execute_agent(&prompt, step).await
            }
        }
    }
}

impl WorkflowExecutor<DefaultShellExecutor> {
    pub fn with_default_executor() -> Self {
        Self::new(DefaultShellExecutor)
    }
}

// 辅助函数

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

// 为了避免依赖 rand crate，使用简单的随机数生成
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::definition::{WorkflowContextPolicy, WorkflowProvider};

    #[test]
    fn test_step_run_lifecycle() {
        let step = WorkflowStep {
            id: "test-step".to_string(),
            tool: "local".to_string(),
            role: None,
            model: None,
            provider: WorkflowProvider::Local,
            architecture: Some(WorkflowArchitecture::Shell),
            permissions: vec![],
            context_policy: WorkflowContextPolicy::default(),
            human_gate: None,
            artifacts: vec![],
            template: None,
            command: Some("echo".to_string()),
            args: vec!["hello".to_string()],
            values: HashMap::new(),
            depends_on: vec![],
            checkpoint: false,
        };

        let mut step_run = StepRun::new(&step);
        assert_eq!(step_run.status, StepStatus::Pending);

        step_run.mark_running();
        assert_eq!(step_run.status, StepStatus::Running);
        assert!(step_run.started_at.is_some());

        let result = StepExecutionResult::success("hello\n".to_string());
        step_run.mark_success(result);
        assert_eq!(step_run.status, StepStatus::Success);
        assert_eq!(step_run.exit_code, Some(0));
        assert!(step_run.ended_at.is_some());
    }

    #[test]
    fn test_step_run_failure() {
        let step = WorkflowStep {
            id: "test-step".to_string(),
            tool: "local".to_string(),
            role: None,
            model: None,
            provider: WorkflowProvider::Local,
            architecture: Some(WorkflowArchitecture::Shell),
            permissions: vec![],
            context_policy: WorkflowContextPolicy::default(),
            human_gate: None,
            artifacts: vec![],
            template: None,
            command: Some("false".to_string()),
            args: vec![],
            values: HashMap::new(),
            depends_on: vec![],
            checkpoint: false,
        };

        let mut step_run = StepRun::new(&step);
        step_run.mark_running();

        let result = StepExecutionResult::failure(1, "command failed".to_string());
        step_run.mark_failed(result, Some("execution failed".to_string()));

        assert_eq!(step_run.status, StepStatus::Failed);
        assert_eq!(step_run.exit_code, Some(1));
        assert_eq!(step_run.message, Some("execution failed".to_string()));
    }

    #[test]
    fn test_step_run_skipped() {
        let step = WorkflowStep {
            id: "test-step".to_string(),
            tool: "local".to_string(),
            role: None,
            model: None,
            provider: WorkflowProvider::Local,
            architecture: Some(WorkflowArchitecture::Shell),
            permissions: vec![],
            context_policy: WorkflowContextPolicy::default(),
            human_gate: None,
            artifacts: vec![],
            template: None,
            command: Some("echo".to_string()),
            args: vec![],
            values: HashMap::new(),
            depends_on: vec![],
            checkpoint: false,
        };

        let mut step_run = StepRun::new(&step);
        step_run.mark_skipped("missing dependency".to_string());

        assert_eq!(step_run.status, StepStatus::Skipped);
        assert_eq!(step_run.message, Some("missing dependency".to_string()));
    }

    #[tokio::test]
    async fn test_workflow_executor_dry_run() {
        let workflow = WorkflowDefinition {
            name: "test-workflow".to_string(),
            description: "Test workflow".to_string(),
            params: HashMap::new(),
            steps: vec![WorkflowStep {
                id: "step1".to_string(),
                tool: "local".to_string(),
                role: None,
                model: None,
                provider: WorkflowProvider::Local,
                architecture: Some(WorkflowArchitecture::Shell),
                permissions: vec![],
                context_policy: WorkflowContextPolicy::default(),
                human_gate: None,
                artifacts: vec![],
                template: None,
                command: Some("echo".to_string()),
                args: vec!["hello".to_string()],
                values: HashMap::new(),
                depends_on: vec![],
                checkpoint: false,
            }],
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        let executor = WorkflowExecutor::with_default_executor();
        let run = executor.run(&workflow, HashMap::new(), true).await.unwrap();

        assert_eq!(run.status, WorkflowRunStatus::DryRun);
        assert_eq!(run.steps.len(), 1);
        assert_eq!(run.steps[0].status, StepStatus::Success);
    }

    #[tokio::test]
    async fn test_workflow_executor_missing_dependency() {
        let workflow = WorkflowDefinition {
            name: "test-workflow".to_string(),
            description: "Test workflow".to_string(),
            params: HashMap::new(),
            steps: vec![WorkflowStep {
                id: "step1".to_string(),
                tool: "local".to_string(),
                role: None,
                model: None,
                provider: WorkflowProvider::Local,
                architecture: Some(WorkflowArchitecture::Shell),
                permissions: vec![],
                context_policy: WorkflowContextPolicy::default(),
                human_gate: None,
                artifacts: vec![],
                template: None,
                command: Some("echo".to_string()),
                args: vec![],
                values: HashMap::new(),
                depends_on: vec!["non-existent".to_string()],
                checkpoint: false,
            }],
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        let executor = WorkflowExecutor::with_default_executor();
        let run = executor
            .run(&workflow, HashMap::new(), false)
            .await
            .unwrap();

        assert_eq!(run.status, WorkflowRunStatus::Failed);
        assert_eq!(run.steps.len(), 1);
        assert_eq!(run.steps[0].status, StepStatus::Skipped);
        assert!(
            run.steps[0]
                .message
                .as_ref()
                .unwrap()
                .contains("missing dependencies")
        );
    }

    #[tokio::test]
    async fn test_workflow_executor_checkpoint() {
        let workflow = WorkflowDefinition {
            name: "test-workflow".to_string(),
            description: "Test workflow".to_string(),
            params: HashMap::new(),
            steps: vec![WorkflowStep {
                id: "step1".to_string(),
                tool: "local".to_string(),
                role: None,
                model: None,
                provider: WorkflowProvider::Local,
                architecture: Some(WorkflowArchitecture::Shell),
                permissions: vec![],
                context_policy: WorkflowContextPolicy::default(),
                human_gate: None,
                artifacts: vec![],
                template: None,
                command: Some("echo".to_string()),
                args: vec![],
                values: HashMap::new(),
                depends_on: vec![],
                checkpoint: true,
            }],
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        let executor = WorkflowExecutor::with_default_executor();
        let run = executor
            .run(&workflow, HashMap::new(), false)
            .await
            .unwrap();

        assert_eq!(run.status, WorkflowRunStatus::Paused);
        assert_eq!(run.steps.len(), 1);
        assert_eq!(run.steps[0].status, StepStatus::Checkpoint);
    }

    #[tokio::test]
    async fn test_workflow_executor_shell_success() {
        // 使用跨平台的命令
        #[cfg(target_os = "windows")]
        let (command, args) = ("cmd", vec!["/C".to_string(), "echo hello".to_string()]);
        #[cfg(not(target_os = "windows"))]
        let (command, args) = ("echo", vec!["hello".to_string()]);

        let workflow = WorkflowDefinition {
            name: "test-workflow".to_string(),
            description: "Test workflow".to_string(),
            params: HashMap::new(),
            steps: vec![WorkflowStep {
                id: "step1".to_string(),
                tool: "local".to_string(),
                role: None,
                model: None,
                provider: WorkflowProvider::Local,
                architecture: Some(WorkflowArchitecture::Shell),
                permissions: vec![],
                context_policy: WorkflowContextPolicy::default(),
                human_gate: None,
                artifacts: vec![],
                template: None,
                command: Some(command.to_string()),
                args,
                values: HashMap::new(),
                depends_on: vec![],
                checkpoint: false,
            }],
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        let executor = WorkflowExecutor::with_default_executor();
        let run = executor
            .run(&workflow, HashMap::new(), false)
            .await
            .unwrap();

        assert_eq!(run.status, WorkflowRunStatus::Success);
        assert_eq!(run.steps.len(), 1);
        assert_eq!(run.steps[0].status, StepStatus::Success);
        assert_eq!(run.steps[0].exit_code, Some(0));
        assert!(run.steps[0].stdout.as_ref().unwrap().contains("hello"));
    }
}
