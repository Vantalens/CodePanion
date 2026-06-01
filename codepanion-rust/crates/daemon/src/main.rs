use codepanion_daemon::{DaemonConfig, run_daemon};

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("--serve") => {
            let port = args
                .next()
                .and_then(|raw| raw.parse::<u16>().ok())
                .unwrap_or(8318);

            let config = DaemonConfig {
                bind: "127.0.0.1".to_string(),
                port,
                ..Default::default()
            };

            if let Err(err) = run_daemon(config).await {
                eprintln!("Error: {}", err);
                std::process::exit(1);
            }
        }
        _ => {
            println!("CodePanion Rust daemon {}", codepanion_shared::VERSION);
            println!();
            println!("Usage:");
            println!("  codepanion-daemon --serve [port]");
            println!();
            println!("Options:");
            println!("  --serve [port]    Start HTTP API server (default port: 8318)");
            println!();
            println!("Examples:");
            println!("  codepanion-daemon --serve");
            println!("  codepanion-daemon --serve 9000");
        }
    }
}
