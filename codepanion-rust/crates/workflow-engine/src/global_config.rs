use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::{CodePanionError, Result};

/// Global configuration for CodePanion
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalConfig {
    /// Currently active provider ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_provider_id: Option<String>,

    /// Model aliases (e.g., "opus" -> "claude-opus-4-20250514")
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub model_aliases: HashMap<String, String>,

    /// Default model alias or ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,

    /// Environment variable overrides (CC Switch compatibility)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub env: HashMap<String, String>,

    /// Available models restriction (CC Switch availableModels)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub available_models: Vec<String>,

    /// Effort level (CC Switch effortLevel)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<String>,

    /// Configuration version
    #[serde(default = "default_version")]
    pub version: u32,
}

fn default_version() -> u32 {
    1
}

impl Default for GlobalConfig {
    fn default() -> Self {
        let mut model_aliases = HashMap::new();

        // Default Claude aliases
        model_aliases.insert("opus".to_string(), "claude-opus-4-20250514".to_string());
        model_aliases.insert("sonnet".to_string(), "claude-sonnet-4-20250514".to_string());
        model_aliases.insert("haiku".to_string(), "claude-haiku-4-20250301".to_string());

        Self {
            active_provider_id: None,
            model_aliases,
            default_model: Some("opus".to_string()),
            env: HashMap::new(),
            available_models: Vec::new(),
            effort_level: None,
            version: 1,
        }
    }
}

/// Resolved configuration with environment variable overrides applied
#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub active_provider_id: Option<String>,
    pub model_aliases: HashMap<String, String>,
    pub default_model: Option<String>,
    pub available_models: Vec<String>,
    pub effort_level: Option<String>,
}

/// Global configuration manager
pub struct GlobalConfigManager {
    path: PathBuf,
}

impl GlobalConfigManager {
    /// Create a new global config manager
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Load global configuration
    pub fn load(&self) -> Result<GlobalConfig> {
        if !self.path.exists() {
            return Ok(GlobalConfig::default());
        }

        let content = std::fs::read_to_string(&self.path).map_err(|err| {
            CodePanionError::Runtime(format!("failed to read global config: {}", err))
        })?;

        serde_json::from_str(&content).map_err(|err| {
            CodePanionError::InvalidInput(format!("failed to parse global config: {}", err))
        })
    }

