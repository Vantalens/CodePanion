pub mod routes;

use axum::{
    http::{header, Method},
    routing::{delete, get, post, put},
    Router,
};
use codepanion_workflow_engine::{ProjectRegistry, ProviderRegistry};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

pub struct DaemonConfig {
    pub bind: String,
    pub port: u16,
    pub projects_path: PathBuf,
    pub providers_path: PathBuf,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        let codepanion_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".codepanion");

        Self {
            bind: "127.0.0.1".to_string(),
            port: 8318,
            projects_path: codepanion_dir.join("projects.json"),
            providers_path: codepanion_dir.join("providers.json"),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub project_registry: Arc<ProjectRegistry>,
    pub provider_registry: Arc<ProviderRegistry>,
}

pub async fn run_daemon(config: DaemonConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize registries
    let state = AppState {
        project_registry: Arc::new(ProjectRegistry::new(config.projects_path)),
        provider_registry: Arc::new(ProviderRegistry::new(config.providers_path)),
    };

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:3000".parse()?,
            "http://localhost:8318".parse()?,
            "http://127.0.0.1:3000".parse()?,
            "http://127.0.0.1:8318".parse()?,
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::HeaderName::from_static("x-request-id"),
        ]);

    // Build router
    let app = Router::new()
        // Health check (legacy endpoint)
        .route("/health", get(health_handler))
        // Project API endpoints
        .route(
            "/api/v1/projects",
            post(routes::projects::create_project),
        )
        .route("/api/v1/projects", get(routes::projects::list_projects))
        .route(
            "/api/v1/projects/:id",
            get(routes::projects::get_project),
        )
        .route(
            "/api/v1/projects/:id",
            put(routes::projects::update_project),
        )
        .route(
            "/api/v1/projects/:id",
            delete(routes::projects::delete_project),
        )
        .route(
            "/api/v1/projects/:id/activate",
            post(routes::projects::activate_project),
        )
        .route(
            "/api/v1/projects/:id/status",
            get(routes::projects::get_project_status),
        )
        // Provider API endpoints
        .route(
            "/api/v1/providers",
            post(routes::providers::create_provider),
        )
        .route(
            "/api/v1/providers",
            get(routes::providers::list_providers),
        )
        .route(
            "/api/v1/providers/:id",
            get(routes::providers::get_provider),
        )
        .route(
            "/api/v1/providers/:id",
            put(routes::providers::update_provider),
        )
        .route(
            "/api/v1/providers/:id",
            delete(routes::providers::delete_provider),
        )
        .route(
            "/api/v1/providers/:id/test",
            post(routes::providers::test_provider),
        )
        .route(
            "/api/v1/providers/:id/models",
            get(routes::providers::list_provider_models),
        )
        .layer(cors)
        .with_state(state);

    // Start server
    let addr = SocketAddr::from((
        config
            .bind
            .parse::<std::net::IpAddr>()
            .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))),
        config.port,
    ));

    println!("CodePanion API Server listening on http://{}", addr);
    println!("  - Health: http://{}/health", addr);
    println!("  - Projects API: http://{}/api/v1/projects", addr);
    println!("  - Providers API: http://{}/api/v1/providers", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_handler() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "ok": true,
        "pid": std::process::id(),
        "version": codepanion_shared::VERSION,
    }))
}
