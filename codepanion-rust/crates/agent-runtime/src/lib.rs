use codepanion_config::ModelBackendConfig;
use codepanion_model_client::{ChatMessage, ChatRequest, ChatTool, chat_completion};
use codepanion_providers::{
    HarnessDelegatedTask, HarnessExecutionRequest, HarnessExecutionResult, HarnessExecutor,
    ProviderCapability, ProviderOutput,
};
use codepanion_shared::{CodePanionError, Result};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub mod auto_fix;
pub mod command;
pub mod risk_detector;
pub mod sandbox;
pub mod tools;
pub use auto_fix::{AutoFixConfig, AutoFixEvent, AutoFixResult, FixAttempt, run_auto_fix_loop};
pub use command::{CommandRequest, CommandResult, CommandRisk, CommandTools, classify_command};
pub use risk_detector::{RiskDetection, RiskDetector, RiskSeverity, RiskType};
pub use sandbox::{IsolationLevel, Sandbox, SandboxConfig, SandboxResult};
pub use tools::{ReadonlyTools, WriteTools, ensure_path_inside};

// Tool-use loop 事件，用于实时推送到 GUI
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentLoopEvent {
    Assistant { text: String },
    ToolCall { name: String, args: String },
    ToolResult { name: String, result: String },
    MaxTurns { turns: usize },
}

// Tool runner trait - 执行工具调用
pub trait AgentToolRunner {
    fn run_tool(&self, name: &str, args_json: &str) -> Result<String>;
}

// Agent loop 结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentLoopResult {
    pub final_text: String,
    pub turns: usize,
    pub hit_max_turns: bool,
}

// Agent loop 请求
#[derive(Debug, Clone)]
pub struct AgentLoopRequest {
    pub backend: ModelBackendConfig,
    pub system: Option<String>,
    pub user_prompt: String,
    pub tools: Vec<ChatTool>,
    pub max_turns: usize,
    pub cancel: Arc<AtomicBool>,
}

