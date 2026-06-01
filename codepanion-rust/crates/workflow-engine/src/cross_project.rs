use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::{CodePanionError, Result};

/// Cross-project workflow dependency
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDependency {
    /// Target project ID
    pub project_id: String,
    /// Target workflow ID
    pub workflow_id: String,
    /// Required artifacts from the dependency
    #[serde(default)]
    pub required_artifacts: Vec<String>,
    /// Whether this dependency is optional
    #[serde(default)]
    pub optional: bool,
}

/// Cross-project artifact reference
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactReference {
    /// Source project ID
    pub project_id: String,
    /// Source run ID
    pub run_id: String,
    /// Artifact key
    pub artifact_key: String,
}

impl ArtifactReference {
    /// Create a new artifact reference
    pub fn new(project_id: String, run_id: String, artifact_key: String) -> Self {
        Self {
            project_id,
            run_id,
            artifact_key,
        }
    }

    /// Get the full artifact path
    pub fn get_path(&self, base_dir: &Path) -> PathBuf {
        base_dir
            .join(&self.project_id)
            .join("runs")
            .join(&self.run_id)
            .join("artifacts")
            .join(&self.artifact_key)
    }
}

/// Workflow with dependencies
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowWithDeps {
    pub project_id: String,
    pub workflow_id: String,
    #[serde(default)]
    pub dependencies: Vec<WorkflowDependency>,
}

/// Dependency resolution result
#[derive(Debug, Clone)]
pub struct DependencyGraph {
    /// Execution order (topologically sorted)
    pub execution_order: Vec<(String, String)>, // (project_id, workflow_id)
    /// Dependency edges
    pub edges: HashMap<(String, String), Vec<(String, String)>>,
}

/// Cross-project orchestrator
pub struct CrossProjectOrchestrator {
    workflows: HashMap<(String, String), WorkflowWithDeps>,
}

impl CrossProjectOrchestrator {
    /// Create a new orchestrator
    pub fn new() -> Self {
        Self {
            workflows: HashMap::new(),
        }
    }

    /// Register a workflow with dependencies
    pub fn register_workflow(&mut self, workflow: WorkflowWithDeps) {
        let key = (workflow.project_id.clone(), workflow.workflow_id.clone());
        self.workflows.insert(key, workflow);
    }

    /// Resolve dependencies and return execution order
    pub fn resolve_dependencies(
        &self,
        project_id: &str,
        workflow_id: &str,
    ) -> Result<DependencyGraph> {
        let mut visited = HashSet::new();
        let mut stack = HashSet::new();
        let mut order = Vec::new();
        let mut edges = HashMap::new();

        self.visit(
            project_id,
            workflow_id,
            &mut visited,
            &mut stack,
            &mut order,
            &mut edges,
        )?;

        // No need to reverse - dependencies are added before the node itself

        Ok(DependencyGraph {
            execution_order: order,
            edges,
        })
    }

    fn visit(
        &self,
        project_id: &str,
        workflow_id: &str,
        visited: &mut HashSet<(String, String)>,
        stack: &mut HashSet<(String, String)>,
        order: &mut Vec<(String, String)>,
        edges: &mut HashMap<(String, String), Vec<(String, String)>>,
    ) -> Result<()> {
        let key = (project_id.to_string(), workflow_id.to_string());

        if stack.contains(&key) {
            return Err(CodePanionError::InvalidInput(format!(
                "Circular dependency detected: {}:{}",
                project_id, workflow_id
            )));
        }

        if visited.contains(&key) {
            return Ok(());
        }

        stack.insert(key.clone());

        // Get workflow dependencies
        if let Some(workflow) = self.workflows.get(&key) {
            let mut deps = Vec::new();

            for dep in &workflow.dependencies {
                let dep_key = (dep.project_id.clone(), dep.workflow_id.clone());
                deps.push(dep_key.clone());

                // Recursively visit dependencies
                self.visit(
                    &dep.project_id,
                    &dep.workflow_id,
                    visited,
                    stack,
                    order,
                    edges,
                )?;
            }

            if !deps.is_empty() {
                edges.insert(key.clone(), deps);
            }
        }

        stack.remove(&key);
        visited.insert(key.clone());
        order.push(key);

        Ok(())
    }

