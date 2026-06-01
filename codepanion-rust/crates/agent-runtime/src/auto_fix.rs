// A-06: 自动修复循环
//
// 实现测试驱动的自动修复循环：
// 1. 运行测试
// 2. 如果失败 → 诊断错误
// 3. 生成修复方案
// 4. 应用修复
// 5. 重跑测试
// 6. 超过重试上限 → 进入 human gate
//
// 这是一个高层编排模块，复用 agent loop、command tools 和 risk detector。

use crate::{CommandRequest, CommandTools};
use codepanion_shared::{CodePanionError, Result};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

/// 自动修复循环配置
#[derive(Debug, Clone)]
pub struct AutoFixConfig {
    /// 最大重试次数（默认 3）
    pub max_retries: usize,
    /// 测试命令（例如 "cargo test"）
    pub test_command: String,
    /// 测试命令参数
    pub test_args: Vec<String>,
    /// workspace 根目录
    pub workspace_root: String,
    /// 取消信号
    pub cancel: Arc<AtomicBool>,
}

impl AutoFixConfig {
    pub fn new(test_command: impl Into<String>, workspace_root: impl Into<String>) -> Self {
        Self {
            max_retries: 3,
            test_command: test_command.into(),
            test_args: Vec::new(),
            workspace_root: workspace_root.into(),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn with_args(mut self, args: Vec<String>) -> Self {
        self.test_args = args;
        self
    }

    pub fn with_max_retries(mut self, max_retries: usize) -> Self {
        self.max_retries = max_retries;
        self
    }

    pub fn with_cancel(mut self, cancel: Arc<AtomicBool>) -> Self {
        self.cancel = cancel;
        self
    }
}

/// 自动修复循环结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoFixResult {
    /// 是否修复成功（测试通过）
    pub success: bool,
    /// 尝试次数
    pub attempts: usize,
    /// 是否达到最大重试次数
    pub hit_max_retries: bool,
    /// 最终测试输出
    pub final_test_output: String,
    /// 修复历史
    pub fix_history: Vec<FixAttempt>,
}

/// 单次修复尝试
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixAttempt {
    /// 尝试编号（从 1 开始）
    pub attempt: usize,
    /// 测试失败输出
    pub test_failure: String,
    /// 诊断结果
    pub diagnosis: String,
    /// 修复方案
    pub fix_plan: String,
    /// 修复后测试是否通过
    pub test_passed: bool,
}

/// 自动修复循环事件
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AutoFixEvent {
    /// 开始运行测试
    TestRunning { attempt: usize },
    /// 测试通过
    TestPassed { attempt: usize, output: String },
    /// 测试失败
    TestFailed { attempt: usize, output: String },
    /// 开始诊断
    Diagnosing { attempt: usize },
    /// 诊断完成
    DiagnosisComplete { attempt: usize, diagnosis: String },
    /// 开始修复
    Fixing { attempt: usize },
    /// 修复完成
    FixComplete { attempt: usize, fix_plan: String },
    /// 达到最大重试次数
    MaxRetriesReached { attempts: usize },
    /// 需要人工介入
    HumanGateRequired { reason: String },
}

const DEFAULT_MAX_RETRIES: usize = 3;

/// 运行自动修复循环
///
/// 这是一个高层编排函数，不直接实现 agent 逻辑。
/// 实际使用时需要传入：
/// - tool_runner: 执行文件读写、命令等工具
/// - agent_runner: 执行诊断和生成修复方案的 agent
///
/// 当前实现为框架代码，展示循环结构和事件流。
pub fn run_auto_fix_loop<F>(config: AutoFixConfig, mut on_event: F) -> Result<AutoFixResult>
where
    F: FnMut(AutoFixEvent),
{
    let max_retries = if config.max_retries > 0 {
        config.max_retries
    } else {
        DEFAULT_MAX_RETRIES
    };

    let mut fix_history = Vec::new();
    let command_tools = CommandTools::new(&config.workspace_root);

    for attempt in 1..=max_retries {
        if config.cancel.load(Ordering::SeqCst) {
            return Err(CodePanionError::Runtime(
                "auto-fix loop cancelled".to_string(),
            ));
        }

        // 1. 运行测试
        on_event(AutoFixEvent::TestRunning { attempt });

        let test_result = command_tools.run_command(CommandRequest {
            command: config.test_command.clone(),
            args: config.test_args.clone(),
            timeout: Duration::from_secs(120), // 测试超时 2 分钟
            cancel: config.cancel.clone(),
            allow_high_risk: false,
        });

        // 检查是否被风险阻止
        if test_result.blocked_by_risk {
            on_event(AutoFixEvent::HumanGateRequired {
                reason: "测试命令被标记为高危操作".to_string(),
            });
            return Err(CodePanionError::Runtime(
                "测试命令需要 human gate 批准".to_string(),
            ));
        }

        // 2. 检查测试结果
        if test_result.exit_code == Some(0) {
            on_event(AutoFixEvent::TestPassed {
                attempt,
                output: test_result.stdout.clone(),
            });

            return Ok(AutoFixResult {
                success: true,
                attempts: attempt,
                hit_max_retries: false,
                final_test_output: test_result.stdout,
                fix_history,
            });
        }

        // 测试失败
        let exit_code_str = test_result
            .exit_code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let test_failure = format!(
            "exit code: {}\nstdout:\n{}\nstderr:\n{}",
            exit_code_str, test_result.stdout, test_result.stderr
        );

        on_event(AutoFixEvent::TestFailed {
            attempt,
            output: test_failure.clone(),
        });

        // 3. 诊断（当前为占位实现）
        on_event(AutoFixEvent::Diagnosing { attempt });

        let diagnosis = diagnose_test_failure(&test_failure);

        on_event(AutoFixEvent::DiagnosisComplete {
            attempt,
            diagnosis: diagnosis.clone(),
        });

        // 4. 生成修复方案（当前为占位实现）
        on_event(AutoFixEvent::Fixing { attempt });

        let fix_plan = generate_fix_plan(&diagnosis);

        on_event(AutoFixEvent::FixComplete {
            attempt,
            fix_plan: fix_plan.clone(),
        });

        // 记录本次尝试
        fix_history.push(FixAttempt {
            attempt,
            test_failure,
            diagnosis,
            fix_plan,
            test_passed: false,
        });

        // 注意：实际的修复应用需要 agent + tool runner
        // 当前实现仅展示循环结构
    }

    // 达到最大重试次数
    on_event(AutoFixEvent::MaxRetriesReached {
        attempts: max_retries,
    });

    on_event(AutoFixEvent::HumanGateRequired {
        reason: format!("测试在 {} 次尝试后仍然失败，需要人工介入", max_retries),
    });

    Ok(AutoFixResult {
        success: false,
        attempts: max_retries,
        hit_max_retries: true,
        final_test_output: fix_history
            .last()
            .map(|a| a.test_failure.clone())
            .unwrap_or_default(),
        fix_history,
    })
}

/// 诊断测试失败原因（占位实现）
///
/// 实际使用时应该调用 agent 来分析测试输出。
fn diagnose_test_failure(test_output: &str) -> String {
    // 简单的模式匹配诊断
    if test_output.contains("compilation failed") || test_output.contains("error[E") {
        "编译错误：代码无法编译".to_string()
    } else if test_output.contains("assertion") || test_output.contains("panicked at") {
        "断言失败：测试逻辑错误".to_string()
    } else if test_output.contains("timeout") || test_output.contains("timed out") {
        "超时：测试运行时间过长".to_string()
    } else {
        "未知错误：需要进一步分析".to_string()
    }
}

/// 生成修复方案（占位实现）
///
/// 实际使用时应该调用 agent 来生成具体的修复代码。
fn generate_fix_plan(diagnosis: &str) -> String {
    format!("根据诊断结果生成修复方案：{}", diagnosis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_fix_config_builder() {
        let config = AutoFixConfig::new("cargo test", "/workspace")
            .with_args(vec!["--lib".to_string()])
            .with_max_retries(5);

        assert_eq!(config.test_command, "cargo test");
        assert_eq!(config.test_args, vec!["--lib"]);
        assert_eq!(config.max_retries, 5);
        assert_eq!(config.workspace_root, "/workspace");
    }

    #[test]
    fn auto_fix_result_structure() {
        let result = AutoFixResult {
            success: false,
            attempts: 3,
            hit_max_retries: true,
            final_test_output: "test failed".to_string(),
            fix_history: vec![FixAttempt {
                attempt: 1,
                test_failure: "assertion failed".to_string(),
                diagnosis: "logic error".to_string(),
                fix_plan: "fix the assertion".to_string(),
                test_passed: false,
            }],
        };

        assert!(!result.success);
        assert_eq!(result.attempts, 3);
        assert!(result.hit_max_retries);
        assert_eq!(result.fix_history.len(), 1);
    }

    #[test]
    fn auto_fix_event_types() {
        let events = [
            AutoFixEvent::TestRunning { attempt: 1 },
            AutoFixEvent::TestFailed {
                attempt: 1,
                output: "failed".to_string(),
            },
            AutoFixEvent::Diagnosing { attempt: 1 },
            AutoFixEvent::DiagnosisComplete {
                attempt: 1,
                diagnosis: "error found".to_string(),
            },
            AutoFixEvent::Fixing { attempt: 1 },
            AutoFixEvent::FixComplete {
                attempt: 1,
                fix_plan: "apply fix".to_string(),
            },
            AutoFixEvent::MaxRetriesReached { attempts: 3 },
            AutoFixEvent::HumanGateRequired {
                reason: "need help".to_string(),
            },
        ];

        assert_eq!(events.len(), 8);
    }

    #[test]
    fn diagnose_compilation_error() {
        let output = "error[E0425]: cannot find value `x` in this scope";
        let diagnosis = diagnose_test_failure(output);
        assert!(diagnosis.contains("编译错误"));
    }

    #[test]
    fn diagnose_assertion_failure() {
        let output = "thread 'main' panicked at 'assertion failed: x == y'";
        let diagnosis = diagnose_test_failure(output);
        assert!(diagnosis.contains("断言失败"));
    }

    #[test]
    fn diagnose_timeout() {
        let output = "test timed out after 30 seconds";
        let diagnosis = diagnose_test_failure(output);
        assert!(diagnosis.contains("超时"));
    }

    #[test]
    fn generate_fix_plan_from_diagnosis() {
        let diagnosis = "编译错误：变量未定义";
        let plan = generate_fix_plan(diagnosis);
        assert!(plan.contains("编译错误"));
        assert!(plan.contains("变量未定义"));
    }
}
