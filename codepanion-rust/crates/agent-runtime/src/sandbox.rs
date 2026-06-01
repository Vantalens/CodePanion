// A-07: 沙箱隔离执行
//
// 实现 4 层隔离级别的沙箱执行环境：
// 1. None - 无隔离（直接执行）
// 2. PathRestricted - 路径限制（cwd 钳制 + 路径检查）
// 3. ResourceLimited - 资源限制（超时 + 输出截断）
// 4. NetworkIsolated - 网络隔离（阻止网络访问，未来实现）
//
// 当前实现 1-3 层，第 4 层预留接口。

use crate::{CommandRequest, CommandResult, CommandTools};
use std::path::{Path, PathBuf};
use std::sync::{Arc, atomic::AtomicBool};
use std::time::Duration;

/// 沙箱隔离级别
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum IsolationLevel {
    /// 无隔离 - 直接执行（仅用于测试或完全信任的场景）
    None = 0,
    /// 路径限制 - cwd 钳制在 workspace root，禁止访问外部路径
    PathRestricted = 1,
    /// 资源限制 - 路径限制 + 超时 + 输出截断
    #[default]
    ResourceLimited = 2,
    /// 网络隔离 - 资源限制 + 阻止网络访问（未来实现）
    NetworkIsolated = 3,
}

/// 沙箱配置
#[derive(Debug, Clone)]
pub struct SandboxConfig {
    /// 隔离级别
    pub isolation_level: IsolationLevel,
    /// workspace 根目录（用于路径限制）
    pub workspace_root: PathBuf,
    /// 默认超时（用于资源限制）
    pub default_timeout: Duration,
    /// 输出大小限制（字节，用于资源限制）
    pub output_limit: usize,
    /// 取消信号
    pub cancel: Arc<AtomicBool>,
}

impl SandboxConfig {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            isolation_level: IsolationLevel::default(),
            workspace_root: workspace_root.into(),
            default_timeout: Duration::from_secs(30),
            output_limit: 32 * 1024, // 32KB
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn with_isolation_level(mut self, level: IsolationLevel) -> Self {
        self.isolation_level = level;
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.default_timeout = timeout;
        self
    }

    pub fn with_output_limit(mut self, limit: usize) -> Self {
        self.output_limit = limit;
        self
    }

    pub fn with_cancel(mut self, cancel: Arc<AtomicBool>) -> Self {
        self.cancel = cancel;
        self
    }
}

/// 沙箱执行器
pub struct Sandbox {
    config: SandboxConfig,
    command_tools: CommandTools,
}

impl Sandbox {
    pub fn new(config: SandboxConfig) -> Self {
        let workspace_root = config.workspace_root.to_string_lossy().to_string();
        let command_tools = CommandTools::new(&workspace_root);
        Self {
            config,
            command_tools,
        }
    }

    /// 在沙箱中执行命令
    pub fn run_command(&self, command: impl Into<String>, args: Vec<String>) -> CommandResult {
        let command = command.into();

        match self.config.isolation_level {
            IsolationLevel::None => {
                // 无隔离 - 直接执行（不推荐）
                self.run_unrestricted(&command, args)
            }
            IsolationLevel::PathRestricted => {
                // 路径限制 - cwd 钳制
                self.run_path_restricted(&command, args)
            }
            IsolationLevel::ResourceLimited => {
                // 资源限制 - 路径 + 超时 + 输出截断
                self.run_resource_limited(&command, args)
            }
            IsolationLevel::NetworkIsolated => {
                // 网络隔离 - 未来实现，当前降级到资源限制
                self.run_resource_limited(&command, args)
            }
        }
    }

    /// 无隔离执行（仅用于测试）
    fn run_unrestricted(&self, command: &str, args: Vec<String>) -> CommandResult {
        self.command_tools.run_command(CommandRequest {
            command: command.to_string(),
            args,
            timeout: Duration::from_secs(3600), // 1 小时
            cancel: self.config.cancel.clone(),
            allow_high_risk: true, // 无隔离模式允许高危命令
        })
    }

    /// 路径限制执行
    fn run_path_restricted(&self, command: &str, args: Vec<String>) -> CommandResult {
        // CommandTools 已经实现了 cwd 钳制
        self.command_tools.run_command(CommandRequest {
            command: command.to_string(),
            args,
            timeout: Duration::from_secs(3600), // 路径限制模式不限制超时
            cancel: self.config.cancel.clone(),
            allow_high_risk: false, // 路径限制模式不允许高危命令
        })
    }

    /// 资源限制执行
    fn run_resource_limited(&self, command: &str, args: Vec<String>) -> CommandResult {
        // CommandTools 已经实现了超时和输出截断
        self.command_tools.run_command(CommandRequest {
            command: command.to_string(),
            args,
            timeout: self.config.default_timeout,
            cancel: self.config.cancel.clone(),
            allow_high_risk: false,
        })
    }

