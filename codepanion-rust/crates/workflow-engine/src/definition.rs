// W-01: Workflow definition
//
// 完整的 workflow 定义结构，兼容 TypeScript daemon 的 workflows.json 格式。
// 支持解析 workflow、step、role、model、provider、permissions、contextPolicy、artifacts、checkpoint。

use codepanion_shared::{CodePanionError, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Workflow 权限类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowPermission {
    Read,
    Write,
    Command,
    Network,
    Delegate,
    Approve,
}

/// Workflow provider（历史字段，保留用于解析旧 workflows.json）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum WorkflowProvider {
    #[default]
    Local,
    Codex,
    ClaudeCode,
    Opencode,
}

/// 执行架构（harness）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowArchitecture {
    /// 在本机 spawn step.command/args（跑测试、本地命令等非 AI 步骤）
    Shell,
    /// 进程内把 prompt 交给模型 API 完成
    Agent,
}

/// Artifact 类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkflowArtifactType {
    Plan,
    PatchSummary,
    TestResult,
    ReviewReport,
    HumanDecision,
    DeliveryNote,
}

/// Context policy（上下文策略）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowContextPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
}

impl WorkflowContextPolicy {
    /// 验证 context glob 路径
    pub fn validate(&self) -> Result<()> {
        for glob in &self.include {
            validate_context_glob(glob)?;
        }
        for glob in &self.exclude {
            validate_context_glob(glob)?;
        }
        Ok(())
    }
}

/// Workflow step 定义
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub id: String,
    #[serde(default = "default_tool")]
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default)]
    pub provider: WorkflowProvider,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub architecture: Option<WorkflowArchitecture>,
    #[serde(default)]
    pub permissions: Vec<WorkflowPermission>,
    #[serde(default)]
    pub context_policy: WorkflowContextPolicy,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub human_gate: Option<String>,
    #[serde(default)]
    pub artifacts: Vec<WorkflowArtifactType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub values: HashMap<String, String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub checkpoint: bool,
}

fn default_tool() -> String {
    "local".to_string()
}

impl WorkflowStep {
    /// 验证 step 定义
    pub fn validate(&self) -> Result<()> {
        // 验证 ID
        validate_identifier(&self.id, "step id")?;

        // 验证 role
        if let Some(ref role) = self.role {
            validate_identifier(role, "role")?;
        }

        // 验证 human_gate
        if let Some(ref gate) = self.human_gate {
            validate_identifier(gate, "human_gate")?;
        }

        // 验证 context policy
        self.context_policy.validate()?;

        // 验证 depends_on 引用
        for dep in &self.depends_on {
            if dep.trim().is_empty() {
                return Err(CodePanionError::InvalidInput(
                    "dependsOn cannot contain empty strings".to_string(),
                ));
            }
        }

        Ok(())
    }

    /// 解析 step 的执行架构（如果未指定，从 provider 派生）
    pub fn resolve_architecture(&self) -> WorkflowArchitecture {
        self.architecture.unwrap_or(match self.provider {
            WorkflowProvider::Local => WorkflowArchitecture::Shell,
            _ => WorkflowArchitecture::Agent,
        })
    }
}

/// Workflow 定义
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub params: HashMap<String, String>,
    pub steps: Vec<WorkflowStep>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl WorkflowDefinition {
    /// 验证 workflow 定义
    pub fn validate(&self) -> Result<()> {
        // 验证 name
        validate_identifier(&self.name, "workflow name")?;

        // 验证至少有一个 step
        if self.steps.is_empty() {
            return Err(CodePanionError::InvalidInput(
                "workflow requires at least one step".to_string(),
            ));
        }

        // 验证每个 step
        for step in &self.steps {
            step.validate()?;
        }

        // 验证 step ID 唯一性
        let mut seen_ids = std::collections::HashSet::new();
        for step in &self.steps {
            if !seen_ids.insert(step.id.as_str()) {
                return Err(CodePanionError::InvalidInput(format!(
                    "duplicate step id: {}",
                    step.id
                )));
            }
        }

        // 验证 depends_on 引用的 step 存在
        for step in &self.steps {
            for dep in &step.depends_on {
                if !seen_ids.contains(dep.as_str()) {
                    return Err(CodePanionError::InvalidInput(format!(
                        "step {} depends on non-existent step: {}",
                        step.id, dep
                    )));
                }
            }
        }

        // 验证 params
        for key in self.params.keys() {
            validate_param_name(key)?;
        }

        Ok(())
    }

    /// 从 JSON 字符串解析 workflow 定义
    pub fn from_json(json: &str) -> Result<Self> {
        serde_json::from_str(json).map_err(|e| {
            CodePanionError::InvalidInput(format!("failed to parse workflow definition: {}", e))
        })
    }

    /// 序列化为 JSON 字符串
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string_pretty(self).map_err(|e| {
            CodePanionError::Runtime(format!("failed to serialize workflow definition: {}", e))
        })
    }
}

