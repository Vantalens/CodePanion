// D-03: Daemon lifecycle management
//
// PID 文件管理、进程检测、daemon 启动/停止/状态查询

use codepanion_shared::{CodePanionError, Result};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Daemon 管理器
pub struct DaemonManager {
    pid_file: PathBuf,
}

impl DaemonManager {
    /// 创建 daemon 管理器
    pub fn new() -> Self {
        let pid_file = Self::default_pid_file();
        Self { pid_file }
    }

    /// 获取默认 PID 文件路径
    fn default_pid_file() -> PathBuf {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join(".codepanion").join("daemon.pid")
    }

    /// 启动 daemon
    pub fn start(&self, port: u16, foreground: bool) -> Result<()> {
        // 检查是否已经运行
        if let Some(pid) = self.read_pid()? {
            if self.is_process_running(pid) {
                return Err(CodePanionError::Runtime(format!(
                    "Daemon is already running (PID: {})",
                    pid
                )));
            } else {
                // PID 文件存在但进程不存在，清理旧的 PID 文件
                let _ = fs::remove_file(&self.pid_file);
            }
        }

        if foreground {
            // 前台运行
            println!("Starting daemon on port {} (foreground mode)...", port);
            self.run_daemon(port)?;
        } else {
            // 后台运行
            println!("Starting daemon on port {}...", port);
            self.spawn_daemon(port)?;
        }

        Ok(())
    }

    /// 停止 daemon
    pub fn stop(&self) -> Result<()> {
        let pid = self.read_pid()?.ok_or_else(|| {
            CodePanionError::Runtime("Daemon is not running (no PID file found)".to_string())
        })?;

        if !self.is_process_running(pid) {
            // 进程不存在，清理 PID 文件
            let _ = fs::remove_file(&self.pid_file);
            return Err(CodePanionError::Runtime(
                "Daemon is not running (stale PID file removed)".to_string(),
            ));
        }

        // 发送 SIGTERM 信号
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            Command::new("kill")
                .arg(pid.to_string())
                .spawn()
                .map_err(|e| CodePanionError::Runtime(format!("Failed to kill process: {}", e)))?;
        }

