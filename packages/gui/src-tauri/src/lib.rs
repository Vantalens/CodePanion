use serde::Serialize;
use std::{
    env,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{Manager, State};

const DEFAULT_DAEMON_PORT: u16 = 8318;

struct DaemonState {
    child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DaemonConfig {
    url: String,
    ws_url: String,
    token: String,
    port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DaemonStatus {
    started: bool,
    managed: bool,
    url: String,
}

#[tauri::command]
fn get_daemon_config() -> DaemonConfig {
    daemon_config()
}

#[tauri::command]
fn ensure_daemon(
    state: State<'_, DaemonState>,
    app: tauri::AppHandle,
) -> Result<DaemonStatus, String> {
    let config = daemon_config();
    if is_daemon_healthy(config.port) {
        return Ok(DaemonStatus {
            started: true,
            managed: false,
            url: config.url,
        });
    }

    let daemon_path = find_daemon_binary(&app).ok_or_else(|| {
        "Rust daemon binary not found. Build codepanion-daemon or set CODEPANION_DAEMON_PATH."
            .to_string()
    })?;

    let working_dir = daemon_path
        .parent()
        .ok_or_else(|| "daemon binary path has no parent directory".to_string())?;

    let child = Command::new(&daemon_path)
        .arg("--serve")
        .arg(config.port.to_string())
        .current_dir(working_dir)
        .env("CODEPANION_STARTED_BY_GUI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("failed to start Rust daemon: {err}"))?;

    *state.child.lock().map_err(|_| "daemon state poisoned")? = Some(child);

    for attempt in 0..40 {
        std::thread::sleep(Duration::from_millis(250));

        // Check if child process exited early
        if let Ok(mut guard) = state.child.lock() {
            if let Some(ref mut child) = *guard {
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(format!(
                        "Rust daemon exited early with status: {}",
                        status.code().map(|c| c.to_string()).unwrap_or_else(|| "unknown".to_string())
                    ));
                }
            }
        }

        if is_daemon_healthy(config.port) {
            return Ok(DaemonStatus {
                started: true,
                managed: true,
                url: config.url,
            });
        }

        // Give more detailed error after several attempts
        if attempt == 20 {
            eprintln!("Daemon health check still failing after 5 seconds...");
        }
    }

    Err("Rust daemon started but did not pass health check in time.".to_string())
}

#[tauri::command]
fn stop_daemon(state: State<'_, DaemonState>) -> Result<(), String> {
    if let Some(mut child) = state
        .child
        .lock()
        .map_err(|_| "daemon state poisoned")?
        .take()
    {
        let _ = child.kill();
        // Wait with timeout to prevent hang if process is unresponsive
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            match child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }
        // Force kill if still alive after timeout
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            let _ = Command::new("kill")
                .args(["-9", &child.id().to_string()])
                .spawn();
        }
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/PID", &child.id().to_string()])
                .spawn();
        }
    }
    Ok(())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs can be opened externally".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", &url]);
        cmd
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&url);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&url);
        cmd
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("failed to open URL: {err}"))?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(DaemonState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            ensure_daemon,
            get_daemon_config,
            open_external,
            stop_daemon
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let state = window.state::<DaemonState>();
                let _ = stop_daemon(state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running CodePanion GUI");
}

fn daemon_config() -> DaemonConfig {
    let (port, token) = read_user_config().unwrap_or((DEFAULT_DAEMON_PORT, String::new()));
    DaemonConfig {
        url: format!("http://127.0.0.1:{port}"),
        ws_url: format!("ws://127.0.0.1:{port}/ws?role=observer"),
        token,
        port,
    }
}

fn read_user_config() -> Option<(u16, String)> {
    let path = home_dir()?.join(".codepanion").join("config.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let port = json
        .get("port")
        .and_then(|value| value.as_u64())
        .and_then(|value| u16::try_from(value).ok())
        .unwrap_or(DEFAULT_DAEMON_PORT);
    let token = json
        .get("token")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    Some((port, token))
}

fn find_daemon_binary(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(configured) = env::var("CODEPANION_DAEMON_PATH") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Some(path);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir
            .join("daemon")
            .join(exe_name("codepanion-daemon"));
        if bundled.is_file() {
            return Some(bundled);
        }
    }

    let mut dir = env::current_dir().ok();
    let mut depth = 0;
    const MAX_DEPTH: usize = 10;

    while let Some(current) = dir {
        if depth >= MAX_DEPTH {
            break;
        }
        for profile in ["release", "debug"] {
            let candidate = current
                .join("codepanion-rust")
                .join("target")
                .join(profile)
                .join(exe_name("codepanion-daemon"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        dir = current.parent().map(Path::to_path_buf);
        depth += 1;
    }

    None
}

fn is_daemon_healthy(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let Ok(mut addrs) = addr.to_socket_addrs() else {
        return false;
    };
    let Some(socket_addr) = addrs.next() else {
        return false;
    };
    TcpStream::connect_timeout(&socket_addr, Duration::from_millis(700)).is_ok()
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
}

fn exe_name(stem: &str) -> String {
    if cfg!(windows) {
        format!("{stem}.exe")
    } else {
        stem.to_string()
    }
}
