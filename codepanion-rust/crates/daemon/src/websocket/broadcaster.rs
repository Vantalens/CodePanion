use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

// Re-export WorkflowRunEvent from workflow-engine to avoid duplication
pub use codepanion_workflow_engine::WorkflowRunEvent;

/// Unique identifier for a WebSocket connection
pub type ConnectionId = u64;

/// Event broadcaster for WebSocket connections
///
/// Manages a registry of active WebSocket connections and broadcasts
/// workflow run events to all connected clients in a fire-and-forget manner.
pub struct EventBroadcaster {
    /// Registry of active connections
    /// Key: ConnectionId, Value: mpsc::Sender for sending events to that connection
    connections: Arc<Mutex<HashMap<ConnectionId, mpsc::UnboundedSender<WorkflowRunEvent>>>>,
    /// Next connection ID to assign
    next_id: Arc<Mutex<ConnectionId>>,
}

impl EventBroadcaster {
    /// Create a new event broadcaster
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
        }
    }

    /// Subscribe a new connection and get a receiver for events
    ///
    /// Returns a tuple of (ConnectionId, Receiver) where the receiver
    /// will receive all broadcast events until unsubscribe is called.
    pub fn subscribe(&self) -> (ConnectionId, mpsc::UnboundedReceiver<WorkflowRunEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();

        let mut next_id = self.next_id.lock().unwrap();
        let id = *next_id;
        *next_id += 1;
        drop(next_id);

        let mut connections = self.connections.lock().unwrap();
        connections.insert(id, tx);
        drop(connections);

        (id, rx)
    }

    /// Unsubscribe a connection
    ///
    /// Removes the connection from the registry. The receiver will no longer
    /// receive events after this call.
    pub fn unsubscribe(&self, id: ConnectionId) {
        let mut connections = self.connections.lock().unwrap();
        connections.remove(&id);
    }

    /// Broadcast an event to all connected clients
    ///
    /// This is a fire-and-forget operation. If a client's channel is full or closed,
    /// the send will fail silently and that client will be removed from the registry.
    pub fn broadcast(&self, event: WorkflowRunEvent) {
        let mut connections = self.connections.lock().unwrap();

        // Collect IDs of connections that failed to send
        let mut failed_ids = Vec::new();

        for (id, tx) in connections.iter() {
            if tx.send(event.clone()).is_err() {
                failed_ids.push(*id);
            }
        }

        // Remove failed connections
        for id in failed_ids {
            connections.remove(&id);
        }
    }

    /// Get the number of active connections
    pub fn connection_count(&self) -> usize {
        let connections = self.connections.lock().unwrap();
        connections.len()
    }
}

impl Default for EventBroadcaster {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subscribe_unsubscribe() {
        let broadcaster = EventBroadcaster::new();

        let (id1, _rx1) = broadcaster.subscribe();
        let (id2, _rx2) = broadcaster.subscribe();

        assert_eq!(broadcaster.connection_count(), 2);
        assert_ne!(id1, id2);

        broadcaster.unsubscribe(id1);
        assert_eq!(broadcaster.connection_count(), 1);

        broadcaster.unsubscribe(id2);
        assert_eq!(broadcaster.connection_count(), 0);
    }

    #[tokio::test]
    async fn test_broadcast_to_single_client() {
        let broadcaster = EventBroadcaster::new();
        let (_id, mut rx) = broadcaster.subscribe();

        let event = WorkflowRunEvent {
            event_type: "workflow-run-event".to_string(),
            run_id: "run-1".to_string(),
            project_id: "project-1".to_string(),
            workflow_id: "workflow-1".to_string(),
            status: "running".to_string(),
            timestamp: 1234567890,
        };

        broadcaster.broadcast(event.clone());

        let received = rx.recv().await.unwrap();
        assert_eq!(received.run_id, "run-1");
        assert_eq!(received.status, "running");
    }

    #[tokio::test]
    async fn test_broadcast_to_multiple_clients() {
        let broadcaster = EventBroadcaster::new();
        let (_id1, mut rx1) = broadcaster.subscribe();
        let (_id2, mut rx2) = broadcaster.subscribe();
        let (_id3, mut rx3) = broadcaster.subscribe();

        let event = WorkflowRunEvent {
            event_type: "workflow-run-event".to_string(),
            run_id: "run-1".to_string(),
            project_id: "project-1".to_string(),
            workflow_id: "workflow-1".to_string(),
            status: "completed".to_string(),
            timestamp: 1234567890,
        };

        broadcaster.broadcast(event.clone());

        let received1 = rx1.recv().await.unwrap();
        let received2 = rx2.recv().await.unwrap();
        let received3 = rx3.recv().await.unwrap();

        assert_eq!(received1.run_id, "run-1");
        assert_eq!(received2.run_id, "run-1");
        assert_eq!(received3.run_id, "run-1");
    }

    #[tokio::test]
    async fn test_broadcast_removes_closed_connections() {
        let broadcaster = EventBroadcaster::new();
        let (_id1, rx1) = broadcaster.subscribe();
        let (_id2, mut rx2) = broadcaster.subscribe();

        assert_eq!(broadcaster.connection_count(), 2);

        // Drop rx1 to close the channel
        drop(rx1);

        let event = WorkflowRunEvent {
            event_type: "workflow-run-event".to_string(),
            run_id: "run-1".to_string(),
            project_id: "project-1".to_string(),
            workflow_id: "workflow-1".to_string(),
            status: "failed".to_string(),
            timestamp: 1234567890,
        };

        broadcaster.broadcast(event.clone());

        // Connection 1 should be removed automatically
        assert_eq!(broadcaster.connection_count(), 1);

        // Connection 2 should still receive the event
        let received = rx2.recv().await.unwrap();
        assert_eq!(received.run_id, "run-1");
    }

    #[tokio::test]
    async fn test_multiple_broadcasts() {
        let broadcaster = EventBroadcaster::new();
        let (_id, mut rx) = broadcaster.subscribe();

        for i in 1..=5 {
            let event = WorkflowRunEvent {
                event_type: "workflow-run-event".to_string(),
                run_id: format!("run-{}", i),
                project_id: "project-1".to_string(),
                workflow_id: "workflow-1".to_string(),
                status: "running".to_string(),
                timestamp: 1234567890 + i,
            };
            broadcaster.broadcast(event);
        }

        for i in 1..=5 {
            let received = rx.recv().await.unwrap();
            assert_eq!(received.run_id, format!("run-{}", i));
        }
    }

    #[test]
    fn test_connection_id_uniqueness() {
        let broadcaster = EventBroadcaster::new();

        let mut ids = Vec::new();
        for _ in 0..100 {
            let (id, _rx) = broadcaster.subscribe();
            ids.push(id);
        }

        // Check all IDs are unique
        let mut sorted_ids = ids.clone();
        sorted_ids.sort();
        sorted_ids.dedup();
        assert_eq!(sorted_ids.len(), ids.len());
    }
}
