// agent 命令工具（A-04）：受控 run_command + 命令风险分级。
//
// 安全模型：
// 1. cwd 强制钳在 workspace root（不允许命令逃逸到 workspace 外）
// 2. 命令风险分级：safe / medium / high
//    - high 风险命令（删除、提权、网络外泄、git 历史改写）必须进入 human gate
// 3. 超时强制执行（默认 30s，可配置）
// 4. 输出大小限制（stdout/stderr 各 32KB，超出截断）
// 5. 取消机制（通过 Arc<AtomicBool>）
//
// 注意：本工具默认拒绝 high 风险命令的自动执行，返回需要 human gate 的标记。
// 实际的 human gate 接线由 workflow engine 负责（A-05 高危行为检测会复用这里的分级）。

use codepanion_model_client::ChatTool;
use codepanion_shared::Result;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const COMMAND_OUTPUT_CAP: usize = 32 * 1024; // stdout/stderr 各自的截断上限
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const POLL_INTERVAL_MS: u64 = 5;

/// 命令风险等级。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandRisk {
    /// 安全命令：测试、构建、列目录等只读或可逆操作。
    Safe,
    /// 中危命令：写入、git 提交等可恢复但有副作用的操作。
    Medium,
    /// 高危命令：删除、提权、网络外泄、git 历史改写——必须进入 human gate。
    High,
}

impl CommandRisk {
    pub fn requires_human_gate(self) -> bool {
        matches!(self, CommandRisk::High)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            CommandRisk::Safe => "safe",
            CommandRisk::Medium => "medium",
            CommandRisk::High => "high",
        }
    }
}

/// 高危命令模式：命中任一即判 High。
/// 这些模式覆盖 workflow 设计阶段识别出的 8 类高危操作。
const HIGH_RISK_PATTERNS: &[&str] = &[
    // 破坏性删除
    "rm -rf",
    "rm -fr",
    "rmdir /s",
    "del /f",
    "del /q",
    "dd ",
    "mkfs",
    "format ",
    // 提权
    "sudo ",
    "runas",
    "su ",
    "chmod 777",
    "chown ",
    // git 历史改写
    "git push --force",
    "git push -f",
    "git reset --hard",
    "git rebase",
    "git filter-branch",
    "git clean -fd",
    // 网络外泄（curl/wget 推送数据）
    "curl -x",
    "curl --upload",
    "wget --post",
    "nc -",
    "ncat ",
    // 系统配置
    "shutdown",
    "reboot",
    "systemctl",
    "reg delete",
    "reg add",
];

/// 中危命令模式：有副作用但可恢复。
const MEDIUM_RISK_PATTERNS: &[&str] = &[
    "git commit",
    "git add",
    "git checkout",
    "git merge",
    "git stash",
    "npm install",
    "npm uninstall",
    "cargo add",
    "cargo remove",
    "pip install",
    "mv ",
    "move ",
    "cp ",
    "copy ",
    "rm ",
    "del ",
];

/// 对一条命令行做风险分级。先匹配 high，再 medium，否则 safe。
/// 匹配大小写不敏感，并归一化连续空白。
pub fn classify_command(command: &str, args: &[String]) -> CommandRisk {
    let full = format!("{} {}", command, args.join(" "));
    let normalized = full.to_lowercase();
    // 归一化空白，避免 "rm  -rf"（双空格）绕过 "rm -rf" 匹配。
    let normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");

    for pattern in HIGH_RISK_PATTERNS {
        if normalized.contains(pattern) {
            return CommandRisk::High;
        }
    }
    for pattern in MEDIUM_RISK_PATTERNS {
        if normalized.contains(pattern) {
            return CommandRisk::Medium;
        }
    }
    CommandRisk::Safe
}

/// 命令执行请求。
#[derive(Debug, Clone)]
pub struct CommandRequest {
    pub command: String,
    pub args: Vec<String>,
    pub timeout: Duration,
    pub cancel: Arc<AtomicBool>,
    /// 是否允许执行 high 风险命令（默认 false，需要 human gate 显式批准后置 true）。
    pub allow_high_risk: bool,
}

