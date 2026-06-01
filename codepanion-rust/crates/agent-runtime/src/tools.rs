use codepanion_model_client::ChatTool;
use codepanion_shared::{CodePanionError, Result};
use std::fs;
use std::path::{Path, PathBuf};

const READ_FILE_CAP: usize = 64 * 1024; // 单文件回填上限，超出截断并标注
const LIST_DIR_CAP: usize = 500; // 单目录列出条目上限
const WRITE_FILE_CAP: usize = 256 * 1024; // 单文件写入上限

/// 通用：保证 input 解析后落在 anchor 下，让路径注入检测工具看得到 containment。
///
/// 刻意保持「纯词法」（不 canonicalize）：
/// 1) 词法 relative + throw 是路径注入检测工具识别的 sanitizer
/// 2) canonicalize 会踩 Windows 短名(8.3)/长名差异
///
/// workspace 内「指向外部的 symlink」属于二级加固（P2），暂不在此处理。
pub fn ensure_path_inside(input: &Path, anchor: &Path, label: &str) -> Result<PathBuf> {
    // 先检查 input 中是否包含 .. 组件
    for component in input.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(CodePanionError::Runtime(format!(
                "{} must resolve inside {}",
                label,
                anchor.display()
            )));
        }
    }

    // 解析为绝对路径
    let resolved = if input.is_absolute() {
        input.to_path_buf()
    } else {
        anchor.join(input)
    };

    let resolved_anchor = if anchor.is_absolute() {
        anchor.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| CodePanionError::Runtime(format!("failed to get current dir: {}", e)))?
            .join(anchor)
    };

    // 词法检查：resolved 必须以 resolved_anchor 为前缀
    // 使用规范化的路径字符串比较
    let resolved_normalized = resolved.to_string_lossy().replace('\\', "/").to_lowercase();
    let anchor_normalized = resolved_anchor
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();
    // 去掉 anchor 末尾的 '/'，统一边界比较语义。
    let anchor_trimmed = anchor_normalized.trim_end_matches('/');

    // 防前缀误判：anchor=/home/user/proj 不能匹配 /home/user/proj-evil。
    // 合法前提是 resolved 完全等于 anchor，或 resolved 在 anchor 后紧跟一个 '/'。
    let inside = resolved_normalized == anchor_trimmed
        || resolved_normalized.starts_with(&format!("{anchor_trimmed}/"));
    if !inside {
        return Err(CodePanionError::Runtime(format!(
            "{} must resolve inside {}",
            label,
            anchor.display()
        )));
    }

    Ok(resolved)
}

/// 只读工具集构造器
pub struct ReadonlyTools {
    workspace_root: PathBuf,
}

