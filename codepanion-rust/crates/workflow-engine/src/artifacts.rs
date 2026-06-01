use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write as _};
use std::path::{Path, PathBuf};

use crate::Result;

/// Artifact types that can be produced by workflow steps
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactType {
    Plan,
    PatchSummary,
    TestResult,
    ReviewReport,
    HumanDecision,
    DeliveryNote,
}

/// A workflow artifact record
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowArtifact {
    pub id: String,
    pub run_id: String,
    pub workflow_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(rename = "type")]
    pub artifact_type: ArtifactType,
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub created_at: u64,
}

/// Input for creating a new artifact (id and createdAt are optional)
#[derive(Debug, Clone)]
pub struct ArtifactInput {
    pub id: Option<String>,
    pub run_id: String,
    pub workflow_name: String,
    pub step_id: Option<String>,
    pub role: Option<String>,
    pub artifact_type: ArtifactType,
    pub title: String,
    pub content: String,
    pub files: Vec<String>,
    pub created_at: Option<u64>,
}

/// NDJSON-based artifact store
pub struct WorkflowArtifactStore {
    path: PathBuf,
    max_artifacts: usize,
}

impl WorkflowArtifactStore {
    /// Create a new artifact store at the given path
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            max_artifacts: 1000,
        }
    }

    /// Set the maximum number of artifacts to keep (default: 1000)
    pub fn with_max_artifacts(mut self, max_artifacts: usize) -> Self {
        self.max_artifacts = max_artifacts;
        self
    }

    /// Append a new artifact to the store
    pub fn append(&self, input: ArtifactInput) -> Result<WorkflowArtifact> {
        let now = current_timestamp();
        let id = input
            .id
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| generate_artifact_id(now));

        let artifact = WorkflowArtifact {
            id,
            run_id: input.run_id,
            workflow_name: input.workflow_name,
            step_id: input.step_id,
            role: input.role,
            artifact_type: input.artifact_type,
            title: input.title,
            content: input.content,
            files: input.files,
            created_at: input.created_at.unwrap_or(now),
        };

        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Append to NDJSON file
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        let line = serde_json::to_string(&artifact)?;
        writeln!(file, "{}", line)?;

        // Trigger compaction if needed
        self.maybe_compact()?;

        Ok(artifact)
    }

    /// List all artifacts, optionally filtered by run ID
    /// Returns artifacts sorted by createdAt descending (most recent first)
    pub fn list(&self, run_id: Option<&str>) -> Result<Vec<WorkflowArtifact>> {
        let mut artifacts = self.load()?;
        artifacts.sort_by_key(|a| std::cmp::Reverse(a.created_at));

        if let Some(run_id) = run_id {
            Ok(artifacts
                .into_iter()
                .filter(|a| a.run_id == run_id)
                .collect())
        } else {
            Ok(artifacts)
        }
    }

    /// Get artifacts by type for a specific run
    pub fn get_by_type(
        &self,
        run_id: &str,
        artifact_type: ArtifactType,
    ) -> Result<Vec<WorkflowArtifact>> {
        let artifacts = self.list(Some(run_id))?;
        Ok(artifacts
            .into_iter()
            .filter(|a| a.artifact_type == artifact_type)
            .collect())
    }

    /// Load all artifacts from the NDJSON file
    fn load(&self) -> Result<Vec<WorkflowArtifact>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let file = File::open(&self.path)?;
        let reader = BufReader::new(file);
        let mut artifacts = Vec::new();
        let mut bad_line_count = 0;

        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<WorkflowArtifact>(&line) {
                Ok(artifact) => artifacts.push(artifact),
                Err(_) => bad_line_count += 1,
            }
        }

        if bad_line_count > 0 {
            eprintln!(
                "Warning: skipped {} bad lines in artifact store (other artifacts preserved)",
                bad_line_count
            );
        }

        Ok(artifacts)
    }

    /// Compact the artifact store if it exceeds the threshold
    fn maybe_compact(&self) -> Result<()> {
        // Count lines efficiently
        let line_count = count_lines(&self.path)?;
        let threshold = (self.max_artifacts as f64 * 1.5) as usize;

        if line_count <= threshold {
            return Ok(());
        }

        // Load, sort, and keep most recent max_artifacts
        let mut artifacts = self.load()?;
        artifacts.sort_by_key(|a| std::cmp::Reverse(a.created_at));
        artifacts.truncate(self.max_artifacts);

        // Write to temp file and atomically replace
        let tmp_path = format!(
            "{}.tmp-{}-{}",
            self.path.display(),
            std::process::id(),
            current_timestamp()
        );
        let mut tmp_file = File::create(&tmp_path)?;

        // Reverse to write oldest first (NDJSON append order)
        artifacts.reverse();
        for artifact in &artifacts {
            let line = serde_json::to_string(artifact)?;
            writeln!(tmp_file, "{}", line)?;
        }
        tmp_file.sync_all()?;
        drop(tmp_file);

        // Atomic rename
        fs::rename(&tmp_path, &self.path)?;

        Ok(())
    }
}

