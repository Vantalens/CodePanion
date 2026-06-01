use codepanion_shared::{CodePanionError, Result};
use std::collections::BTreeMap;
use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    Api,
    Cli,
    Harness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProviderCapability {
    Read,
    Write,
    Command,
    Network,
    Delegate,
    Streaming,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProviderPermission {
    ReadWorkspace,
    WriteWorkspace,
    RunCommand,
    UseNetwork,
    DelegateTask,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProviderPermissions {
    pub requires_human_gate: bool,
    pub grants: Vec<ProviderPermission>,
}

impl ProviderPermissions {
    pub fn new(requires_human_gate: bool, grants: Vec<ProviderPermission>) -> Self {
        Self {
            requires_human_gate,
            grants,
        }
    }

    pub fn allows(&self, permission: ProviderPermission) -> bool {
        self.grants.contains(&permission)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderRuntime {
    Api { base_url: String },
    Cli { command: String, args: Vec<String> },
    Harness { name: String },
}

impl ProviderRuntime {
    pub fn api(base_url: impl Into<String>) -> Self {
        Self::Api {
            base_url: base_url.into(),
        }
    }

    pub fn cli(command: impl Into<String>, args: Vec<impl Into<String>>) -> Self {
        Self::Cli {
            command: command.into(),
            args: args.into_iter().map(Into::into).collect(),
        }
    }

    pub fn harness(name: impl Into<String>) -> Self {
        Self::Harness { name: name.into() }
    }

    pub fn kind(&self) -> ProviderKind {
        match self {
            Self::Api { .. } => ProviderKind::Api,
            Self::Cli { .. } => ProviderKind::Cli,
            Self::Harness { .. } => ProviderKind::Harness,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderDefinition {
    pub id: String,
    pub display_name: String,
    pub kind: ProviderKind,
    pub capabilities: Vec<ProviderCapability>,
    pub permissions: ProviderPermissions,
    pub runtime: ProviderRuntime,
}

impl ProviderDefinition {
    pub fn new(
        id: impl Into<String>,
        display_name: impl Into<String>,
        kind: ProviderKind,
        capabilities: Vec<ProviderCapability>,
        permissions: ProviderPermissions,
        runtime: ProviderRuntime,
    ) -> Result<Self> {
        let id = id.into();
        if id.trim().is_empty() {
            return Err(CodePanionError::InvalidInput(
                "provider id is required".to_string(),
            ));
        }
        if kind != runtime.kind() {
            return Err(CodePanionError::InvalidInput(
                "provider kind must match runtime kind".to_string(),
            ));
        }
        Ok(Self {
            id,
            display_name: display_name.into(),
            kind,
            capabilities,
            permissions,
            runtime,
        })
    }

    pub fn supports(&self, capability: ProviderCapability) -> bool {
        self.capabilities.contains(&capability)
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProviderRegistry {
    providers: BTreeMap<String, ProviderDefinition>,
}

impl ProviderRegistry {
    pub fn register(&mut self, provider: ProviderDefinition) -> Result<()> {
        if self.providers.contains_key(&provider.id) {
            return Err(CodePanionError::InvalidInput(format!(
                "duplicate provider id: {}",
                provider.id
            )));
        }
        self.providers.insert(provider.id.clone(), provider);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&ProviderDefinition> {
        self.providers.get(id)
    }

    pub fn list(&self) -> Vec<&ProviderDefinition> {
        self.providers.values().collect()
    }

    pub fn len(&self) -> usize {
        self.providers.len()
    }

    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }
}

pub fn default_external_tool_registry() -> Result<ProviderRegistry> {
    let mut registry = ProviderRegistry::default();
    registry.register(codex_cli_provider()?)?;
    registry.register(claude_code_cli_provider()?)?;
    registry.register(opencode_cli_provider()?)?;
    Ok(registry)
}

pub fn codex_cli_provider() -> Result<ProviderDefinition> {
    external_cli_provider(
        "codex-cli",
        "Codex CLI",
        "codex",
        vec!["exec"],
        vec![
            ProviderCapability::Read,
            ProviderCapability::Write,
            ProviderCapability::Command,
            ProviderCapability::Delegate,
            ProviderCapability::Streaming,
            ProviderCapability::Cancel,
        ],
    )
}

pub fn claude_code_cli_provider() -> Result<ProviderDefinition> {
    external_cli_provider(
        "claude-code-cli",
        "Claude Code CLI",
        "claude",
        vec!["-p"],
        vec![
            ProviderCapability::Read,
            ProviderCapability::Write,
            ProviderCapability::Command,
            ProviderCapability::Delegate,
            ProviderCapability::Streaming,
            ProviderCapability::Cancel,
        ],
    )
}

pub fn opencode_cli_provider() -> Result<ProviderDefinition> {
    external_cli_provider(
        "opencode-cli",
        "OpenCode CLI",
        "opencode",
        vec!["run"],
        vec![
            ProviderCapability::Read,
            ProviderCapability::Write,
            ProviderCapability::Command,
            ProviderCapability::Delegate,
            ProviderCapability::Streaming,
            ProviderCapability::Cancel,
        ],
    )
}

fn external_cli_provider(
    id: &str,
    display_name: &str,
    command: &str,
    args: Vec<&str>,
    capabilities: Vec<ProviderCapability>,
) -> Result<ProviderDefinition> {
    ProviderDefinition::new(
        id,
        display_name,
        ProviderKind::Cli,
        capabilities,
        ProviderPermissions::new(
            true,
            vec![
                ProviderPermission::ReadWorkspace,
                ProviderPermission::WriteWorkspace,
                ProviderPermission::RunCommand,
                ProviderPermission::DelegateTask,
            ],
        ),
        ProviderRuntime::cli(command, args),
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderArtifact {
    pub kind: String,
    pub format: String,
    pub content: String,
}

impl ProviderArtifact {
    pub fn new(
        kind: impl Into<String>,
        format: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self {
            kind: kind.into(),
            format: format.into(),
            content: content.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderOutput {
    pub provider_id: String,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub assistant_text: Option<String>,
    pub artifacts: Vec<ProviderArtifact>,
}

impl ProviderOutput {
    pub fn new(provider_id: impl Into<String>) -> Self {
        Self {
            provider_id: provider_id.into(),
            stdout: None,
            stderr: None,
            assistant_text: None,
            artifacts: Vec::new(),
        }
    }

    pub fn with_stdout(mut self, stdout: impl Into<String>) -> Self {
        self.stdout = Some(stdout.into());
        self
    }

    pub fn with_stderr(mut self, stderr: impl Into<String>) -> Self {
        self.stderr = Some(stderr.into());
        self
    }

    pub fn with_assistant_text(mut self, assistant_text: impl Into<String>) -> Self {
        self.assistant_text = Some(assistant_text.into());
        self
    }

    pub fn with_artifact(mut self, artifact: ProviderArtifact) -> Self {
        self.artifacts.push(artifact);
        self
    }
}

#[derive(Debug, Clone)]
pub struct CliExecutionRequest {
    pub workspace_root: PathBuf,
    pub timeout: Duration,
    pub cancel: Arc<AtomicBool>,
    pub extra_args: Vec<String>,
    pub allowed_extra_args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub prompt: Option<String>,
}

impl CliExecutionRequest {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
            timeout: Duration::from_secs(30),
            cancel: Arc::new(AtomicBool::new(false)),
            extra_args: Vec::new(),
            allowed_extra_args: Vec::new(),
            env: BTreeMap::new(),
            prompt: None,
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_cancel(mut self, cancel: Arc<AtomicBool>) -> Self {
        self.cancel = cancel;
        self
    }

    pub fn with_extra_args(
        mut self,
        extra_args: Vec<impl Into<String>>,
        allowed_extra_args: Vec<impl Into<String>>,
    ) -> Self {
        self.extra_args = extra_args.into_iter().map(Into::into).collect();
        self.allowed_extra_args = allowed_extra_args.into_iter().map(Into::into).collect();
        self
    }

    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.insert(key.into(), value.into());
        self
    }

    pub fn with_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.prompt = Some(prompt.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliExecutionResult {
    pub output: ProviderOutput,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub cancelled: bool,
    pub events: Vec<CliExecutionEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliExecutionStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliExecutionEvent {
    pub provider_id: String,
    pub stream: CliExecutionStream,
    pub chunk: String,
}

pub fn execute_cli_provider(
    provider: &ProviderDefinition,
    request: CliExecutionRequest,
) -> Result<CliExecutionResult> {
    if request.cancel.load(Ordering::SeqCst) {
        return Err(CodePanionError::Runtime(
            "cli provider execution cancelled before start".to_string(),
        ));
    }
    let ProviderRuntime::Cli { command, args } = &provider.runtime else {
        return Err(CodePanionError::InvalidInput(
            "provider runtime must be cli".to_string(),
        ));
    };
    if !request.workspace_root.is_dir() {
        return Err(CodePanionError::InvalidInput(format!(
            "workspace root does not exist: {}",
            request.workspace_root.display()
        )));
    }
    for arg in &request.extra_args {
        if !request.allowed_extra_args.contains(arg) {
            return Err(CodePanionError::PermissionDenied(format!(
                "cli argument is not allowed: {arg}"
            )));
        }
    }

    let mut command_builder = Command::new(command);
    command_builder
        .args(args)
        .args(&request.extra_args)
        .current_dir(&request.workspace_root)
        .env_clear()
        .stdin(if request.prompt.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in &request.env {
        command_builder.env(key, value);
    }

    let mut child = command_builder
        .spawn()
        .map_err(|err| CodePanionError::Runtime(format!("failed to spawn cli provider: {err}")))?;
    if let Some(prompt) = request.prompt.as_deref()
        && let Some(mut stdin) = child.stdin.take()
    {
        stdin.write_all(prompt.as_bytes()).map_err(|err| {
            let _ = child.kill();
            CodePanionError::Runtime(format!("failed to write cli provider prompt: {err}"))
        })?;
    }
    let stdout = child.stdout.take().map(read_stream_in_thread);
    let stderr = child.stderr.take().map(read_stream_in_thread);
    let start = Instant::now();
    let mut timed_out = false;
    let mut cancelled = false;
    let status = loop {
        if request.cancel.load(Ordering::SeqCst) {
            cancelled = true;
            let _ = child.kill();
            break child.wait().ok();
        }
        if start.elapsed() >= request.timeout {
            timed_out = true;
            let _ = child.kill();
            break child.wait().ok();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
            Err(err) => {
                let _ = child.kill();
                return Err(CodePanionError::Runtime(format!(
                    "failed to poll cli provider: {err}"
                )));
            }
        }
    };
    let stdout_text = join_reader(stdout)?;
    let stderr_text = join_reader(stderr)?;
    let mut events = Vec::new();
    let mut output = ProviderOutput::new(provider.id.clone());
    if !stdout_text.is_empty() {
        events.push(CliExecutionEvent {
            provider_id: provider.id.clone(),
            stream: CliExecutionStream::Stdout,
            chunk: stdout_text.clone(),
        });
        output = output.with_stdout(stdout_text);
    }
    if !stderr_text.is_empty() {
        events.push(CliExecutionEvent {
            provider_id: provider.id.clone(),
            stream: CliExecutionStream::Stderr,
            chunk: stderr_text.clone(),
        });
        output = output.with_stderr(stderr_text);
    }

    Ok(CliExecutionResult {
        output,
        exit_code: status.and_then(|status| status.code()),
        timed_out,
        cancelled,
        events,
    })
}

fn read_stream_in_thread<T>(mut stream: T) -> JoinHandle<std::io::Result<String>>
where
    T: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut buffer = String::new();
        stream.read_to_string(&mut buffer)?;
        Ok(buffer)
    })
}

fn join_reader(handle: Option<JoinHandle<std::io::Result<String>>>) -> Result<String> {
    match handle {
        Some(handle) => handle
            .join()
            .map_err(|_| CodePanionError::Runtime("cli output reader panicked".to_string()))?
            .map_err(|err| {
                CodePanionError::Runtime(format!("failed to read cli provider output: {err}"))
            }),
        None => Ok(String::new()),
    }
}

#[derive(Debug, Clone)]
pub struct ApiExecutionRequest {
    pub body: String,
    pub path: String,
    pub api_key: Option<String>,
    pub cancel: Arc<AtomicBool>,
    pub stream: bool,
    pub timeout: Duration,
}

impl ApiExecutionRequest {
    pub fn new(body: impl Into<String>) -> Self {
        Self {
            body: body.into(),
            path: "/chat/completions".to_string(),
            api_key: None,
            cancel: Arc::new(AtomicBool::new(false)),
            stream: false,
            timeout: Duration::from_secs(30),
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = path.into();
        self
    }

    pub fn with_api_key(mut self, api_key: impl Into<String>) -> Self {
        self.api_key = Some(api_key.into());
        self
    }

    pub fn with_cancel(mut self, cancel: Arc<AtomicBool>) -> Self {
        self.cancel = cancel;
        self
    }

    pub fn with_stream(mut self, stream: bool) -> Self {
        self.stream = stream;
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ApiUsage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiExecutionEvent {
    pub provider_id: String,
    pub chunk: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiExecutionResult {
    pub output: ProviderOutput,
    pub status: u16,
    pub usage: ApiUsage,
    pub events: Vec<ApiExecutionEvent>,
    pub redacted_request: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedHttpUrl {
    host: String,
    port: u16,
    path: String,
}

pub fn execute_api_provider(
    provider: &ProviderDefinition,
    request: ApiExecutionRequest,
) -> Result<ApiExecutionResult> {
    if request.cancel.load(Ordering::SeqCst) {
        return Err(CodePanionError::Runtime(
            "api provider execution cancelled before start".to_string(),
        ));
    }
    let ProviderRuntime::Api { base_url } = &provider.runtime else {
        return Err(CodePanionError::InvalidInput(
            "provider runtime must be api".to_string(),
        ));
    };
    let url = parse_http_url(base_url)?;
    let path = join_http_path(&url.path, &request.path);
    let mut headers = vec![
        format!("POST {path} HTTP/1.1"),
        format!("Host: {}:{}", url.host, url.port),
        "Content-Type: application/json".to_string(),
        format!("Content-Length: {}", request.body.len()),
        "Connection: close".to_string(),
    ];
    if request.stream {
        headers.push("Accept: text/event-stream".to_string());
    }
    if let Some(api_key) = request.api_key.as_deref().filter(|key| !key.is_empty()) {
        headers.push(format!("Authorization: Bearer {api_key}"));
    }

    let raw_request = format!("{}\r\n\r\n{}", headers.join("\r\n"), request.body);
    let redacted_request = redact_api_key(&raw_request, request.api_key.as_deref());
    let mut stream = TcpStream::connect((url.host.as_str(), url.port)).map_err(|err| {
        CodePanionError::Runtime(format!("api provider connection failed: {err}"))
    })?;
    stream
        .set_read_timeout(Some(Duration::from_millis(50)))
        .map_err(|err| {
            CodePanionError::Runtime(format!("failed to set api read timeout: {err}"))
        })?;
    stream
        .write_all(raw_request.as_bytes())
        .map_err(|err| CodePanionError::Runtime(format!("api provider request failed: {err}")))?;

    let response = read_api_response(&mut stream, &request)?;
    parse_api_response(provider, &response, redacted_request)
}

fn read_api_response(stream: &mut TcpStream, request: &ApiExecutionRequest) -> Result<String> {
    let started = Instant::now();
    let mut response = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        if request.cancel.load(Ordering::SeqCst) {
            return Err(CodePanionError::Runtime(
                "api provider execution cancelled during response read".to_string(),
            ));
        }
        if started.elapsed() >= request.timeout {
            return Err(CodePanionError::Runtime(
                "api provider response timed out".to_string(),
            ));
        }
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => response.extend_from_slice(&buffer[..read]),
            Err(err)
                if matches!(
                    err.kind(),
                    ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
                ) =>
            {
                continue;
            }
            Err(err) => {
                return Err(CodePanionError::Runtime(format!(
                    "api provider response failed: {err}"
                )));
            }
        }
    }
    String::from_utf8(response).map_err(|err| {
        CodePanionError::Runtime(format!("api provider response was not utf-8: {err}"))
    })
}

fn parse_api_response(
    provider: &ProviderDefinition,
    response: &str,
    redacted_request: String,
) -> Result<ApiExecutionResult> {
    let (head, body) = response.split_once("\r\n\r\n").ok_or_else(|| {
        CodePanionError::Runtime("api provider returned malformed HTTP response".to_string())
    })?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| {
            CodePanionError::Runtime("api provider response missing status".to_string())
        })?;
    if !(200..300).contains(&status) {
        return Err(CodePanionError::Runtime(format!(
            "api provider {status}: {}",
            body.chars().take(500).collect::<String>()
        )));
    }

    let (assistant_text, events) = if body
        .lines()
        .any(|line| line.trim_start().starts_with("data:"))
    {
        parse_api_stream(provider, body)
    } else {
        (
            extract_json_string(body, "\"content\"").unwrap_or_default(),
            Vec::new(),
        )
    };
    let output = ProviderOutput::new(provider.id.clone()).with_assistant_text(assistant_text);
    Ok(ApiExecutionResult {
        output,
        status,
        usage: ApiUsage {
            prompt_tokens: extract_json_number(body, "\"prompt_tokens\""),
            completion_tokens: extract_json_number(body, "\"completion_tokens\""),
            total_tokens: extract_json_number(body, "\"total_tokens\""),
        },
        events,
        redacted_request,
    })
}

fn parse_api_stream(provider: &ProviderDefinition, body: &str) -> (String, Vec<ApiExecutionEvent>) {
    let mut text = String::new();
    let mut events = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim_start();
        let Some(data) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            break;
        }
        if let Some(chunk) = extract_json_string(data, "\"content\"") {
            text.push_str(&chunk);
            events.push(ApiExecutionEvent {
                provider_id: provider.id.clone(),
                chunk,
            });
        }
    }
    (text, events)
}

fn parse_http_url(raw: &str) -> Result<ParsedHttpUrl> {
    let without_scheme = raw.strip_prefix("http://").ok_or_else(|| {
        CodePanionError::InvalidInput(
            "only http:// api provider base_url is supported in bootstrap executor".to_string(),
        )
    })?;
    let (authority, path) = without_scheme
        .split_once('/')
        .map_or((without_scheme, "/"), |(host, rest)| (host, rest));
    if authority.is_empty() {
        return Err(CodePanionError::InvalidInput(
            "api provider base_url host is required".to_string(),
        ));
    }
    let (host, port) = authority
        .rsplit_once(':')
        .and_then(|(host, port)| Some((host, port.parse::<u16>().ok()?)))
        .unwrap_or((authority, 80));
    Ok(ParsedHttpUrl {
        host: host.to_string(),
        port,
        path: if path == "/" {
            "/".to_string()
        } else {
            format!("/{path}")
        },
    })
}

fn join_http_path(base: &str, suffix: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        suffix.trim_start_matches('/')
    )
}

fn redact_api_key(request: &str, api_key: Option<&str>) -> String {
    match api_key.filter(|key| !key.is_empty()) {
        Some(api_key) => request.replace(api_key, "[redacted]"),
        None => request.to_string(),
    }
}

fn extract_json_number(body: &str, key: &str) -> Option<u64> {
    let start = body.find(key)?;
    let after_key = &body[start + key.len()..];
    let colon = after_key.find(':')?;
    let digits = after_key[colon + 1..]
        .trim_start()
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    digits.parse::<u64>().ok()
}

fn extract_json_string(body: &str, key: &str) -> Option<String> {
    let start = body.find(key)?;
    let after_key = &body[start + key.len()..];
    let colon = after_key.find(':')?;
    let mut chars = after_key[colon + 1..].trim_start().chars();
    if chars.next()? != '"' {
        return None;
    }
    let mut out = String::new();
    let mut escaped = false;
    for ch in chars {
        if escaped {
            match ch {
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                other => out.push(other),
            }
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(out);
        } else {
            out.push(ch);
        }
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarnessRisk {
    Normal,
    High,
}

#[derive(Debug, Clone)]
pub struct HarnessExecutionRequest {
    pub provider_id: String,
    pub prompt: String,
    pub required_permissions: Vec<ProviderPermission>,
    pub cancel: Arc<AtomicBool>,
    pub risk: HarnessRisk,
}

impl HarnessExecutionRequest {
    pub fn new(prompt: impl Into<String>) -> Self {
        Self {
            provider_id: String::new(),
            prompt: prompt.into(),
            required_permissions: Vec::new(),
            cancel: Arc::new(AtomicBool::new(false)),
            risk: HarnessRisk::Normal,
        }
    }

    pub fn with_required_permission(mut self, permission: ProviderPermission) -> Self {
        self.required_permissions.push(permission);
        self
    }

    pub fn with_cancel(mut self, cancel: Arc<AtomicBool>) -> Self {
        self.cancel = cancel;
        self
    }

    pub fn with_risk(mut self, risk: HarnessRisk) -> Self {
        self.risk = risk;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessDelegatedTask {
    pub role: String,
    pub prompt: String,
}

impl HarnessDelegatedTask {
    pub fn new(role: impl Into<String>, prompt: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            prompt: prompt.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessExecutionResult {
    pub output: ProviderOutput,
    pub delegated_tasks: Vec<HarnessDelegatedTask>,
    pub requires_human_gate: bool,
    pub risk: HarnessRisk,
}

impl HarnessExecutionResult {
    pub fn new(output: ProviderOutput, risk: HarnessRisk) -> Self {
        Self {
            output,
            delegated_tasks: Vec::new(),
            requires_human_gate: false,
            risk,
        }
    }

    pub fn with_delegated_task(mut self, task: HarnessDelegatedTask) -> Self {
        self.delegated_tasks.push(task);
        self
    }
}

pub trait HarnessExecutor {
    fn execute(&self, request: &HarnessExecutionRequest) -> Result<HarnessExecutionResult>;
}

pub fn execute_harness_provider(
    provider: &ProviderDefinition,
    mut request: HarnessExecutionRequest,
    executor: &impl HarnessExecutor,
) -> Result<HarnessExecutionResult> {
    if request.cancel.load(Ordering::SeqCst) {
        return Err(CodePanionError::Runtime(
            "harness provider execution cancelled before start".to_string(),
        ));
    }
    let ProviderRuntime::Harness { .. } = &provider.runtime else {
        return Err(CodePanionError::InvalidInput(
            "provider runtime must be harness".to_string(),
        ));
    };
    for permission in &request.required_permissions {
        if !provider.permissions.allows(*permission) {
            return Err(CodePanionError::PermissionDenied(format!(
                "harness provider missing permission: {permission:?}"
            )));
        }
    }

    request.provider_id = provider.id.clone();
    let mut result = executor.execute(&request)?;
    if provider.permissions.requires_human_gate || request.risk == HarnessRisk::High {
        result.requires_human_gate = true;
    }
    result.risk = request.risk;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::{Arc, atomic::AtomicBool};
    use std::time::Duration;

    #[test]
    fn provider_declares_capabilities() {
        let provider = ProviderDefinition::new(
            "codex-cli",
            "Codex CLI",
            ProviderKind::Cli,
            vec![ProviderCapability::Command, ProviderCapability::Streaming],
            ProviderPermissions::default(),
            ProviderRuntime::cli("codex", vec!["exec"]),
        )
        .unwrap();

        assert!(provider.supports(ProviderCapability::Command));
        assert!(!provider.supports(ProviderCapability::Network));
    }

    #[test]
    fn provider_requires_id() {
        let err = ProviderDefinition::new(
            "",
            "Invalid",
            ProviderKind::Api,
            vec![],
            ProviderPermissions::default(),
            ProviderRuntime::api("http://127.0.0.1:11434/v1"),
        )
        .unwrap_err();
        assert!(err.to_string().contains("provider id"));
    }

    #[test]
    fn provider_schema_declares_runtime_and_permissions() {
        let provider = ProviderDefinition::new(
            "codex-cli",
            "Codex CLI",
            ProviderKind::Cli,
            vec![ProviderCapability::Read, ProviderCapability::Write],
            ProviderPermissions::new(
                false,
                vec![
                    ProviderPermission::ReadWorkspace,
                    ProviderPermission::WriteWorkspace,
                ],
            ),
            ProviderRuntime::cli("codex", vec!["exec"]),
        )
        .unwrap();

        assert_eq!(provider.runtime.kind(), ProviderKind::Cli);
        assert!(
            provider
                .permissions
                .allows(ProviderPermission::ReadWorkspace)
        );
        assert!(!provider.permissions.requires_human_gate);
    }

    #[test]
    fn cli_provider_requires_command_runtime() {
        let err = ProviderDefinition::new(
            "broken-cli",
            "Broken CLI",
            ProviderKind::Cli,
            vec![ProviderCapability::Command],
            ProviderPermissions::default(),
            ProviderRuntime::api("http://127.0.0.1:11434/v1"),
        )
        .unwrap_err();

        assert!(err.to_string().contains("runtime kind"));
    }

    #[test]
    fn registry_registers_and_finds_provider() {
        let mut registry = ProviderRegistry::default();
        let provider = ProviderDefinition::new(
            "claude-code-cli",
            "Claude Code CLI",
            ProviderKind::Cli,
            vec![ProviderCapability::Read, ProviderCapability::Write],
            ProviderPermissions::default(),
            ProviderRuntime::cli("claude", vec!["-p"]),
        )
        .unwrap();

        registry.register(provider).unwrap();

        assert_eq!(
            registry.get("claude-code-cli").unwrap().display_name,
            "Claude Code CLI"
        );
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn registry_rejects_duplicate_provider_id() {
        let mut registry = ProviderRegistry::default();
        let first = ProviderDefinition::new(
            "opencode-cli",
            "OpenCode CLI",
            ProviderKind::Cli,
            vec![ProviderCapability::Command],
            ProviderPermissions::default(),
            ProviderRuntime::cli("opencode", vec!["run"]),
        )
        .unwrap();
        let duplicate = first.clone();

        registry.register(first).unwrap();
        let err = registry.register(duplicate).unwrap_err();

        assert!(err.to_string().contains("duplicate provider id"));
    }

    #[test]
    fn provider_output_maps_to_workflow_artifacts() {
        let output = ProviderOutput::new("codex-cli")
            .with_stdout("tests passed")
            .with_assistant_text("Implemented the change")
            .with_artifact(ProviderArtifact::new(
                "delivery-note",
                "markdown",
                "Ready for review",
            ));

        assert_eq!(output.provider_id, "codex-cli");
        assert_eq!(output.stdout.as_deref(), Some("tests passed"));
        assert_eq!(output.artifacts[0].kind, "delivery-note");
    }

    #[test]
    fn cli_executor_captures_output_and_uses_workspace_cwd() {
        let workspace = test_workspace("cli-cwd");
        let provider = helper_cli_provider("cwd-provider", vec![]);
        let request = CliExecutionRequest::new(workspace.clone())
            .with_env("CODEPANION_PROVIDER_HELPER", "cwd");

        let result = execute_cli_provider(&provider, request).unwrap();

        assert_eq!(result.exit_code, Some(0));
        assert!(
            result
                .output
                .stdout
                .as_deref()
                .unwrap_or_default()
                .contains(&workspace.display().to_string())
        );
        assert!(
            result
                .output
                .stderr
                .as_deref()
                .unwrap_or_default()
                .contains("helper-stderr")
        );
        assert!(
            result
                .events
                .iter()
                .any(|event| event.stream == CliExecutionStream::Stdout)
        );
        assert!(
            result
                .events
                .iter()
                .any(|event| event.stream == CliExecutionStream::Stderr)
        );
    }

    #[test]
    fn cli_executor_does_not_inherit_parent_environment() {
        unsafe {
            std::env::set_var("CODEPANION_SHOULD_NOT_LEAK", "secret-parent-token");
        }
        let provider = helper_cli_provider("env-provider", vec![]);
        let request = CliExecutionRequest::new(test_workspace("cli-env"))
            .with_env("CODEPANION_PROVIDER_HELPER", "env");

        let result = execute_cli_provider(&provider, request).unwrap();

        unsafe {
            std::env::remove_var("CODEPANION_SHOULD_NOT_LEAK");
        }
        let stdout = result.output.stdout.as_deref().unwrap_or_default();
        assert!(stdout.contains("not-present"));
        assert!(!stdout.contains("secret-parent-token"));
    }

    #[test]
    fn cli_executor_writes_prompt_to_stdin() {
        let provider = helper_cli_provider("prompt-provider", vec![]);
        let request = CliExecutionRequest::new(test_workspace("cli-prompt"))
            .with_env("CODEPANION_PROVIDER_HELPER", "stdin")
            .with_prompt("implement provider prompt");

        let result = execute_cli_provider(&provider, request).unwrap();

        assert!(
            result
                .output
                .stdout
                .as_deref()
                .unwrap_or_default()
                .contains("implement provider prompt")
        );
    }

    #[test]
    fn cli_executor_rejects_args_outside_allowlist() {
        let provider = helper_cli_provider("arg-provider", vec![]);
        let request = CliExecutionRequest::new(test_workspace("cli-args"))
            .with_extra_args(vec!["--danger"], vec!["--safe"]);

        let err = execute_cli_provider(&provider, request).unwrap_err();

        assert!(err.to_string().contains("not allowed"));
    }

    #[test]
    fn cli_executor_times_out_and_kills_process() {
        let provider = helper_cli_provider("timeout-provider", vec![]);
        let request = CliExecutionRequest::new(test_workspace("cli-timeout"))
            .with_env("CODEPANION_PROVIDER_HELPER", "sleep")
            .with_env("CODEPANION_PROVIDER_SLEEP_MS", "1000")
            .with_timeout(Duration::from_millis(50));

        let result = execute_cli_provider(&provider, request).unwrap();

        assert!(result.timed_out);
        assert_ne!(result.exit_code, Some(0));
    }

    #[test]
    fn cli_executor_honors_pre_cancelled_request() {
        let provider = helper_cli_provider("cancel-provider", vec![]);
        let cancel = Arc::new(AtomicBool::new(true));
        let request = CliExecutionRequest::new(test_workspace("cli-cancel")).with_cancel(cancel);

        let err = execute_cli_provider(&provider, request).unwrap_err();

        assert!(err.to_string().contains("cancelled"));
    }

    #[test]
    fn api_executor_posts_json_and_redacts_api_key() {
        let (base_url, handle) = spawn_api_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 126\r\n\r\n{\"choices\":[{\"message\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3,\"total_tokens\":5}}",
        );
        let provider = api_provider("api-provider", base_url);
        let request = ApiExecutionRequest::new(r#"{"model":"test","messages":[]}"#)
            .with_api_key("secret-key");

        let result = execute_api_provider(&provider, request).unwrap();
        let raw_request = handle.join().unwrap();

        assert!(raw_request.contains("POST /v1/chat/completions HTTP/1.1"));
        assert!(raw_request.contains("Authorization: Bearer secret-key"));
        assert_eq!(result.status, 200);
        assert_eq!(result.output.assistant_text.as_deref(), Some("done"));
        assert_eq!(result.usage.total_tokens, Some(5));
        assert!(result.redacted_request.contains("Bearer [redacted]"));
        assert!(!result.redacted_request.contains("secret-key"));
    }

    #[test]
    fn api_executor_maps_streaming_content_to_events() {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\
data: {\"choices\":[{\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\
data: [DONE]\n";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let leaked_response: &'static str = Box::leak(response.into_boxed_str());
        let (base_url, handle) = spawn_api_server(leaked_response);
        let provider = api_provider("stream-provider", base_url);
        let request = ApiExecutionRequest::new(r#"{"stream":true}"#).with_stream(true);

        let result = execute_api_provider(&provider, request).unwrap();
        let _ = handle.join().unwrap();

        assert_eq!(result.output.assistant_text.as_deref(), Some("hello"));
        assert_eq!(result.events.len(), 2);
        assert_eq!(result.events[0].chunk, "hel");
        assert_eq!(result.events[1].chunk, "lo");
    }

    #[test]
    fn api_executor_reports_non_success_status() {
        let (base_url, handle) = spawn_api_server(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 12\r\n\r\nserver broke",
        );
        let provider = api_provider("bad-api", base_url);
        let err = execute_api_provider(&provider, ApiExecutionRequest::new("{}")).unwrap_err();
        let _ = handle.join().unwrap();

        assert!(err.to_string().contains("500"));
        assert!(err.to_string().contains("server broke"));
    }

    #[test]
    fn api_executor_honors_pre_cancelled_request() {
        let provider = api_provider("cancel-api", "http://127.0.0.1:1/v1".to_string());
        let cancel = Arc::new(AtomicBool::new(true));
        let err = execute_api_provider(
            &provider,
            ApiExecutionRequest::new("{}").with_cancel(cancel),
        )
        .unwrap_err();

        assert!(err.to_string().contains("cancelled"));
    }

    #[test]
    fn api_executor_honors_runtime_cancel_during_response_read() {
        let (base_url, handle) = spawn_slow_api_server(Duration::from_millis(250));
        let provider = api_provider("slow-api", base_url);
        let cancel = Arc::new(AtomicBool::new(false));
        let request = ApiExecutionRequest::new("{}")
            .with_cancel(cancel.clone())
            .with_timeout(Duration::from_secs(5));
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            cancel.store(true, Ordering::SeqCst);
        });

        let err = execute_api_provider(&provider, request).unwrap_err();
        let _ = canceller.join();
        let _ = handle.join();

        assert!(err.to_string().contains("cancelled"));
    }

    #[test]
    fn harness_executor_maps_agent_result_to_provider_output() {
        let provider = harness_provider(
            "codex-harness",
            vec![
                ProviderPermission::ReadWorkspace,
                ProviderPermission::DelegateTask,
            ],
        );
        let request = HarnessExecutionRequest::new("implement feature")
            .with_required_permission(ProviderPermission::ReadWorkspace);
        let executor = FakeHarnessExecutor {
            response: "plan ready".to_string(),
            delegated_task: Some("review implementation".to_string()),
        };

        let result = execute_harness_provider(&provider, request, &executor).unwrap();

        assert_eq!(result.output.assistant_text.as_deref(), Some("plan ready"));
        assert_eq!(result.delegated_tasks[0].prompt, "review implementation");
        assert!(!result.requires_human_gate);
    }

    #[test]
    fn harness_executor_rejects_missing_permission() {
        let provider =
            harness_provider("read-only-harness", vec![ProviderPermission::ReadWorkspace]);
        let request = HarnessExecutionRequest::new("edit file")
            .with_required_permission(ProviderPermission::WriteWorkspace);
        let executor = FakeHarnessExecutor::default();

        let err = execute_harness_provider(&provider, request, &executor).unwrap_err();

        assert!(err.to_string().contains("permission"));
    }

    #[test]
    fn harness_executor_marks_high_risk_request_for_human_gate() {
        let provider = harness_provider(
            "risky-harness",
            vec![
                ProviderPermission::RunCommand,
                ProviderPermission::WriteWorkspace,
            ],
        );
        let request = HarnessExecutionRequest::new("rewrite project")
            .with_required_permission(ProviderPermission::RunCommand)
            .with_risk(HarnessRisk::High);
        let executor = FakeHarnessExecutor {
            response: "needs approval".to_string(),
            delegated_task: None,
        };

        let result = execute_harness_provider(&provider, request, &executor).unwrap();

        assert!(result.requires_human_gate);
        assert_eq!(result.risk, HarnessRisk::High);
    }

    #[test]
    fn harness_executor_honors_pre_cancelled_request() {
        let provider = harness_provider("cancel-harness", vec![ProviderPermission::ReadWorkspace]);
        let cancel = Arc::new(AtomicBool::new(true));
        let request = HarnessExecutionRequest::new("read").with_cancel(cancel);
        let executor = FakeHarnessExecutor::default();

        let err = execute_harness_provider(&provider, request, &executor).unwrap_err();

        assert!(err.to_string().contains("cancelled"));
    }

    #[test]
    fn default_external_tool_registry_contains_first_cli_providers() {
        let registry = default_external_tool_registry().unwrap();

        assert!(registry.get("codex-cli").is_some());
        assert!(registry.get("claude-code-cli").is_some());
        assert!(registry.get("opencode-cli").is_some());
        assert_eq!(registry.len(), 3);
    }

    #[test]
    fn default_codex_cli_provider_uses_codex_exec() {
        let provider = codex_cli_provider().unwrap();

        assert_eq!(provider.id, "codex-cli");
        assert!(provider.supports(ProviderCapability::Read));
        assert!(provider.supports(ProviderCapability::Write));
        assert!(provider.supports(ProviderCapability::Command));
        assert!(provider.supports(ProviderCapability::Streaming));
        assert!(provider.supports(ProviderCapability::Cancel));
        assert!(
            provider
                .permissions
                .allows(ProviderPermission::ReadWorkspace)
        );
        assert!(
            provider
                .permissions
                .allows(ProviderPermission::WriteWorkspace)
        );
        assert!(provider.permissions.allows(ProviderPermission::RunCommand));
        assert!(provider.permissions.requires_human_gate);
        assert_cli_runtime(&provider, "codex", &["exec"]);
    }

    #[test]
    fn default_claude_code_provider_uses_prompt_mode() {
        let provider = claude_code_cli_provider().unwrap();

        assert_eq!(provider.id, "claude-code-cli");
        assert!(provider.supports(ProviderCapability::Read));
        assert!(provider.supports(ProviderCapability::Write));
        assert!(provider.supports(ProviderCapability::Streaming));
        assert!(provider.supports(ProviderCapability::Cancel));
        assert!(provider.permissions.requires_human_gate);
        assert_cli_runtime(&provider, "claude", &["-p"]);
    }

    #[test]
    fn default_opencode_provider_uses_run_command() {
        let provider = opencode_cli_provider().unwrap();

        assert_eq!(provider.id, "opencode-cli");
        assert!(provider.supports(ProviderCapability::Read));
        assert!(provider.supports(ProviderCapability::Write));
        assert!(provider.supports(ProviderCapability::Command));
        assert!(provider.supports(ProviderCapability::Streaming));
        assert!(provider.supports(ProviderCapability::Cancel));
        assert!(provider.permissions.requires_human_gate);
        assert_cli_runtime(&provider, "opencode", &["run"]);
    }

    #[test]
    fn cli_provider_helper() {
        match std::env::var("CODEPANION_PROVIDER_HELPER").as_deref() {
            Ok("cwd") => {
                println!("{}", std::env::current_dir().unwrap().display());
                eprintln!("helper-stderr");
            }
            Ok("sleep") => {
                let sleep_ms = std::env::var("CODEPANION_PROVIDER_SLEEP_MS")
                    .ok()
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(1000);
                std::thread::sleep(Duration::from_millis(sleep_ms));
            }
            Ok("env") => {
                println!(
                    "{}",
                    std::env::var("CODEPANION_SHOULD_NOT_LEAK")
                        .unwrap_or_else(|_| "not-present".to_string())
                );
            }
            Ok("stdin") => {
                let mut input = String::new();
                std::io::stdin().read_to_string(&mut input).unwrap();
                println!("{input}");
            }
            _ => {}
        }
    }

    fn helper_cli_provider(id: &str, extra_args: Vec<String>) -> ProviderDefinition {
        let mut args = vec![
            "--exact".to_string(),
            "tests::cli_provider_helper".to_string(),
            "--nocapture".to_string(),
        ];
        args.extend(extra_args);
        ProviderDefinition::new(
            id,
            "Test CLI",
            ProviderKind::Cli,
            vec![ProviderCapability::Command],
            ProviderPermissions::default(),
            ProviderRuntime::Cli {
                command: std::env::current_exe().unwrap().display().to_string(),
                args,
            },
        )
        .unwrap()
    }

    fn test_workspace(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "codepanion-provider-test-{name}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn api_provider(id: &str, base_url: String) -> ProviderDefinition {
        ProviderDefinition::new(
            id,
            "Test API",
            ProviderKind::Api,
            vec![ProviderCapability::Network, ProviderCapability::Streaming],
            ProviderPermissions::default(),
            ProviderRuntime::api(base_url),
        )
        .unwrap()
    }

    fn harness_provider(id: &str, grants: Vec<ProviderPermission>) -> ProviderDefinition {
        ProviderDefinition::new(
            id,
            "Test Harness",
            ProviderKind::Harness,
            vec![
                ProviderCapability::Read,
                ProviderCapability::Write,
                ProviderCapability::Delegate,
            ],
            ProviderPermissions::new(false, grants),
            ProviderRuntime::harness("test-harness"),
        )
        .unwrap()
    }

    fn assert_cli_runtime(
        provider: &ProviderDefinition,
        expected_command: &str,
        expected_args: &[&str],
    ) {
        let ProviderRuntime::Cli { command, args } = &provider.runtime else {
            panic!("expected cli runtime");
        };
        assert_eq!(command, expected_command);
        assert_eq!(
            args,
            &expected_args
                .iter()
                .map(|arg| arg.to_string())
                .collect::<Vec<_>>()
        );
    }

    #[derive(Default)]
    struct FakeHarnessExecutor {
        response: String,
        delegated_task: Option<String>,
    }

    impl HarnessExecutor for FakeHarnessExecutor {
        fn execute(&self, request: &HarnessExecutionRequest) -> Result<HarnessExecutionResult> {
            let mut result = HarnessExecutionResult::new(
                ProviderOutput::new(request.provider_id.clone())
                    .with_assistant_text(self.response.clone()),
                request.risk,
            );
            if let Some(prompt) = &self.delegated_task {
                result = result
                    .with_delegated_task(HarnessDelegatedTask::new("reviewer", prompt.clone()));
            }
            Ok(result)
        }
    }

    fn spawn_api_server(response: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]).to_string();
            stream.write_all(response.as_bytes()).unwrap();
            request
        });
        (format!("http://127.0.0.1:{port}/v1"), handle)
    }

    fn spawn_slow_api_server(delay: Duration) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 4096];
            let _ = stream.read(&mut buffer).unwrap();
            std::thread::sleep(delay);
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 53\r\n\r\n{\"choices\":[{\"message\":{\"content\":\"too late\"}}]}",
            );
        });
        (format!("http://127.0.0.1:{port}/v1"), handle)
    }
}