    /// 检查路径是否在 workspace 内
    pub fn is_path_allowed(&self, path: &Path) -> bool {
        crate::ensure_path_inside(path, &self.config.workspace_root, "sandbox path check").is_ok()
    }

    /// 获取隔离级别
    pub fn isolation_level(&self) -> IsolationLevel {
        self.config.isolation_level
    }
}

/// 沙箱执行结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxResult {
    /// 命令执行结果
    pub command_result: CommandResult,
    /// 隔离级别
    pub isolation_level: IsolationLevel,
    /// 是否被隔离策略阻止
    pub blocked_by_isolation: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolation_level_ordering() {
        assert!(IsolationLevel::None < IsolationLevel::PathRestricted);
        assert!(IsolationLevel::PathRestricted < IsolationLevel::ResourceLimited);
        assert!(IsolationLevel::ResourceLimited < IsolationLevel::NetworkIsolated);
    }

    #[test]
    fn isolation_level_default() {
        assert_eq!(IsolationLevel::default(), IsolationLevel::ResourceLimited);
    }

    #[test]
    fn sandbox_config_builder() {
        let config = SandboxConfig::new("/workspace")
            .with_isolation_level(IsolationLevel::PathRestricted)
            .with_timeout(Duration::from_secs(60))
            .with_output_limit(64 * 1024);

        assert_eq!(config.isolation_level, IsolationLevel::PathRestricted);
        assert_eq!(config.default_timeout, Duration::from_secs(60));
        assert_eq!(config.output_limit, 64 * 1024);
    }

    #[test]
    fn sandbox_creation() {
        let config = SandboxConfig::new("/workspace");
        let sandbox = Sandbox::new(config);
        assert_eq!(sandbox.isolation_level(), IsolationLevel::ResourceLimited);
    }

    #[test]
    fn sandbox_path_check() {
        let config = SandboxConfig::new("/workspace");
        let _sandbox = Sandbox::new(config);

        // 注意：这些测试依赖于 ensure_path_inside 的实现
        // 在 Windows 上路径格式可能不同
        #[cfg(unix)]
        {
            assert!(_sandbox.is_path_allowed(Path::new("/workspace/file.txt")));
            assert!(!_sandbox.is_path_allowed(Path::new("/etc/passwd")));
        }
    }

    #[test]
    fn sandbox_run_echo() {
        let temp_dir = std::env::temp_dir();
        let config = SandboxConfig::new(&temp_dir)
            .with_isolation_level(IsolationLevel::ResourceLimited)
            .with_timeout(Duration::from_secs(5));

        let sandbox = Sandbox::new(config);

        #[cfg(unix)]
        let result = sandbox.run_command("echo", vec!["hello".to_string()]);

        #[cfg(windows)]
        let result = sandbox.run_command("cmd", vec!["/c".to_string(), "echo hello".to_string()]);

        assert_eq!(result.exit_code, Some(0));
        assert!(result.stdout.contains("hello"));
    }

    #[test]
    fn sandbox_blocks_high_risk_command() {
        let temp_dir = std::env::temp_dir();
        let config =
            SandboxConfig::new(&temp_dir).with_isolation_level(IsolationLevel::ResourceLimited);

        let sandbox = Sandbox::new(config);

        #[cfg(unix)]
        let result = sandbox.run_command("rm", vec!["-rf".to_string(), "/".to_string()]);

        #[cfg(windows)]
        let result = sandbox.run_command(
            "rmdir",
            vec!["/s".to_string(), "/q".to_string(), "C:\\".to_string()],
        );

        // 高危命令应该被阻止
        assert!(result.blocked_by_risk);
    }

    #[test]
    fn sandbox_timeout_enforcement() {
        let temp_dir = std::env::temp_dir();
        let config = SandboxConfig::new(&temp_dir)
            .with_isolation_level(IsolationLevel::ResourceLimited)
            .with_timeout(Duration::from_millis(100)); // 100ms 超时

        let sandbox = Sandbox::new(config);

        #[cfg(unix)]
        let result = sandbox.run_command("sleep", vec!["10".to_string()]);

        #[cfg(windows)]
        let result = sandbox.run_command(
            "ping",
            vec!["127.0.0.1".to_string(), "-n".to_string(), "10".to_string()],
        );

        // 应该超时
        assert!(result.timed_out);
    }

    #[test]
    fn sandbox_result_structure() {
        let result = SandboxResult {
            command_result: CommandResult {
                exit_code: Some(0),
                stdout: "output".to_string(),
                stderr: String::new(),
                stdout_truncated: false,
                stderr_truncated: false,
                timed_out: false,
                cancelled: false,
                risk: crate::CommandRisk::Safe,
                blocked_by_risk: false,
            },
            isolation_level: IsolationLevel::ResourceLimited,
            blocked_by_isolation: false,
        };

        assert_eq!(result.command_result.exit_code, Some(0));
        assert_eq!(result.isolation_level, IsolationLevel::ResourceLimited);
        assert!(!result.blocked_by_isolation);
    }
}