impl ReadonlyTools {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
        }
    }

    /// 返回工具定义列表
    pub fn tools(&self) -> Vec<ChatTool> {
        if self.workspace_root.as_os_str().is_empty() {
            return Vec::new();
        }

        vec![
            ChatTool::new(
                "read_file",
                "读取 workspace 内某个文件的文本内容（相对 workspace 根的路径）。",
                r#"{"type":"object","properties":{"path":{"type":"string","description":"相对 workspace 根的文件路径"}},"required":["path"]}"#,
            ),
            ChatTool::new(
                "list_dir",
                "列出 workspace 内某个目录的条目（相对 workspace 根的路径，默认根目录）。",
                r#"{"type":"object","properties":{"path":{"type":"string","description":"相对 workspace 根的目录路径，默认当前目录"}}}"#,
            ),
        ]
    }

    /// 执行工具调用
    pub fn run_tool(&self, name: &str, args_json: &str) -> Result<String> {
        if self.workspace_root.as_os_str().is_empty() {
            return Ok(
                "错误：当前没有选定 workspace，文件工具不可用。请先选择一个 workspace 再运行。"
                    .to_string(),
            );
        }

        match name {
            "read_file" => self.read_file(args_json),
            "list_dir" => self.list_dir(args_json),
            _ => Ok(format!("错误：未知工具 {}", name)),
        }
    }

    fn parse_path_arg(&self, args_json: &str, fallback: &str) -> String {
        let parsed: serde_json::Value =
            serde_json::from_str(args_json).unwrap_or(serde_json::json!({}));
        parsed
            .get("path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(fallback)
            .trim()
            .to_string()
    }

    fn safe_resolve(&self, rel: &str) -> Result<PathBuf> {
        let joined = self.workspace_root.join(rel);
        ensure_path_inside(&joined, &self.workspace_root, "agent tool path")
    }

    fn read_file(&self, args_json: &str) -> Result<String> {
        let rel = self.parse_path_arg(args_json, "");
        if rel.is_empty() {
            return Ok("错误：path 参数为空".to_string());
        }

        let abs = match self.safe_resolve(&rel) {
            Ok(p) => p,
            Err(_) => return Ok(format!("错误：路径越界，拒绝访问 workspace 之外：{}", rel)),
        };

        if !abs.exists() {
            return Ok(format!("错误：文件不存在：{}", rel));
        }

        if abs.is_dir() {
            return Ok(format!("错误：{} 是目录，请用 list_dir", rel));
        }

        match fs::read_to_string(&abs) {
            Ok(content) => {
                if content.len() > READ_FILE_CAP {
                    Ok(format!(
                        "{}\n\n[内容已截断：超过 {} 字节]",
                        &content[..READ_FILE_CAP],
                        READ_FILE_CAP
                    ))
                } else {
                    Ok(content)
                }
            }
            Err(err) => Ok(format!("错误：读取失败：{}", err)),
        }
    }

    fn list_dir(&self, args_json: &str) -> Result<String> {
        let rel = self.parse_path_arg(args_json, ".");

        let abs = match self.safe_resolve(&rel) {
            Ok(p) => p,
            Err(_) => return Ok(format!("错误：路径越界，拒绝访问 workspace 之外：{}", rel)),
        };

        if !abs.exists() {
            return Ok(format!("错误：目录不存在：{}", rel));
        }

        if !abs.is_dir() {
            return Ok(format!("错误：{} 不是目录，请用 read_file", rel));
        }

        match fs::read_dir(&abs) {
            Ok(entries) => {
                let mut lines = Vec::new();
                let mut count = 0;
                let mut total = 0;

                for entry in entries {
                    total += 1;
                    if count >= LIST_DIR_CAP {
                        continue;
                    }

                    if let Ok(entry) = entry {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
                        lines.push(format!("{} {}", if is_dir { "dir " } else { "file" }, name));
                        count += 1;
                    }
                }

                if total > LIST_DIR_CAP {
                    lines.push(format!("... [还有 {} 条未列出]", total - LIST_DIR_CAP));
                }

                if lines.is_empty() {
                    Ok("（空目录）".to_string())
                } else {
                    Ok(lines.join("\n"))
                }
            }
            Err(err) => Ok(format!("错误：列目录失败：{}", err)),
        }
    }
}

impl super::AgentToolRunner for ReadonlyTools {
    fn run_tool(&self, name: &str, args_json: &str) -> Result<String> {
        self.run_tool(name, args_json)
    }
}

/// 写入工具集构造器
pub struct WriteTools {
    workspace_root: PathBuf,
}