impl AgentLoopRequest {
    pub fn new(backend: ModelBackendConfig, user_prompt: impl Into<String>) -> Self {
        Self {
            backend,
            system: None,
            user_prompt: user_prompt.into(),
            tools: Vec::new(),
            max_turns: 12,
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn with_system(mut self, system: impl Into<String>) -> Self {
        self.system = Some(system.into());
        self
    }

    pub fn with_tools(mut self, tools: Vec<ChatTool>) -> Self {
        self.tools = tools;
        self
    }

    pub fn with_max_turns(mut self, max_turns: usize) -> Self {
        self.max_turns = max_turns;
        self
    }

    pub fn with_cancel(mut self, cancel: Arc<AtomicBool>) -> Self {
        self.cancel = cancel;
        self
    }
}

const DEFAULT_MAX_TURNS: usize = 12;

/// 运行 agent tool-use 循环直到模型不再发 tool_calls，或触顶 maxTurns。
/// - tools 为空 / 无 tool_runner → 退化为 single-call（一次模型调用即返回）。
/// - 工具抛错被收成 tool 消息回填给模型（让模型自己决定怎么继续），不中断循环。
/// - cancel 透传给每次模型调用，接 run cancel。
pub fn run_agent_loop<R, F>(
    request: AgentLoopRequest,
    tool_runner: Option<R>,
    mut on_event: F,
) -> Result<AgentLoopResult>
where
    R: AgentToolRunner,
    F: FnMut(AgentLoopEvent),
{
    let max_turns = if request.max_turns > 0 {
        request.max_turns
    } else {
        DEFAULT_MAX_TURNS
    };

    let mut messages = Vec::new();
    if let Some(system) = request.system.as_deref().filter(|s| !s.trim().is_empty()) {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: system.to_string(),
        });
    }
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: request.user_prompt.clone(),
    });

    let mut last_text = String::new();

    for turn in 1..=max_turns {
        if request.cancel.load(Ordering::SeqCst) {
            return Err(CodePanionError::Runtime("agent loop cancelled".to_string()));
        }

        // 调用模型
        let chat_request = ChatRequest {
            backend: request.backend.clone(),
            messages: messages.clone(),
            api_key: request.backend.api_key.clone(),
            cancel: codepanion_model_client::CancellationToken::from_flag(request.cancel.clone()),
            stream: false,
        };

        let result = chat_completion(&chat_request)?;
        last_text = result.text.clone();

        // 始终把 assistant 消息压回上下文
        messages.push(ChatMessage {
            role: "assistant".to_string(),
            content: result.text.clone(),
        });

        if !last_text.trim().is_empty() {
            on_event(AgentLoopEvent::Assistant {
                text: last_text.clone(),
            });
        }

        // 没有 tool_calls → 结束循环
        if result.tool_calls.is_empty() {
            return Ok(AgentLoopResult {
                final_text: last_text,
                turns: turn,
                hit_max_turns: false,
            });
        }

        // 模型要调工具但没有工具运行器 → 无法满足，返回现有文本收尾
        if request.tools.is_empty() || tool_runner.is_none() {
            return Ok(AgentLoopResult {
                final_text: last_text,
                turns: turn,
                hit_max_turns: false,
            });
        }

        // 执行所有 tool calls
        let runner = tool_runner.as_ref().unwrap();
        for tool_call in &result.tool_calls {
            on_event(AgentLoopEvent::ToolCall {
                name: tool_call.name.clone(),
                args: tool_call.arguments.clone(),
            });

            let tool_result = match runner.run_tool(&tool_call.name, &tool_call.arguments) {
                Ok(result) => result,
                Err(err) => format!("tool error: {}", err),
            };

            on_event(AgentLoopEvent::ToolResult {
                name: tool_call.name.clone(),
                result: tool_result.clone(),
            });

            // 回填 tool 消息
            messages.push(ChatMessage {
                role: "tool".to_string(),
                content: tool_result,
            });
        }
    }

    // 达到最大轮数
    on_event(AgentLoopEvent::MaxTurns { turns: max_turns });
    Ok(AgentLoopResult {
        final_text: last_text,
        turns: max_turns,
        hit_max_turns: true,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentPermissions {
    capabilities: Vec<ProviderCapability>,
}

impl AgentPermissions {
    pub fn new(capabilities: Vec<ProviderCapability>) -> Self {
        Self { capabilities }
    }

    pub fn can(&self, capability: ProviderCapability) -> bool {
        self.capabilities.contains(&capability)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InProcessHarness {
    role: String,
    delegated_tasks: Vec<HarnessDelegatedTask>,
}

impl InProcessHarness {
    pub fn new(role: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            delegated_tasks: Vec::new(),
        }
    }

    pub fn with_delegated_task(
        mut self,
        role: impl Into<String>,
        prompt: impl Into<String>,
    ) -> Self {
        self.delegated_tasks
            .push(HarnessDelegatedTask::new(role, prompt));
        self
    }
}

impl HarnessExecutor for InProcessHarness {
    fn execute(
        &self,
        request: &HarnessExecutionRequest,
    ) -> codepanion_shared::Result<HarnessExecutionResult> {
        let mut result = HarnessExecutionResult::new(
            ProviderOutput::new(request.provider_id.clone()).with_assistant_text(format!(
                "{} harness accepted task: {}",
                self.role, request.prompt
            )),
            request.risk,
        );
        for task in &self.delegated_tasks {
            result = result.with_delegated_task(task.clone());
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codepanion_providers::{
        HarnessExecutionRequest, HarnessRisk, ProviderDefinition, ProviderKind, ProviderPermission,
        ProviderPermissions, ProviderRuntime, execute_harness_provider,
    };

    #[test]
    fn permissions_gate_capabilities() {
        let permissions = AgentPermissions::new(vec![ProviderCapability::Read]);
        assert!(permissions.can(ProviderCapability::Read));
        assert!(!permissions.can(ProviderCapability::Write));
    }

    #[test]
    fn in_process_harness_implements_provider_executor() {
        let provider = harness_provider();
        let harness = InProcessHarness::new("builder");
        let request = HarnessExecutionRequest::new("add provider registry")
            .with_required_permission(ProviderPermission::ReadWorkspace);

        let result = execute_harness_provider(&provider, request, &harness).unwrap();

        assert!(
            result
                .output
                .assistant_text
                .as_deref()
                .unwrap_or_default()
                .contains("builder")
        );
        assert!(
            result
                .output
                .assistant_text
                .as_deref()
                .unwrap_or_default()
                .contains("add provider registry")
        );
    }

    #[test]
    fn in_process_harness_can_delegate_tasks() {
        let provider = harness_provider();
        let harness =
            InProcessHarness::new("builder").with_delegated_task("reviewer", "review patch");
        let request = HarnessExecutionRequest::new("implement patch").with_risk(HarnessRisk::High);

        let result = execute_harness_provider(&provider, request, &harness).unwrap();

        assert_eq!(result.delegated_tasks.len(), 1);
        assert_eq!(result.delegated_tasks[0].role, "reviewer");
        assert!(result.requires_human_gate);
    }

    // Tool-use loop tests：用本地 TCP mock server 真实驱动循环。
    use std::io::{Read as IoRead, Write as IoWrite};
    use std::net::TcpListener;

    /// 启动一个 mock 模型服务器，按顺序返回 responses 中的 HTTP 响应。
    /// 每次 chat_completion 调用接受一个连接并回一条响应。
    fn spawn_sequence_server(responses: Vec<String>) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            for response in responses {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut buffer = [0_u8; 4096];
                    let _ = stream.read(&mut buffer);
                    let _ = stream.write_all(response.as_bytes());
                }
            }
        });
        (format!("http://127.0.0.1:{port}/v1"), handle)
    }

    fn json_response(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
    }

    /// 一个返回固定脚本的工具 runner，记录被调用的工具名。
    struct ScriptedToolRunner {
        result: String,
        calls: std::cell::RefCell<Vec<String>>,
    }

    impl ScriptedToolRunner {
        fn new(result: impl Into<String>) -> Self {
            Self {
                result: result.into(),
                calls: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl AgentToolRunner for ScriptedToolRunner {
        fn run_tool(&self, name: &str, _args_json: &str) -> Result<String> {
            self.calls.borrow_mut().push(name.to_string());
            Ok(self.result.clone())
        }
    }

    fn backend(base_url: String) -> ModelBackendConfig {
        ModelBackendConfig {
            id: "test".to_string(),
            base_url,
            model: "test-model".to_string(),
            api_key: None,
        }
    }

    #[test]
    fn agent_loop_single_call_returns_text() {
        // 模型直接返回文本，无 tool_calls → 单次调用即结束。
        let body = r#"{"choices":[{"message":{"content":"hello there"},"finish_reason":"stop"}]}"#;
        let (base_url, handle) = spawn_sequence_server(vec![json_response(body)]);

        let request = AgentLoopRequest::new(backend(base_url), "hi");
        let mut events: Vec<AgentLoopEvent> = Vec::new();
        let result =
            run_agent_loop::<ScriptedToolRunner, _>(request, None, |ev| events.push(ev)).unwrap();
        handle.join().unwrap();

        assert_eq!(result.final_text, "hello there");
        assert_eq!(result.turns, 1);
        assert!(!result.hit_max_turns);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], AgentLoopEvent::Assistant { .. }));
    }

    #[test]
    fn agent_loop_executes_tool_then_continues() {
        // 第一轮：模型发 tool_call；第二轮：模型返回最终文本。
        let turn1 = r#"{"choices":[{"message":{"content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"README.md\"}"}}]},"finish_reason":"tool_calls"}]}"#;
        let turn2 =
            r#"{"choices":[{"message":{"content":"done reading"},"finish_reason":"stop"}]}"#;
        let (base_url, handle) =
            spawn_sequence_server(vec![json_response(turn1), json_response(turn2)]);

        let tools = vec![ChatTool::new("read_file", "read a file", "{}")];
        let request = AgentLoopRequest::new(backend(base_url), "read the readme").with_tools(tools);
        let runner = ScriptedToolRunner::new("file contents here");
        let mut events: Vec<AgentLoopEvent> = Vec::new();

        let result = run_agent_loop(request, Some(runner), |ev| events.push(ev)).unwrap();
        handle.join().unwrap();

        assert_eq!(result.final_text, "done reading");
        assert_eq!(result.turns, 2);
        assert!(!result.hit_max_turns);
        // 事件应包含 tool-call 和 tool-result。
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentLoopEvent::ToolCall { .. }))
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentLoopEvent::ToolResult { .. }))
        );
    }

    #[test]
    fn agent_loop_honors_pre_cancel() {
        let request = AgentLoopRequest::new(backend("http://127.0.0.1:1/v1".to_string()), "hi")
            .with_cancel(Arc::new(AtomicBool::new(true)));
        let result = run_agent_loop::<ScriptedToolRunner, _>(request, None, |_| {});
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }

    #[test]
    fn agent_loop_returns_text_when_tool_call_but_no_runner() {
        // 模型发 tool_call 但没有 runner → 用现有文本收尾，不崩。
        let body = r#"{"choices":[{"message":{"content":"partial","tool_calls":[{"id":"c","type":"function","function":{"name":"x","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}"#;
        let (base_url, handle) = spawn_sequence_server(vec![json_response(body)]);

        // 有 tools 声明但不传 runner。
        let request = AgentLoopRequest::new(backend(base_url), "go")
            .with_tools(vec![ChatTool::new("x", "x", "{}")]);
        let result = run_agent_loop::<ScriptedToolRunner, _>(request, None, |_| {}).unwrap();
        handle.join().unwrap();

        assert_eq!(result.final_text, "partial");
        assert!(!result.hit_max_turns);
    }

    #[test]
    fn agent_loop_request_builder() {
        let backend = ModelBackendConfig {
            id: "test".to_string(),
            base_url: "http://127.0.0.1:11434/v1".to_string(),
            model: "qwen".to_string(),
            api_key: None,
        };

        let request = AgentLoopRequest::new(backend.clone(), "implement feature")
            .with_system("You are a helpful assistant")
            .with_max_turns(5)
            .with_cancel(Arc::new(AtomicBool::new(false)));

        assert_eq!(request.backend.model, "qwen");
        assert_eq!(request.user_prompt, "implement feature");
        assert_eq!(
            request.system.as_deref(),
            Some("You are a helpful assistant")
        );
        assert_eq!(request.max_turns, 5);
    }

    #[test]
    fn agent_loop_event_types() {
        let assistant_event = AgentLoopEvent::Assistant {
            text: "I will help you".to_string(),
        };
        let tool_call_event = AgentLoopEvent::ToolCall {
            name: "read_file".to_string(),
            args: r#"{"path":"README.md"}"#.to_string(),
        };
        let tool_result_event = AgentLoopEvent::ToolResult {
            name: "read_file".to_string(),
            result: "# CodePanion".to_string(),
        };
        let max_turns_event = AgentLoopEvent::MaxTurns { turns: 12 };

        // 验证事件可以被创建和比较
        assert_ne!(assistant_event, tool_call_event);
        assert_ne!(tool_result_event, max_turns_event);
    }

    fn harness_provider() -> ProviderDefinition {
        ProviderDefinition::new(
            "runtime-harness",
            "Runtime Harness",
            ProviderKind::Harness,
            vec![ProviderCapability::Read, ProviderCapability::Delegate],
            ProviderPermissions::new(
                false,
                vec![
                    ProviderPermission::ReadWorkspace,
                    ProviderPermission::DelegateTask,
                ],
            ),
            ProviderRuntime::harness("runtime"),
        )
        .unwrap()
    }
}