    /// Save global configuration
    pub fn save(&self, config: &GlobalConfig) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                CodePanionError::Runtime(format!("failed to create config directory: {}", err))
            })?;
        }

        // Write to temp file first
        let tmp_path = self.path.with_extension("tmp");
        let content = serde_json::to_string_pretty(config).map_err(|err| {
            CodePanionError::Runtime(format!("failed to serialize global config: {}", err))
        })?;

        std::fs::write(&tmp_path, content).map_err(|err| {
            CodePanionError::Runtime(format!("failed to write global config: {}", err))
        })?;

        // Atomic rename
        std::fs::rename(&tmp_path, &self.path).map_err(|err| {
            CodePanionError::Runtime(format!("failed to rename global config: {}", err))
        })?;

        Ok(())
    }

    /// Set active provider
    pub fn set_active_provider(&self, provider_id: &str) -> Result<()> {
        let mut config = self.load()?;
        config.active_provider_id = Some(provider_id.to_string());
        self.save(&config)
    }

    /// Get active provider ID
    pub fn get_active_provider(&self) -> Result<Option<String>> {
        let config = self.load()?;
        Ok(config.active_provider_id)
    }

    /// Resolve model alias to actual model ID
    pub fn resolve_model_alias(&self, alias: &str) -> Result<String> {
        let config = self.load()?;

        // If it's an alias, resolve it
        if let Some(model_id) = config.model_aliases.get(alias) {
            return Ok(model_id.clone());
        }

        // Otherwise, return as-is (assume it's a full model ID)
        Ok(alias.to_string())
    }

    /// Add or update model alias
    pub fn set_model_alias(&self, alias: &str, model_id: &str) -> Result<()> {
        let mut config = self.load()?;
        config.model_aliases.insert(alias.to_string(), model_id.to_string());
        self.save(&config)
    }

    /// Remove model alias
    pub fn remove_model_alias(&self, alias: &str) -> Result<bool> {
        let mut config = self.load()?;
        let removed = config.model_aliases.remove(alias).is_some();
        if removed {
            self.save(&config)?;
        }
        Ok(removed)
    }

    /// Set default model
    pub fn set_default_model(&self, model: &str) -> Result<()> {
        let mut config = self.load()?;
        config.default_model = Some(model.to_string());
        self.save(&config)
    }

    /// Get default model (resolved)
    pub fn get_default_model(&self) -> Result<Option<String>> {
        let config = self.load()?;
        if let Some(model) = config.default_model {
            Ok(Some(self.resolve_model_alias(&model)?))
        } else {
            Ok(None)
        }
    }

    /// Load configuration with environment variable overrides applied
    /// Priority: env vars > file config > defaults
    pub fn load_resolved(&self) -> Result<ResolvedConfig> {
        let mut config = self.load()?;

        // Apply environment variable overrides (CC Switch compatibility)
        // ANTHROPIC_MODEL overrides default_model
        if let Ok(model) = std::env::var("ANTHROPIC_MODEL") {
            config.default_model = Some(model);
        }

        // ANTHROPIC_DEFAULT_OPUS_MODEL overrides opus alias
        if let Ok(model) = std::env::var("ANTHROPIC_DEFAULT_OPUS_MODEL") {
            config.model_aliases.insert("opus".to_string(), model);
        }

        // ANTHROPIC_DEFAULT_SONNET_MODEL overrides sonnet alias
        if let Ok(model) = std::env::var("ANTHROPIC_DEFAULT_SONNET_MODEL") {
            config.model_aliases.insert("sonnet".to_string(), model);
        }

        // ANTHROPIC_DEFAULT_HAIKU_MODEL overrides haiku alias
        if let Ok(model) = std::env::var("ANTHROPIC_DEFAULT_HAIKU_MODEL") {
            config.model_aliases.insert("haiku".to_string(), model);
        }

        // ANTHROPIC_EFFORT_LEVEL overrides effort_level
        if let Ok(level) = std::env::var("ANTHROPIC_EFFORT_LEVEL") {
            config.effort_level = Some(level);
        }

        // Apply env overrides from config file
        for (key, value) in &config.env {
            unsafe {
                std::env::set_var(key, value);
            }
        }

        Ok(ResolvedConfig {
            active_provider_id: config.active_provider_id,
            model_aliases: config.model_aliases,
            default_model: config.default_model,
            available_models: config.available_models,
            effort_level: config.effort_level,
        })
    }

    /// Resolve model alias with environment variable overrides
    pub fn resolve_model_alias_with_env(&self) -> Result<String> {
        let resolved = self.load_resolved()?;

        // Get default model from resolved config
        let alias = resolved.default_model.as_deref().unwrap_or("opus");

        // If it's an alias, resolve it
        if let Some(model_id) = resolved.model_aliases.get(alias) {
            return Ok(model_id.clone());
        }

        // Otherwise, return as-is
        Ok(alias.to_string())
    }

    /// Get environment variable overrides for provider (CC Switch compatibility)
    pub fn get_provider_env_overrides(&self) -> Result<HashMap<String, String>> {
        let mut overrides = HashMap::new();

        // Read from environment
        if let Ok(base_url) = std::env::var("ANTHROPIC_BASE_URL") {
            overrides.insert("ANTHROPIC_BASE_URL".to_string(), base_url);
        }

        if let Ok(auth_token) = std::env::var("ANTHROPIC_AUTH_TOKEN") {
            overrides.insert("ANTHROPIC_AUTH_TOKEN".to_string(), auth_token);
        }

        if let Ok(model) = std::env::var("ANTHROPIC_MODEL") {
            overrides.insert("ANTHROPIC_MODEL".to_string(), model);
        }

        Ok(overrides)
    }

    /// Set environment variable override in config
    pub fn set_env_override(&self, key: &str, value: &str) -> Result<()> {
        let mut config = self.load()?;
        config.env.insert(key.to_string(), value.to_string());
        self.save(&config)
    }

    /// Remove environment variable override from config
    pub fn remove_env_override(&self, key: &str) -> Result<bool> {
        let mut config = self.load()?;
        let removed = config.env.remove(key).is_some();
        if removed {
            self.save(&config)?;
        }
        Ok(removed)
    }

    /// Set available models restriction
    pub fn set_available_models(&self, models: Vec<String>) -> Result<()> {
        let mut config = self.load()?;
        config.available_models = models;
        self.save(&config)
    }

    /// Set effort level
    pub fn set_effort_level(&self, level: &str) -> Result<()> {
        let mut config = self.load()?;
        config.effort_level = Some(level.to_string());
        self.save(&config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_config() -> (TempDir, GlobalConfigManager) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.json");
        let manager = GlobalConfigManager::new(path);
        (dir, manager)
    }

    #[test]
    fn test_default_config() {
        let (_dir, manager) = temp_config();
        let config = manager.load().unwrap();

        assert_eq!(config.version, 1);
        assert!(config.active_provider_id.is_none());
        assert_eq!(config.default_model, Some("opus".to_string()));
        assert_eq!(config.model_aliases.get("opus"), Some(&"claude-opus-4-20250514".to_string()));
    }

    #[test]
    fn test_set_active_provider() {
        let (_dir, manager) = temp_config();

        manager.set_active_provider("test-provider").unwrap();

        let active = manager.get_active_provider().unwrap();
        assert_eq!(active, Some("test-provider".to_string()));
    }

    #[test]
    fn test_resolve_model_alias() {
        let (_dir, manager) = temp_config();

        // Resolve built-in alias
        let resolved = manager.resolve_model_alias("opus").unwrap();
        assert_eq!(resolved, "claude-opus-4-20250514");

        // Non-alias returns as-is
        let resolved = manager.resolve_model_alias("gpt-4").unwrap();
        assert_eq!(resolved, "gpt-4");
    }

    #[test]
    fn test_set_model_alias() {
        let (_dir, manager) = temp_config();

        manager.set_model_alias("gpt4", "gpt-4-turbo").unwrap();

        let resolved = manager.resolve_model_alias("gpt4").unwrap();
        assert_eq!(resolved, "gpt-4-turbo");
    }

    #[test]
    fn test_remove_model_alias() {
        let (_dir, manager) = temp_config();

        manager.set_model_alias("test", "test-model").unwrap();

        let removed = manager.remove_model_alias("test").unwrap();
        assert!(removed);

        let resolved = manager.resolve_model_alias("test").unwrap();
        assert_eq!(resolved, "test"); // Returns as-is after removal
    }

    #[test]
    fn test_set_default_model() {
        let (_dir, manager) = temp_config();

        manager.set_default_model("sonnet").unwrap();

        let default = manager.get_default_model().unwrap();
        assert_eq!(default, Some("claude-sonnet-4-20250514".to_string()));
    }

    #[test]
    fn test_persistence() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.json");

        {
            let manager = GlobalConfigManager::new(&path);
            manager.set_active_provider("provider-1").unwrap();
            manager.set_model_alias("custom", "custom-model").unwrap();
        }

        {
            let manager = GlobalConfigManager::new(&path);
            let active = manager.get_active_provider().unwrap();
            assert_eq!(active, Some("provider-1".to_string()));

            let resolved = manager.resolve_model_alias("custom").unwrap();
            assert_eq!(resolved, "custom-model");
        }
    }

    #[test]
    fn test_env_override_model() {
        let (_dir, manager) = temp_config();

        // Set env var
        unsafe {
            std::env::set_var("ANTHROPIC_MODEL", "gpt-4");
        }

        let resolved = manager.load_resolved().unwrap();
        assert_eq!(resolved.default_model, Some("gpt-4".to_string()));

        // Clean up
        unsafe {
            std::env::remove_var("ANTHROPIC_MODEL");
        }
    }

    #[test]
    fn test_env_override_aliases() {
        let (_dir, manager) = temp_config();

        // Set env vars for aliases
        unsafe {
            std::env::set_var("ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-opus-5");
            std::env::set_var("ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-sonnet-5");
        }

        let resolved = manager.load_resolved().unwrap();
        assert_eq!(resolved.model_aliases.get("opus"), Some(&"claude-opus-5".to_string()));
        assert_eq!(resolved.model_aliases.get("sonnet"), Some(&"claude-sonnet-5".to_string()));

        // Clean up
        unsafe {
            std::env::remove_var("ANTHROPIC_DEFAULT_OPUS_MODEL");
            std::env::remove_var("ANTHROPIC_DEFAULT_SONNET_MODEL");
        }
    }

    #[test]
    fn test_env_override_effort_level() {
        let (_dir, manager) = temp_config();

        unsafe {
            std::env::set_var("ANTHROPIC_EFFORT_LEVEL", "xhigh");
        }

        let resolved = manager.load_resolved().unwrap();
        assert_eq!(resolved.effort_level, Some("xhigh".to_string()));

        unsafe {
            std::env::remove_var("ANTHROPIC_EFFORT_LEVEL");
        }
    }

    #[test]
    fn test_set_env_override() {
        let (_dir, manager) = temp_config();

        manager.set_env_override("ANTHROPIC_BASE_URL", "https://custom.api.com").unwrap();

        let config = manager.load().unwrap();
        assert_eq!(config.env.get("ANTHROPIC_BASE_URL"), Some(&"https://custom.api.com".to_string()));
    }

    #[test]
    fn test_remove_env_override() {
        let (_dir, manager) = temp_config();

        manager.set_env_override("TEST_VAR", "test-value").unwrap();
        let removed = manager.remove_env_override("TEST_VAR").unwrap();
        assert!(removed);

        let config = manager.load().unwrap();
        assert!(config.env.get("TEST_VAR").is_none());
    }

    #[test]
    fn test_set_available_models() {
        let (_dir, manager) = temp_config();

        manager.set_available_models(vec!["opus".to_string(), "sonnet".to_string()]).unwrap();

        let config = manager.load().unwrap();
        assert_eq!(config.available_models, vec!["opus", "sonnet"]);
    }

    #[test]
    fn test_set_effort_level() {
        let (_dir, manager) = temp_config();

        manager.set_effort_level("high").unwrap();

        let config = manager.load().unwrap();
        assert_eq!(config.effort_level, Some("high".to_string()));
    }

    #[test]
    fn test_get_provider_env_overrides() {
        let (_dir, manager) = temp_config();

        unsafe {
            std::env::set_var("ANTHROPIC_BASE_URL", "https://test.api.com");
            std::env::set_var("ANTHROPIC_AUTH_TOKEN", "sk-test-123");
        }

        let overrides = manager.get_provider_env_overrides().unwrap();
        assert_eq!(overrides.get("ANTHROPIC_BASE_URL"), Some(&"https://test.api.com".to_string()));
        assert_eq!(overrides.get("ANTHROPIC_AUTH_TOKEN"), Some(&"sk-test-123".to_string()));

        unsafe {
            std::env::remove_var("ANTHROPIC_BASE_URL");
            std::env::remove_var("ANTHROPIC_AUTH_TOKEN");
        }
    }
}
