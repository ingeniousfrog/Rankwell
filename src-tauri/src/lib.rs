#[cfg(not(debug_assertions))]
use std::io::{Read, Write};
#[cfg(not(debug_assertions))]
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use std::time::Duration;

use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri::Url;
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[cfg(not(debug_assertions))]
const SERVER_PORT_START: u16 = 5279;

struct ServerProcess(Mutex<Option<CommandChild>>);

#[cfg(not(debug_assertions))]
fn find_available_server_port() -> Result<u16, String> {
    for port in SERVER_PORT_START..SERVER_PORT_START + 100 {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            drop(listener);
            return Ok(port);
        }
    }

    Err("Could not find an available local API port".into())
}

#[cfg(not(debug_assertions))]
fn wait_for_server(port: u16) -> Result<(), String> {
    let request = format!(
        "GET /api/provider/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );

    for _ in 0..80 {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
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
    let server_port = find_available_server_port()?;
    let resource_dir = app.path().resource_dir()?;
    let static_root = resource_dir.join("server-dist");
    let home_dir = app.path().home_dir()?;
    let codex_home = home_dir.join(".codex");

    let sidecar = app.shell().sidecar("server")?;
    let (mut rx, child) = sidecar
        .env("PORT", server_port.to_string())
        .env("STATIC_ROOT", static_root.to_string_lossy().to_string())
        .env("HOME", home_dir.to_string_lossy().to_string())
        .env("CODEX_HOME", codex_home.to_string_lossy().to_string())
        .spawn()?;

    std::thread::spawn(move || {
        while let Some(event) = rx.blocking_recv() {
            if let CommandEvent::Error(err) = event {
                eprintln!("Server sidecar error: {err}");
            }
        }
    });

    app.manage(ServerProcess(Mutex::new(Some(child))));
    wait_for_server(server_port)?;

    if let Some(window) = app.get_webview_window("main") {
        let url = Url::parse(&format!("http://127.0.0.1:{server_port}/"))?;
        window.navigate(url)?;
    }

    Ok(())
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
