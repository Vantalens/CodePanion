use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use codepanion_config::ModelBackendConfig;
use codepanion_shared::{CodePanionError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CancellationToken {
    cancelled: bool,
}

impl CancellationToken {
    pub fn cancelled() -> Self {
        Self { cancelled: true }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedUrl {
    host: String,
    port: u16,
    path: String,
}

pub fn chat_completion(request: &ChatRequest) -> Result<ChatCompletionResult> {
    request.validate()?;
    if request.cancel.is_cancelled() {
        return Err(CodePanionError::Runtime(
            "model request cancelled".to_string(),
        ));
    }

    let url = parse_http_url(&request.backend.base_url)?;
    let body = build_chat_body(request);
    let mut headers = vec![
        format!(
            "POST {} HTTP/1.1",
            join_path(&url.path, "/chat/completions")
        ),
        format!("Host: {}:{}", url.host, url.port),
        "Content-Type: application/json".to_string(),
        format!("Content-Length: {}", body.len()),
        "Connection: close".to_string(),
    ];
    if let Some(api_key) = request.api_key.as_deref().filter(|key| !key.is_empty()) {
        headers.push(format!("Authorization: Bearer {api_key}"));
    }

    let mut stream = TcpStream::connect((url.host.as_str(), url.port))
        .map_err(|err| CodePanionError::Runtime(format!("model API connection failed: {err}")))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|err| CodePanionError::Runtime(format!("failed to set read timeout: {err}")))?;
    let request_bytes = format!("{}\r\n\r\n{body}", headers.join("\r\n"));
    stream
        .write_all(request_bytes.as_bytes())
        .map_err(|err| CodePanionError::Runtime(format!("model API request failed: {err}")))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|err| CodePanionError::Runtime(format!("model API response failed: {err}")))?;
    parse_chat_response(&response)
}

fn parse_http_url(raw: &str) -> Result<ParsedUrl> {
    let without_scheme = raw.strip_prefix("http://").ok_or_else(|| {
        CodePanionError::InvalidInput(
            "only http:// model base_url is supported in bootstrap client".to_string(),
        )
    })?;
    let (authority, path) = without_scheme
        .split_once('/')
        .map_or((without_scheme, "/"), |(host, rest)| (host, rest));
    if authority.is_empty() {
        return Err(CodePanionError::InvalidInput(
            "model base_url host is required".to_string(),
        ));
    }
    let (host, port) = authority
        .rsplit_once(':')
        .and_then(|(host, port)| Some((host, port.parse::<u16>().ok()?)))
        .unwrap_or((authority, 80));
    Ok(ParsedUrl {
        host: host.to_string(),
        port,
        path: if path == "/" {
            "/".to_string()
        } else {
            format!("/{path}")
        },
    })
}

fn join_path(base: &str, suffix: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        suffix.trim_start_matches('/')
    )
}

fn build_chat_body(request: &ChatRequest) -> String {
    let messages = request
        .messages
        .iter()
        .map(|message| {
            format!(
                r#"{{"role":"{}","content":"{}"}}"#,
                json_escape(&message.role),
                json_escape(&message.content)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let stream = if request.stream {
        r#","stream":true"#
    } else {
        ""
    };
    format!(
        r#"{{"model":"{}","messages":[{}]{stream}}}"#,
        json_escape(&request.backend.model),
        messages
    )
}

fn json_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if ch.is_control() => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out
}

fn parse_chat_response(response: &str) -> Result<ChatCompletionResult> {
    let (head, body) = response.split_once("\r\n\r\n").ok_or_else(|| {
        CodePanionError::Runtime("model API returned malformed HTTP response".to_string())
    })?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| CodePanionError::Runtime("model API response missing status".to_string()))?;
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
    fn chat_completion_posts_openai_compatible_request() {
        let (base_url, handle) = spawn_mock_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 92\r\n\r\n{\"choices\":[{\"message\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":3}}",
        );
        let result = chat_completion(&ChatRequest {
            backend: ModelBackendConfig {
                id: "mock".to_string(),
                base_url,
                model: "gpt-test".to_string(),
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
        assert!(request.contains("Authorization: Bearer secret"));
        assert!(request.contains(r#""model":"gpt-test""#));
        assert!(request.contains(r#""content":"hello""#));
    }

    #[test]
    fn chat_completion_reports_non_success_status() {
        let (base_url, handle) = spawn_mock_server(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 12\r\n\r\nserver broke",
        );
        let err = chat_completion(&ChatRequest {
            backend: ModelBackendConfig {
                id: "mock".to_string(),
                base_url,
                model: "gpt-test".to_string(),
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
    fn chat_completion_parses_tool_calls() {
        let (base_url, handle) = spawn_mock_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 173\r\n\r\n{\"choices\":[{\"message\":{\"content\":\"\",\"tool_calls\":[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}",
        );
        let result = chat_completion(&ChatRequest {
            backend: ModelBackendConfig {
                id: "mock".to_string(),
                base_url,
                model: "gpt-test".to_string(),
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
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        let leaked_response: &'static str = Box::leak(response.into_boxed_str());
        let (base_url, handle) = spawn_mock_server(leaked_response);
        let result = chat_completion(&ChatRequest {
            backend: ModelBackendConfig {
                id: "mock".to_string(),
                base_url,
                model: "gpt-test".to_string(),
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

    fn spawn_mock_server(response: &'static str) -> (String, thread::JoinHandle<String>) {
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
