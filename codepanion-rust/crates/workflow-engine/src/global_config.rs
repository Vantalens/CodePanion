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
            version: 1,
        }
    }
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
}
