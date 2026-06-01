// A-05: 高危行为检测器
//
// 统一的高危行为检测层，覆盖：
// 1. 文件删除操作（命令 + 工具调用）
// 2. 关键配置/凭据文件修改
// 3. 危险命令（复用 A-04 的 CommandRisk）
// 4. 网络请求（预留接口）
// 5. git 历史修改
//
// 所有高危行为必须进入 human gate。

/// 高危行为类型
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RiskType {
    /// 删除文件/目录
    FileDelete { path: String },
    /// 修改关键配置文件
    CriticalFileModify { path: String, reason: String },
    /// 危险命令
    DangerousCommand { command: String },
    /// 网络请求（预留）
    NetworkRequest { url: String },
    /// Git 历史修改
    GitHistoryModify { operation: String },
}

/// 高危行为检测结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiskDetection {
    pub risk_type: RiskType,
    pub severity: RiskSeverity,
    pub message: String,
    pub requires_human_gate: bool,
}

/// 风险严重程度
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RiskSeverity {
    Low,
    Medium,
    High,
    Critical,
}

impl RiskSeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            RiskSeverity::Low => "low",
            RiskSeverity::Medium => "medium",
            RiskSeverity::High => "high",
            RiskSeverity::Critical => "critical",
        }
    }
}

/// 关键文件模式：修改这些文件需要 human gate
const CRITICAL_FILE_PATTERNS: &[&str] = &[
    // 凭据和密钥
    ".env",
    ".env.local",
    ".env.production",
    "credentials.json",
    "secrets.json",
    "id_rsa",
    "id_ed25519",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    // 配置文件
    ".git/config",
    ".gitconfig",
    ".ssh/config",
    "config.json",
    "appsettings", // 匹配所有 appsettings*.json
    // 权限文件
    ".htaccess",
    ".htpasswd",
    "sudoers",
    "authorized_keys",
    // 系统关键文件
    "/etc/passwd",
    "/etc/shadow",
    "/etc/hosts",
    "hosts",
];

/// 高危行为检测器
pub struct RiskDetector {
    #[allow(dead_code)]
    workspace_root: String,
}