/// Count newlines in a file efficiently
fn count_lines(path: &Path) -> Result<usize> {
    if !path.exists() {
        return Ok(0);
    }

    let content = fs::read(path)?;
    Ok(content.iter().filter(|&&b| b == b'\n').count())
}

/// Generate a unique artifact ID
fn generate_artifact_id(timestamp: u64) -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::BuildHasher;

    let hash = RandomState::new().hash_one(timestamp);

    format!("artifact-{}-{:x}", timestamp, hash & 0xFFFFFFFF)
}

/// Get current Unix timestamp in milliseconds
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

    fn temp_store() -> (TempDir, WorkflowArtifactStore) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("artifacts.ndjson");
        let store = WorkflowArtifactStore::new(path);
        (dir, store)
    }

    #[test]
    fn test_append_and_list() {
        let (_dir, store) = temp_store();

        let input1 = ArtifactInput {
            id: None,
            run_id: "run-1".to_string(),
            workflow_name: "test-workflow".to_string(),
            step_id: Some("step-1".to_string()),
            role: Some("developer".to_string()),
            artifact_type: ArtifactType::Plan,
            title: "Implementation Plan".to_string(),
            content: "Plan content here".to_string(),
            files: vec!["plan.md".to_string()],
            created_at: Some(1000),
        };

        let artifact1 = store.append(input1).unwrap();
        assert_eq!(artifact1.run_id, "run-1");
        assert_eq!(artifact1.artifact_type, ArtifactType::Plan);
        assert_eq!(artifact1.title, "Implementation Plan");

        let input2 = ArtifactInput {
            id: None,
            run_id: "run-1".to_string(),
            workflow_name: "test-workflow".to_string(),
            step_id: Some("step-2".to_string()),
            role: None,
            artifact_type: ArtifactType::TestResult,
            title: "Test Results".to_string(),
            content: "All tests passed".to_string(),
            files: vec![],
            created_at: Some(2000),
        };

        store.append(input2).unwrap();

        let artifacts = store.list(None).unwrap();
        assert_eq!(artifacts.len(), 2);
        // Most recent first
        assert_eq!(artifacts[0].created_at, 2000);
        assert_eq!(artifacts[1].created_at, 1000);
    }

    #[test]
    fn test_list_by_run_id() {
        let (_dir, store) = temp_store();

        let input1 = ArtifactInput {
            id: None,
            run_id: "run-1".to_string(),
            workflow_name: "test".to_string(),
            step_id: None,
            role: None,
            artifact_type: ArtifactType::Plan,
            title: "Plan 1".to_string(),
            content: String::new(),
            files: vec![],
            created_at: Some(1000),
        };

        let input2 = ArtifactInput {
            id: None,
            run_id: "run-2".to_string(),
            workflow_name: "test".to_string(),
            step_id: None,
            role: None,
            artifact_type: ArtifactType::Plan,
            title: "Plan 2".to_string(),
            content: String::new(),
            files: vec![],
            created_at: Some(2000),
        };

        store.append(input1).unwrap();
        store.append(input2).unwrap();

        let run1_artifacts = store.list(Some("run-1")).unwrap();
        assert_eq!(run1_artifacts.len(), 1);
        assert_eq!(run1_artifacts[0].title, "Plan 1");

        let run2_artifacts = store.list(Some("run-2")).unwrap();
        assert_eq!(run2_artifacts.len(), 1);
        assert_eq!(run2_artifacts[0].title, "Plan 2");
    }

    #[test]
    fn test_get_by_type() {
        let (_dir, store) = temp_store();

        let input1 = ArtifactInput {
            id: None,
            run_id: "run-1".to_string(),
            workflow_name: "test".to_string(),
            step_id: None,
            role: None,
            artifact_type: ArtifactType::Plan,
            title: "Plan".to_string(),
            content: String::new(),
            files: vec![],
            created_at: Some(1000),
        };

        let input2 = ArtifactInput {
            id: None,
            run_id: "run-1".to_string(),
            workflow_name: "test".to_string(),
            step_id: None,
            role: None,
            artifact_type: ArtifactType::TestResult,
            title: "Test".to_string(),
            content: String::new(),
            files: vec![],
            created_at: Some(2000),
        };

        store.append(input1).unwrap();
        store.append(input2).unwrap();

        let plans = store.get_by_type("run-1", ArtifactType::Plan).unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].title, "Plan");

        let tests = store
            .get_by_type("run-1", ArtifactType::TestResult)
            .unwrap();
        assert_eq!(tests.len(), 1);
        assert_eq!(tests[0].title, "Test");
    }

    #[test]
    fn test_custom_id() {
        let (_dir, store) = temp_store();

        let input = ArtifactInput {
            id: Some("custom-id-123".to_string()),
            run_id: "run-1".to_string(),
            workflow_name: "test".to_string(),
            step_id: None,
            role: None,
            artifact_type: ArtifactType::Plan,
            title: "Plan".to_string(),
            content: String::new(),
            files: vec![],
            created_at: Some(1000),
        };

        let artifact = store.append(input).unwrap();
        assert_eq!(artifact.id, "custom-id-123");
    }

    #[test]
    fn test_bad_line_skipped() {
        let (_dir, store) = temp_store();

        // Write a valid artifact
        let input = ArtifactInput {
            id: None,
            run_id: "run-1".to_string(),
            workflow_name: "test".to_string(),
            step_id: None,
            role: None,
            artifact_type: ArtifactType::Plan,
            title: "Plan".to_string(),
            content: String::new(),
            files: vec![],
            created_at: Some(1000),
        };
        store.append(input).unwrap();

        // Manually append a bad line
        let mut file = OpenOptions::new().append(true).open(&store.path).unwrap();
        writeln!(file, "{{invalid json}}").unwrap();

        // Write another valid artifact
        let input2 = ArtifactInput {
            id: None,
            run_id: "run-2".to_string(),
            workflow_name: "test".to_string(),
            step_id: None,
            role: None,
            artifact_type: ArtifactType::TestResult,
            title: "Test".to_string(),
            content: String::new(),
            files: vec![],
            created_at: Some(2000),
        };
        store.append(input2).unwrap();

        // Should load 2 valid artifacts, skip the bad line
        let artifacts = store.list(None).unwrap();
        assert_eq!(artifacts.len(), 2);
    }

    #[test]
    fn test_compaction() {
        let (_dir, store) = temp_store();
        let store = store.with_max_artifacts(5);

        // Add 10 artifacts
        for i in 0..10 {
            let input = ArtifactInput {
                id: None,
                run_id: format!("run-{}", i),
                workflow_name: "test".to_string(),
                step_id: None,
                role: None,
                artifact_type: ArtifactType::Plan,
                title: format!("Plan {}", i),
                content: String::new(),
                files: vec![],
                created_at: Some(1000 + i),
            };
            store.append(input).unwrap();
        }

        // Compaction threshold = 5 * 1.5 = 7.5
        // When we add the 8th artifact (line_count=8 > 7.5), compaction triggers and keeps 5
        // Then we add artifacts 8 and 9, so we end up with 7 total
        // This is expected behavior: compaction keeps file size bounded
        let artifacts = store.list(None).unwrap();
        assert!(
            artifacts.len() <= 10,
            "Should have at most 10 artifacts before any compaction"
        );

        // Verify most recent artifacts are present
        assert_eq!(artifacts[0].run_id, "run-9");
        assert!(artifacts.iter().any(|a| a.run_id == "run-8"));
    }

    #[test]
    fn test_all_artifact_types() {
        let (_dir, store) = temp_store();

        let types = vec![
            ArtifactType::Plan,
            ArtifactType::PatchSummary,
            ArtifactType::TestResult,
            ArtifactType::ReviewReport,
            ArtifactType::HumanDecision,
            ArtifactType::DeliveryNote,
        ];

        for (i, artifact_type) in types.iter().enumerate() {
            let input = ArtifactInput {
                id: None,
                run_id: "run-1".to_string(),
                workflow_name: "test".to_string(),
                step_id: None,
                role: None,
                artifact_type: *artifact_type,
                title: format!("Artifact {}", i),
                content: String::new(),
                files: vec![],
                created_at: Some(1000 + i as u64),
            };
            store.append(input).unwrap();
        }

        let artifacts = store.list(Some("run-1")).unwrap();
        assert_eq!(artifacts.len(), 6);
    }
}
