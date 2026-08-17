// reconstructed executable: assembly-driven Native Messaging host
// evidence:
// - ARM64 slice: artifacts/native-host/assembly/extension_host_main_h3fe6fe7fcded2c01.s
// - symbols: extension_host::main, transport::stdio::StdioWriter::send_or_exit, RpcRouter::*
// - protocol: Chrome Native Messaging length-prefixed JSON over stdin/stdout
// confidence: high for process composition; medium for exact private payloads

use codex_native_host_asm_rust_reconstruction::{
    app_server::AppServerManager,
    client_writer::ClientWriterRegistry,
    config::ExtensionHostConfig,
    rpc_router::RpcRouter,
    tab_context_asset::TabContextAssetManager,
    transport::stdio::StdioTransport,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = ExtensionHostConfig::discover()?;
    let app_server = AppServerManager::new(config.clone());
    let tab_assets = TabContextAssetManager::new(config.paths.codex_home.join("tab-context-assets"))?;
    let writers = ClientWriterRegistry::new();
    let transport = StdioTransport::new();
    let mut router = RpcRouter::new(transport, app_server, tab_assets, writers);
    router.run().await?;
    Ok(())
}
