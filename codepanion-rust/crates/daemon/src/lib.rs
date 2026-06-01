pub mod routes;

use axum::{
    Router,
    http::{Method, header},
    routing::{delete, get, post, put},
};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use codepanion_workflow_engine::ProjectRegistry;

pub struct DaemonConfig {
    pub bind: String,
    pub port: u16,
    pub projects_path: PathBuf,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            bind: "127.0.0.1".to_string(),
            port: 8318,
            projects_path: dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".codepanion")
                .join("projects.json"),
        }
    }
}

pub async fn run_daemon(config: DaemonConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize ProjectRegistry
    let registry = Arc::new(ProjectRegistry::new(config.projects_path));

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
        .route("/api/v1/projects", post(routes::projects::create_project))
        .route("/api/v1/projects", get(routes::projects::list_projects))
        .route("/api/v1/projects/:id", get(routes::projects::get_project))
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
        .layer(cors)
        .with_state(registry);

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
