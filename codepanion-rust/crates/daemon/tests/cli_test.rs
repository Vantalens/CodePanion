#[path = "integration/mod.rs"]
mod integration;

use integration::test_helpers::TestDaemon;
use serde_json::json;
use std::path::Path;
use std::process::Command;

fn codepanion_bin() -> &'static str {
    env!("CARGO_BIN_EXE_codepanion")
}

async fn run_cli(api_url: &str, args: &[&str]) -> std::process::Output {
    let api_url = api_url.to_string();
    let args = args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
    tokio::task::spawn_blocking(move || {
        let mut command = Command::new(codepanion_bin());
        command.arg("--api-url").arg(api_url).args(args);
        command.output().expect("failed to run codepanion CLI")
    })
    .await
    .expect("CLI task panicked")
}

fn stdout(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).to_string()
}

fn assert_success(output: &std::process::Output) {
    assert!(
        output.status.success(),
        "expected CLI success\nstdout:\n{}\nstderr:\n{}",
        stdout(output),
        stderr(output)
    );
}

fn assert_failure(output: &std::process::Output) {
    assert!(
        !output.status.success(),
        "expected CLI failure\nstdout:\n{}\nstderr:\n{}",
        stdout(output),
        stderr(output)
    );
}

#[tokio::test]
async fn cli_status_and_workflows_use_daemon_api() {
    let daemon = TestDaemon::start().await;

    let status = run_cli(&daemon.base_url, &["status"]).await;
    assert_success(&status);
    assert!(stdout(&status).contains("API server: reachable"));

    let workflows = run_cli(&daemon.base_url, &["workflows"]).await;
    assert_success(&workflows);
    assert!(stdout(&workflows).contains("No workflows found."));
}

#[tokio::test]
async fn cli_workspace_commands_use_project_api() {
    let daemon = TestDaemon::start().await;
    let workspace = daemon.temp_dir.join("workspace-a");
    std::fs::create_dir_all(&workspace).unwrap();
    let workspace_arg = workspace.to_string_lossy().to_string();

    let add = run_cli(&daemon.base_url, &["workspace", "add", &workspace_arg]).await;
    assert_success(&add);
    assert!(stdout(&add).contains("Added workspace"));

    let list = run_cli(&daemon.base_url, &["workspace", "list"]).await;
    assert_success(&list);
    assert!(
        stdout(&list).contains(
            Path::new(&workspace_arg)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
        )
    );

    let remove = run_cli(&daemon.base_url, &["workspace", "remove", &workspace_arg]).await;
    assert_success(&remove);
    assert!(stdout(&remove).contains("Removed workspace"));
}

#[tokio::test]
async fn cli_provider_commands_use_provider_api() {
    let daemon = TestDaemon::start().await;

    let add = run_cli(
        &daemon.base_url,
        &[
            "provider",
            "add",
            "openai-test",
            "--name",
            "OpenAI Test",
            "--provider-type",
            "openai_compatible",
            "--api-key",
            "sk-test",
            "--base-url",
            "https://api.example.com/v1",
            "--default-model",
            "gpt-test",
        ],
    )
    .await;
    assert_success(&add);
    assert!(stdout(&add).contains("Added provider"));

    let list = run_cli(&daemon.base_url, &["provider", "list"]).await;
    assert_success(&list);
    assert!(stdout(&list).contains("openai-test"));

    let switch = run_cli(&daemon.base_url, &["provider", "switch", "openai-test"]).await;
    assert_success(&switch);
    assert!(stdout(&switch).contains("Activated provider"));

    let active = run_cli(&daemon.base_url, &["provider", "active"]).await;
    assert_success(&active);
    assert!(stdout(&active).contains("openai-test"));

    let test = run_cli(&daemon.base_url, &["provider", "test", "openai-test"]).await;
    assert_success(&test);
    assert!(stdout(&test).contains("is reachable"));

    let remove = run_cli(&daemon.base_url, &["provider", "remove", "openai-test"]).await;
    assert_success(&remove);
    assert!(stdout(&remove).contains("Removed provider"));
}

#[tokio::test]
async fn cli_model_and_config_commands_persist_settings() {
    let daemon = TestDaemon::start().await;
    daemon
        .post(
            "/api/v1/providers",
            json!({
                "id": "test-provider",
                "name": "Test Provider",
                "type": "openai_compatible",
                "config": {
                    "apiKey": "sk-test",
                    "baseUrl": "https://api.example.com/v1",
                    "defaultModel": "gpt-test"
                },
                "models": [
                    {"id": "gpt-test", "name": "GPT Test"}
                ]
            }),
        )
        .await
        .unwrap();

    let models = run_cli(&daemon.base_url, &["model", "list"]).await;
    assert_success(&models);
    assert!(stdout(&models).contains("gpt-test"));

    let alias = run_cli(&daemon.base_url, &["model", "alias", "fast", "gpt-test"]).await;
    assert_success(&alias);
    assert!(stdout(&alias).contains("Set alias"));

    let model = run_cli(&daemon.base_url, &["config", "set-model", "gpt-test"]).await;
    assert_success(&model);
    assert!(stdout(&model).contains("Set default model"));

    let effort = run_cli(&daemon.base_url, &["config", "set-effort", "high"]).await;
    assert_success(&effort);
    assert!(stdout(&effort).contains("Set effort level"));

    let config: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(daemon.temp_dir.join("config.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(config["modelAliases"]["fast"], "gpt-test");
    assert_eq!(config["defaultModel"], "gpt-test");
    assert_eq!(config["effortLevel"], "high");
}

#[tokio::test]
async fn cli_provider_import_reports_daemon_error_for_missing_file() {
    let daemon = TestDaemon::start().await;

    let output = run_cli(
        &daemon.base_url,
        &[
            "provider",
            "import",
            "--source",
            "claude",
            "--file",
            "Z:\\definitely\\missing\\settings.json",
        ],
    )
    .await;
    assert_failure(&output);
    assert!(stderr(&output).contains("Error:"));
}
