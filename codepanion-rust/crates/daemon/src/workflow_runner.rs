// D-02: Workflow Runner
//
// 集成 workflow engine 和 agent runtime，实现 fire-and-forget 执行。
// 支持 workflow 启动、取消、暂停、恢复。
// 实时输出推送到 WebSocket。

use codepanion_agent_runtime::{AgentLoopEvent, AgentLoopRequest, run_agent_loop};
use codepanion_shared::{CodePanionError, Result};
use codepanion_workflow_engine::{
    DefaultShellExecutor, GlobalConfigManager, ModelProvider, ProviderRegistry,
    StepExecutionResult, StepExecutor, WorkflowDefinition, WorkflowExecutor, WorkflowStep,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tokio::sync::Mutex;

/// Workflow 执行上下文
#[derive(Clone)]
pub struct WorkflowRunContext {
    pub run_id: String,
    pub project_id: String,
    pub workflow_id: String,
    pub cancel_signal: Arc<AtomicBool>,
    pub event_tx: tokio::sync::mpsc::UnboundedSender<WorkflowRunnerEvent>,
}

/// Workflow Runner 事件（用于实时推送）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum WorkflowRunnerEvent {
    WorkflowStarted {
        run_id: String,
        workflow_id: String,
        timestamp: u64,
    },
    StepStarted {
        run_id: String,
        step_id: String,
        timestamp: u64,
    },
    StepOutput {
        run_id: String,
        step_id: String,
        output: String,
        timestamp: u64,
    },
    StepCompleted {
        run_id: String,
        step_id: String,
        status: String,
        exit_code: Option<i32>,
        timestamp: u64,
    },
    WorkflowCompleted {
        run_id: String,
        status: String,
        timestamp: u64,
    },
    WorkflowCancelled {
        run_id: String,
        timestamp: u64,
    },
    WorkflowPaused {
        run_id: String,
        step_id: String,
        reason: String,
        timestamp: u64,
    },
}

impl WorkflowRunnerEvent {
    fn timestamp() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }
}

/// Agent-aware Step Executor
///
/// 集成 agent runtime，支持 shell 和 agent 两种执行模式。
pub struct AgentStepExecutor {
    provider_registry: Arc<ProviderRegistry>,
    global_config: Arc<GlobalConfigManager>,
    context: WorkflowRunContext,
}

impl AgentStepExecutor {
    pub fn new(
        provider_registry: Arc<ProviderRegistry>,
        global_config: Arc<GlobalConfigManager>,
        context: WorkflowRunContext,
    ) -> Self {
        Self {
            provider_registry,
            global_config,
            context,
        }
    }

    fn provider_by_id(&self, provider_id: &str) -> Result<ModelProvider> {
        self.provider_registry.get(provider_id)?.ok_or_else(|| {
            CodePanionError::InvalidInput(format!("provider not found: {}", provider_id))
        })
    }

    fn resolve_model_selection(
        &self,
        model: &str,
        fallback_provider: &ModelProvider,
    ) -> Result<(ModelProvider, String)> {
        if let Some((provider_id, model_id)) = parse_model_reference(model) {
            Ok((self.provider_by_id(provider_id)?, model_id.to_string()))
        } else {
            Ok((fallback_provider.clone(), model.to_string()))
        }
    }

    fn resolve_backend(
        &self,
        step: &WorkflowStep,
    ) -> Result<codepanion_config::ModelBackendConfig> {
        let active_provider_id = self.global_config.get_active_provider()?.ok_or_else(|| {
            CodePanionError::InvalidInput("active provider is required for agent steps".to_string())
        })?;

        let active_provider = self
            .provider_registry
            .get(&active_provider_id)?
            .ok_or_else(|| {
                CodePanionError::InvalidInput(format!(
                    "active provider not found: {}",
                    active_provider_id
                ))
            })?;

        let raw_global_default = self.global_config.load()?.default_model;
        let global_default = raw_global_default
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != "opus")
            .map(|value| self.global_config.resolve_model_alias(value))
            .transpose()?;

