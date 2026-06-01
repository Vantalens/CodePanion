use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};

#[derive(Parser)]
#[command(name = "codepanion")]
#[command(about = "CodePanion CLI - AI-powered development assistant", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// API server URL
    #[arg(long, default_value = "http://127.0.0.1:8318", global = true)]
    api_url: String,
}

#[derive(Subcommand)]
enum Commands {
    /// Provider management commands
    Provider {
        #[command(subcommand)]
        command: ProviderCommands,
    },
    /// Model management commands
    Model {
        #[command(subcommand)]
        command: ModelCommands,
    },
    /// Configuration management commands
    Config {
        #[command(subcommand)]
        command: ConfigCommands,
    },
}

#[derive(Subcommand)]
enum ProviderCommands {
    /// List all providers
    List,
    /// Show active provider
    Active,
    /// Activate a provider
    Switch {
        /// Provider ID to activate
        id: String,
    },
    /// Add a new provider
    Add {
        /// Provider ID
        id: String,
        /// Provider name
        #[arg(long)]
        name: String,
        /// Provider type (openai, anthropic, deepseek, etc.)
        #[arg(long)]
        provider_type: String,
        /// API key
        #[arg(long)]
        api_key: String,
        /// Base URL
        #[arg(long)]
        base_url: String,
        /// Default model
        #[arg(long)]
        default_model: String,
    },
    /// Remove a provider
    Remove {
        /// Provider ID to remove
        id: String,
    },
    /// Test provider connectivity
    Test {
        /// Provider ID to test
        id: String,
    },
    /// Import configuration
    Import {
        /// Source: ccm, claude, or auto
        #[arg(long, default_value = "auto")]
        source: String,
        /// Custom file path
        #[arg(long)]
        file: Option<String>,
    },
}

#[derive(Subcommand)]
enum ModelCommands {
    /// List all available models
    List,
    /// Set model alias
    Alias {
        /// Alias name (e.g., "opus")
        alias: String,
        /// Model ID (e.g., "claude-opus-4-20250514")
        model_id: String,
    },
}

#[derive(Subcommand)]
enum ConfigCommands {
    /// Set default model
    SetModel {
        /// Model alias or ID
        model: String,
    },
    /// Set effort level
    SetEffort {
        /// Effort level: low, medium, high, xhigh, max
        level: String,
    },
}

// API response types
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Provider {
    id: String,
    name: String,
    #[serde(rename = "type")]
    provider_type: String,
    status: String,
}

#[derive(Debug, Deserialize)]
struct ModelListResponse {
    data: Vec<ModelObject>,
}

