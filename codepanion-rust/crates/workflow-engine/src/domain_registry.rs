use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Domain-specific registries for agent behavior.
/// All domain logic is injected as data, not hardcoded in the agent loop.
/// Enables multi-agent scenarios with isolated state.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DomainRegistry {
    /// Extractors parse tool results into structured state
    pub extractors: HashMap<String, ExtractorConfig>,

    /// Reflectors generate strategic insights after tool execution
    pub reflectors: HashMap<String, ReflectorConfig>,

    /// Chains define multi-step reasoning paths
    pub chains: HashMap<String, Vec<ChainStep>>,

    /// Plan templates provide domain-specific task structures
    pub plan_templates: HashMap<String, Vec<PhaseTemplate>>,

    /// Error patterns guide recovery from known failures
    pub error_patterns: HashMap<String, ErrorPattern>,

    /// Tool-specific timeouts (seconds)
    pub tool_timeouts: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractorConfig {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectorConfig {
    pub name: String,
    pub prompt_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainStep {
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_hint: Option<String>,
    /// Prerequisites that must all be confirmed before this step activates
    #[serde(default)]
    pub requires_all: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseTemplate {
    pub name: String,
    pub objective: String,
    pub steps: Vec<TaskStep>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_condition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStep {
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPattern {
    pub indicators: Vec<String>,
    pub guidance: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_tool: Option<String>,
    #[serde(default)]
    pub give_up: bool,
}

impl DomainRegistry {
    /// Create a new empty registry
    pub fn new() -> Self {
        Self::default()
    }

    /// Merge another registry into this one (other takes precedence)
    pub fn merge(&mut self, other: DomainRegistry) {
        self.extractors.extend(other.extractors);
        self.reflectors.extend(other.reflectors);
        self.chains.extend(other.chains);
        self.plan_templates.extend(other.plan_templates);
        self.error_patterns.extend(other.error_patterns);
        self.tool_timeouts.extend(other.tool_timeouts);
    }

    /// Get timeout for a specific tool, or default if not configured
    pub fn get_tool_timeout(&self, tool_name: &str, default: u64) -> u64 {
        self.tool_timeouts
            .get(tool_name)
            .copied()
            .unwrap_or(default)
    }

    /// Check if an extractor exists for a tool
    pub fn has_extractor(&self, tool_name: &str) -> bool {
        self.extractors.contains_key(tool_name)
    }

    /// Check if a reflector exists for a tool
    pub fn has_reflector(&self, tool_name: &str) -> bool {
        self.reflectors.contains_key(tool_name)
    }

    /// Get error pattern for a tool
    pub fn get_error_pattern(&self, tool_name: &str) -> Option<&ErrorPattern> {
        self.error_patterns.get(tool_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_registry() {
        let registry = DomainRegistry::default();
        assert!(registry.extractors.is_empty());
        assert!(registry.reflectors.is_empty());
        assert!(registry.chains.is_empty());
    }

    #[test]
    fn test_merge_registries() {
        let mut reg1 = DomainRegistry::new();
        reg1.tool_timeouts.insert("tool1".to_string(), 30);

        let mut reg2 = DomainRegistry::new();
        reg2.tool_timeouts.insert("tool2".to_string(), 60);
        reg2.tool_timeouts.insert("tool1".to_string(), 45); // Override

        reg1.merge(reg2);

        assert_eq!(reg1.tool_timeouts.get("tool1"), Some(&45)); // reg2 wins
        assert_eq!(reg1.tool_timeouts.get("tool2"), Some(&60));
    }

    #[test]
    fn test_get_tool_timeout() {
        let mut registry = DomainRegistry::new();
        registry.tool_timeouts.insert("slow_tool".to_string(), 120);

        assert_eq!(registry.get_tool_timeout("slow_tool", 30), 120);
        assert_eq!(registry.get_tool_timeout("unknown_tool", 30), 30);
    }

    #[test]
    fn test_has_extractor() {
        let mut registry = DomainRegistry::new();
        registry.extractors.insert(
            "nmap".to_string(),
            ExtractorConfig {
                name: "nmap".to_string(),
                pattern: None,
                fields: vec!["ports".to_string()],
            },
        );

        assert!(registry.has_extractor("nmap"));
        assert!(!registry.has_extractor("curl"));
    }

    #[test]
    fn test_serialization() {
        let mut registry = DomainRegistry::new();
        registry.tool_timeouts.insert("tool1".to_string(), 60);
        registry.error_patterns.insert(
            "tool1".to_string(),
            ErrorPattern {
                indicators: vec!["timeout".to_string()],
                guidance: "Retry with longer timeout".to_string(),
                retry_tool: Some("tool1".to_string()),
                give_up: false,
            },
        );

        let json = serde_json::to_string(&registry).unwrap();
        let deserialized: DomainRegistry = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.tool_timeouts.get("tool1"), Some(&60));
        assert!(deserialized.error_patterns.contains_key("tool1"));
    }
}
