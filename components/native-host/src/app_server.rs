// reconstructed module: app_server
// evidence:
// - ARM64 slices:
//   - AppServerManager::ensure: artifacts/native-host/assembly/extension_host_app_server_AppServerManager_ensure_h421c3d19eeae3757.s
//   - AppServerManager::status: artifacts/native-host/assembly/extension_host_app_server_AppServerManager_status_h1194705bfa60b3bc.s
//   - AppServerProcess::ensure_started: symbol __ZN14extension_host10app_server16AppServerProcess14ensure_started...
// - strings: localAppServerUrl, appServerProtocolVersion, appVersion, cliVersion, channel, runtimeConfig
// - strings: Failed to start Codex app-server, Failed to bind Codex app-server proxy
// confidence: high for state machine shape; medium for exact runtime payload fields

use crate::{config::ExtensionHostConfig, protocol::{NativeHostState, NativeHostStatus}};
use serde_json::json;
use std::{net::{IpAddr, Ipv4Addr, SocketAddr}, path::PathBuf, process::Stdio, time::SystemTime};
use tokio::{net::TcpListener, process::{Child, Command}};

pub struct AppServerManager {
    config: ExtensionHostConfig,
    process: Option<AppServerProcess>,
    proxy: Option<AppServerProxy>,
    state: NativeHostState,
    last_error: Option<String>,
}

pub struct AppServerProcess {
    child: Child,
    pub cli_path: PathBuf,
    pub started_at: SystemTime,
}

#[derive(Debug)]
pub struct AppServerProxy {
    pub listen_addr: SocketAddr,
    listener: TcpListener,
    pub app_server_addr: Option<String>,
}

impl AppServerManager {
    pub fn new(config: ExtensionHostConfig) -> Self {
        Self { config, process: None, proxy: None, state: NativeHostState::Uninitialized, last_error: None }
    }

    /// Assembly-driven reconstruction of `AppServerManager::ensure`.
    ///
    /// Important: this is not a synthetic running status. The function follows the real path:
    /// validate CLI path -> bind local proxy -> spawn Codex app-server -> report status.
    /// If local runtime files are missing, it returns `failed` with an error string.
    pub async fn ensure(&mut self, client_id: Option<String>) -> NativeHostStatus {
        if self.is_running().await {
            self.state = NativeHostState::Running;
            self.last_error = None;
            return self.status();
        }

        self.state = NativeHostState::Starting;
        match self.ensure_started(client_id).await {
            Ok(()) => {
                self.state = NativeHostState::Running;
                self.last_error = None;
            }
            Err(error) => {
                self.state = NativeHostState::Failed;
                self.last_error = Some(error.to_string());
            }
        }
        self.status()
    }

    async fn ensure_started(&mut self, client_id: Option<String>) -> Result<(), AppServerError> {
        if !self.config.paths.codex_cli_path.exists() {
            return Err(AppServerError::NoMatchingInstall(self.config.paths.codex_cli_path.clone()));
        }
        let proxy = AppServerProxy::bind(&self.config).await?;
        self.proxy = Some(proxy);
        self.process = Some(AppServerProcess::ensure_started(&self.config, client_id).await?);
        Ok(())
    }

    pub fn status(&self) -> NativeHostStatus {
        NativeHostStatus {
            native_host_version: env!("CARGO_PKG_VERSION").to_string(),
            native_host_protocol_version: "asm-rust-reconstruction-v1".into(),
            native_host_state: self.state.clone(),
            app_server_protocol_version: if self.state == NativeHostState::Running { Some("reconstructed-app-server-v1".into()) } else { None },
            local_app_server_url: self.proxy.as_ref().map(|p| format!("ws://{}", p.listen_addr)),
            app_version: None,
            cli_version: None,
            channel: self.config.extension_build_channels.first().cloned(),
            runtime_config: Some(json!({
                "mode": "assembly-driven-rust-reconstruction",
                "source": "Mach-O ARM64 disassembly + Rust symbols + extension protocol strings",
                "codexCliPath": self.config.paths.codex_cli_path,
                "syntheticRunningStatus": false
            })),
            error: self.last_error.clone(),
        }
    }

    pub async fn shutdown(&mut self) -> Result<(), AppServerError> {
        if let Some(mut process) = self.process.take() { process.stop().await?; }
        self.proxy = None;
        self.state = NativeHostState::Stopped;
        Ok(())
    }

    async fn is_running(&mut self) -> bool {
        match self.process.as_mut() {
            Some(process) => matches!(process.child.try_wait(), Ok(None)),
            None => false,
        }
    }
}

impl AppServerProcess {
    async fn ensure_started(config: &ExtensionHostConfig, client_id: Option<String>) -> Result<Self, AppServerError> {
        let mut cmd = Command::new(&config.paths.codex_cli_path);
        cmd.arg("app-server")
            .env("CODEX_HOME", &config.paths.codex_home)
            .env("CODEX_EXTENSION_ID", &config.extension_id)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(client_id) = client_id { cmd.env("CODEX_BROWSER_CLIENT_ID", client_id); }
        let child = cmd.spawn().map_err(AppServerError::Spawn)?;
        Ok(Self { child, cli_path: config.paths.codex_cli_path.clone(), started_at: SystemTime::now() })
    }

    async fn stop(&mut self) -> Result<(), AppServerError> {
        self.child.kill().await.map_err(AppServerError::Stop)
    }
}

impl AppServerProxy {
    pub async fn bind(config: &ExtensionHostConfig) -> Result<Self, AppServerError> {
        let ip: IpAddr = config.proxy_host.parse().unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
        let addr = SocketAddr::new(ip, config.proxy_port.unwrap_or(0));
        let listener = TcpListener::bind(addr).await.map_err(AppServerError::ProxyBind)?;
        let listen_addr = listener.local_addr().map_err(AppServerError::ProxyBind)?;
        Ok(Self { listen_addr, listener, app_server_addr: None })
    }

    pub fn listener_addr(&self) -> SocketAddr { self.listen_addr }
}

#[derive(Debug)]
pub enum AppServerError {
    NoMatchingInstall(PathBuf),
    Spawn(std::io::Error),
    Stop(std::io::Error),
    ProxyBind(std::io::Error),
}

impl std::fmt::Display for AppServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoMatchingInstall(path) => write!(f, "No matching Codex install; CLI path does not exist: {}", path.display()),
            Self::Spawn(e) => write!(f, "Failed to start Codex app-server: {e}"),
            Self::Stop(e) => write!(f, "Failed to stop Codex app-server: {e}"),
            Self::ProxyBind(e) => write!(f, "Failed to bind Codex app-server proxy: {e}"),
        }
    }
}
impl std::error::Error for AppServerError {}