#[derive(Debug, Deserialize)]
struct ModelObject {
    id: String,
    owned_by: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateProviderRequest {
    id: String,
    name: String,
    #[serde(rename = "type")]
    provider_type: String,
    config: ProviderConfigRequest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfigRequest {
    api_key: String,
    base_url: String,
    default_model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportConfigRequest {
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    providers_imported: usize,
    aliases_imported: usize,
    env_vars_imported: usize,
    active_provider: Option<String>,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Provider { command } => handle_provider_command(command, &cli.api_url).await,
        Commands::Model { command } => handle_model_command(command, &cli.api_url).await,
        Commands::Config { command } => handle_config_command(command, &cli.api_url).await,
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}

async fn handle_provider_command(
    command: ProviderCommands,
    api_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    match command {
        ProviderCommands::List => {
            let url = format!("{}/api/v1/providers", api_url);
            let response: Vec<Provider> = client.get(&url).send().await?.json().await?;

            if response.is_empty() {
                println!("No providers configured.");
            } else {
                println!("{:<20} {:<30} {:<15} {:<10}", "ID", "NAME", "TYPE", "STATUS");
                println!("{}", "-".repeat(75));
                for provider in response {
                    println!(
                        "{:<20} {:<30} {:<15} {:<10}",
                        provider.id, provider.name, provider.provider_type, provider.status
                    );
                }
            }
        }
        ProviderCommands::Active => {
            let url = format!("{}/api/v1/providers/active", api_url);
            match client.get(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    let provider: Provider = response.json().await?;
                    println!("Active provider: {} ({})", provider.name, provider.id);
                    println!("Type: {}", provider.provider_type);
                    println!("Status: {}", provider.status);
                }
                Ok(response) => {
                    let status = response.status();
                    let text = response.text().await?;
                    if status == 404 {
                        println!("No active provider set.");
                    } else {
                        eprintln!("Error: {} - {}", status, text);
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
        ProviderCommands::Switch { id } => {
            let url = format!("{}/api/v1/providers/{}/activate", api_url, id);
            let response: Provider = client.post(&url).send().await?.json().await?;
            println!("✓ Activated provider: {} ({})", response.name, response.id);
        }
        ProviderCommands::Add {
            id,
            name,
            provider_type,
            api_key,
            base_url,
            default_model,
        } => {
            let url = format!("{}/api/v1/providers", api_url);
            let req = CreateProviderRequest {
                id: id.clone(),
                name: name.clone(),
                provider_type,
                config: ProviderConfigRequest {
                    api_key,
                    base_url,
                    default_model,
                },
            };
            let _response: Provider = client.post(&url).json(&req).send().await?.json().await?;
            println!("✓ Added provider: {} ({})", name, id);
        }
        ProviderCommands::Remove { id } => {
            let url = format!("{}/api/v1/providers/{}", api_url, id);
            client.delete(&url).send().await?;
            println!("✓ Removed provider: {}", id);
        }
        ProviderCommands::Test { id } => {
            let url = format!("{}/api/v1/providers/{}/test", api_url, id);
            match client.post(&url).send().await {
                Ok(response) if response.status().is_success() => {
                    println!("✓ Provider {} is reachable", id);
                }
                Ok(response) => {
                    let status = response.status();
                    let text = response.text().await?;
                    eprintln!("✗ Provider test failed: {} - {}", status, text);
                }
                Err(e) => {
                    eprintln!("✗ Provider test failed: {}", e);
                }
            }
        }
        ProviderCommands::Import { source, file } => {
            let url = format!("{}/api/v1/config/import", api_url);
            let req = ImportConfigRequest {
                source,
                file_path: file,
            };
            let result: ImportResult = client.post(&url).json(&req).send().await?.json().await?;
            println!("✓ Import completed:");
            println!("  Providers imported: {}", result.providers_imported);
            println!("  Aliases imported: {}", result.aliases_imported);
            println!("  Env vars imported: {}", result.env_vars_imported);
            if let Some(active) = result.active_provider {
                println!("  Active provider: {}", active);
            }
        }
    }

    Ok(())
}

async fn handle_model_command(
    command: ModelCommands,
    api_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    match command {
        ModelCommands::List => {
            let url = format!("{}/v1/models", api_url);
            let response: ModelListResponse = client.get(&url).send().await?.json().await?;

            if response.data.is_empty() {
                println!("No models available.");
            } else {
                println!("{:<40} {:<30}", "MODEL ID", "PROVIDER");
                println!("{}", "-".repeat(70));
                for model in response.data {
                    println!("{:<40} {:<30}", model.id, model.owned_by);
                }
            }
        }
        ModelCommands::Alias { alias, model_id } => {
            println!("✓ Would set alias '{}' -> '{}'", alias, model_id);
            println!("Note: Alias management API endpoint not yet implemented.");
            println!("You can manually edit ~/.codepanion/config.json to add aliases.");
        }
    }

    Ok(())
}

async fn handle_config_command(
    command: ConfigCommands,
    _api_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    match command {
        ConfigCommands::SetModel { model } => {
            println!("✓ Would set default model to '{}'", model);
            println!("Note: Config management API endpoint not yet implemented.");
            println!("You can manually edit ~/.codepanion/config.json to set defaultModel.");
        }
        ConfigCommands::SetEffort { level } => {
            println!("✓ Would set effort level to '{}'", level);
            println!("Note: Config management API endpoint not yet implemented.");
            println!("You can manually edit ~/.codepanion/config.json to set effortLevel.");
        }
    }

    Ok(())
}
