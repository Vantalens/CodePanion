use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use codepanion_config::ModelBackendConfig;
use codepanion_shared::{CodePanionError, Result};
use reqwest::header::CONTENT_TYPE;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub backend: ModelBackendConfig,
    pub messages: Vec<ChatMessage>,
    pub api_key: Option<String>,
    pub cancel: CancellationToken,
    pub stream: bool,
}

impl ChatRequest {
    pub fn validate(&self) -> Result<()> {
        if self.backend.base_url.trim().is_empty() {
            return Err(CodePanionError::InvalidInput(
                "model base_url is required".to_string(),
            ));
        }
        if self.backend.model.trim().is_empty() {
            return Err(CodePanionError::InvalidInput(
                "model name is required".to_string(),
            ));
        }
        if self.messages.is_empty() {
            return Err(CodePanionError::InvalidInput(
                "at least one message is required".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn from_flag(cancelled: Arc<AtomicBool>) -> Self {
        Self { cancelled }
    }

    pub fn cancelled() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(true)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatCompletionResult {
    pub text: String,
    pub finish_reason: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCall {
    pub id: Option<String>,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatTool {
    pub tool_type: String,
    pub function: ChatToolFunction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatToolFunction {
    pub name: String,
    pub description: String,
    pub parameters: String, // JSON schema as string
}

impl ChatTool {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: impl Into<String>,
    ) -> Self {
        Self {
            tool_type: "function".to_string(),
            function: ChatToolFunction {
                name: name.into(),
                description: description.into(),
                parameters: parameters.into(),
            },
        }
    }
}

pub fn chat_completion(request: &ChatRequest) -> Result<ChatCompletionResult> {
    request.validate()?;
    if request.cancel.is_cancelled() {
        return Err(CodePanionError::Runtime(
            "model request cancelled".to_string(),
        ));
    }

    let url = chat_url(&request.backend.base_url)?;
    let body = build_chat_body(request)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| CodePanionError::Runtime(format!("model API client failed: {err}")))?;

    let mut request_builder = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .body(body);
    if let Some(api_key) = request.api_key.as_deref().filter(|key| !key.is_empty()) {
        request_builder = request_builder.bearer_auth(api_key);
    }

    let response = request_builder
        .send()
        .map_err(|err| CodePanionError::Runtime(format!("model API request failed: {err}")))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .map_err(|err| CodePanionError::Runtime(format!("model API response failed: {err}")))?;

    parse_chat_body(status, &body)
}

fn chat_url(base_url: &str) -> Result<String> {
    let trimmed = base_url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(CodePanionError::InvalidInput(
            "model base_url must start with http:// or https://".to_string(),
        ));
    }
    if trimmed == "http://" || trimmed == "https://" {
        return Err(CodePanionError::InvalidInput(
            "model base_url host is required".to_string(),
        ));
    }
    reqwest::Url::parse(trimmed)
        .map_err(|err| CodePanionError::InvalidInput(format!("model base_url is invalid: {err}")))
        .map(|_| format!("{}/chat/completions", trimmed.trim_end_matches('/')))
}

fn build_chat_body(request: &ChatRequest) -> Result<String> {
    use serde_json::json;

    let messages: Vec<_> = request
        .messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content
            })
        })
        .collect();

    let mut body = json!({
        "model": request.backend.model,
        "messages": messages
    });

    if request.stream {
        body["stream"] = json!(true);
    }

    serde_json::to_string(&body)
        .map_err(|e| CodePanionError::InvalidInput(format!("Failed to serialize request: {}", e)))
}

fn parse_chat_body(status: u16, body: &str) -> Result<ChatCompletionResult> {
    if !(200..300).contains(&status) {
        return Err(CodePanionError::Runtime(format!(
            "model API {status}: {}",
            body.chars().take(500).collect::<String>()
        )));
    }
    if body
        .lines()
        .any(|line| line.trim_start().starts_with("data:"))
    {
        return parse_streaming_body(body);
    }
    let text = extract_json_string(body, "\"content\"").unwrap_or_default();
    let finish_reason = extract_json_string(body, "\"finish_reason\"");
    let tool_calls = extract_tool_calls(body);
    if text.is_empty() && tool_calls.is_empty() {
        return Err(CodePanionError::Runtime(
            "model API response missing content or tool_calls".to_string(),
        ));
    }
    Ok(ChatCompletionResult {
        text,
        finish_reason,
        tool_calls,
        raw: body.to_string(),
    })
}

fn parse_streaming_body(body: &str) -> Result<ChatCompletionResult> {
    let mut text = String::new();
    let mut finish_reason = None;
    let mut tool_calls = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim_start();
        let Some(data) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            break;
        }
        if let Some(delta) = extract_json_string(data, "\"content\"") {
            text.push_str(&delta);
        }
        if finish_reason.is_none() {
            finish_reason = extract_json_string(data, "\"finish_reason\"");
        }
        tool_calls.extend(extract_tool_calls(data));
    }
    Ok(ChatCompletionResult {
        text,
        finish_reason,
        tool_calls,
        raw: body.to_string(),
    })
}