/// Definition store（workflows.json 的根结构）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DefinitionStore {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub workflows: Vec<WorkflowDefinition>,
}

fn default_version() -> u32 {
    1
}

impl DefinitionStore {
    /// 创建空的 store
    pub fn new() -> Self {
        Self {
            version: 1,
            workflows: Vec::new(),
        }
    }

    /// 从 JSON 字符串解析 store
    pub fn from_json(json: &str) -> Result<Self> {
        serde_json::from_str(json).map_err(|e| {
            CodePanionError::InvalidInput(format!("failed to parse definition store: {}", e))
        })
    }

    /// 序列化为 JSON 字符串
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string_pretty(self).map_err(|e| {
            CodePanionError::Runtime(format!("failed to serialize definition store: {}", e))
        })
    }

    /// 验证 store 中的所有 workflow
    pub fn validate(&self) -> Result<()> {
        for workflow in &self.workflows {
            workflow.validate()?;
        }

        // 验证 workflow name 唯一性
        let mut seen_names = std::collections::HashSet::new();
        for workflow in &self.workflows {
            if !seen_names.insert(&workflow.name) {
                return Err(CodePanionError::InvalidInput(format!(
                    "duplicate workflow name: {}",
                    workflow.name
                )));
            }
        }

        Ok(())
    }

    /// 根据名称查找 workflow
    pub fn find_workflow(&self, name: &str) -> Option<&WorkflowDefinition> {
        self.workflows.iter().find(|w| w.name == name)
    }
}

impl Default for DefinitionStore {
    fn default() -> Self {
        Self::new()
    }
}

// 辅助函数