    /// Check if a workflow has dependencies
    pub fn has_dependencies(&self, project_id: &str, workflow_id: &str) -> bool {
        let key = (project_id.to_string(), workflow_id.to_string());
        self.workflows
            .get(&key)
            .map(|w| !w.dependencies.is_empty())
            .unwrap_or(false)
    }

    /// Get direct dependencies of a workflow
    pub fn get_dependencies(
        &self,
        project_id: &str,
        workflow_id: &str,
    ) -> Vec<WorkflowDependency> {
        let key = (project_id.to_string(), workflow_id.to_string());
        self.workflows
            .get(&key)
            .map(|w| w.dependencies.clone())
            .unwrap_or_default()
    }

    /// List all registered workflows
    pub fn list_workflows(&self) -> Vec<WorkflowWithDeps> {
        self.workflows.values().cloned().collect()
    }

    /// Remove a workflow
    pub fn remove_workflow(&mut self, project_id: &str, workflow_id: &str) {
        let key = (project_id.to_string(), workflow_id.to_string());
        self.workflows.remove(&key);
    }
}

impl Default for CrossProjectOrchestrator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_artifact_reference_path() {
        let base_dir = PathBuf::from("/home/user/.codepanion");
        let artifact_ref = ArtifactReference::new(
            "project-1".to_string(),
            "run-001".to_string(),
            "output.json".to_string(),
        );