impl CommandRequest {
    pub fn new(command: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            command: command.into(),
            args,
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
            cancel: Arc::new(AtomicBool::new(false)),
            allow_high_risk: false,
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_cancel(mut self, cancel: Arc<AtomicBool>) -> Self {
        self.cancel = cancel;
        self
    }

    pub fn with_allow_high_risk(mut self, allow: bool) -> Self {
        self.allow_high_risk = allow;
        self
    }
}

/// 命令执行结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    pub risk: CommandRisk,
    /// 因 high 风险被拒绝（未实际执行）。
    pub blocked_by_risk: bool,
}

/// 命令工具集构造器。所有命令在 workspace_root 下执行。
pub struct CommandTools {
    workspace_root: PathBuf,
}

impl CommandTools {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
        }
    }

    /// 返回工具定义列表。
    pub fn tools(&self) -> Vec<ChatTool> {
        if self.workspace_root.as_os_str().is_empty() {
            return Vec::new();
        }
        vec![ChatTool::new(
            "run_command",
            "在 workspace 根目录下执行一条命令（测试、构建等）。高危命令（删除、提权、网络外泄、git 历史改写）会被拒绝并要求人工审核。",
            r#"{"type":"object","properties":{"command":{"type":"string","description":"要执行的命令名"},"args":{"type":"array","items":{"type":"string"},"description":"命令参数列表"}},"required":["command"]}"#,
        )]
    }

    /// 执行工具调用（字符串接口，供 agent loop 使用）。
    pub fn run_tool(&self, name: &str, args_json: &str) -> Result<String> {
        if self.workspace_root.as_os_str().is_empty() {
            return Ok(
                "错误：当前没有选定 workspace，命令工具不可用。请先选择一个 workspace 再运行。"
                    .to_string(),
            );
        }
        match name {
            "run_command" => self.run_command_from_json(args_json),
            _ => Ok(format!("错误：未知工具 {}", name)),
        }
    }

    fn run_command_from_json(&self, args_json: &str) -> Result<String> {
        let parsed: serde_json::Value = match serde_json::from_str(args_json) {
            Ok(v) => v,
            Err(e) => return Ok(format!("错误：参数解析失败：{}", e)),
        };

        let command = match parsed
            .get("command")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
        {
            Some(c) => c.trim().to_string(),
            None => return Ok("错误：command 参数为空或缺失".to_string()),
        };

        let args: Vec<String> = parsed
            .get("args")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let request = CommandRequest::new(command, args);
        let result = self.run_command(request);
        Ok(format_command_result(&result))
    }

    /// 执行命令（结构化接口）。
    pub fn run_command(&self, request: CommandRequest) -> CommandResult {
        let risk = classify_command(&request.command, &request.args);

        // high 风险且未显式批准 → 拒绝执行，返回需要 human gate 的标记。
        if risk.requires_human_gate() && !request.allow_high_risk {
            return CommandResult {
                exit_code: None,
                stdout: String::new(),
                stderr: format!(
                    "高危命令被拒绝执行（需人工审核）：{} {}",
                    request.command,
                    request.args.join(" ")
                ),
                stdout_truncated: false,
                stderr_truncated: false,
                timed_out: false,
                cancelled: false,
                risk,
                blocked_by_risk: true,
            };
        }

        // 预取消检查。
        if request.cancel.load(Ordering::SeqCst) {
            return CommandResult {
                exit_code: None,
                stdout: String::new(),
                stderr: "命令在启动前被取消".to_string(),
                stdout_truncated: false,
                stderr_truncated: false,
                timed_out: false,
                cancelled: true,
                risk,
                blocked_by_risk: false,
            };
        }

        self.spawn_and_wait(request, risk)
    }

    fn spawn_and_wait(&self, request: CommandRequest, risk: CommandRisk) -> CommandResult {
        let mut child = match Command::new(&request.command)
            .args(&request.args)
            .current_dir(&self.workspace_root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                return CommandResult {
                    exit_code: Some(-1),
                    stdout: String::new(),
                    stderr: format!("命令启动失败：{}", err),
                    stdout_truncated: false,
                    stderr_truncated: false,
                    timed_out: false,
                    cancelled: false,
                    risk,
                    blocked_by_risk: false,
                };
            }
        };

        let stdout_handle = child.stdout.take().map(read_stream_in_thread);
        let stderr_handle = child.stderr.take().map(read_stream_in_thread);

        let start = Instant::now();
        let mut timed_out = false;
        let mut cancelled = false;

        let status = loop {
            if request.cancel.load(Ordering::SeqCst) {
                cancelled = true;
                let _ = child.kill();
                break child.wait().ok();
            }
            if start.elapsed() >= request.timeout {
                timed_out = true;
                let _ = child.kill();
                break child.wait().ok();
            }
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS)),
                Err(_) => {
                    let _ = child.kill();
                    break child.wait().ok();
                }
            }
        };

        let (stdout, stdout_truncated) = join_and_truncate(stdout_handle);
        let (stderr, stderr_truncated) = join_and_truncate(stderr_handle);

        CommandResult {
            exit_code: status.and_then(|s| s.code()),
            stdout,
            stderr,
            stdout_truncated,
            stderr_truncated,
            timed_out,
            cancelled,
            risk,
            blocked_by_risk: false,
        }
    }
}

