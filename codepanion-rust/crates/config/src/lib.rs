use codepanion_providers::ProviderDefinition;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelBackendConfig {
    pub id: String,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AppConfig {
    pub default_model: Option<String>,
    pub models: Vec<ModelBackendConfig>,
    pub providers: Vec<ProviderDefinition>,
}

impl AppConfig {
    pub fn with_default_external_providers() -> codepanion_shared::Result<Self> {
        Ok(Self {
            providers: codepanion_providers::default_external_tool_registry()?
                .list()
                .into_iter()
                .cloned()
                .collect(),
            ..Self::default()
        })
    }

    pub fn model(&self, id: &str) -> Option<&ModelBackendConfig> {
        self.models.iter().find(|model| model.id == id)
    }

    pub fn provider(&self, id: &str) -> Option<&ProviderDefinition> {
        self.providers.iter().find(|provider| provider.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codepanion_providers::{
        ProviderCapability, ProviderKind, ProviderPermissions, ProviderRuntime,
    };

    #[test]
    fn config_finds_model_and_provider() {
        let provider = ProviderDefinition::new(
            "opencode-cli",
            "OpenCode CLI",
            ProviderKind::Cli,
            vec![ProviderCapability::Command],
            ProviderPermissions::default(),
            ProviderRuntime::cli("opencode", vec!["run"]),
        )
        .unwrap();
        let config = AppConfig {
            default_model: Some("default".to_string()),
            models: vec![ModelBackendConfig {
                id: "default".to_string(),
                base_url: "http://localhost:11434/v1".to_string(),
                model: "qwen".to_string(),
                api_key: None,
            }],
            providers: vec![provider],
        };

        assert_eq!(config.model("default").unwrap().model, "qwen");
        assert_eq!(
            config.provider("opencode-cli").unwrap().display_name,
            "OpenCode CLI"
        );
    }

    #[test]
    fn config_can_load_default_external_tool_providers() {
        let config = AppConfig::with_default_external_providers().unwrap();

        assert!(config.provider("codex-cli").is_some());
        assert!(config.provider("claude-code-cli").is_some());
        assert!(config.provider("opencode-cli").is_some());
    }
}
