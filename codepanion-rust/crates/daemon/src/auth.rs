use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode, header},
    middleware::Next,
    response::Response,
};

use crate::AppState;

/// Authentication middleware for HTTP requests
///
/// Verifies Bearer token from Authorization header.
/// Allows /health endpoint without authentication.
pub async fn auth_middleware(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = request.uri().path();

    // Allow health check without authentication
    if path == "/health" {
        return Ok(next.run(request).await);
    }

    let Some(expected_token) = state.auth_token.as_deref() else {
        // Local development compatibility: auth is enforced when a token is configured.
        return Ok(next.run(request).await);
    };

    if bearer_token_matches(&request, expected_token)
        || websocket_protocol_token_matches(&request, expected_token)
    {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

fn bearer_token_matches(request: &Request<Body>, expected_token: &str) -> bool {
    request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|auth| auth.strip_prefix("Bearer "))
        .is_some_and(|token| constant_time_eq(token.as_bytes(), expected_token.as_bytes()))
}

/// Check WebSocket protocol-based authentication.
/// Only allows a single token protocol to prevent injection attacks.
fn websocket_protocol_token_matches(request: &Request<Body>, expected_token: &str) -> bool {
    if request.uri().path() != "/ws" {
        return false;
    }

    // Get the Sec-WebSocket-Protocol header
    let protocols_header = match request
        .headers()
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|h| h.to_str().ok())
    {
        Some(h) => h,
        None => return false,
    };

    // Split protocols and look for our token protocol
    let protocols: Vec<&str> = protocols_header
        .split(',')
        .map(str::trim)
        .collect();

    // Security: Only accept if there's exactly ONE protocol total and it's our token protocol
    // This prevents attackers from mixing valid and malicious protocols
    if protocols.len() != 1 {
        return false;
    }

    let protocol = protocols[0];

    // Must have our prefix
    let Some(token) = protocol.strip_prefix("codepanion.token.") else {
        return false;
    };

    // Additional validation: token must not contain suspicious characters
    if token.contains(&[',', ' ', '\n', '\r'][..]) {
        return false;
    }

    // Constant-time comparison
    constant_time_eq(token.as_bytes(), expected_token.as_bytes())
}

/// Constant-time comparison to prevent timing attacks.
/// This implementation ensures that comparison time does not leak length information.
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    // Early length check with constant-time dummy comparison
    if left.len() != right.len() {
        // Perform a dummy constant-time comparison to prevent timing leak
        // Use the longer slice length to ensure consistent timing
        let max_len = left.len().max(right.len());
        let dummy = vec![0u8; max_len];

        let mut _diff = 0u8;
        for i in 0..max_len {
            let a = left.get(i).copied().unwrap_or(0);
            let b = dummy.get(i).copied().unwrap_or(0);
            _diff |= a ^ b;
        }

        // Always return false, but after constant-time work
        return false;
    }

    // Actual constant-time comparison for equal-length inputs
    let mut diff = 0u8;
    for i in 0..left.len() {
        diff |= left[i] ^ right[i];
    }

    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, header};

    #[test]
    fn constant_time_eq_matches_equal_tokens() {
        assert!(constant_time_eq(b"secret-token", b"secret-token"));
        assert!(!constant_time_eq(b"secret-token", b"wrong-token"));
        assert!(!constant_time_eq(b"secret-token", b"secret-token-extra"));
    }

    #[test]
    fn constant_time_eq_handles_length_differences() {
        assert!(!constant_time_eq(b"short", b"verylongtoken"));
        assert!(!constant_time_eq(b"verylongtoken", b"short"));
        assert!(!constant_time_eq(b"", b"token"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn constant_time_eq_handles_special_characters() {
        let token1 = b"token-with-special!@#$%^&*()";
        let token2 = b"token-with-special!@#$%^&*()";
        assert!(constant_time_eq(token1, token2));
    }

    #[test]
    fn bearer_token_valid() {
        let request = Request::builder()
            .uri("/api/test")
            .header(header::AUTHORIZATION, "Bearer valid-token-123")
            .body(Body::empty())
            .unwrap();

        assert!(bearer_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn bearer_token_invalid() {
        let request = Request::builder()
            .uri("/api/test")
            .header(header::AUTHORIZATION, "Bearer wrong-token")
            .body(Body::empty())
            .unwrap();

        assert!(!bearer_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn bearer_token_missing_bearer_prefix() {
        let request = Request::builder()
            .uri("/api/test")
            .header(header::AUTHORIZATION, "valid-token-123")
            .body(Body::empty())
            .unwrap();

        assert!(!bearer_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn bearer_token_missing_header() {
        let request = Request::builder()
            .uri("/api/test")
            .body(Body::empty())
            .unwrap();

        assert!(!bearer_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn websocket_token_valid() {
        let request = Request::builder()
            .uri("/ws")
            .header(header::SEC_WEBSOCKET_PROTOCOL, "codepanion.token.valid-token-123")
            .body(Body::empty())
            .unwrap();

        assert!(websocket_protocol_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn websocket_token_invalid() {
        let request = Request::builder()
            .uri("/ws")
            .header(header::SEC_WEBSOCKET_PROTOCOL, "codepanion.token.wrong-token")
            .body(Body::empty())
            .unwrap();

        assert!(!websocket_protocol_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn websocket_token_multiple_protocols_rejected() {
        // Security test: multiple protocols should be rejected to prevent injection
        let request = Request::builder()
            .uri("/ws")
            .header(
                header::SEC_WEBSOCKET_PROTOCOL,
                "other-protocol, codepanion.token.valid-token-123"
            )
            .body(Body::empty())
            .unwrap();

        assert!(!websocket_protocol_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn websocket_token_multiple_token_protocols_rejected() {
        // Security test: multiple token protocols should be rejected
        let request = Request::builder()
            .uri("/ws")
            .header(
                header::SEC_WEBSOCKET_PROTOCOL,
                "codepanion.token.valid-token-123, codepanion.token.another-token"
            )
            .body(Body::empty())
            .unwrap();

        assert!(!websocket_protocol_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn websocket_token_with_suspicious_characters_rejected() {
        let request = Request::builder()
            .uri("/ws")
            .header(header::SEC_WEBSOCKET_PROTOCOL, "codepanion.token.token,injection")
            .body(Body::empty())
            .unwrap();

        assert!(!websocket_protocol_token_matches(&request, "token,injection"));
    }

    #[test]
    fn websocket_token_wrong_path() {
        let request = Request::builder()
            .uri("/api/test")
            .header(header::SEC_WEBSOCKET_PROTOCOL, "codepanion.token.valid-token-123")
            .body(Body::empty())
            .unwrap();

        assert!(!websocket_protocol_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn websocket_token_missing_header() {
        let request = Request::builder()
            .uri("/ws")
            .body(Body::empty())
            .unwrap();

        assert!(!websocket_protocol_token_matches(&request, "valid-token-123"));
    }

    #[test]
    fn websocket_token_empty_after_prefix() {
        let request = Request::builder()
            .uri("/ws")
            .header(header::SEC_WEBSOCKET_PROTOCOL, "codepanion.token.")
            .body(Body::empty())
            .unwrap();

        // Empty token after prefix matches empty expected token
        // This is technically correct behavior (empty == empty)
        assert!(websocket_protocol_token_matches(&request, ""));

        // But empty token should NOT match a non-empty expected token
        assert!(!websocket_protocol_token_matches(&request, "non-empty"));
    }
}