impl WriteTools {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
        }
    }

    /// 返回工具定义列表
    pub fn tools(&self) -> Vec<ChatTool> {
        if self.workspace_root.as_os_str().is_empty() {
            return Vec::new();
        }

        vec![
            ChatTool::new(
                "write_file",
                "写入或覆盖 workspace 内某个文件的完整内容。",
                r#"{"type":"object","properties":{"path":{"type":"string","description":"相对 workspace 根的文件路径"},"content":{"type":"string","description":"文件的完整内容"}},"required":["path","content"]}"#,
            ),
            ChatTool::new(
                "create_file",
                "创建 workspace 内的新文件（如果文件已存在则失败）。",
                r#"{"type":"object","properties":{"path":{"type":"string","description":"相对 workspace 根的文件路径"},"content":{"type":"string","description":"文件的初始内容"}},"required":["path","content"]}"#,
            ),
        ]
    }

    /// 执行工具调用
    pub fn run_tool(&self, name: &str, args_json: &str) -> Result<String> {
        if self.workspace_root.as_os_str().is_empty() {
            return Ok(
                "错误：当前没有选定 workspace，文件工具不可用。请先选择一个 workspace 再运行。"
                    .to_string(),
            );
        }

        match name {
            "write_file" => self.write_file(args_json),
            "create_file" => self.create_file(args_json),
            _ => Ok(format!("错误：未知工具 {}", name)),
        }
    }

    fn parse_write_args(&self, args_json: &str) -> Result<(String, String)> {
        let parsed: serde_json::Value = serde_json::from_str(args_json)
            .map_err(|e| CodePanionError::InvalidInput(format!("参数解析失败: {}", e)))?;

        let path = parsed
            .get("path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| CodePanionError::InvalidInput("path 参数为空或缺失".to_string()))?
            .trim()
            .to_string();

        let content = parsed
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CodePanionError::InvalidInput("content 参数缺失".to_string()))?
            .to_string();

        Ok((path, content))
    }

    fn safe_resolve(&self, rel: &str) -> Result<PathBuf> {
        let joined = self.workspace_root.join(rel);
        ensure_path_inside(&joined, &self.workspace_root, "agent tool path")
    }

    fn write_file(&self, args_json: &str) -> Result<String> {
        let (rel, content) = match self.parse_write_args(args_json) {
            Ok(args) => args,
            Err(e) => return Ok(format!("错误：{}", e)),
        };

        if content.len() > WRITE_FILE_CAP {
            return Ok(format!(
                "错误：内容超过 {} 字节限制（实际 {} 字节）",
                WRITE_FILE_CAP,
                content.len()
            ));
        }

        let abs = match self.safe_resolve(&rel) {
            Ok(p) => p,
            Err(_) => return Ok(format!("错误：路径越界，拒绝访问 workspace 之外：{}", rel)),
        };

        // 读取旧内容（如果存在）用于生成 patch summary
        let old_content = if abs.exists() && abs.is_file() {
            fs::read_to_string(&abs).ok()
        } else {
            None
        };

        // 确保父目录存在
        if let Some(parent) = abs.parent()
            && let Err(err) = fs::create_dir_all(parent)
        {
            return Ok(format!("错误：创建父目录失败：{}", err));
        }

        // 写入文件
        match fs::write(&abs, &content) {
            Ok(_) => {
                let summary = generate_patch_summary(&rel, old_content.as_deref(), &content);
                Ok(format!("成功写入文件：{}\n\n{}", rel, summary))
            }
            Err(err) => Ok(format!("错误：写入失败：{}", err)),
        }
    }

    fn create_file(&self, args_json: &str) -> Result<String> {
        let (rel, content) = match self.parse_write_args(args_json) {
            Ok(args) => args,
            Err(e) => return Ok(format!("错误：{}", e)),
        };

        if content.len() > WRITE_FILE_CAP {
            return Ok(format!(
                "错误：内容超过 {} 字节限制（实际 {} 字节）",
                WRITE_FILE_CAP,
                content.len()
            ));
        }

        let abs = match self.safe_resolve(&rel) {
            Ok(p) => p,
            Err(_) => return Ok(format!("错误：路径越界，拒绝访问 workspace 之外：{}", rel)),
        };

        if abs.exists() {
            return Ok(format!("错误：文件已存在：{}（使用 write_file 覆盖）", rel));
        }

        // 确保父目录存在
        if let Some(parent) = abs.parent()
            && let Err(err) = fs::create_dir_all(parent)
        {
            return Ok(format!("错误：创建父目录失败：{}", err));
        }

        // 创建文件
        match fs::write(&abs, &content) {
            Ok(_) => {
                let lines = content.lines().count();
                Ok(format!(
                    "成功创建文件：{}\n\nPatch Summary:\n+ 新建文件（{} 行，{} 字节）",
                    rel,
                    lines,
                    content.len()
                ))
            }
            Err(err) => Ok(format!("错误：创建失败：{}", err)),
        }
    }
}

impl super::AgentToolRunner for WriteTools {
    fn run_tool(&self, name: &str, args_json: &str) -> Result<String> {
        self.run_tool(name, args_json)
    }
}

