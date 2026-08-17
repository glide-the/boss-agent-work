use codex_native_host_asm_rust_reconstruction::{
    app_server::AppServerManager,
    client_writer::ClientWriterRegistry,
    config::{ConfigPaths, ExtensionHostConfig},
    rpc_router::RpcRouter,
    tab_context_asset::TabContextAssetManager,
    transport::stdio::StdioTransport,
};
use serde_json::{json, Value};
use std::{io::Cursor, path::PathBuf};
use uuid::Uuid;

fn temp_root(label: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("codex-recon-test-{label}-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn config(root: PathBuf) -> ExtensionHostConfig {
    ExtensionHostConfig {
        schema_version: 2,
        paths: ConfigPaths {
            extension_host_path: root.join("codex-native-host-reconstructed"),
            resources_path: root.join("resources"),
            browser_client_path: root.join("browser-client"),
            codex_cli_path: root.join("bin/codex"),
            codex_home: root,
            node_repl_path: None,
        },
        native_host_names: vec!["com.openai.codexextension".into()],
        extension_id: "test-extension".into(),
        extension_build_channels: vec!["prod".into()],
        proxy_host: "127.0.0.1".into(),
        proxy_port: None,
        trusted_browser_client_sha256s: vec![],
    }
}

async fn router() -> RpcRouter<StdioTransport<Cursor<Vec<u8>>, Cursor<Vec<u8>>>> {
    let root = temp_root("router");
    let app = AppServerManager::new(config(root.clone()));
    let assets = TabContextAssetManager::new(root.join("assets")).unwrap();
    let writers = ClientWriterRegistry::new();
    let transport = StdioTransport::with_io(Cursor::new(Vec::new()), Cursor::new(Vec::new()));
    RpcRouter::new(transport, app, assets, writers)
}

#[tokio::test]
async fn json_rpc_status_request_returns_status() {
    let mut router = router().await;
    let response = router.handle_frame(br#"{"jsonrpc":"2.0","id":1,"method":"GET_NATIVE_HOST_STATUS"}"#).await.unwrap();
    assert_eq!(response["jsonrpc"], "2.0");
    assert_eq!(response["id"], 1);
    assert!(response["result"]["nativeHostVersion"].is_string());
}

#[tokio::test]
async fn ensure_app_server_reports_failed_without_cli() {
    let mut router = router().await;
    let response = router.handle_frame(br#"{"jsonrpc":"2.0","id":"a","method":"ensure_codex_app_server","params":{"clientId":"c1"}}"#).await.unwrap();
    assert_eq!(response["id"], "a");
    assert_eq!(response["result"]["nativeHostState"], "failed");
    assert!(response["result"]["error"].as_str().unwrap().contains("No matching Codex install"));
}

#[tokio::test]
async fn plain_extension_message_status_is_accepted() {
    let mut router = router().await;
    let response = router.handle_frame(br#"{"type":"GET_NATIVE_HOST_STATUS"}"#).await.unwrap();
    assert_eq!(response["ok"], false);
    assert_eq!(response["type"], "NATIVE_HOST_STATUS");
}

#[tokio::test]
async fn tab_asset_bundle_writes_assets() {
    let mut router = router().await;
    let payload = json!({
        "jsonrpc":"2.0",
        "id":7,
        "method":"tab_page_assets_bundle",
        "params":{"entries":[{"assetId":"asset_1","entryId":"entry_1","text":"hello tab"}]}
    });
    let response = router.handle_frame(payload.to_string().as_bytes()).await.unwrap();
    assert_eq!(response["id"], 7);
    assert_eq!(response["result"]["ok"], true);
    let assets: &Vec<Value> = response["result"]["assets"].as_array().unwrap();
    assert!(!assets.is_empty());
}
