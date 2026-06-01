use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use crate::{CodePanionError, GlobalConfig, ProviderConfig, ProviderType, Result};

/// CC Switch config format (~/.ccm_config)
#[derive(Debug, Deserialize)]
struct CcmConfig {
    #[serde(default)]
    providers: HashMap<String, CcmProvider>,
    #[serde(default)]
    active: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CcmProvider {
    #[serde(rename = "type")]
    provider_type: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    models: HashMap<String, String>,
}

/// Claude Code settings.json format
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSettings {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    available_models: Vec<String>,
    #[serde(default)]
    model_overrides: HashMap<String, String>,
    #[serde(default)]
    effort_level: Option<String>,
    #[serde(default)]
    env: HashMap<String, String>,
}

/// Import result
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub providers_imported: usize,
    pub aliases_imported: usize,
    pub env_vars_imported: usize,
    pub active_provider: Option<String>,
}

/// Import CC Switch config file
pub fn import_ccm_config(path: &Path) -> Result<(Vec<ProviderConfig>, GlobalConfig)> {
    if !path.exists() {
        return Err(CodePanionError::InvalidInput(format!(
            "CC Switch config file not found: {}",
            path.display()
        )));
    }

    let content = std::fs::read_to_string(path).map_err(|err| {
        CodePanionError::Runtime(format!("Failed to read CC Switch config: {}", err))
    })?;

    let ccm_config: CcmConfig = serde_json::from_str(&content).map_err(|err| {
        CodePanionError::InvalidInput(format!("Failed to parse CC Switch config: {}", err))
    })?;

    let mut providers = Vec::new();
    let mut global_config = GlobalConfig::default();

    // Import providers
    for (_name, provider) in ccm_config.providers {
        let _provider_type = match provider.provider_type.as_str() {
            "anthropic" => ProviderType::Anthropic,
            "openai" => ProviderType::OpenAI,
            "deepseek" => ProviderType::DeepSeek,
            "openrouter" => ProviderType::OpenRouter,
            "gemini" => ProviderType::Gemini,
            "qwen" => ProviderType::Qwen,
            "glm" => ProviderType::GLM,
            _ => ProviderType::Custom,
        };

        let config = ProviderConfig {
            api_key: provider.api_key,
            base_url: provider.base_url,
            default_model: provider
                .models
                .get("default")
                .cloned()
                .unwrap_or_else(|| "default".to_string()),
            max_tokens: None,
            temperature: None,
            custom: HashMap::new(),
        };

        providers.push(config);

        // Import model aliases
        for (alias, model_id) in provider.models {
            if alias != "default" {
                global_config
                    .model_aliases
                    .insert(alias.clone(), model_id.clone());
            }
        }
    }

    // Set active provider
    if let Some(active) = ccm_config.active {
        global_config.active_provider_id = Some(active);
    }

    Ok((providers, global_config))
}

/// Import Claude Code settings.json
pub fn import_claude_settings(path: &Path) -> Result<GlobalConfig> {
    if !path.exists() {
        return Err(CodePanionError::InvalidInput(format!(
            "Claude Code settings file not found: {}",
            path.display()
        )));
    }

    let content = std::fs::read_to_string(path).map_err(|err| {
        CodePanionError::Runtime(format!("Failed to read Claude Code settings: {}", err))
    })?;

    let settings: ClaudeSettings = serde_json::from_str(&content).map_err(|err| {
        CodePanionError::InvalidInput(format!("Failed to parse Claude Code settings: {}", err))
    })?;

    let mut global_config = GlobalConfig::default();

    // Import default model
    if let Some(model) = settings.model {
        global_config.default_model = Some(model);
    }

    // Import available models
    if !settings.available_models.is_empty() {
        global_config.available_models = settings.available_models;
    }

    // Import model overrides (aliases)
    for (alias, model_id) in settings.model_overrides {
        global_config.model_aliases.insert(alias, model_id);
    }

    // Import effort level
    if let Some(effort_level) = settings.effort_level {
        global_config.effort_level = Some(effort_level);
    }

    // Import environment variables
    global_config.env = settings.env;

    Ok(global_config)
}

/// Detect and import from standard locations
pub fn auto_import() -> Result<ImportResult> {
    let home = dirs::home_dir().ok_or_else(|| {
        CodePanionError::Runtime("Failed to determine home directory".to_string())
    })?;

    let mut result = ImportResult {
        providers_imported: 0,
        aliases_imported: 0,
        env_vars_imported: 0,
        active_provider: None,
    };

    // Try CC Switch config
    let ccm_path = home.join(".ccm_config");
    if ccm_path.exists() {
        match import_ccm_config(&ccm_path) {
            Ok((providers, config)) => {
                result.providers_imported = providers.len();
                result.aliases_imported = config.model_aliases.len();
                result.env_vars_imported = config.env.len();
                result.active_provider = config.active_provider_id;
            }
            Err(_) => {
                // Ignore errors, try next source
            }
        }
    }

    // Try Claude Code settings
    let claude_settings_path = home.join(".claude").join("settings.json");
    if claude_settings_path.exists() {
        match import_claude_settings(&claude_settings_path) {
            Ok(config) => {
                result.aliases_imported += config.model_aliases.len();
                result.env_vars_imported += config.env.len();
            }
            Err(_) => {
                // Ignore errors
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_import_ccm_config() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".ccm_config");

        let config_content = r#"{
            "providers": {
                "deepseek": {
                    "type": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "api_key": "sk-test-123",
                    "models": {
                        "default": "deepseek-chat",
                        "chat": "deepseek-chat",
                        "coder": "deepseek-coder"
                    }
                }
            },
            "active": "deepseek"
        }"#;

        std::fs::write(&path, config_content).unwrap();

        let (providers, global_config) = import_ccm_config(&path).unwrap();

        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].base_url, "https://api.deepseek.com");
        assert_eq!(providers[0].api_key, "sk-test-123");
        assert_eq!(global_config.active_provider_id, Some("deepseek".to_string()));
        assert_eq!(
            global_config.model_aliases.get("chat"),
            Some(&"deepseek-chat".to_string())
        );
    }

    #[test]
    fn test_import_claude_settings() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("settings.json");

        let settings_content = r#"{
            "model": "opus",
            "availableModels": ["opus", "sonnet", "haiku"],
            "modelOverrides": {
                "opus": "claude-opus-4-20250514",
                "sonnet": "claude-sonnet-4-20250514"
            },
            "effortLevel": "high",
            "env": {
                "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
            }
        }"#;

        std::fs::write(&path, settings_content).unwrap();

        let global_config = import_claude_settings(&path).unwrap();

        assert_eq!(global_config.default_model, Some("opus".to_string()));
        assert_eq!(global_config.available_models, vec!["opus", "sonnet", "haiku"]);
        assert_eq!(
            global_config.model_aliases.get("opus"),
            Some(&"claude-opus-4-20250514".to_string())
        );
        assert_eq!(global_config.effort_level, Some("high".to_string()));
        assert_eq!(
            global_config.env.get("ANTHROPIC_BASE_URL"),
            Some(&"https://api.anthropic.com".to_string())
        );
    }

    #[test]
    fn test_import_nonexistent_file() {
        let path = Path::new("/nonexistent/config.json");
        let result = import_ccm_config(path);
        assert!(result.is_err());
    }
}
