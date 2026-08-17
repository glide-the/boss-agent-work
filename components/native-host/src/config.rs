// reconstructed module: config
// evidence:
// - strings: extension-host-config.json, chrome-native-hosts-v2.json
// - fields: schemaVersion, paths, extensionHostPath, nativeHostNames, extensionId, resourcesPath, browserClientPath, codexCliPath, codexHome, nodeReplPath, proxyHost, proxyPort, trustedBrowserClientSha256s
// confidence: high

use serde::{Deserialize, Serialize};
use std::{env, fs, path::{Path, PathBuf}};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionHostConfig {
    pub schema_version: u32,
    pub paths: ConfigPaths,
    pub native_host_names: Vec<String>,
    pub extension_id: String,
    pub extension_build_channels: Vec<String>,
    pub proxy_host: String,
    pub proxy_port: Option<u16>,
    #[serde(default)]
    pub trusted_browser_client_sha256s: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPaths {
    pub extension_host_path: PathBuf,
    pub resources_path: PathBuf,
    pub browser_client_path: PathBuf,
    pub codex_cli_path: PathBuf,
    pub codex_home: PathBuf,
    pub node_repl_path: Option<PathBuf>,
}

impl ExtensionHostConfig {
    pub fn discover() -> Result<Self, ConfigError> {
        let config_path = env::var_os("CODEX_EXTENSION_HOST_CONFIG")
            .map(PathBuf::from)
            .or_else(|| default_config_path());

        let mut config = if let Some(path) = config_path.filter(|path| path.exists()) {
            Self::load_from_file(&path)?
        } else {
            Self::fallback_from_env()?
        };

        config.apply_env_overrides();
        config.validate()?;
        Ok(config)
    }

    pub fn load_from_file(path: &Path) -> Result<Self, ConfigError> {
        let text = fs::read_to_string(path).map_err(|source| ConfigError::Read { path: path.to_path_buf(), source })?;
        serde_json::from_str(&text).map_err(|source| ConfigError::Parse { path: path.to_path_buf(), source })
    }

    fn fallback_from_env() -> Result<Self, ConfigError> {
        let codex_home = env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(default_codex_home);
        let codex_cli_path = env::var_os("CODEX_CLI_PATH").map(PathBuf::from).unwrap_or_else(|| codex_home.join("bin/codex"));
        let extension_id = env::var("CODEX_EXTENSION_ID").unwrap_or_else(|_| "unknown-extension-id".into());
        Ok(Self {
            schema_version: 2,
            paths: ConfigPaths {
                extension_host_path: env::current_exe().unwrap_or_else(|_| PathBuf::from("Codex for Chrome")),
                resources_path: codex_home.join("resources"),
                browser_client_path: codex_home.join("browser-client"),
                codex_cli_path,
                codex_home,
                node_repl_path: env::var_os("CODEX_BROWSER_USE_NODE_PATH").map(PathBuf::from),
            },
            native_host_names: vec!["com.openai.codexextension".into(), "com.openai.codexextension.dev".into(), "com.openai.codexextension.internal".into()],
            extension_id,
            extension_build_channels: vec!["prod".into()],
            proxy_host: "127.0.0.1".into(),
            proxy_port: None,
            trusted_browser_client_sha256s: vec![],
        })
    }

    fn apply_env_overrides(&mut self) {
        if let Some(v) = env::var_os("CODEX_HOME") { self.paths.codex_home = PathBuf::from(v); }
        if let Some(v) = env::var_os("CODEX_CLI_PATH") { self.paths.codex_cli_path = PathBuf::from(v); }
        if let Ok(v) = env::var("CODEX_EXTENSION_ID") { self.extension_id = v; }
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.native_host_names.is_empty() { return Err(ConfigError::Invalid("nativeHostNames is empty".into())); }
        if self.proxy_host.is_empty() { return Err(ConfigError::Invalid("proxyHost is empty".into())); }
        Ok(())
    }
}

fn default_config_path() -> Option<PathBuf> {
    let home = env::var_os("HOME").map(PathBuf::from)?;
    Some(home.join("Library/Application Support/Codex/extension-host-config.json"))
}

fn default_codex_home() -> PathBuf {
    env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(".")).join(".codex")
}

#[derive(Debug)]
pub enum ConfigError {
    Read { path: PathBuf, source: std::io::Error },
    Parse { path: PathBuf, source: serde_json::Error },
    Invalid(String),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Read { path, source } => write!(f, "failed to read config {}: {source}", path.display()),
            Self::Parse { path, source } => write!(f, "failed to parse config {}: {source}", path.display()),
            Self::Invalid(msg) => write!(f, "invalid config: {msg}"),
        }
    }
}
impl std::error::Error for ConfigError {}