        #[cfg(windows)]
        {
            Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| CodePanionError::Runtime(format!("Failed to kill process: {}", e)))?;
        }

        // 等待进程退出
        for _ in 0..50 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if !self.is_process_running(pid) {
                let _ = fs::remove_file(&self.pid_file);
                println!("✓ Daemon stopped");
                return Ok(());
            }
        }

        Err(CodePanionError::Runtime(
            "Daemon did not stop within 5 seconds".to_string(),
        ))
    }

    /// 查询 daemon 状态
    pub fn status(&self) -> Result<DaemonStatus> {
        match self.read_pid()? {
            Some(pid) => {
                if self.is_process_running(pid) {
                    Ok(DaemonStatus::Running { pid })
                } else {
                    Ok(DaemonStatus::Stopped {
                        stale_pid: Some(pid),
                    })
                }
            }
            None => Ok(DaemonStatus::Stopped { stale_pid: None }),
        }
    }

    /// 读取 PID 文件
    fn read_pid(&self) -> Result<Option<u32>> {
        if !self.pid_file.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&self.pid_file)
            .map_err(|e| CodePanionError::Runtime(format!("Failed to read PID file: {}", e)))?;

        let pid = content
            .trim()
            .parse::<u32>()
            .map_err(|e| CodePanionError::Runtime(format!("Invalid PID in file: {}", e)))?;

        Ok(Some(pid))
    }

    /// 写入 PID 文件
    fn write_pid(&self, pid: u32) -> Result<()> {
        // 确保目录存在
        if let Some(parent) = self.pid_file.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                CodePanionError::Runtime(format!("Failed to create PID directory: {}", e))
            })?;
        }

        fs::write(&self.pid_file, pid.to_string())
            .map_err(|e| CodePanionError::Runtime(format!("Failed to write PID file: {}", e)))?;

        Ok(())
    }

    /// 检查进程是否运行
    fn is_process_running(&self, pid: u32) -> bool {
        #[cfg(unix)]
        {
            // 使用 kill -0 检查进程是否存在
            Command::new("kill")
                .args(&["-0", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }

        #[cfg(windows)]
        {
            // 使用 tasklist 检查进程是否存在
            Command::new("tasklist")
                .args(["/FI", &format!("PID eq {}", pid), "/NH"])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .output()
                .map(|output| {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    stdout.contains(&pid.to_string())
                })
                .unwrap_or(false)
        }
    }

    /// 前台运行 daemon
    fn run_daemon(&self, port: u16) -> Result<()> {
        // 写入当前进程的 PID
        let pid = std::process::id();
        self.write_pid(pid)?;

        // 运行 daemon（这会阻塞）
        let config = crate::DaemonConfig {
            bind: "127.0.0.1".to_string(),
            port,
            ..Default::default()
        };

        let runtime = tokio::runtime::Runtime::new()
            .map_err(|e| CodePanionError::Runtime(format!("Failed to create runtime: {}", e)))?;

        runtime.block_on(async {
            crate::run_daemon(config)
                .await
                .map_err(|e| CodePanionError::Runtime(format!("Daemon error: {}", e)))
        })?;

        Ok(())
    }

    /// 后台启动 daemon
    fn spawn_daemon(&self, port: u16) -> Result<()> {
        let exe = std::env::current_exe()
            .map_err(|e| CodePanionError::Runtime(format!("Failed to get executable path: {}", e)))?;

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;

            // 使用 nohup 后台运行
            let child = Command::new("nohup")
                .arg(&exe)
                .arg("start")
                .arg("--foreground")
                .arg("--port")
                .arg(port.to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| CodePanionError::Runtime(format!("Failed to spawn daemon: {}", e)))?;

            let pid = child.id();
            self.write_pid(pid)?;
            println!("✓ Daemon started (PID: {})", pid);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;

            // Windows: 使用 CREATE_NO_WINDOW 标志后台运行
            let child = Command::new(&exe)
                .arg("start")
                .arg("--foreground")
                .arg("--port")
                .arg(port.to_string())
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| CodePanionError::Runtime(format!("Failed to spawn daemon: {}", e)))?;

            let pid = child.id();
            self.write_pid(pid)?;
            println!("✓ Daemon started (PID: {})", pid);
        }

        // 等待一下确保 daemon 启动
        std::thread::sleep(std::time::Duration::from_millis(500));

        // 验证进程是否还在运行
        if let Some(pid) = self.read_pid()?
            && !self.is_process_running(pid)
        {
            return Err(CodePanionError::Runtime(
                "Daemon failed to start (process exited immediately)".to_string(),
            ));
        }

        Ok(())
    }
}

impl Default for DaemonManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Daemon 状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DaemonStatus {
    Running { pid: u32 },
    Stopped { stale_pid: Option<u32> },
}

impl std::fmt::Display for DaemonStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DaemonStatus::Running { pid } => write!(f, "Running (PID: {})", pid),
            DaemonStatus::Stopped { stale_pid: Some(pid) } => {
                write!(f, "Stopped (stale PID: {})", pid)
            }
            DaemonStatus::Stopped { stale_pid: None } => write!(f, "Stopped"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_daemon_manager_creation() {
        let manager = DaemonManager::new();
        assert!(manager.pid_file.to_string_lossy().contains(".codepanion"));
        assert!(manager.pid_file.to_string_lossy().contains("daemon.pid"));
    }

    #[test]
    fn test_daemon_status_display() {
        let running = DaemonStatus::Running { pid: 12345 };
        assert_eq!(running.to_string(), "Running (PID: 12345)");

        let stopped = DaemonStatus::Stopped { stale_pid: None };
        assert_eq!(stopped.to_string(), "Stopped");

        let stale = DaemonStatus::Stopped {
            stale_pid: Some(99999),
        };
        assert_eq!(stale.to_string(), "Stopped (stale PID: 99999)");
    }

    #[test]
    fn test_is_process_running_self() {
        let manager = DaemonManager::new();
        let self_pid = std::process::id();
        assert!(manager.is_process_running(self_pid));
    }

    #[test]
    fn test_is_process_running_invalid() {
        let manager = DaemonManager::new();
        // 使用一个不太可能存在的 PID
        assert!(!manager.is_process_running(999999));
    }
}