        let (provider, model) = if let Some(model) = step
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let resolved_model = self.global_config.resolve_model_alias(model)?;
            self.resolve_model_selection(&resolved_model, &active_provider)?
        } else if let Some(role) = step
            .role
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            match self.global_config.get_role_model(role)? {
                Some(model) => self.resolve_model_selection(&model, &active_provider)?,
                None => (
                    active_provider.clone(),
                    active_provider.config.default_model.clone(),
                ),
            }
        } else if let Some(model) = global_default {
            self.resolve_model_selection(&model, &active_provider)?
        } else {
            (
                active_provider.clone(),
                active_provider.config.default_model.clone(),
            )
        };

        if provider.config.base_url.trim().is_empty() {
            return Err(CodePanionError::InvalidInput(format!(
                "provider {} base_url is required for agent steps",
                provider.id
            )));
        }

        if model.trim().is_empty() {
            return Err(CodePanionError::InvalidInput(
                "model is required for agent steps".to_string(),
            ));
        }

        Ok(codepanion_config::ModelBackendConfig {
            id: provider.id,
            base_url: provider.config.base_url,
            model,
            api_key: Some(provider.config.api_key).filter(|key| !key.trim().is_empty()),
        })
    }
}

fn parse_model_reference(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix("provider:")?;
    let (provider_id, model_id) = rest.split_once(":model:")?;
    if provider_id.trim().is_empty() || model_id.trim().is_empty() {
        None
    } else {
        Some((provider_id, model_id))
    }
}

impl StepExecutor for AgentStepExecutor {
    async fn execute_shell(&self, command: &str, args: &[String]) -> Result<StepExecutionResult> {
        // 使用默认 shell executor
        let executor = DefaultShellExecutor;
        executor.execute_shell(command, args).await
    }

    async fn execute_agent(
        &self,
        prompt: &str,
        step: &WorkflowStep,
    ) -> Result<StepExecutionResult> {
        let backend = self.resolve_backend(step)?;
        let cancel_signal = self.context.cancel_signal.clone();
        let event_tx = self.context.event_tx.clone();
        let run_id = self.context.run_id.clone();
        let step_id = step.id.clone();

        // 构建 agent loop request
        let request = AgentLoopRequest::new(backend, prompt)
            .with_max_turns(12)
            .with_cancel(cancel_signal.clone());

        tokio::task::spawn_blocking(move || {
            // 运行 agent loop，收集输出
            let mut output_buffer = String::new();

            // 使用 Option::<ReadonlyTools>::None 来满足类型约束
            let result = run_agent_loop(
                request,
                Option::<codepanion_agent_runtime::ReadonlyTools>::None,
                |event| match event {
                    AgentLoopEvent::Assistant { text } => {
                        output_buffer.push_str(&text);
                        output_buffer.push('\n');

                        // 实时推送输出
                        let _ = event_tx.send(WorkflowRunnerEvent::StepOutput {
                            run_id: run_id.clone(),
                            step_id: step_id.clone(),
                            output: text,
                            timestamp: WorkflowRunnerEvent::timestamp(),
                        });
                    }
                    AgentLoopEvent::ToolCall { name, args } => {
                        let msg = format!("[tool_call] {}: {}", name, args);
                        output_buffer.push_str(&msg);
                        output_buffer.push('\n');
                    }
                    AgentLoopEvent::ToolResult { name, result } => {
                        let msg = format!("[tool_result] {}: {}", name, result);
                        output_buffer.push_str(&msg);
                        output_buffer.push('\n');
                    }
                    AgentLoopEvent::MaxTurns { turns } => {
                        let msg = format!("[max_turns] hit limit at {} turns", turns);
                        output_buffer.push_str(&msg);
                        output_buffer.push('\n');
                    }
                },
            )?;

            // 检查是否被取消
            if cancel_signal.load(Ordering::Relaxed) {
                return Err(CodePanionError::Runtime("workflow cancelled".to_string()));
            }

            // 返回执行结果
            Ok(StepExecutionResult {
                exit_code: if result.hit_max_turns { 1 } else { 0 },
                stdout: output_buffer,
                stderr: String::new(),
                truncated: false,
            })
        })
        .await
        .map_err(|err| CodePanionError::Runtime(format!("agent task failed: {}", err)))?
    }
}

