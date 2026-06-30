#[cfg(not(debug_assertions))]
use std::io::{Read, Write};
#[cfg(not(debug_assertions))]
use std::net::TcpStream;
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[cfg(not(debug_assertions))]
const SERVER_PORT: u16 = 5279;

struct ServerProcess(Mutex<Option<CommandChild>>);

#[cfg(not(debug_assertions))]
fn wait_for_server() -> Result<(), String> {
    let request = format!(
    "GET /api/provider/status HTTP/1.1\r\nHost: 127.0.0.1:{SERVER_PORT}\r\nConnection: close\r\n\r\n"
  );

    for _ in 0..80 {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", SERVER_PORT)) {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            if stream.write_all(request.as_bytes()).is_ok() {
                let mut buf = [0_u8; 512];
                if stream.read(&mut buf).is_ok() {
                    return Ok(());
                }
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    Err("Timed out waiting for local API server".into())
}

#[cfg(not(debug_assertions))]
fn start_server_sidecar(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let resource_dir = app.path().resource_dir()?;
    let static_root = resource_dir.join("server-dist");

    let sidecar = app.shell().sidecar("server")?;
    let (mut rx, child) = sidecar
        .env("PORT", SERVER_PORT.to_string())
        .env("STATIC_ROOT", static_root.to_string_lossy().to_string())
        .spawn()?;

    std::thread::spawn(move || {
        while let Some(event) = rx.blocking_recv() {
            if let CommandEvent::Error(err) = event {
                eprintln!("Server sidecar error: {err}");
            }
        }
    });

    app.manage(ServerProcess(Mutex::new(Some(child))));
    wait_for_server().map_err(|error| error.into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(not(debug_assertions))]
            start_server_sidecar(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<ServerProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
