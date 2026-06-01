use codepanion_daemon::{DaemonOptions, run_daemon};

fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("--serve") => {
            let port = args
                .next()
                .and_then(|raw| raw.parse::<u16>().ok())
                .unwrap_or(7777);
            if let Err(err) = run_daemon(DaemonOptions {
                bind: "127.0.0.1".to_string(),
                port,
            }) {
                eprintln!("{err}");
                std::process::exit(1);
            }
        }
        _ => {
            println!("CodePanion Rust daemon {}", codepanion_shared::VERSION);
        }
    }
}
