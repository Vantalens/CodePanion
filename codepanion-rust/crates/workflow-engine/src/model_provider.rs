use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::{CodePanionError, Result};

/// Current timestamp in milliseconds
fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Model provider type
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    OpenAI,
    Anthropic,
    DeepSeek,
    OpenRouter,
    Ollama,
    #[serde(rename = "azure-openai")]
    AzureOpenAI,
    Gemini,
    Qwen,
    GLM,
    Custom,
}

/// Provider status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderStatus {
    Active,
    Inactive,
    Error,
}

/// Provider capabilities
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderCapability {
    Chat,
    Streaming,
    FunctionCalling,
    Vision,
    Embedding,
}

/// Model pricing information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
    pub input: f64,
    pub output: f64,
    pub currency: String,
    pub per: u64,
}

/// Model information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub context_window: u64,
    pub max_output_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pricing: Option<ModelPricing>,
}

/// Provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub api_key: String,
    pub base_url: String,
    pub default_model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub custom: HashMap<String, serde_json::Value>,
}

/// Model provider
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProvider {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: ProviderType,
    pub config: ProviderConfig,
    #[serde(default)]
    pub models: Vec<ModelInfo>,
    #[serde(default)]
    pub capabilities: Vec<ProviderCapability>,
    pub status: ProviderStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_tested: Option<u64>,
    pub created_at: u64,
}

/// Provider registry file format
#[derive(Debug, Serialize, Deserialize)]
struct ProviderRegistryFile {
    version: u32,
    providers: HashMap<String, ModelProvider>,
}

/// Provider registry that manages multiple model providers
pub struct ProviderRegistry {
    path: PathBuf,
}

impl ProviderRegistry {
    /// Create a new provider registry
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// List all providers
    pub fn list(&self) -> Result<Vec<ModelProvider>> {
        if !self.path.exists() {
            return Ok(vec![]);
        }

        let content = std::fs::read_to_string(&self.path).map_err(|err| {
            CodePanionError::Runtime(format!("failed to read provider registry: {}", err))
        })?;

        let registry: ProviderRegistryFile = serde_json::from_str(&content).map_err(|err| {
            CodePanionError::InvalidInput(format!("failed to parse provider registry: {}", err))
        })?;

        let mut providers: Vec<ModelProvider> = registry.providers.into_values().collect();
        // Sort by created_at descending (most recent first)
        providers.sort_by_key(|p| std::cmp::Reverse(p.created_at));

        Ok(providers)
    }

    /// Get a provider by ID
    pub fn get(&self, id: &str) -> Result<Option<ModelProvider>> {
        let providers = self.list()?;
        Ok(providers.into_iter().find(|p| p.id == id))
    }

    /// Add or update a provider
    pub fn upsert(&self, provider: ModelProvider) -> Result<()> {
        let mut registry = self.read_or_default()?;
        registry.providers.insert(provider.id.clone(), provider);
        self.write(&registry)
    }

    /// Remove a provider by ID
    pub fn remove(&self, id: &str) -> Result<bool> {
        let mut registry = self.read_or_default()?;
        let removed = registry.providers.remove(id).is_some();
        if removed {
            self.write(&registry)?;
        }
        Ok(removed)
    }

    /// Update last tested time for a provider
    pub fn touch(&self, id: &str) -> Result<()> {
        let mut registry = self.read_or_default()?;
        if let Some(provider) = registry.providers.get_mut(id) {
            provider.last_tested = Some(current_timestamp());
            self.write(&registry)?;
        }
        Ok(())
    }

    /// Search providers by name or type
    pub fn search(&self, query: &str) -> Result<Vec<ModelProvider>> {
        let providers = self.list()?;
        let query_lower = query.to_lowercase();

        let filtered: Vec<ModelProvider> = providers
            .into_iter()
            .filter(|p| {
                p.name.to_lowercase().contains(&query_lower)
                    || format!("{:?}", p.provider_type)
                        .to_lowercase()
                        .contains(&query_lower)
            })
            .collect();

        Ok(filtered)
    }

    /// Generate a unique ID from provider name
    pub fn generate_id(name: &str) -> String {
        let sanitized = name
            .to_lowercase()
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>();

        let timestamp = current_timestamp();
        format!("{}-{}", sanitized, timestamp)
    }

    // Private helpers

    fn read_or_default(&self) -> Result<ProviderRegistryFile> {
        if !self.path.exists() {
            return Ok(ProviderRegistryFile {
                version: 1,
                providers: HashMap::new(),
            });
        }

        let content = std::fs::read_to_string(&self.path).map_err(|err| {
            CodePanionError::Runtime(format!("failed to read provider registry: {}", err))
        })?;

        serde_json::from_str(&content).map_err(|err| {
            CodePanionError::InvalidInput(format!("failed to parse provider registry: {}", err))
        })
    }

