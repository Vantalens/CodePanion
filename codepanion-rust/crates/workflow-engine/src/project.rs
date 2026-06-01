use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::{CodePanionError, Result};

/// Project metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    #[serde(default)]
    pub tags: Vec<String>,
    pub last_active_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: u64,
    #[serde(default)]
    pub metadata: ProjectMetadata,
}

/// Project metadata for runtime, model, and custom fields
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub custom: HashMap<String, serde_json::Value>,
}

/// Project health status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHealth {
    pub path_exists: bool,
    pub is_directory: bool,
    pub is_git_repo: bool,
    pub last_checked: u64,
}

/// Project statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub total_runs: u64,
    pub successful_runs: u64,
    pub failed_runs: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<u64>,
}

/// Project registry that manages multiple projects
pub struct ProjectRegistry {
    path: PathBuf,
}

impl ProjectRegistry {
    /// Create a new project registry
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// List all projects
    pub fn list(&self) -> Result<Vec<Project>> {
        if !self.path.exists() {
            return Ok(vec![]);
        }

        let content = std::fs::read_to_string(&self.path).map_err(|err| {
            CodePanionError::Runtime(format!("failed to read project registry: {}", err))
        })?;

        let registry: ProjectRegistryFile = serde_json::from_str(&content).map_err(|err| {
            CodePanionError::InvalidInput(format!("failed to parse project registry: {}", err))
        })?;

        let mut projects: Vec<Project> = registry.projects.into_values().collect();
        // Sort by last_active_at descending (most recent first)
        projects.sort_by_key(|p| std::cmp::Reverse(p.last_active_at));

        Ok(projects)
    }

    /// Get a project by ID
    pub fn get(&self, id: &str) -> Result<Option<Project>> {
        let projects = self.list()?;
        Ok(projects.into_iter().find(|p| p.id == id))
    }

    /// Add or update a project
    pub fn upsert(&self, project: Project) -> Result<()> {
        let mut registry = self.read_or_default()?;
        registry.projects.insert(project.id.clone(), project);
        self.write(&registry)
    }

    /// Remove a project by ID
    pub fn remove(&self, id: &str) -> Result<bool> {
        let mut registry = self.read_or_default()?;
        let removed = registry.projects.remove(id).is_some();
        if removed {
            self.write(&registry)?;
        }
        Ok(removed)
    }

    /// Update last active time for a project
    pub fn touch(&self, id: &str) -> Result<()> {
        let mut registry = self.read_or_default()?;
        if let Some(project) = registry.projects.get_mut(id) {
            project.last_active_at = current_timestamp();
            self.write(&registry)?;
        }
        Ok(())
    }

    /// Search projects by name, path, or tags
    pub fn search(&self, query: &str) -> Result<Vec<Project>> {
        let projects = self.list()?;
        let query_lower = query.to_lowercase();

        let filtered: Vec<Project> = projects
            .into_iter()
            .filter(|p| {
                p.name.to_lowercase().contains(&query_lower)
                    || p.path
                        .to_string_lossy()
                        .to_lowercase()
                        .contains(&query_lower)
                    || p.tags
                        .iter()
                        .any(|tag| tag.to_lowercase().contains(&query_lower))
                    || p.description
                        .as_ref()
                        .map(|d| d.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
            })
            .collect();

        Ok(filtered)
    }

    /// Validate project path exists and is a directory
    pub fn validate_path(path: &Path) -> Result<()> {
        if !path.exists() {
            return Err(CodePanionError::NotFound(format!(
                "path does not exist: {}",
                path.display()
            )));
        }

        if !path.is_dir() {
            return Err(CodePanionError::InvalidInput(format!(
                "path is not a directory: {}",
                path.display()
            )));
        }

        Ok(())
    }

    /// Generate a unique project ID from name
    pub fn generate_id(name: &str) -> String {
        let sanitized = name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>()
            .to_lowercase();

        let timestamp = current_timestamp();
        format!("{}-{}", sanitized, timestamp)
    }

    // Private helpers

    fn read_or_default(&self) -> Result<ProjectRegistryFile> {
        if !self.path.exists() {
            return Ok(ProjectRegistryFile::default());
        }

        let content = std::fs::read_to_string(&self.path).map_err(|err| {
            CodePanionError::Runtime(format!("failed to read project registry: {}", err))
        })?;

        serde_json::from_str(&content).map_err(|err| {
            CodePanionError::InvalidInput(format!("failed to parse project registry: {}", err))
        })
    }

    fn write(&self, registry: &ProjectRegistryFile) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                CodePanionError::Runtime(format!("failed to create registry directory: {}", err))
            })?;
        }

        // Write to temp file first
        let tmp_path = self.path.with_extension("tmp");
        let content = serde_json::to_string_pretty(registry).map_err(|err| {
            CodePanionError::Runtime(format!("failed to serialize project registry: {}", err))
        })?;

        std::fs::write(&tmp_path, content).map_err(|err| {
            CodePanionError::Runtime(format!("failed to write project registry: {}", err))
        })?;

        // Atomic rename
        std::fs::rename(&tmp_path, &self.path).map_err(|err| {
            CodePanionError::Runtime(format!("failed to rename project registry: {}", err))
        })?;

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProjectRegistryFile {
    version: u32,
    projects: HashMap<String, Project>,
}

