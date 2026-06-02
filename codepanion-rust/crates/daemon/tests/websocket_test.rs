#[path = "integration/mod.rs"]
mod integration;

use futures::StreamExt;
use integration::test_helpers::TestDaemon;
use serde_json::json;
use std::time::Duration;
use tokio::time::timeout;
use tokio_tungstenite::connect_async;

// ============================================================================
// WebSocket Real-Time Event Tests
// ============================================================================

#[tokio::test]
async fn test_websocket_receives_scheduler_run_event() {
    let daemon = TestDaemon::start().await;
    let ws_url = daemon.base_url.replace("http://", "ws://") + "/ws";
    let (mut ws, _) = connect_async(ws_url).await.unwrap();

    let response = daemon
        .post(
            "/api/v1/scheduler/enqueue",
            json!({
                "runId": "ws-scheduler-run",
                "projectId": "ws-project",
                "workflowId": "ws-workflow",
                "priority": "normal"
            }),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);

    let event = next_json_event(&mut ws).await;
    assert_eq!(event["eventType"], "workflow-run-event");
    assert_eq!(event["runId"], "ws-scheduler-run");
    assert_eq!(event["projectId"], "ws-project");
    assert_eq!(event["workflowId"], "ws-workflow");
    assert_eq!(event["status"], "queued");
}

#[tokio::test]
async fn test_websocket_receives_workflow_execution_events() {
    let daemon = TestDaemon::start().await;
    let ws_url = daemon.base_url.replace("http://", "ws://") + "/ws";
    let (mut ws, _) = connect_async(ws_url).await.unwrap();

    #[cfg(target_os = "windows")]
    let (command, args) = ("cmd", vec!["/C", "echo websocket"]);
    #[cfg(not(target_os = "windows"))]
    let (command, args) = ("echo", vec!["websocket"]);

    let response = daemon
        .post(
            "/api/v1/workflows/execute",
            json!({
                "projectId": "ws-project",
                "workflow": {
                    "name": "ws-exec-workflow",
                    "description": "websocket workflow",
                    "params": {},
                    "steps": [
                        {
                            "id": "say",
                            "architecture": "shell",
                            "command": command,
                            "args": args
                        }
                    ],
                    "createdAt": 0,
                    "updatedAt": 0
                }
            }),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    let run_id = body["runId"].as_str().unwrap();

    let mut seen_types = Vec::new();
    for _ in 0..5 {
        let event = next_json_event(&mut ws).await;
        if event["runId"] == run_id {
            assert_eq!(event["projectId"], "ws-project");
            seen_types.push(event["eventType"].as_str().unwrap().to_string());
            if event["eventType"] == "workflow-completed" {
                assert_eq!(event["workflowId"], "ws-exec-workflow");
                assert_eq!(event["status"], "Success");
                break;
            }
        }
    }

    assert!(
        seen_types
            .iter()
            .any(|event_type| event_type == "workflow-started"),
        "expected workflow-started event, got {:?}",
        seen_types
    );
    assert!(
        seen_types
            .iter()
            .any(|event_type| event_type == "workflow-completed"),
        "expected workflow-completed event, got {:?}",
        seen_types
    );
}

async fn next_json_event(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> serde_json::Value {
    let message = timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("timed out waiting for websocket event")
        .expect("websocket closed")
        .expect("websocket error");

    let text = message
        .into_text()
        .expect("expected text websocket message");
    serde_json::from_str(&text).expect("websocket event should be JSON")
}
