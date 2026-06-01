use std::path::{Path, PathBuf};

use codepanion_shared::{CodePanionError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspacePaths {
    pub root: PathBuf,
    pub codepanion_dir: PathBuf,
}

impl WorkspacePaths {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        if root.as_os_str().is_empty() {
            return Err(CodePanionError::InvalidInput(
                "workspace root is required".to_string(),
            ));
        }
        let codepanion_dir = root.join(".codepanion");
        Ok(Self {
            root,
            codepanion_dir,
        })
    }

    pub fn contains(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_paths_include_codepanion_dir() {
        let paths = WorkspacePaths::new("D:/example").unwrap();
        assert!(paths.codepanion_dir.ends_with(".codepanion"));
    }
}