impl RiskDetector {
    pub fn new(workspace_root: impl Into<String>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
        }
    }

    /// 检测文件写入操作的风险
    pub fn detect_file_write(&self, path: &str, is_delete: bool) -> Option<RiskDetection> {
        // 删除操作
        if is_delete {
            return Some(RiskDetection {
                risk_type: RiskType::FileDelete {
                    path: path.to_string(),
                },
                severity: RiskSeverity::High,
                message: format!("尝试删除文件：{}", path),
                requires_human_gate: true,
            });
        }

        // 关键文件修改
        if self.is_critical_file(path) {
            return Some(RiskDetection {
                risk_type: RiskType::CriticalFileModify {
                    path: path.to_string(),
                    reason: "关键配置/凭据文件".to_string(),
                },
                severity: RiskSeverity::Critical,
                message: format!("尝试修改关键文件：{}", path),
                requires_human_gate: true,
            });
        }

        None
    }

    /// 检测命令执行的风险（复用 A-04 的 CommandRisk）
    pub fn detect_command(&self, command: &str, args: &[String]) -> Option<RiskDetection> {
        use crate::command::{CommandRisk, classify_command};

        let risk = classify_command(command, args);
        if risk == CommandRisk::High {
            let full_cmd = format!("{} {}", command, args.join(" "));
            return Some(RiskDetection {
                risk_type: RiskType::DangerousCommand {
                    command: full_cmd.clone(),
                },
                severity: RiskSeverity::High,
                message: format!("高危命令：{}", full_cmd),
                requires_human_gate: true,
            });
        }

        None
    }

    /// 检测目录删除操作
    pub fn detect_directory_delete(&self, path: &str) -> Option<RiskDetection> {
        Some(RiskDetection {
            risk_type: RiskType::FileDelete {
                path: path.to_string(),
            },
            severity: RiskSeverity::Critical,
            message: format!("尝试删除目录：{}", path),
            requires_human_gate: true,
        })
    }

    /// 检测 git 历史修改操作
    pub fn detect_git_history_modify(&self, operation: &str) -> Option<RiskDetection> {
        let dangerous_git_ops = [
            "push --force",
            "push -f",
            "reset --hard",
            "rebase",
            "filter-branch",
            "clean -fd",
        ];

        for op in &dangerous_git_ops {
            if operation.contains(op) {
                return Some(RiskDetection {
                    risk_type: RiskType::GitHistoryModify {
                        operation: operation.to_string(),
                    },
                    severity: RiskSeverity::High,
                    message: format!("Git 历史修改操作：{}", operation),
                    requires_human_gate: true,
                });
            }
        }

        None
    }

    /// 检测网络请求（预留接口）
    pub fn detect_network_request(&self, url: &str) -> Option<RiskDetection> {
        // 预留：未来可以检测外部网络请求
        // 当前仅检测明显的数据外泄模式
        if url.contains("pastebin") || url.contains("transfer.sh") || url.contains("webhook") {
            return Some(RiskDetection {
                risk_type: RiskType::NetworkRequest {
                    url: url.to_string(),
                },
                severity: RiskSeverity::High,
                message: format!("可疑网络请求：{}", url),
                requires_human_gate: true,
            });
        }

        None
    }

    /// 判断是否为关键文件
    fn is_critical_file(&self, path: &str) -> bool {
        let path_lower = path.to_lowercase();

        // 规范化路径分隔符
        let path_normalized = path_lower.replace('\\', "/");

        for pattern in CRITICAL_FILE_PATTERNS {
            // 精确匹配文件名或路径包含该模式
            if path_normalized.ends_with(pattern)
                || path_normalized.contains(&format!("/{}", pattern))
                || path_normalized.contains(pattern)
            {
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_file_delete() {
        let detector = RiskDetector::new("/workspace");
        let result = detector.detect_file_write("test.txt", true);
        assert!(result.is_some());
        let detection = result.unwrap();
        assert!(detection.requires_human_gate);
        assert_eq!(detection.severity, RiskSeverity::High);
    }

    #[test]
    fn detect_critical_file_modify() {
        let detector = RiskDetector::new("/workspace");
        let result = detector.detect_file_write(".env", false);
        assert!(result.is_some());
        let detection = result.unwrap();
        assert!(detection.requires_human_gate);
        assert_eq!(detection.severity, RiskSeverity::Critical);
    }

    #[test]
    fn detect_credentials_file() {
        let detector = RiskDetector::new("/workspace");
        let files = vec![
            "credentials.json",
            "secrets.json",
            "id_rsa",
            ".ssh/id_ed25519",
            "config/appsettings.Production.json",
        ];

        for file in files {
            let result = detector.detect_file_write(file, false);
            assert!(result.is_some(), "应该检测到关键文件：{}", file);
        }
    }

    #[test]
    fn detect_dangerous_command() {
        let detector = RiskDetector::new("/workspace");
        let result = detector.detect_command("rm", &["-rf".to_string(), "/".to_string()]);
        assert!(result.is_some());
        let detection = result.unwrap();
        assert!(detection.requires_human_gate);
        assert_eq!(detection.severity, RiskSeverity::High);
    }

    #[test]
    fn detect_git_force_push() {
        let detector = RiskDetector::new("/workspace");
        let result = detector.detect_git_history_modify("git push --force origin main");
        assert!(result.is_some());
        let detection = result.unwrap();
        assert!(detection.requires_human_gate);
    }

    #[test]
    fn detect_suspicious_network_request() {
        let detector = RiskDetector::new("/workspace");
        let result = detector.detect_network_request("https://pastebin.com/upload");
        assert!(result.is_some());
        let detection = result.unwrap();
        assert!(detection.requires_human_gate);
    }

    #[test]
    fn safe_file_write_no_detection() {
        let detector = RiskDetector::new("/workspace");
        let result = detector.detect_file_write("src/main.rs", false);
        assert!(result.is_none());
    }

    #[test]
    fn safe_command_no_detection() {
        let detector = RiskDetector::new("/workspace");
        let result = detector.detect_command("cargo", &["test".to_string()]);
        assert!(result.is_none());
    }
}