impl Default for ProjectRegistryFile {
    fn default() -> Self {
        Self {
            version: 1,
            projects: HashMap::new(),
        }
    }
}

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_registry() -> (TempDir, ProjectRegistry) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("projects.json");
        let registry = ProjectRegistry::new(path);
        (dir, registry)
    }

    fn create_test_project(id: &str, name: &str) -> Project {
        Project {
            id: id.to_string(),
            name: name.to_string(),
            path: PathBuf::from("/tmp/test"),
            tags: vec![],
            last_active_at: 1000,
            description: None,
            created_at: 1000,
            metadata: ProjectMetadata::default(),
        }
    }

    #[test]
    fn test_list_empty() {
        let (_dir, registry) = temp_registry();
        let projects = registry.list().unwrap();
        assert_eq!(projects.len(), 0);
    }

    #[test]
    fn test_upsert_and_get() {
        let (_dir, registry) = temp_registry();

        let project = create_test_project("test-1", "Test Project");
        registry.upsert(project.clone()).unwrap();

        let retrieved = registry.get("test-1").unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().name, "Test Project");
    }

    #[test]
    fn test_list_sorted_by_last_active() {
        let (_dir, registry) = temp_registry();

        let mut project1 = create_test_project("test-1", "Project 1");
        project1.last_active_at = 1000;
        registry.upsert(project1).unwrap();

        let mut project2 = create_test_project("test-2", "Project 2");
        project2.last_active_at = 3000;
        registry.upsert(project2).unwrap();

        let mut project3 = create_test_project("test-3", "Project 3");
        project3.last_active_at = 2000;
        registry.upsert(project3).unwrap();

        let projects = registry.list().unwrap();
        assert_eq!(projects.len(), 3);
        assert_eq!(projects[0].id, "test-2"); // Most recent
        assert_eq!(projects[1].id, "test-3");
        assert_eq!(projects[2].id, "test-1"); // Oldest
    }

    #[test]
    fn test_remove() {
        let (_dir, registry) = temp_registry();

        let project = create_test_project("test-1", "Test Project");
        registry.upsert(project).unwrap();

        let removed = registry.remove("test-1").unwrap();
        assert!(removed);

        let retrieved = registry.get("test-1").unwrap();
        assert!(retrieved.is_none());

        // Removing again should return false
        let removed_again = registry.remove("test-1").unwrap();
        assert!(!removed_again);
    }

    #[test]
    fn test_touch_updates_last_active() {
        let (_dir, registry) = temp_registry();

        let project = create_test_project("test-1", "Test Project");
        let original_time = project.last_active_at;
        registry.upsert(project).unwrap();

        // Wait a bit to ensure timestamp changes
        std::thread::sleep(std::time::Duration::from_millis(10));

        registry.touch("test-1").unwrap();

        let updated = registry.get("test-1").unwrap().unwrap();
        assert!(updated.last_active_at > original_time);
    }

    #[test]
    fn test_search_by_name() {
        let (_dir, registry) = temp_registry();

        registry
            .upsert(create_test_project("test-1", "My Project"))
            .unwrap();
        registry
            .upsert(create_test_project("test-2", "Another Project"))
            .unwrap();
        registry
            .upsert(create_test_project("test-3", "Something Else"))
            .unwrap();

        let results = registry.search("project").unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_search_by_tag() {
        let (_dir, registry) = temp_registry();

        let mut project1 = create_test_project("test-1", "Project 1");
        project1.tags = vec!["rust".to_string(), "backend".to_string()];
        registry.upsert(project1).unwrap();

        let mut project2 = create_test_project("test-2", "Project 2");
        project2.tags = vec!["typescript".to_string(), "frontend".to_string()];
        registry.upsert(project2).unwrap();

        let results = registry.search("rust").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "test-1");
    }

    #[test]
    fn test_search_by_description() {
        let (_dir, registry) = temp_registry();

        let mut project = create_test_project("test-1", "Project");
        project.description = Some("A cool project with AI features".to_string());
        registry.upsert(project).unwrap();

        let results = registry.search("AI").unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_upsert_updates_existing() {
        let (_dir, registry) = temp_registry();

        let project = create_test_project("test-1", "Original Name");
        registry.upsert(project).unwrap();

        let mut updated = create_test_project("test-1", "Updated Name");
        updated.last_active_at = 5000;
        registry.upsert(updated).unwrap();

        let retrieved = registry.get("test-1").unwrap().unwrap();
        assert_eq!(retrieved.name, "Updated Name");
        assert_eq!(retrieved.last_active_at, 5000);

        // Should still have only one project
        let projects = registry.list().unwrap();
        assert_eq!(projects.len(), 1);
    }

    #[test]
    fn test_generate_id() {
        let id1 = ProjectRegistry::generate_id("My Project");

        // Wait to ensure different timestamp
        std::thread::sleep(std::time::Duration::from_millis(2));

        let id2 = ProjectRegistry::generate_id("My Project");

        // Should be sanitized
        assert!(id1.starts_with("myproject-"));
        assert!(id2.starts_with("myproject-"));

        // Should be unique (different timestamps)
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_validate_path() {
        let temp_dir = TempDir::new().unwrap();
        let valid_path = temp_dir.path();

        // Valid directory
        assert!(ProjectRegistry::validate_path(valid_path).is_ok());

        // Non-existent path
        let invalid_path = temp_dir.path().join("nonexistent");
        assert!(ProjectRegistry::validate_path(&invalid_path).is_err());

        // File instead of directory
        let file_path = temp_dir.path().join("file.txt");
        std::fs::write(&file_path, "test").unwrap();
        assert!(ProjectRegistry::validate_path(&file_path).is_err());
    }
}