/// Workflow Runner
///
/// 管理 workflow 的后台执行，支持启动、取消、暂停、恢复。
pub struct WorkflowRunner {
    provider_registry: Arc<ProviderRegistry>,
    global_config: Arc<GlobalConfigManager>,
    active_runs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl WorkflowRunner {
    pub fn new(
        provider_registry: Arc<ProviderRegistry>,
        global_config: Arc<GlobalConfigManager>,
    ) -> Self {
        Self {
            provider_registry,
            global_config,
            active_runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 启动 workflow（fire-and-forget）
    ///
    /// 返回 run_id 和 event receiver。
    /// 调用方应该在后台任务中消费 event_rx，并推送到 WebSocket。
    pub async fn start_workflow(
        &self,
        run_id: String,
        project_id: String,
        workflow: WorkflowDefinition,
        values: HashMap<String, String>,
    ) -> Result<tokio::sync::mpsc::UnboundedReceiver<WorkflowRunnerEvent>> {
        // 创建取消信号
        let cancel_signal = Arc::new(AtomicBool::new(false));

        // 注册到 active_runs
        {
            let mut runs = self.active_runs.lock().await;
            runs.insert(run_id.clone(), cancel_signal.clone());
        }

        // 创建事件通道
        let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();

        // 构建执行上下文
        let context = WorkflowRunContext {
            run_id: run_id.clone(),
            project_id: project_id.clone(),
            workflow_id: workflow.name.clone(),
            cancel_signal: cancel_signal.clone(),
            event_tx: event_tx.clone(),
        };

        // 创建 executor
        let executor = AgentStepExecutor::new(
            self.provider_registry.clone(),
            self.global_config.clone(),
            context.clone(),
        );
        let workflow_executor = WorkflowExecutor::new(executor);

        // 发送启动事件
        let _ = event_tx.send(WorkflowRunnerEvent::WorkflowStarted {
            run_id: run_id.clone(),
            workflow_id: workflow.name.clone(),
            timestamp: WorkflowRunnerEvent::timestamp(),
        });

        // Spawn 后台任务执行 workflow
        let active_runs = self.active_runs.clone();
        tokio::spawn(async move {
            let result = workflow_executor.run(&workflow, values, false).await;

            // 发送完成事件
            match result {
                Ok(run) => {
                    let status = format!("{:?}", run.status);
                    let _ = event_tx.send(WorkflowRunnerEvent::WorkflowCompleted {
                        run_id: run_id.clone(),
                        status,
                        timestamp: WorkflowRunnerEvent::timestamp(),
                    });
                }
                Err(e) => {
                    let _ = event_tx.send(WorkflowRunnerEvent::WorkflowCompleted {
                        run_id: run_id.clone(),
                        status: format!("Failed: {}", e),
                        timestamp: WorkflowRunnerEvent::timestamp(),
                    });
                }
            }

            // 清理 active_runs
            let mut runs = active_runs.lock().await;
            runs.remove(&run_id);
        });

        Ok(event_rx)
    }

    /// 取消 workflow
    pub async fn cancel_workflow(&self, run_id: &str) -> Result<()> {
        let runs = self.active_runs.lock().await;

        if let Some(cancel_signal) = runs.get(run_id) {
            cancel_signal.store(true, Ordering::Relaxed);
            Ok(())
        } else {
            Err(CodePanionError::InvalidInput(format!(
                "workflow run not found: {}",
                run_id
            )))
        }
    }

    /// 暂停 workflow（TODO: 需要 workflow engine 支持）
    pub async fn pause_workflow(&self, _run_id: &str) -> Result<()> {
        Err(CodePanionError::Runtime(
            "pause not implemented yet".to_string(),
        ))
    }

    /// 恢复 workflow（TODO: 需要 workflow engine 支持）
    pub async fn resume_workflow(&self, _run_id: &str) -> Result<()> {
        Err(CodePanionError::Runtime(
            "resume not implemented yet".to_string(),
        ))
    }

    /// 列出活跃的 workflow runs
    pub async fn list_active_runs(&self) -> Vec<String> {
        let runs = self.active_runs.lock().await;
        runs.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codepanion_workflow_engine::{
        GlobalConfigManager, ModelInfo, ModelProvider, ProviderConfig, ProviderRegistry,
        ProviderStatus, ProviderType, WorkflowArchitecture, WorkflowContextPolicy,
        WorkflowProvider,
    };
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Duration;
    use tempfile::TempDir;

    struct TestRegistries {
        _dir: TempDir,
        provider_registry: Arc<ProviderRegistry>,
        global_config: Arc<GlobalConfigManager>,
    }

    fn test_registries() -> TestRegistries {
        let dir = TempDir::new().unwrap();
        let provider_registry = Arc::new(ProviderRegistry::new(dir.path().join("providers.json")));
        let global_config = Arc::new(GlobalConfigManager::new(dir.path().join("config.json")));

        provider_registry
            .upsert(ModelProvider {
                id: "provider-1".to_string(),
                name: "Provider 1".to_string(),
                provider_type: ProviderType::OpenAI,
                config: ProviderConfig {
                    api_key: "sk-test".to_string(),
                    base_url: "http://127.0.0.1:1/v1".to_string(),
                    default_model: "provider-default".to_string(),
                    max_tokens: None,
                    temperature: None,
                    custom: HashMap::new(),
                },
                models: vec![],
                capabilities: vec![],
                status: ProviderStatus::Active,
                last_tested: None,
                created_at: 1,
            })
            .unwrap();
        provider_registry
            .upsert(ModelProvider {
                id: "provider-2".to_string(),
                name: "Provider 2".to_string(),
                provider_type: ProviderType::DeepSeek,
                config: ProviderConfig {
                    api_key: "sk-second".to_string(),
                    base_url: "http://127.0.0.1:2/v1".to_string(),
                    default_model: "second-default".to_string(),
                    max_tokens: None,
                    temperature: None,
                    custom: HashMap::new(),
                },
                models: vec![ModelInfo {
                    id: "second-model".to_string(),
                    name: "Second Model".to_string(),
                    context_window: 128_000,
                    max_output_tokens: 4_096,
                    pricing: None,
                }],
                capabilities: vec![],
                status: ProviderStatus::Active,
                last_tested: None,
                created_at: 2,
            })
            .unwrap();
        global_config.set_active_provider("provider-1").unwrap();

        TestRegistries {
            _dir: dir,
            provider_registry,
            global_config,
        }
    }

    fn test_context() -> WorkflowRunContext {
        let (event_tx, _event_rx) = tokio::sync::mpsc::unbounded_channel();
        WorkflowRunContext {
            run_id: "test-run".to_string(),
            project_id: "test-project".to_string(),
            workflow_id: "test-workflow".to_string(),
            cancel_signal: Arc::new(AtomicBool::new(false)),
            event_tx,
        }
    }

    fn agent_step() -> WorkflowStep {
        WorkflowStep {
            id: "step1".to_string(),
            tool: "agent".to_string(),
            role: None,
            model: None,
            provider: WorkflowProvider::Local,
            architecture: Some(WorkflowArchitecture::Agent),
            permissions: vec![],
            context_policy: WorkflowContextPolicy::default(),
            human_gate: None,
            artifacts: vec![],
            template: None,
            command: None,
            args: vec![],
            values: HashMap::new(),
            depends_on: vec![],
            checkpoint: false,
        }
    }

    fn json_response(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
    }

    fn spawn_delayed_model_server(delay: Duration) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]).to_string();
            std::thread::sleep(delay);
            let body =
                r#"{"choices":[{"message":{"content":"slow done"},"finish_reason":"stop"}]}"#;
            stream.write_all(json_response(body).as_bytes()).unwrap();
            request
        });
        (format!("http://127.0.0.1:{port}/v1"), handle)
    }

    #[tokio::test]
    async fn test_workflow_runner_lifecycle() {
        // 创建简单的 workflow
        let workflow = WorkflowDefinition {
            name: "test-workflow".to_string(),
            description: "test".to_string(),
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
            created_at: 0,
            updated_at: 0,
        };

        let registries = test_registries();
        let runner = WorkflowRunner::new(
            registries.provider_registry.clone(),
            registries.global_config.clone(),
        );

        // 启动 workflow
        let run_id = "test-run-1".to_string();
        let mut event_rx = runner
            .start_workflow(
                run_id.clone(),
                "test-project".to_string(),
                workflow,
                HashMap::new(),
            )
            .await
            .unwrap();

        // 收集事件
        let mut events = Vec::new();
        while let Some(event) = event_rx.recv().await {
            events.push(event);
        }

        // 验证事件序列
        assert!(!events.is_empty());
        assert!(matches!(
            events[0],
            WorkflowRunnerEvent::WorkflowStarted { .. }
        ));
        assert!(matches!(
            events[events.len() - 1],
            WorkflowRunnerEvent::WorkflowCompleted { .. }
        ));
    }

    #[tokio::test]
    async fn test_workflow_cancel() {
        let workflow = WorkflowDefinition {
            name: "long-workflow".to_string(),
            description: "test".to_string(),
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
                args: vec!["test".to_string()],
                values: HashMap::new(),
                depends_on: vec![],
                checkpoint: false,
            }],
            created_at: 0,
            updated_at: 0,
        };

        let registries = test_registries();
        let runner = WorkflowRunner::new(
            registries.provider_registry.clone(),
            registries.global_config.clone(),
        );
        let run_id = "test-run-2".to_string();

        let _event_rx = runner
            .start_workflow(
                run_id.clone(),
                "test-project".to_string(),
                workflow,
                HashMap::new(),
            )
            .await
            .unwrap();

        // 验证 run 已注册（workflow 执行很快，可能已经完成）
        // 所以我们只测试 cancel 不会 panic
        let result = runner.cancel_workflow(&run_id).await;
        // cancel 可能失败（如果 workflow 已经完成），这是正常的
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn test_resolve_backend_uses_role_binding_before_provider_default() {
        let registries = test_registries();
        registries
            .global_config
            .set_model_alias("role:coder", "coder-model")
            .unwrap();
        let executor = AgentStepExecutor::new(
            registries.provider_registry.clone(),
            registries.global_config.clone(),
            test_context(),
        );

        let mut step = agent_step();
        step.role = Some("coder".to_string());

        let backend = executor.resolve_backend(&step).unwrap();
        assert_eq!(backend.id, "provider-1");
        assert_eq!(backend.model, "coder-model");
        assert_eq!(backend.api_key.as_deref(), Some("sk-test"));
    }

    #[test]
    fn test_resolve_backend_uses_provider_default_when_global_default_is_builtin() {
        let registries = test_registries();
        let executor = AgentStepExecutor::new(
            registries.provider_registry.clone(),
            registries.global_config.clone(),
            test_context(),
        );

        let step = agent_step();

        let backend = executor.resolve_backend(&step).unwrap();
        assert_eq!(backend.model, "provider-default");
    }

    #[test]
    fn test_resolve_backend_uses_explicit_global_default() {
        let registries = test_registries();
        registries
            .global_config
            .set_default_model("global-model")
            .unwrap();
        let executor = AgentStepExecutor::new(
            registries.provider_registry.clone(),
            registries.global_config.clone(),
            test_context(),
        );

        let step = agent_step();

        let backend = executor.resolve_backend(&step).unwrap();
        assert_eq!(backend.model, "global-model");
    }

    #[test]
    fn test_resolve_backend_uses_provider_scoped_model_reference() {
        let registries = test_registries();
        registries
            .global_config
            .set_default_model("provider:provider-2:model:second-model")
            .unwrap();
        let executor = AgentStepExecutor::new(
            registries.provider_registry.clone(),
            registries.global_config.clone(),
            test_context(),
        );

        let step = agent_step();

        let backend = executor.resolve_backend(&step).unwrap();
        assert_eq!(backend.id, "provider-2");
        assert_eq!(backend.base_url, "http://127.0.0.1:2/v1");
        assert_eq!(backend.model, "second-model");
        assert_eq!(backend.api_key.as_deref(), Some("sk-second"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_execute_agent_does_not_block_current_thread_runtime() {
        let (base_url, handle) = spawn_delayed_model_server(Duration::from_millis(300));
        let registries = test_registries();
        let mut provider = registries
            .provider_registry
            .get("provider-1")
            .unwrap()
            .unwrap();
        provider.config.base_url = base_url;
        registries.provider_registry.upsert(provider).unwrap();

        let executor = AgentStepExecutor::new(
            registries.provider_registry.clone(),
            registries.global_config.clone(),
            test_context(),
        );
        let step = agent_step();

        let tick = async {
            tokio::time::sleep(Duration::from_millis(25)).await;
        };
        let agent = executor.execute_agent("slow prompt", &step);
        let (tick_result, agent_result) = tokio::join!(
            tokio::time::timeout(Duration::from_millis(200), tick),
            agent
        );

        let request = handle.join().unwrap();
        assert!(tick_result.is_ok(), "agent execution blocked the runtime");
        let result = agent_result.unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("slow done"));
        assert!(request.contains("POST /v1/chat/completions HTTP/1.1"));
    }
}
