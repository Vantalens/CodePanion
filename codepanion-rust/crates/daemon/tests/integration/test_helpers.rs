// Integration test helpers for CodePanion Rust daemon
use codepanion_daemon::{DaemonConfig, run_daemon};
use reqwest::{Client, Response};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::sleep;

/// Test daemon instance
pub struct TestDaemon {
    pub base_url: String,
    pub client: Client,
    pub temp_dir: PathBuf,
    handle: Option<tokio::task::JoinHandle<()>>,
}

impl TestDaemon {
    /// Start a test daemon instance
    pub async fn start() -> Self {
        let port = Self::find_free_port();
        let temp_dir = tempfile::tempdir().unwrap().keep();

        let projects_path = temp_dir.join("projects.json");
        let providers_path = temp_dir.join("providers.json");
        let global_config_path = temp_dir.join("config.json");
        let workflow_history_path = temp_dir.join("workflow-runs.ndjson");
        let workflow_artifacts_path = temp_dir.join("workflow-artifacts.ndjson");

        let config = DaemonConfig {
            bind: "127.0.0.1".to_string(),
            port,
            projects_path,
            providers_path,
            global_config_path,
            workflow_history_path,
            workflow_artifacts_path,
        };

        let handle = tokio::spawn(async move {
            let _ = run_daemon(config).await;
        });

        // Wait for daemon to start
        let base_url = format!("http://127.0.0.1:{}", port);
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();

        for _ in 0..20 {
            if client
                .get(format!("{}/health", base_url))
                .send()
                .await
                .is_ok()
            {
                break;
            }
            sleep(Duration::from_millis(100)).await;
        }

        Self {
            base_url,
            client,
            temp_dir,
            handle: Some(handle),
        }
    }

    /// Find a free port
    fn find_free_port() -> u16 {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    }

    /// GET request
    #[allow(dead_code)]
    pub async fn get(&self, path: &str) -> reqwest::Result<Response> {
        self.client
            .get(format!("{}{}", self.base_url, path))
            .send()
            .await
    }

    /// POST request with JSON body
    #[allow(dead_code)]
    pub async fn post(&self, path: &str, body: Value) -> reqwest::Result<Response> {
        self.client
            .post(format!("{}{}", self.base_url, path))
            .json(&body)
            .send()
            .await
    }

    /// PUT request with JSON body
    #[allow(dead_code)]
    pub async fn put(&self, path: &str, body: Value) -> reqwest::Result<Response> {
        self.client
            .put(format!("{}{}", self.base_url, path))
            .json(&body)
            .send()
            .await
    }

    /// DELETE request
    #[allow(dead_code)]
    pub async fn delete(&self, path: &str) -> reqwest::Result<Response> {
        self.client
            .delete(format!("{}{}", self.base_url, path))
            .send()
            .await
    }

    /// Health check
    #[allow(dead_code)]
    pub async fn health(&self) -> bool {
        self.get("/health")
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

impl Drop for TestDaemon {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
        let _ = std::fs::remove_dir_all(&self.temp_dir);
    }
}

/// Assert HTTP status code
#[macro_export]
macro_rules! assert_status {
    ($response:expr, $expected:expr) => {
        assert_eq!(
            $response.status().as_u16(),
            $expected,
            "Expected status {}, got {}",
            $expected,
            $response.status().as_u16()
        );
    };
}

/// Assert response contains JSON field
#[macro_export]
macro_rules! assert_json_field {
    ($json:expr, $field:expr) => {
        assert!(
            $json.get($field).is_some(),
            "Expected field '{}' in JSON response",
            $field
        );
    };
}

/// Assert response JSON field equals value
#[macro_export]
macro_rules! assert_json_eq {
    ($json:expr, $field:expr, $expected:expr) => {
        assert_eq!(
            $json.get($field).and_then(|v| v.as_str()),
            Some($expected),
            "Expected field '{}' to be '{}', got {:?}",
            $field,
            $expected,
            $json.get($field)
        );
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_daemon_starts() {
        let daemon = TestDaemon::start().await;
        assert!(daemon.health().await);
    }
}