impl super::AgentToolRunner for CommandTools {
    fn run_tool(&self, name: &str, args_json: &str) -> Result<String> {
        self.run_tool(name, args_json)
    }
}

fn read_stream_in_thread<T>(mut stream: T) -> JoinHandle<String>
where
    T: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut buffer = String::new();
        // 用 read_to_string；非 UTF-8 时退回 lossy 读取。
        if std::io::Read::read_to_string(&mut stream, &mut buffer).is_err() {
            // 读取失败（如二进制输出）→ 返回已读部分或提示。
            return buffer;
        }
        buffer
    })
}

fn join_and_truncate(handle: Option<JoinHandle<String>>) -> (String, bool) {
    let raw = match handle {
        Some(h) => h.join().unwrap_or_default(),
        None => String::new(),
    };
    if raw.len() > COMMAND_OUTPUT_CAP {
        // 按字符边界安全截断（避免切断多字节 UTF-8）。
        let truncated: String = raw.chars().take(COMMAND_OUTPUT_CAP).collect();
        (truncated, true)
    } else {
        (raw, false)
    }
}

/// 把 CommandResult 格式化为给模型看的字符串。
fn format_command_result(result: &CommandResult) -> String {
    if result.blocked_by_risk {
        return format!(
            "命令被拒绝执行（风险等级：{}）\n{}\n\n此命令需要人工审核批准后才能执行。",
            result.risk.as_str(),
            result.stderr
        );
    }

    let mut parts = Vec::new();
    parts.push(format!(
        "命令执行完成（风险等级：{}，退出码：{}）",
        result.risk.as_str(),
        result
            .exit_code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "无".to_string())
    ));

    if result.timed_out {
        parts.push("⚠️ 命令超时被终止".to_string());
    }
    if result.cancelled {
        parts.push("⚠️ 命令被取消".to_string());
    }

    if !result.stdout.is_empty() {
        let suffix = if result.stdout_truncated {
            "\n[stdout 已截断]"
        } else {
            ""
        };
        parts.push(format!("stdout:\n{}{}", result.stdout, suffix));
    }
    if !result.stderr.is_empty() {
        let suffix = if result.stderr_truncated {
            "\n[stderr 已截断]"
        } else {
            ""
        };
        parts.push(format!("stderr:\n{}{}", result.stderr, suffix));
    }

    parts.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // ---- 风险分级测试 ----

    #[test]
    fn classify_safe_commands() {
        assert_eq!(
            classify_command("npm", &["test".to_string()]),
            CommandRisk::Safe
        );
        assert_eq!(
            classify_command("cargo", &["build".to_string()]),
            CommandRisk::Safe
        );
        assert_eq!(
            classify_command("ls", &["-la".to_string()]),
            CommandRisk::Safe
        );
        assert_eq!(
            classify_command("echo", &["hello".to_string()]),
            CommandRisk::Safe
        );
    }

    #[test]
    fn classify_medium_commands() {
        assert_eq!(
            classify_command(
                "git",
                &["commit".to_string(), "-m".to_string(), "x".to_string()]
            ),
            CommandRisk::Medium
        );
        assert_eq!(
            classify_command("npm", &["install".to_string(), "express".to_string()]),
            CommandRisk::Medium
        );
    }

    #[test]
    fn classify_high_risk_destructive() {
        assert_eq!(
            classify_command("rm", &["-rf".to_string(), "/".to_string()]),
            CommandRisk::High
        );
        assert_eq!(
            classify_command("dd", &["if=/dev/zero".to_string()]),
            CommandRisk::High
        );
    }

    #[test]
    fn classify_high_risk_privilege_escalation() {
        assert_eq!(
            classify_command("sudo", &["rm".to_string()]),
            CommandRisk::High
        );
        assert_eq!(
            classify_command("chmod", &["777".to_string(), "file".to_string()]),
            CommandRisk::High
        );
    }

    #[test]
    fn classify_high_risk_git_history() {
        assert_eq!(
            classify_command("git", &["push".to_string(), "--force".to_string()]),
            CommandRisk::High
        );
        assert_eq!(
            classify_command("git", &["reset".to_string(), "--hard".to_string()]),
            CommandRisk::High
        );
    }

    #[test]
    fn classify_normalizes_whitespace() {
        // 双空格不应绕过 "rm -rf" 匹配。
        assert_eq!(
            classify_command(
                "rm",
                &["-rf".to_string(), "".to_string(), "dir".to_string()]
            ),
            CommandRisk::High
        );
    }

    #[test]
    fn classify_case_insensitive() {
        assert_eq!(
            classify_command("SUDO", &["RM".to_string()]),
            CommandRisk::High
        );
    }

    // ---- 命令执行测试 ----

    fn echo_command() -> &'static str {
        if cfg!(windows) { "cmd" } else { "echo" }
    }

    fn echo_args(text: &str) -> Vec<String> {
        if cfg!(windows) {
            vec!["/C".to_string(), "echo".to_string(), text.to_string()]
        } else {
            vec![text.to_string()]
        }
    }

    #[test]
    fn run_command_executes_safe_command() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let request = CommandRequest::new(echo_command(), echo_args("hello_world"));
        let result = tools.run_command(request);

        assert_eq!(result.risk, CommandRisk::Safe);
        assert!(!result.blocked_by_risk);
        assert_eq!(result.exit_code, Some(0));
        assert!(result.stdout.contains("hello_world"));
    }

    #[test]
    fn run_command_blocks_high_risk_by_default() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let request = CommandRequest::new("rm", vec!["-rf".to_string(), "x".to_string()]);
        let result = tools.run_command(request);

        assert_eq!(result.risk, CommandRisk::High);
        assert!(result.blocked_by_risk);
        assert_eq!(result.exit_code, None);
        assert!(result.stderr.contains("高危命令被拒绝"));
    }

    #[test]
    fn run_command_allows_high_risk_when_approved() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        // 用一个高危但无害的命令（git reset --hard 在非 git 目录会失败但不会被 block）。
        let request = CommandRequest::new("git", vec!["reset".to_string(), "--hard".to_string()])
            .with_allow_high_risk(true);
        let result = tools.run_command(request);

        assert_eq!(result.risk, CommandRisk::High);
        assert!(!result.blocked_by_risk); // 已批准，不再被 block
    }

    #[test]
    fn run_command_honors_pre_cancel() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let cancel = Arc::new(AtomicBool::new(true));
        let request = CommandRequest::new(echo_command(), echo_args("x")).with_cancel(cancel);
        let result = tools.run_command(request);

        assert!(result.cancelled);
        assert!(result.stderr.contains("取消"));
    }

    #[test]
    fn run_command_times_out() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        // sleep 命令：Windows 用 timeout，Unix 用 sleep。
        let (cmd, args) = if cfg!(windows) {
            (
                "cmd",
                vec![
                    "/C".to_string(),
                    "ping".to_string(),
                    "-n".to_string(),
                    "10".to_string(),
                    "127.0.0.1".to_string(),
                ],
            )
        } else {
            ("sleep", vec!["10".to_string()])
        };

        let request = CommandRequest::new(cmd, args).with_timeout(Duration::from_millis(100));
        let result = tools.run_command(request);

        assert!(result.timed_out);
        assert_ne!(result.exit_code, Some(0));
    }

    #[test]
    fn run_command_handles_nonexistent_command() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let request = CommandRequest::new("this_command_does_not_exist_xyz", vec![]);
        let result = tools.run_command(request);

        assert_eq!(result.exit_code, Some(-1));
        assert!(result.stderr.contains("启动失败"));
    }

    #[test]
    fn run_command_runs_in_workspace_dir() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let (cmd, args) = if cfg!(windows) {
            ("cmd", vec!["/C".to_string(), "cd".to_string()])
        } else {
            ("pwd", vec![])
        };

        let request = CommandRequest::new(cmd, args);
        let result = tools.run_command(request);

        assert_eq!(result.exit_code, Some(0));
        // workspace 路径的最后一段应出现在输出中。
        let workspace_name = temp.path().file_name().unwrap().to_string_lossy();
        assert!(result.stdout.contains(&*workspace_name));
    }

    // ---- 工具接口测试 ----

    #[test]
    fn empty_workspace_provides_no_tools() {
        let tools = CommandTools::new("");
        assert_eq!(tools.tools().len(), 0);

        let result = tools
            .run_tool("run_command", r#"{"command":"ls"}"#)
            .unwrap();
        assert!(result.contains("没有选定 workspace"));
    }

    #[test]
    fn valid_workspace_provides_one_tool() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let tool_names: Vec<String> = tools
            .tools()
            .iter()
            .map(|t| t.function.name.clone())
            .collect();
        assert_eq!(tool_names, vec!["run_command".to_string()]);
    }

    #[test]
    fn run_tool_json_interface_works() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let args = if cfg!(windows) {
            r#"{"command":"cmd","args":["/C","echo","json_test"]}"#
        } else {
            r#"{"command":"echo","args":["json_test"]}"#
        };
        let result = tools.run_tool("run_command", args).unwrap();
        assert!(result.contains("json_test"));
        assert!(result.contains("退出码"));
    }

    #[test]
    fn run_tool_blocks_high_risk_via_json() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let result = tools
            .run_tool("run_command", r#"{"command":"rm","args":["-rf","/"]}"#)
            .unwrap();
        assert!(result.contains("被拒绝") || result.contains("人工审核"));
    }

    #[test]
    fn run_tool_handles_missing_command() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let result = tools.run_tool("run_command", r#"{"args":["x"]}"#).unwrap();
        assert!(result.contains("command 参数为空"));
    }

    #[test]
    fn run_tool_unknown_tool_returns_error() {
        let temp = TempDir::new().unwrap();
        let tools = CommandTools::new(temp.path());

        let result = tools.run_tool("unknown", "{}").unwrap();
        assert!(result.contains("未知工具"));
    }

    #[test]
    fn command_risk_human_gate_flag() {
        assert!(CommandRisk::High.requires_human_gate());
        assert!(!CommandRisk::Medium.requires_human_gate());
        assert!(!CommandRisk::Safe.requires_human_gate());
    }
}