fn extract_tool_calls(body: &str) -> Vec<ToolCall> {
    let mut calls = Vec::new();
    let mut rest = body;
    while let Some(function_index) = rest.find("\"function\"") {
        let prefix = &rest[..function_index];
        let id = extract_last_json_string(prefix, "\"id\"");
        rest = &rest[function_index..];
        let name = extract_json_string(rest, "\"name\"");
        let arguments = extract_json_string(rest, "\"arguments\"");
        if let (Some(name), Some(arguments)) = (name, arguments) {
            calls.push(ToolCall {
                id,
                name,
                arguments,
            });
        }
        rest = if let Some(arguments_index) = rest.find("\"arguments\"") {
            &rest[arguments_index + "\"arguments\"".len()..]
        } else {
            &rest["\"function\"".len()..]
        };
    }
    calls
}

fn extract_last_json_string(body: &str, key: &str) -> Option<String> {
    let mut found = None;
    let mut rest = body;
    while let Some(index) = rest.find(key) {
        rest = &rest[index..];
        found = extract_json_string(rest, key);
        rest = &rest[key.len()..];
    }
    found
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn chat_request_requires_messages() {
        let request = ChatRequest {
            backend: ModelBackendConfig {
                id: "default".to_string(),
                base_url: "http://localhost:11434/v1".to_string(),
                model: "qwen".to_string(),
                api_key: None,
            },
            messages: vec![],
            api_key: None,
            cancel: CancellationToken::default(),
            stream: false,
        };

        assert!(
            request
                .validate()
                .unwrap_err()
                .to_string()
                .contains("message")
        );
    }

    #[test]
    fn chat_url_accepts_https_base_urls() {
        assert_eq!(
            chat_url("https://api.openai.com/v1").unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn chat_completion_posts_openai_compatible_request() {
        let (base_url, handle) = spawn_mock_server(json_response(
            200,
            "OK",
            r#"{"choices":[{"message":{"content":"done"},"finish_reason":"stop"}],"usage":{"total_tokens":3}}"#,
        ));
        let result = chat_completion(&ChatRequest {
            backend: ModelBackendConfig {
                id: "mock".to_string(),
                base_url,
                model: "gpt-test".to_string(),
                api_key: None,
            },
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            }],
            api_key: Some("secret".to_string()),
            cancel: CancellationToken::default(),
            stream: false,
        })
        .unwrap();
        let request = handle.join().unwrap();

        assert_eq!(result.text, "done");
        assert_eq!(result.finish_reason.as_deref(), Some("stop"));
        assert!(request.contains("POST /v1/chat/completions HTTP/1.1"));
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer secret")
        );
        assert!(request.contains(r#""model":"gpt-test""#));
        assert!(request.contains(r#""content":"hello""#));
    }

    #[test]
    fn chat_completion_reports_non_success_status() {
        let (base_url, handle) =
            spawn_mock_server(text_response(500, "Internal Server Error", "server broke"));
        let err = chat_completion(&ChatRequest {
            backend: ModelBackendConfig {
                id: "mock".to_string(),
                base_url,
                model: "gpt-test".to_string(),
                api_key: None,
            },
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            }],
            api_key: None,
            cancel: CancellationToken::default(),
            stream: false,
        })
        .unwrap_err();
        let _ = handle.join().unwrap();

        assert!(err.to_string().contains("500"));
        assert!(err.to_string().contains("server broke"));
    }

    #[test]
    fn chat_completion_honors_pre_cancelled_request() {
        let err = chat_completion(&ChatRequest {
            backend: ModelBackendConfig {
                id: "mock".to_string(),
                base_url: "http://127.0.0.1:1/v1".to_string(),
                model: "gpt-test".to_string(),
                api_key: None,
            },
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            }],
            api_key: None,
            cancel: CancellationToken::cancelled(),
            stream: false,
        })
        .unwrap_err();

        assert!(err.to_string().contains("cancelled"));
    }

    #[test]
    fn cancellation_token_observes_shared_flag() {
        let flag = Arc::new(AtomicBool::new(false));
        let token = CancellationToken::from_flag(flag.clone());

        assert!(!token.is_cancelled());
        flag.store(true, Ordering::SeqCst);
        assert!(token.is_cancelled());
    }

    #[test]
    fn chat_completion_parses_tool_calls() {
        let (base_url, handle) = spawn_mock_server(json_response(
            200,
            "OK",
            r#"{"choices":[{"message":{"content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"README.md\"}"}}]},"finish_reason":"tool_calls"}]}"#,
        ));
        let result = chat_completion(&ChatRequest {
            backend: ModelBackendConfig {
                id: "mock".to_string(),
                base_url,
                model: "gpt-test".to_string(),
                api_key: None,
            },
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "read".to_string(),
            }],
            api_key: None,
            cancel: CancellationToken::default(),
            stream: false,
        })
        .unwrap();
        let _ = handle.join().unwrap();

        assert_eq!(result.finish_reason.as_deref(), Some("tool_calls"));
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id.as_deref(), Some("call_1"));
        assert_eq!(result.tool_calls[0].name, "read_file");
        assert!(result.tool_calls[0].arguments.contains("README.md"));
    }

    #[test]
    fn chat_completion_parses_streaming_content() {
        let response_body = "data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\
data: {\"choices\":[{\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\
data: [DONE]\n";
        let (base_url, handle) = spawn_mock_server(event_stream_response(200, "OK", response_body));
        let result = chat_completion(&ChatRequest {
            backend: ModelBackendConfig {
                id: "mock".to_string(),
                base_url,
                model: "gpt-test".to_string(),
                api_key: None,
            },
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "stream".to_string(),
            }],
            api_key: None,
            cancel: CancellationToken::default(),
            stream: true,
        })
        .unwrap();
        let request = handle.join().unwrap();

        assert_eq!(result.text, "hello");
        assert_eq!(result.finish_reason.as_deref(), Some("stop"));
        assert!(request.contains(r#""stream":true"#));
    }

    fn json_response(status: u16, reason: &str, body: &str) -> String {
        response(status, reason, "application/json", body)
    }

    fn text_response(status: u16, reason: &str, body: &str) -> String {
        response(status, reason, "text/plain", body)
    }

    fn event_stream_response(status: u16, reason: &str, body: &str) -> String {
        response(status, reason, "text/event-stream", body)
    }

    fn response(status: u16, reason: &str, content_type: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    fn spawn_mock_server(response: String) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]).to_string();
            stream.write_all(response.as_bytes()).unwrap();
            request
        });
        (format!("http://127.0.0.1:{port}/v1"), handle)
    }
}
