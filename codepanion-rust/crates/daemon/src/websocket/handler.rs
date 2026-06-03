use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use futures::{sink::SinkExt, stream::StreamExt};

use super::broadcaster::EventBroadcaster;

/// WebSocket upgrade handler
///
/// Handles the WebSocket upgrade request and spawns a task to manage
/// the connection lifecycle: subscribe to broadcaster, forward events
/// to the client, and cleanup on disconnect.
pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<crate::AppState>,
) -> Response {
    let broadcaster = state.event_broadcaster.clone();
    ws.on_upgrade(move |socket| handle_socket(socket, broadcaster))
}

/// Handle a WebSocket connection
///
/// Connection lifecycle:
/// 1. Subscribe to the event broadcaster
/// 2. Forward events from broadcaster to WebSocket client
/// 3. Handle client disconnections gracefully
/// 4. Cleanup: unsubscribe from broadcaster
async fn handle_socket(socket: WebSocket, broadcaster: std::sync::Arc<EventBroadcaster>) {
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to broadcaster
    let (conn_id, mut event_rx) = broadcaster.subscribe();

    // Spawn a task to forward events from broadcaster to WebSocket
    let mut send_task = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            // Wrap event in GUI-expected format: { type: "workflow-run-event", event: {...} }
            let wrapped = serde_json::json!({
                "type": "workflow-run-event",
                "event": event
            });

            // Serialize to JSON
            let json = match serde_json::to_string(&wrapped) {
                Ok(json) => json,
                Err(e) => {
                    eprintln!("Failed to serialize event: {}", e);
                    continue;
                }
            };

            // Send to WebSocket client
            if sender.send(Message::Text(json)).await.is_err() {
                // Client disconnected
                break;
            }
        }
    });

    // Spawn a task to handle incoming messages from client
    // (Currently we don't expect any messages from client, but we need to
    // handle close frames and detect disconnections)
    let mut recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Close(_)) => {
                    // Client sent close frame
                    break;
                }
                Ok(Message::Ping(data)) => {
                    // Respond to ping with pong (axum handles this automatically)
                    // This is just for logging/debugging
                    let _ = data;
                }
                Ok(Message::Text(_)) | Ok(Message::Binary(_)) => {
                    // We don't expect text/binary messages from client
                    // Ignore them
                }
                Ok(Message::Pong(_)) => {
                    // Pong response to our ping
                }
                Err(e) => {
                    eprintln!("WebSocket error: {}", e);
                    break;
                }
            }
        }
    });

    // Wait for either task to finish (disconnect or error)
    tokio::select! {
        _ = (&mut send_task) => {
            recv_task.abort();
        }
        _ = (&mut recv_task) => {
            send_task.abort();
        }
    }

    // Cleanup: unsubscribe from broadcaster
    broadcaster.unsubscribe(conn_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_handle_socket_lifecycle() {
        // Test that we can create a broadcaster and subscribe
        let broadcaster = Arc::new(EventBroadcaster::new());

        let (conn_id, mut rx) = broadcaster.subscribe();
        assert_eq!(broadcaster.connection_count(), 1);

        // Simulate broadcasting an event
        let event = codepanion_workflow_engine::WorkflowRunEvent {
            event_type: "workflow-run-event".to_string(),
            run_id: "test-run".to_string(),
            project_id: "test-project".to_string(),
            workflow_id: "test-workflow".to_string(),
            status: "running".to_string(),
            timestamp: 1234567890,
        };

        broadcaster.broadcast(event.clone());

        // Verify event was received
        let received = rx.recv().await.unwrap();
        assert_eq!(received.run_id, "test-run");
        assert_eq!(received.status, "running");

        // Cleanup
        broadcaster.unsubscribe(conn_id);
        assert_eq!(broadcaster.connection_count(), 0);
    }
}