/// 验证标识符（workflow name, step id, role, human_gate）
fn validate_identifier(value: &str, label: &str) -> Result<()> {
    if value.is_empty() {
        return Err(CodePanionError::InvalidInput(format!(
            "{} cannot be empty",
            label
        )));
    }

    if value.len() > 120 {
        return Err(CodePanionError::InvalidInput(format!(
            "{} cannot exceed 120 characters",
            label
        )));
    }

    // 正则：^[A-Za-z0-9][A-Za-z0-9_.-]*$
    let re = Regex::new(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$").unwrap();
    if !re.is_match(value) {
        return Err(CodePanionError::InvalidInput(format!(
            "{} must start with alphanumeric and contain only alphanumeric, underscore, dot, or dash",
            label
        )));
    }

    Ok(())
}

/// 验证参数名称
fn validate_param_name(name: &str) -> Result<()> {
    // 正则：^[A-Za-z_][A-Za-z0-9_-]*$
    let re = Regex::new(r"^[A-Za-z_][A-Za-z0-9_-]*$").unwrap();
    if !re.is_match(name) {
        return Err(CodePanionError::InvalidInput(format!(
            "param name '{}' must start with letter or underscore and contain only alphanumeric, underscore, or dash",
            name
        )));
    }
    Ok(())
}

/// 验证 context glob 路径（拒绝 path traversal / 绝对路径 / 空段）
fn validate_context_glob(glob: &str) -> Result<()> {
    if glob.is_empty() {
        return Err(CodePanionError::InvalidInput(
            "context glob cannot be empty".to_string(),
        ));
    }

    if glob.len() > 200 {
        return Err(CodePanionError::InvalidInput(
            "context glob cannot exceed 200 characters".to_string(),
        ));
    }

    // 拒绝 null 字符
    if glob.contains('\0') {
        return Err(CodePanionError::InvalidInput(
            "context glob cannot contain null characters".to_string(),
        ));
    }

    // 拒绝绝对路径
    if glob.starts_with('/') || glob.starts_with('\\') {
        return Err(CodePanionError::InvalidInput(
            "context glob must be a relative path".to_string(),
        ));
    }

    // 拒绝 Windows 绝对路径（C:\, D:\, etc.）
    if glob.len() >= 3 {
        let chars: Vec<char> = glob.chars().collect();
        if chars[0].is_ascii_alphabetic()
            && chars[1] == ':'
            && (chars[2] == '\\' || chars[2] == '/')
        {
            return Err(CodePanionError::InvalidInput(
                "context glob must be a relative path".to_string(),
            ));
        }
    }

    // 拒绝 .. 段
    for segment in glob.split(&['/', '\\'][..]) {
        if segment == ".." {
            return Err(CodePanionError::InvalidInput(
                "context glob cannot contain .. segments".to_string(),
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_identifier() {
        assert!(validate_identifier("test", "test").is_ok());
        assert!(validate_identifier("test-123", "test").is_ok());
        assert!(validate_identifier("test_123", "test").is_ok());
        assert!(validate_identifier("test.123", "test").is_ok());
        assert!(validate_identifier("", "test").is_err());
        assert!(validate_identifier("-test", "test").is_err());
        assert!(validate_identifier("test@", "test").is_err());
    }

    #[test]
    fn test_validate_param_name() {
        assert!(validate_param_name("test").is_ok());
        assert!(validate_param_name("_test").is_ok());
        assert!(validate_param_name("test_123").is_ok());
        assert!(validate_param_name("test-123").is_ok());
        assert!(validate_param_name("123test").is_err());
        assert!(validate_param_name("-test").is_err());
    }

    #[test]
    fn test_validate_context_glob() {
        assert!(validate_context_glob("src/**/*.rs").is_ok());
        assert!(validate_context_glob("test.txt").is_ok());
        assert!(validate_context_glob("").is_err());
        assert!(validate_context_glob("/etc/passwd").is_err());
        assert!(validate_context_glob("C:\\Windows").is_err());
        assert!(validate_context_glob("../etc/passwd").is_err());
        assert!(validate_context_glob("src/../etc/passwd").is_err());
    }

    #[test]
    fn test_workflow_definition_validation() {
        let workflow = WorkflowDefinition {
            name: "test-workflow".to_string(),
            description: "Test workflow".to_string(),
            params: HashMap::new(),
            steps: vec![WorkflowStep {
                id: "step1".to_string(),
                tool: "local".to_string(),
                role: None,
                model: None,
                provider: WorkflowProvider::Local,
                architecture: None,
                permissions: vec![],
                context_policy: WorkflowContextPolicy::default(),
                human_gate: None,
                artifacts: vec![],
                template: None,
                command: Some("echo".to_string()),
                args: vec!["hello".to_string()],
                values: HashMap::new(),
                depends_on: vec![],
                checkpoint: false,
            }],
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        assert!(workflow.validate().is_ok());
    }

    #[test]
    fn test_workflow_requires_steps() {
        let workflow = WorkflowDefinition {
            name: "empty".to_string(),
            description: String::new(),
            params: HashMap::new(),
            steps: vec![],
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        assert!(workflow.validate().is_err());
    }

    #[test]
    fn test_duplicate_step_ids() {
        let workflow = WorkflowDefinition {
            name: "test".to_string(),
            description: String::new(),
            params: HashMap::new(),
            steps: vec![
                WorkflowStep {
                    id: "step1".to_string(),
                    tool: "local".to_string(),
                    role: None,
                    model: None,
                    provider: WorkflowProvider::Local,
                    architecture: None,
                    permissions: vec![],
                    context_policy: WorkflowContextPolicy::default(),
                    human_gate: None,
                    artifacts: vec![],
                    template: None,
                    command: Some("echo".to_string()),
                    args: vec![],
                    values: HashMap::new(),
                    depends_on: vec![],
                    checkpoint: false,
                },
                WorkflowStep {
                    id: "step1".to_string(), // 重复
                    tool: "local".to_string(),
                    role: None,
                    model: None,
                    provider: WorkflowProvider::Local,
                    architecture: None,
                    permissions: vec![],
                    context_policy: WorkflowContextPolicy::default(),
                    human_gate: None,
                    artifacts: vec![],
                    template: None,
                    command: Some("echo".to_string()),
                    args: vec![],
                    values: HashMap::new(),
                    depends_on: vec![],
                    checkpoint: false,
                },
            ],
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        assert!(workflow.validate().is_err());
    }

    #[test]
    fn test_invalid_depends_on() {
        let workflow = WorkflowDefinition {
            name: "test".to_string(),
            description: String::new(),
            params: HashMap::new(),
            steps: vec![WorkflowStep {
                id: "step1".to_string(),
                tool: "local".to_string(),
                role: None,
                model: None,
                provider: WorkflowProvider::Local,
                architecture: None,
                permissions: vec![],
                context_policy: WorkflowContextPolicy::default(),
                human_gate: None,
                artifacts: vec![],
                template: None,
                command: Some("echo".to_string()),
                args: vec![],
                values: HashMap::new(),
                depends_on: vec!["non-existent".to_string()],
                checkpoint: false,
            }],
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        assert!(workflow.validate().is_err());
    }

    #[test]
    fn test_resolve_architecture() {
        let step_local = WorkflowStep {
            id: "step1".to_string(),
            tool: "local".to_string(),
            role: None,
            model: None,
            provider: WorkflowProvider::Local,
            architecture: None,
            permissions: vec![],
            context_policy: WorkflowContextPolicy::default(),
            human_gate: None,
            artifacts: vec![],
            template: None,
            command: Some("echo".to_string()),
            args: vec![],
            values: HashMap::new(),
            depends_on: vec![],
            checkpoint: false,
        };

        assert_eq!(
            step_local.resolve_architecture(),
            WorkflowArchitecture::Shell
        );

        let step_agent = WorkflowStep {
            id: "step2".to_string(),
            tool: "local".to_string(),
            role: None,
            model: None,
            provider: WorkflowProvider::ClaudeCode,
            architecture: None,
            permissions: vec![],
            context_policy: WorkflowContextPolicy::default(),
            human_gate: None,
            artifacts: vec![],
            template: None,
            command: None,
            args: vec![],
            values: HashMap::new(),
            depends_on: vec![],
            checkpoint: false,
        };

        assert_eq!(
            step_agent.resolve_architecture(),
            WorkflowArchitecture::Agent
        );
    }

    #[test]
    fn test_json_serialization() {
        let workflow = WorkflowDefinition {
            name: "test".to_string(),
            description: "Test workflow".to_string(),
            params: HashMap::new(),
            steps: vec![WorkflowStep {
                id: "step1".to_string(),
                tool: "local".to_string(),
                role: None,
                model: None,
                provider: WorkflowProvider::Local,
                architecture: Some(WorkflowArchitecture::Shell),
                permissions: vec![WorkflowPermission::Read, WorkflowPermission::Write],
                context_policy: WorkflowContextPolicy::default(),
                human_gate: None,
                artifacts: vec![WorkflowArtifactType::Plan],
                template: None,
                command: Some("echo".to_string()),
                args: vec!["hello".to_string()],
                values: HashMap::new(),
                depends_on: vec![],
                checkpoint: false,
            }],
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        let json = workflow.to_json().unwrap();
        let parsed = WorkflowDefinition::from_json(&json).unwrap();
        assert_eq!(workflow, parsed);
    }

    #[test]
    fn test_definition_store() {
        let mut store = DefinitionStore::new();
        assert_eq!(store.version, 1);
        assert!(store.workflows.is_empty());

        store.workflows.push(WorkflowDefinition {
            name: "test".to_string(),
            description: String::new(),
            params: HashMap::new(),
            steps: vec![WorkflowStep {
                id: "step1".to_string(),
                tool: "local".to_string(),
                role: None,
                model: None,
                provider: WorkflowProvider::Local,
                architecture: None,
                permissions: vec![],
                context_policy: WorkflowContextPolicy::default(),
                human_gate: None,
                artifacts: vec![],
                template: None,
                command: Some("echo".to_string()),
                args: vec![],
                values: HashMap::new(),
                depends_on: vec![],
                checkpoint: false,
            }],
            created_at: 1234567890,
            updated_at: 1234567890,
        });

        assert!(store.validate().is_ok());
        assert!(store.find_workflow("test").is_some());
        assert!(store.find_workflow("non-existent").is_none());

        let json = store.to_json().unwrap();
        let parsed = DefinitionStore::from_json(&json).unwrap();
        assert_eq!(store, parsed);
    }
}