    fn write(&self, registry: &ProviderRegistryFile) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                CodePanionError::Runtime(format!("failed to create registry directory: {}", err))
            })?;
        }

        // Write to temp file first
        let tmp_path = self.path.with_extension("tmp");
        let content = serde_json::to_string_pretty(registry).map_err(|err| {
            CodePanionError::Runtime(format!("failed to serialize provider registry: {}", err))
        })?;

        std::fs::write(&tmp_path, content).map_err(|err| {
            CodePanionError::Runtime(format!("failed to write provider registry: {}", err))
        })?;

        // Atomic rename
        std::fs::rename(&tmp_path, &self.path).map_err(|err| {
            CodePanionError::Runtime(format!("failed to rename provider registry: {}", err))
        })?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_registry() -> (TempDir, ProviderRegistry) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("providers.json");
        let registry = ProviderRegistry::new(path);
        (dir, registry)
    }

    fn create_test_provider(id: &str, name: &str, provider_type: ProviderType) -> ModelProvider {
        ModelProvider {
            id: id.to_string(),
            name: name.to_string(),
            provider_type,
            config: ProviderConfig {
                api_key: "sk-test".to_string(),
                base_url: "https://api.example.com".to_string(),
                default_model: "test-model".to_string(),
                max_tokens: Some(4096),
                temperature: Some(0.7),
                custom: HashMap::new(),
            },
            models: vec![],
            capabilities: vec![ProviderCapability::Chat, ProviderCapability::Streaming],
            status: ProviderStatus::Active,
            last_tested: None,
            created_at: 1000,
        }
    }

    #[test]
    fn test_list_empty() {
        let (_dir, registry) = temp_registry();
        let providers = registry.list().unwrap();
        assert_eq!(providers.len(), 0);
    }

    #[test]
    fn test_upsert_and_get() {
        let (_dir, registry) = temp_registry();
        let provider = create_test_provider("test-1", "Test Provider", ProviderType::OpenAI);

        registry.upsert(provider.clone()).unwrap();

        let retrieved = registry.get("test-1").unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().name, "Test Provider");
    }

    #[test]
    fn test_list_sorted_by_created_at() {
        let (_dir, registry) = temp_registry();

        let mut provider1 = create_test_provider("test-1", "Provider 1", ProviderType::OpenAI);
        provider1.created_at = 1000;
        registry.upsert(provider1).unwrap();

        let mut provider2 = create_test_provider("test-2", "Provider 2", ProviderType::Anthropic);
        provider2.created_at = 2000;
        registry.upsert(provider2).unwrap();

        let providers = registry.list().unwrap();
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].id, "test-2"); // Most recent first
        assert_eq!(providers[1].id, "test-1");
    }

    #[test]
    fn test_remove() {
        let (_dir, registry) = temp_registry();
        let provider = create_test_provider("test-1", "Test Provider", ProviderType::OpenAI);

        registry.upsert(provider).unwrap();
        assert_eq!(registry.list().unwrap().len(), 1);

        let removed = registry.remove("test-1").unwrap();
        assert!(removed);
        assert_eq!(registry.list().unwrap().len(), 0);

        let removed_again = registry.remove("test-1").unwrap();
        assert!(!removed_again);
    }

    #[test]
    fn test_touch_updates_last_tested() {
        let (_dir, registry) = temp_registry();
        let provider = create_test_provider("test-1", "Test Provider", ProviderType::OpenAI);

        registry.upsert(provider).unwrap();

        let before = registry.get("test-1").unwrap().unwrap();
        assert!(before.last_tested.is_none());

        registry.touch("test-1").unwrap();

        let after = registry.get("test-1").unwrap().unwrap();
        assert!(after.last_tested.is_some());
        assert!(after.last_tested.unwrap() > 0);
    }

    #[test]
    fn test_search_by_name() {
        let (_dir, registry) = temp_registry();

        registry
            .upsert(create_test_provider(
                "test-1",
                "OpenAI Provider",
                ProviderType::OpenAI,
            ))
            .unwrap();
        registry
            .upsert(create_test_provider(
                "test-2",
                "Claude Provider",
                ProviderType::Anthropic,
            ))
            .unwrap();

        let results = registry.search("openai").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "OpenAI Provider");
    }

    #[test]
    fn test_search_by_type() {
        let (_dir, registry) = temp_registry();

        registry
            .upsert(create_test_provider(
                "test-1",
                "Provider 1",
                ProviderType::OpenAI,
            ))
            .unwrap();
        registry
            .upsert(create_test_provider(
                "test-2",
                "Provider 2",
                ProviderType::Anthropic,
            ))
            .unwrap();

        let results = registry.search("anthropic").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Provider 2");
    }

    #[test]
    fn test_upsert_updates_existing() {
        let (_dir, registry) = temp_registry();
        let provider = create_test_provider("test-1", "Original Name", ProviderType::OpenAI);

        registry.upsert(provider).unwrap();

        let mut updated = registry.get("test-1").unwrap().unwrap();
        updated.name = "Updated Name".to_string();
        registry.upsert(updated).unwrap();

        let retrieved = registry.get("test-1").unwrap().unwrap();
        assert_eq!(retrieved.name, "Updated Name");
        assert_eq!(registry.list().unwrap().len(), 1);
    }

    #[test]
    fn test_generate_id() {
        let id1 = ProviderRegistry::generate_id("My Provider");
        assert!(id1.starts_with("my-provider-"));

        // Sleep to ensure different timestamps
        std::thread::sleep(std::time::Duration::from_millis(2));

        let id2 = ProviderRegistry::generate_id("My Provider");
        assert_ne!(id1, id2); // Different timestamps

        let id3 = ProviderRegistry::generate_id("Test@Provider#123");
        assert!(id3.starts_with("test-provider-123-"));
    }
}
