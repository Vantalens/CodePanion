pub mod daemon_manager;
pub mod routes;
pub mod websocket;
pub mod workflow_runner;

use axum::{
    Router,
    http::{Method, header},
    routing::{delete, get, post, put},
};
use codepanion_workflow_engine::{
    CrossProjectOrchestrator, GlobalConfigManager, ProjectRegistry, ProviderRegistry, RunScheduler,
    SchedulerConfig,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use websocket::EventBroadcaster;

pub struct DaemonConfig {
    pub bind: String,
    pub port: u16,
    pub projects_path: PathBuf,
    pub providers_path: PathBuf,
    pub global_config_path: PathBuf,
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
            global_config_path: codepanion_dir.join("config.json"),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub project_registry: Arc<ProjectRegistry>,
    pub provider_registry: Arc<ProviderRegistry>,
    pub global_config: Arc<GlobalConfigManager>,
    pub scheduler: Arc<RunScheduler>,
    pub orchestrator: Arc<std::sync::Mutex<CrossProjectOrchestrator>>,
    pub event_broadcaster: Arc<EventBroadcaster>,
    pub workflow_runner: Arc<tokio::sync::Mutex<workflow_runner::WorkflowRunner>>,
}

pub async fn run_daemon(config: DaemonConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize event broadcaster
    let event_broadcaster = Arc::new(EventBroadcaster::new());

    // Initialize scheduler with event callback
    let mut scheduler = RunScheduler::new(SchedulerConfig::default());
    let broadcaster_clone = event_broadcaster.clone();
    scheduler.set_event_callback(Arc::new(move |event| {
        broadcaster_clone.broadcast(event);
    }));

    // Initialize registries
    let project_registry = Arc::new(ProjectRegistry::new(config.projects_path));
    let provider_registry = Arc::new(ProviderRegistry::new(config.providers_path));
    let global_config = Arc::new(GlobalConfigManager::new(config.global_config_path));
    let workflow_runner = Arc::new(tokio::sync::Mutex::new(
        workflow_runner::WorkflowRunner::new(provider_registry.clone(), global_config.clone()),
    ));

    let state = AppState {
        project_registry,
        provider_registry,
        global_config,
        scheduler: Arc::new(scheduler),
        orchestrator: Arc::new(std::sync::Mutex::new(CrossProjectOrchestrator::new())),
        event_broadcaster,
        workflow_runner,
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
        // Provider API endpoints
        .route(
            "/api/v1/providers",
            post(routes::providers::create_provider),
        )
        .route("/api/v1/providers", get(routes::providers::list_providers))
        .route(
            "/api/v1/providers/active",
            get(routes::providers::get_active_provider),
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
        .route(
            "/api/v1/providers/:id/activate",
            post(routes::providers::activate_provider),
        )
        .route("/api/v1/models", get(routes::providers::list_gui_models))
        .route(
            "/api/v1/models/default",
            post(routes::providers::set_default_model),
        )
        .route(
            "/api/v1/models/role-binding",
            post(routes::providers::set_role_binding),
        )
        // Configuration import
        .route(
            "/api/v1/config/import",
            post(routes::providers::import_config),
        )
        // Scheduler API endpoints
        .route(
            "/api/v1/scheduler/enqueue",
            post(routes::scheduler::enqueue_run),
        )
        .route(
            "/api/v1/scheduler/runs",
            get(routes::scheduler::list_all_runs),
        )
        .route(
            "/api/v1/scheduler/runs/queued",
            get(routes::scheduler::list_queued_runs),
        )
        .route(
            "/api/v1/scheduler/runs/running",
            get(routes::scheduler::list_running_runs),
        )
        .route(
            "/api/v1/scheduler/runs/completed",
            get(routes::scheduler::list_completed_runs),
        )
        .route(
            "/api/v1/scheduler/runs/:run_id",
            get(routes::scheduler::get_run),
        )
        .route(
            "/api/v1/scheduler/projects/:project_id/runs",
            get(routes::scheduler::list_project_runs),
        )
        .route(
            "/api/v1/scheduler/runs/:run_id/cancel",
            post(routes::scheduler::cancel_run),
        )
        .route(
            "/api/v1/scheduler/runs/:run_id/pause",
            post(routes::scheduler::pause_run),
        )
        .route(
            "/api/v1/scheduler/runs/:run_id/resume",
            post(routes::scheduler::resume_run),
        )
        .route("/api/v1/scheduler/stats", get(routes::scheduler::get_stats))
        .route(
            "/api/v1/scheduler/completed",
            delete(routes::scheduler::clear_completed),
        )
        // Orchestrator API endpoints
        .route(
            "/api/v1/orchestrator/workflows",
            post(routes::orchestrator::register_workflow),
        )
        .route(
            "/api/v1/orchestrator/workflows",
            get(routes::orchestrator::list_workflows),
        )
        .route(
            "/api/v1/orchestrator/workflows/:project_id/:workflow_id",
            get(routes::orchestrator::get_workflow),
        )
        .route(
            "/api/v1/orchestrator/workflows/:project_id/:workflow_id",
            delete(routes::orchestrator::remove_workflow),
        )
        .route(
            "/api/v1/orchestrator/workflows/:project_id/:workflow_id/dependencies",
            get(routes::orchestrator::get_dependencies),
        )
        .route(
            "/api/v1/orchestrator/workflows/:project_id/:workflow_id/resolve",
            post(routes::orchestrator::resolve_dependencies),
        )
        .route(
            "/api/v1/orchestrator/workflows/:project_id/:workflow_id/has-dependencies",
            get(routes::orchestrator::has_dependencies),
        )
        // Global view API endpoints
        .route("/api/v1/global/runs", get(routes::global::get_global_runs))
        .route(
            "/api/v1/global/runs/queued",
            get(routes::global::get_global_queued_runs),
        )
        .route(
            "/api/v1/global/runs/running",
            get(routes::global::get_global_running_runs),
        )
        .route(
            "/api/v1/global/runs/completed",
            get(routes::global::get_global_completed_runs),
        )
        .route(
            "/api/v1/global/stats",
            get(routes::global::get_global_stats),
        )
        // Workflow API endpoints (legacy compatibility)
        .route("/workflow/board", get(routes::workflow::get_workflow_board))
        .route("/workflow/runs", get(routes::workflow::get_workflow_runs))
        .route(
            "/workflow/runs/:id",
            get(routes::workflow::get_workflow_run),
        )
        .route(
            "/workflow/runs/:id/artifacts",
            get(routes::workflow::get_run_artifacts),
        )
        .route(
            "/workflow/runs/:id/delivery",
            get(routes::workflow::get_run_delivery),
        )
        .route("/workflow/gates", get(routes::workflow::get_workflow_gates))
        .route(
            "/workflow/gates/:run_id/:step_id/resolve",
            post(routes::workflow::resolve_gate),
        )
        // Workflow execution API endpoints (D-02)
        .route(
            "/api/v1/workflows/execute",
            post(routes::workflow_execution::execute_workflow),
        )
        .route(
            "/api/v1/workflows/:run_id/cancel",
            post(routes::workflow_execution::cancel_workflow),
        )
        .route(
            "/api/v1/workflows/:run_id/pause",
            post(routes::workflow_execution::pause_workflow),
        )
        .route(
            "/api/v1/workflows/:run_id/resume",
            post(routes::workflow_execution::resume_workflow),
        )
        .route(
            "/api/v1/workflows/active",
            get(routes::workflow_execution::list_active_workflows),
        )
        // WebSocket endpoint
        .route("/ws", get(websocket::websocket_handler))
        // OpenAI-compatible endpoints
        .route("/v1/models", get(routes::providers::list_all_models))
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
    println!("  - Scheduler API: http://{}/api/v1/scheduler", addr);
    println!("  - Orchestrator API: http://{}/api/v1/orchestrator", addr);
    println!("  - Global View API: http://{}/api/v1/global", addr);
    println!("  - Workflow API: http://{}/workflow", addr);
    println!("  - Config Import: http://{}/api/v1/config/import", addr);
    println!("  - Models API: http://{}/v1/models", addr);

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
