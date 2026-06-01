use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

use codepanion_shared::{CodePanionError, Result, VERSION};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DaemonOptions {
    pub bind: String,
    pub port: u16,
}

pub fn run_daemon(options: DaemonOptions) -> Result<()> {
    let listener = TcpListener::bind((options.bind.as_str(), options.port))
        .map_err(|err| CodePanionError::Runtime(format!("failed to bind daemon: {err}")))?;
    println!(
        "CodePanion Rust daemon listening on http://{}:{}",
        options.bind, options.port
    );
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle_connection(stream)?,
            Err(err) => {
                return Err(CodePanionError::Runtime(format!(
                    "connection failed: {err}"
                )));
            }
        }
    }
    Ok(())
}

fn handle_connection(mut stream: TcpStream) -> Result<()> {
    let mut buffer = [0_u8; 1024];
    let size = stream
        .read(&mut buffer)
        .map_err(|err| CodePanionError::Runtime(format!("failed to read request: {err}")))?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    if request.starts_with("GET /ws ") {
        return handle_websocket_upgrade(stream, &request);
    }
    let response = if request.starts_with("GET /health ") {
        health_response(std::process::id(), VERSION)
    } else {
        not_found_response()
    };
    stream
        .write_all(response.as_bytes())
        .map_err(|err| CodePanionError::Runtime(format!("failed to write response: {err}")))?;
    Ok(())
}

fn handle_websocket_upgrade(mut stream: TcpStream, request: &str) -> Result<()> {
    let key = websocket_key(request).ok_or_else(|| {
        CodePanionError::InvalidInput("missing Sec-WebSocket-Key header".to_string())
    })?;
    let accept = websocket_accept_key(key.trim());
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {accept}\r\n\
         \r\n"
    );
    stream.write_all(response.as_bytes()).map_err(|err| {
        CodePanionError::Runtime(format!("failed to write websocket upgrade: {err}"))
    })?;
    let hello = format!(
        r#"{{"type":"hello","pid":{},"version":"{}"}}"#,
        std::process::id(),
        VERSION
    );
    stream
        .write_all(&websocket_text_frame(&hello))
        .map_err(|err| {
            CodePanionError::Runtime(format!("failed to write websocket hello: {err}"))
        })?;
    Ok(())
}

fn websocket_key(request: &str) -> Option<&str> {
    request.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case("sec-websocket-key") {
            Some(value)
        } else {
            None
        }
    })
}

pub fn health_response(pid: u32, version: &str) -> String {
    let body = format!(r#"{{"ok":true,"pid":{pid},"version":"{version}"}}"#);
    http_response("200 OK", "application/json; charset=utf-8", &body)
}

fn not_found_response() -> String {
    http_response(
        "404 Not Found",
        "application/json; charset=utf-8",
        r#"{"error":"not found"}"#,
    )
}

fn http_response(status: &str, content_type: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

pub fn websocket_accept_key(key: &str) -> String {
    let mut bytes = Vec::with_capacity(key.len() + 36);
    bytes.extend_from_slice(key.as_bytes());
    bytes.extend_from_slice(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    base64_encode(&sha1_digest(&bytes))
}

pub fn websocket_text_frame(text: &str) -> Vec<u8> {
    let payload = text.as_bytes();
    let mut frame = Vec::with_capacity(payload.len() + 10);
    frame.push(0x81);
    match payload.len() {
        0..=125 => frame.push(payload.len() as u8),
        126..=65_535 => {
            frame.push(126);
            frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        }
        _ => {
            frame.push(127);
            frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
        }
    }
    frame.extend_from_slice(payload);
    frame
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn sha1_digest(input: &[u8]) -> [u8; 20] {
    let mut h0: u32 = 0x6745_2301;
    let mut h1: u32 = 0xefcd_ab89;
    let mut h2: u32 = 0x98ba_dcfe;
    let mut h3: u32 = 0x1032_5476;
    let mut h4: u32 = 0xc3d2_e1f0;

    let bit_len = (input.len() as u64) * 8;
    let mut message = input.to_vec();
    message.push(0x80);
    while (message.len() % 64) != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in message.chunks(64) {
        let mut w = [0_u32; 80];
        for (i, bytes) in chunk.chunks(4).take(16).enumerate() {
            w[i] = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let mut a = h0;
        let mut b = h1;
        let mut c = h2;
        let mut d = h3;
        let mut e = h4;

        for (i, word) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5a82_7999),
                20..=39 => (b ^ c ^ d, 0x6ed9_eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1b_bcdc),
                _ => (b ^ c ^ d, 0xca62_c1d6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut digest = [0_u8; 20];
    digest[0..4].copy_from_slice(&h0.to_be_bytes());
    digest[4..8].copy_from_slice(&h1.to_be_bytes());
    digest[8..12].copy_from_slice(&h2.to_be_bytes());
    digest[12..16].copy_from_slice(&h3.to_be_bytes());
    digest[16..20].copy_from_slice(&h4.to_be_bytes());
    digest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_response_is_json_http_200() {
        let response = health_response(42, "0.1.0");

        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("Content-Type: application/json; charset=utf-8"));
        assert!(response.ends_with(r#"{"ok":true,"pid":42,"version":"0.1.0"}"#));
    }

    #[test]
    fn websocket_accept_matches_rfc_example() {
        let accept = websocket_accept_key("dGhlIHNhbXBsZSBub25jZQ==");
        assert_eq!(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    #[test]
    fn websocket_text_frame_encodes_unmasked_server_frame() {
        let frame = websocket_text_frame("hello");
        assert_eq!(frame, vec![0x81, 5, b'h', b'e', b'l', b'l', b'o']);
    }
}