/// 生成 patch summary
fn generate_patch_summary(path: &str, old_content: Option<&str>, new_content: &str) -> String {
    match old_content {
        None => {
            let lines = new_content.lines().count();
            format!(
                "Patch Summary:\n+ 新建文件（{} 行，{} 字节）",
                lines,
                new_content.len()
            )
        }
        Some(old) => {
            let old_lines = old.lines().count();
            let new_lines = new_content.lines().count();
            let old_bytes = old.len();
            let new_bytes = new_content.len();

            let diff = if new_lines > old_lines {
                format!("+{} 行", new_lines - old_lines)
            } else if new_lines < old_lines {
                format!("-{} 行", old_lines - new_lines)
            } else {
                "行数不变".to_string()
            };

            format!(
                "Patch Summary:\n~ 修改文件 {} ({} 行 → {} 行 [{}]，{} 字节 → {} 字节)",
                path, old_lines, new_lines, diff, old_bytes, new_bytes
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir, write};
    use tempfile::TempDir;

    #[test]
    fn ensure_path_inside_accepts_valid_paths() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        let valid = root.join("roles").join("planner.md");
        let result = ensure_path_inside(&valid, root, "test");
        assert!(result.is_ok());
    }

    #[test]
    fn ensure_path_inside_rejects_parent_dir() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        let invalid = root.join("..").join("secret");
        let result = ensure_path_inside(&invalid, root, "test");
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("must resolve inside")
        );
    }

    #[test]
    fn ensure_path_inside_rejects_sibling_prefix() {
        // 防前缀误判：anchor=/.../proj 不能匹配 /.../proj-evil（绝对路径输入）。
        let temp = TempDir::new().unwrap();
        let anchor = temp.path().join("proj");
        std::fs::create_dir(&anchor).unwrap();
        let sibling = temp.path().join("proj-evil").join("secret.txt");

        let result = ensure_path_inside(&sibling, &anchor, "test");
        assert!(
            result.is_err(),
            "sibling dir sharing a name prefix must be rejected"
        );
    }

    #[test]
    fn ensure_path_inside_accepts_anchor_itself() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let result = ensure_path_inside(root, root, "test");
        assert!(result.is_ok(), "anchor path itself must be allowed");
    }

    #[test]
    fn read_file_returns_content() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root.join("hello.txt"), "HELLO_CONTENT").unwrap();

        let tools = ReadonlyTools::new(root);
        let result = tools
            .run_tool("read_file", r#"{"path":"hello.txt"}"#)
            .unwrap();
        assert_eq!(result, "HELLO_CONTENT");
    }

    #[test]
    fn read_file_rejects_out_of_bounds() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        let tools = ReadonlyTools::new(root);
        let result = tools
            .run_tool("read_file", r#"{"path":"../../etc/passwd"}"#)
            .unwrap();
        assert!(result.contains("越界") || result.contains("拒绝"));
    }

    #[test]
    fn read_file_handles_missing_file() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();

        let tools = ReadonlyTools::new(root);
        let result = tools
            .run_tool("read_file", r#"{"path":"nope.txt"}"#)
            .unwrap();
        assert!(result.contains("不存在"));
    }

    #[test]
    fn read_file_rejects_directory() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        create_dir(root.join("src")).unwrap();

        let tools = ReadonlyTools::new(root);
        let result = tools.run_tool("read_file", r#"{"path":"src"}"#).unwrap();
        assert!(result.contains("是目录"));
    }

    #[test]
    fn list_dir_shows_entries() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root.join("hello.txt"), "content").unwrap();
        create_dir(root.join("src")).unwrap();

        let tools = ReadonlyTools::new(root);
        let result = tools.run_tool("list_dir", r#"{"path":"."}"#).unwrap();
        assert!(result.contains("file hello.txt"));
        assert!(result.contains("dir  src"));
    }

    #[test]
    fn list_dir_rejects_file() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root.join("hello.txt"), "content").unwrap();

        let tools = ReadonlyTools::new(root);
        let result = tools
            .run_tool("list_dir", r#"{"path":"hello.txt"}"#)
            .unwrap();
        assert!(result.contains("不是目录"));
    }

    #[test]
    fn empty_workspace_provides_no_tools() {
        let tools = ReadonlyTools::new("");
        assert_eq!(tools.tools().len(), 0);

        let result = tools.run_tool("read_file", r#"{"path":"x"}"#).unwrap();
        assert!(result.contains("没有选定 workspace"));
    }

    #[test]
    fn valid_workspace_provides_two_tools() {
        let temp = TempDir::new().unwrap();
        let tools = ReadonlyTools::new(temp.path());

        let tool_names: Vec<String> = tools
            .tools()
            .iter()
            .map(|t| t.function.name.clone())
            .collect();
        assert_eq!(tool_names.len(), 2);
        assert!(tool_names.contains(&"read_file".to_string()));
        assert!(tool_names.contains(&"list_dir".to_string()));
    }

    #[test]
    fn unknown_tool_returns_error() {
        let temp = TempDir::new().unwrap();
        let tools = ReadonlyTools::new(temp.path());

        let result = tools.run_tool("unknown_tool", "{}").unwrap();
        assert!(result.contains("未知工具"));
    }

    // WriteTools tests
    #[test]
    fn write_file_creates_new_file() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let tools = WriteTools::new(root);

        let result = tools
            .run_tool(
                "write_file",
                r#"{"path":"test.txt","content":"hello world"}"#,
            )
            .unwrap();
        assert!(result.contains("成功写入"));
        assert!(result.contains("Patch Summary"));
        assert!(result.contains("新建文件"));

        let content = fs::read_to_string(root.join("test.txt")).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn write_file_overwrites_existing() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root.join("test.txt"), "old content").unwrap();

        let tools = WriteTools::new(root);
        let result = tools
            .run_tool(
                "write_file",
                r#"{"path":"test.txt","content":"new content"}"#,
            )
            .unwrap();
        assert!(result.contains("成功写入"));
        assert!(result.contains("修改文件"));

        let content = fs::read_to_string(root.join("test.txt")).unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn write_file_creates_parent_dirs() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let tools = WriteTools::new(root);

        let result = tools
            .run_tool(
                "write_file",
                r#"{"path":"src/lib.rs","content":"pub fn main() {}"}"#,
            )
            .unwrap();
        assert!(result.contains("成功写入"));

        assert!(root.join("src").is_dir());
        assert!(root.join("src/lib.rs").is_file());
    }

    #[test]
    fn write_file_rejects_out_of_bounds() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let tools = WriteTools::new(root);

        let result = tools
            .run_tool(
                "write_file",
                r#"{"path":"../../etc/passwd","content":"hacked"}"#,
            )
            .unwrap();
        assert!(result.contains("越界") || result.contains("拒绝"));
    }

    #[test]
    fn write_file_rejects_oversized_content() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let tools = WriteTools::new(root);

        let large_content = "x".repeat(WRITE_FILE_CAP + 1);
        let args = format!(r#"{{"path":"large.txt","content":"{}"}}"#, large_content);
        let result = tools.run_tool("write_file", &args).unwrap();
        assert!(result.contains("超过") && result.contains("字节限制"));
    }

    #[test]
    fn create_file_creates_new_file() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        let tools = WriteTools::new(root);

        let result = tools
            .run_tool("create_file", r#"{"path":"new.txt","content":"fresh"}"#)
            .unwrap();
        assert!(result.contains("成功创建"));
        assert!(result.contains("新建文件"));

        let content = fs::read_to_string(root.join("new.txt")).unwrap();
        assert_eq!(content, "fresh");
    }

    #[test]
    fn create_file_rejects_existing_file() {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        write(root.join("exists.txt"), "already here").unwrap();

        let tools = WriteTools::new(root);
        let result = tools
            .run_tool("create_file", r#"{"path":"exists.txt","content":"new"}"#)
            .unwrap();
        assert!(result.contains("已存在"));

        // 确保原文件未被修改
        let content = fs::read_to_string(root.join("exists.txt")).unwrap();
        assert_eq!(content, "already here");
    }

    #[test]
    fn write_tools_empty_workspace_provides_no_tools() {
        let tools = WriteTools::new("");
        assert_eq!(tools.tools().len(), 0);

        let result = tools
            .run_tool("write_file", r#"{"path":"x","content":"y"}"#)
            .unwrap();
        assert!(result.contains("没有选定 workspace"));
    }

    #[test]
    fn write_tools_valid_workspace_provides_two_tools() {
        let temp = TempDir::new().unwrap();
        let tools = WriteTools::new(temp.path());

        let tool_names: Vec<String> = tools
            .tools()
            .iter()
            .map(|t| t.function.name.clone())
            .collect();
        assert_eq!(tool_names.len(), 2);
        assert!(tool_names.contains(&"write_file".to_string()));
        assert!(tool_names.contains(&"create_file".to_string()));
    }

    #[test]
    fn write_tools_unknown_tool_returns_error() {
        let temp = TempDir::new().unwrap();
        let tools = WriteTools::new(temp.path());

        let result = tools.run_tool("unknown_tool", "{}").unwrap();
        assert!(result.contains("未知工具"));
    }

    #[test]
    fn patch_summary_for_new_file() {
        let summary = generate_patch_summary("test.txt", None, "line1\nline2\n");
        assert!(summary.contains("新建文件"));
        assert!(summary.contains("2 行"));
    }

    #[test]
    fn patch_summary_for_modified_file() {
        let old = "line1\nline2\n";
        let new = "line1\nline2\nline3\n";
        let summary = generate_patch_summary("test.txt", Some(old), new);
        assert!(summary.contains("修改文件"));
        assert!(summary.contains("2 行 → 3 行"));
    }
}