        let path = artifact_ref.get_path(&base_dir);
        assert_eq!(
            path,
            PathBuf::from("/home/user/.codepanion/project-1/runs/run-001/artifacts/output.json")
        );
    }

    #[test]
    fn test_register_workflow() {
        let mut orchestrator = CrossProjectOrchestrator::new();

        let workflow = WorkflowWithDeps {
            project_id: "project-1".to_string(),
            workflow_id: "workflow-1".to_string(),
            dependencies: vec![],
        };

        orchestrator.register_workflow(workflow);

        assert_eq!(orchestrator.list_workflows().len(), 1);
    }

    #[test]
    fn test_simple_dependency() {
        let mut orchestrator = CrossProjectOrchestrator::new();

        // Register workflow A (no dependencies)
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "project-1".to_string(),
            workflow_id: "workflow-a".to_string(),
            dependencies: vec![],
        });

        // Register workflow B (depends on A)
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "project-1".to_string(),
            workflow_id: "workflow-b".to_string(),
            dependencies: vec![WorkflowDependency {
                project_id: "project-1".to_string(),
                workflow_id: "workflow-a".to_string(),
                required_artifacts: vec![],
                optional: false,
            }],
        });

        let graph = orchestrator
            .resolve_dependencies("project-1", "workflow-b")
            .unwrap();

        // A should be executed before B
        assert_eq!(graph.execution_order.len(), 2);
        assert_eq!(
            graph.execution_order[0],
            ("project-1".to_string(), "workflow-a".to_string())
        );
        assert_eq!(
            graph.execution_order[1],
            ("project-1".to_string(), "workflow-b".to_string())
        );
    }

    #[test]
    fn test_cross_project_dependency() {
        let mut orchestrator = CrossProjectOrchestrator::new();

        // Register workflow in project-1
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "project-1".to_string(),
            workflow_id: "build".to_string(),
            dependencies: vec![],
        });

        // Register workflow in project-2 that depends on project-1
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "project-2".to_string(),
            workflow_id: "deploy".to_string(),
            dependencies: vec![WorkflowDependency {
                project_id: "project-1".to_string(),
                workflow_id: "build".to_string(),
                required_artifacts: vec!["dist.zip".to_string()],
                optional: false,
            }],
        });

        let graph = orchestrator
            .resolve_dependencies("project-2", "deploy")
            .unwrap();

        assert_eq!(graph.execution_order.len(), 2);
        assert_eq!(
            graph.execution_order[0],
            ("project-1".to_string(), "build".to_string())
        );
        assert_eq!(
            graph.execution_order[1],
            ("project-2".to_string(), "deploy".to_string())
        );
    }

    #[test]
    fn test_circular_dependency() {
        let mut orchestrator = CrossProjectOrchestrator::new();

        // Register workflow A (depends on B)
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "project-1".to_string(),
            workflow_id: "workflow-a".to_string(),
            dependencies: vec![WorkflowDependency {
                project_id: "project-1".to_string(),
                workflow_id: "workflow-b".to_string(),
                required_artifacts: vec![],
                optional: false,
            }],
        });

        // Register workflow B (depends on A)
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "project-1".to_string(),
            workflow_id: "workflow-b".to_string(),
            dependencies: vec![WorkflowDependency {
                project_id: "project-1".to_string(),
                workflow_id: "workflow-a".to_string(),
                required_artifacts: vec![],
                optional: false,
            }],
        });

        let result = orchestrator.resolve_dependencies("project-1", "workflow-a");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Circular dependency"));
    }

    #[test]
    fn test_diamond_dependency() {
        let mut orchestrator = CrossProjectOrchestrator::new();

        // A (no deps)
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "p1".to_string(),
            workflow_id: "a".to_string(),
            dependencies: vec![],
        });

        // B depends on A
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "p1".to_string(),
            workflow_id: "b".to_string(),
            dependencies: vec![WorkflowDependency {
                project_id: "p1".to_string(),
                workflow_id: "a".to_string(),
                required_artifacts: vec![],
                optional: false,
            }],
        });

        // C depends on A
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "p1".to_string(),
            workflow_id: "c".to_string(),
            dependencies: vec![WorkflowDependency {
                project_id: "p1".to_string(),
                workflow_id: "a".to_string(),
                required_artifacts: vec![],
                optional: false,
            }],
        });

        // D depends on B and C
        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "p1".to_string(),
            workflow_id: "d".to_string(),
            dependencies: vec![
                WorkflowDependency {
                    project_id: "p1".to_string(),
                    workflow_id: "b".to_string(),
                    required_artifacts: vec![],
                    optional: false,
                },
                WorkflowDependency {
                    project_id: "p1".to_string(),
                    workflow_id: "c".to_string(),
                    required_artifacts: vec![],
                    optional: false,
                },
            ],
        });

        let graph = orchestrator.resolve_dependencies("p1", "d").unwrap();

        // A should be first, D should be last
        assert_eq!(graph.execution_order[0], ("p1".to_string(), "a".to_string()));
        assert_eq!(
            graph.execution_order[graph.execution_order.len() - 1],
            ("p1".to_string(), "d".to_string())
        );
    }

    #[test]
    fn test_has_dependencies() {
        let mut orchestrator = CrossProjectOrchestrator::new();

        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "p1".to_string(),
            workflow_id: "a".to_string(),
            dependencies: vec![],
        });

        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "p1".to_string(),
            workflow_id: "b".to_string(),
            dependencies: vec![WorkflowDependency {
                project_id: "p1".to_string(),
                workflow_id: "a".to_string(),
                required_artifacts: vec![],
                optional: false,
            }],
        });

        assert!(!orchestrator.has_dependencies("p1", "a"));
        assert!(orchestrator.has_dependencies("p1", "b"));
    }

    #[test]
    fn test_get_dependencies() {
        let mut orchestrator = CrossProjectOrchestrator::new();

        orchestrator.register_workflow(WorkflowWithDeps {
            project_id: "p1".to_string(),
            workflow_id: "b".to_string(),
            dependencies: vec![WorkflowDependency {
                project_id: "p1".to_string(),
                workflow_id: "a".to_string(),
                required_artifacts: vec!["output.json".to_string()],
                optional: false,
            }],
        });

        let deps = orchestrator.get_dependencies("p1", "b");
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].workflow_id, "a");
        assert_eq!(deps[0].required_artifacts, vec!["output.json"]);
    }
}
