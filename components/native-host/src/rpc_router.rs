// reconstructed module: rpc_router
// evidence:
// - symbols: RpcRouter::new/register_message_from_client/route_message_to_client/remove_client
// - Chrome-side messages: GET_NATIVE_HOST_STATUS, ensure_codex_app_server, tab_page_assets_bundle
// confidence: high for dispatch shape; medium for exact undocumented payload schema

use crate::{
    app_server::AppServerManager,
    client_writer::ClientWriterRegistry,
    protocol::{JsonRpcId, JsonRpcRequest, JsonRpcResponse, METHOD_ENSURE_CODEX_APP_SERVER, METHOD_GET_NATIVE_HOST_STATUS, METHOD_TAB_PAGE_ASSETS_BUNDLE},
    tab_context_asset::TabContextAssetManager,
    transport::{stdio::StdioTransport, MessageTransport},
};
use serde_json::{json, Value};

pub struct RpcRouter<T: MessageTransport = StdioTransport> {
    transport: T,
    app_server: AppServerManager,
    client_writers: ClientWriterRegistry,
    tab_assets: TabContextAssetManager,
}

impl<T: MessageTransport> RpcRouter<T> {
    pub fn new(transport: T, app_server: AppServerManager, tab_assets: TabContextAssetManager, client_writers: ClientWriterRegistry) -> Self {
        Self { transport, app_server, client_writers, tab_assets }
    }

    pub async fn run(&mut self) -> Result<(), RouterError> {
        loop {
            let frame = self.transport.receive_frame().map_err(RouterError::Transport)?;
            if let Some(response) = self.handle_frame(&frame).await {
                let bytes = serde_json::to_vec(&response).map_err(RouterError::Serialize)?;
                self.transport.send_frame(&bytes).map_err(RouterError::Transport)?;
            }
        }
    }

    /// Handles both JSON-RPC and plain extension-message objects observed in the extension bundle.
    /// Unsupported methods return structured errors instead of synthetic success.
    pub async fn handle_frame(&mut self, frame: &[u8]) -> Option<Value> {
        let value: Value = match serde_json::from_slice(frame) {
            Ok(value) => value,
            Err(error) => return Some(serde_json::to_value(JsonRpcResponse::err(JsonRpcId::Number(0), -32700, format!("invalid JSON frame: {error}"))).unwrap()),
        };

        if value.get("jsonrpc").and_then(Value::as_str) == Some("2.0") && value.get("id").is_some() && value.get("method").is_some() {
            let req: JsonRpcRequest = match serde_json::from_value(value) {
                Ok(req) => req,
                Err(error) => return Some(serde_json::to_value(JsonRpcResponse::err(JsonRpcId::Number(0), -32600, format!("invalid JSON-RPC request: {error}"))).unwrap()),
            };
            return Some(serde_json::to_value(self.handle_request(req).await).unwrap());
        }

        if value.get("jsonrpc").and_then(Value::as_str) == Some("2.0") && value.get("method").is_some() {
            let method = value.get("method").and_then(Value::as_str).unwrap_or_default().to_string();
            let params = value.get("params").cloned().unwrap_or(Value::Null);
            self.handle_notification(method, params).await;
            return None;
        }

        Some(self.handle_plain_extension_message(value).await)
    }

    pub async fn handle_request(&mut self, req: JsonRpcRequest) -> JsonRpcResponse {
        let id = req.id.clone();
        match req.method.as_str() {
            METHOD_GET_NATIVE_HOST_STATUS | "getNativeHostStatus" | "nativeHostStatus" | "status" => JsonRpcResponse::ok(id, self.app_server.status()),
            METHOD_ENSURE_CODEX_APP_SERVER | "ensureCodexAppServer" => {
                let client_id = req.params.get("clientId").and_then(Value::as_str).map(ToString::to_string);
                let status = self.app_server.ensure(client_id).await;
                JsonRpcResponse::ok(id, status)
            }
            "shutdown_codex_app_server" | "shutdownCodexAppServer" => match self.app_server.shutdown().await {
                Ok(()) => JsonRpcResponse::ok(id, json!({"ok": true})),
                Err(e) => JsonRpcResponse::err(id, 500, e.to_string()),
            },
            "create_tab_context_asset" | "createTabContextAsset" => self.create_tab_context_asset(id, req.params),
            "append_tab_context_asset_chunk" | "appendTabContextAssetChunk" => self.append_tab_context_asset_chunk(id, req.params),
            "finish_tab_context_asset" | "finishTabContextAsset" => self.finish_tab_context_asset(id, req.params),
            "remove_tab_context_asset" | "removeTabContextAsset" => self.remove_tab_context_asset(id, req.params),
            METHOD_TAB_PAGE_ASSETS_BUNDLE => self.handle_tab_page_assets_bundle(id, req.params),
            "route_message_to_client" | "routeMessageToClient" => self.route_message_to_client(id, req.params).await,
            other => JsonRpcResponse::err(id, -32601, format!("unsupported reconstructed native-host method: {other}")),
        }
    }

    async fn handle_plain_extension_message(&mut self, value: Value) -> Value {
        let message_type = value.get("type").or_else(|| value.get("method")).and_then(Value::as_str).unwrap_or("");
        match message_type {
            METHOD_GET_NATIVE_HOST_STATUS | "getNativeHostStatus" | "NATIVE_HOST_STATUS" => {
                let status = self.app_server.status();
                let ok = matches!(status.native_host_state, crate::protocol::NativeHostState::Running);
                json!({"ok": ok, "type": "NATIVE_HOST_STATUS", "status": status})
            },
            METHOD_ENSURE_CODEX_APP_SERVER | "ensureCodexAppServer" => {
                let client_id = value.get("clientId").and_then(Value::as_str).map(ToString::to_string);
                let status = self.app_server.ensure(client_id).await;
                let native_host_status = status.clone();
                let ok = matches!(status.native_host_state, crate::protocol::NativeHostState::Running);
                json!({"ok": ok, "status": status, "nativeHostStatus": native_host_status})
            }
            METHOD_TAB_PAGE_ASSETS_BUNDLE => json!({"ok": false, "error": "tab_page_assets_bundle requires a JSON-RPC params.entries payload in this reconstruction"}),
            _ => json!({"ok": false, "error": format!("unsupported reconstructed extension message: {message_type}"), "echo": value}),
        }
    }

    async fn handle_notification(&mut self, method: String, params: Value) {
        if method == "register_message_from_client" {
            if let Some(client_id) = params.get("clientId").and_then(Value::as_str) {
                let _receiver = self.client_writers.register(client_id.to_string(), 0).await;
            }
        }
    }

    fn create_tab_context_asset(&mut self, id: JsonRpcId, params: Value) -> JsonRpcResponse {
        let asset_id = params.get("assetId").and_then(Value::as_str).unwrap_or_default().to_string();
        let entry_id = params.get("entryId").and_then(Value::as_str).unwrap_or("tab-context").to_string();
        match self.tab_assets.create_tab_context_asset(asset_id, entry_id) {
            Ok(status) => JsonRpcResponse::ok(id, status),
            Err(e) => JsonRpcResponse::err(id, 400, e.to_string()),
        }
    }

    fn append_tab_context_asset_chunk(&mut self, id: JsonRpcId, params: Value) -> JsonRpcResponse {
        let asset_id = params.get("assetId").and_then(Value::as_str).unwrap_or_default();
        let chunk = params.get("chunk").and_then(Value::as_str).unwrap_or_default().as_bytes().to_vec();
        match self.tab_assets.append_tab_context_asset_chunk(asset_id, &chunk) {
            Ok(status) => JsonRpcResponse::ok(id, status),
            Err(e) => JsonRpcResponse::err(id, 400, e.to_string()),
        }
    }

    fn finish_tab_context_asset(&mut self, id: JsonRpcId, params: Value) -> JsonRpcResponse {
        let asset_id = params.get("assetId").and_then(Value::as_str).unwrap_or_default();
        match self.tab_assets.finish_tab_context_asset(asset_id) {
            Ok(status) => JsonRpcResponse::ok(id, status),
            Err(e) => JsonRpcResponse::err(id, 400, e.to_string()),
        }
    }

    fn remove_tab_context_asset(&mut self, id: JsonRpcId, params: Value) -> JsonRpcResponse {
        let asset_id = params.get("assetId").and_then(Value::as_str).unwrap_or_default();
        match self.tab_assets.remove_tab_context_asset(asset_id) {
            Ok(removed) => JsonRpcResponse::ok(id, json!({"removed": removed})),
            Err(e) => JsonRpcResponse::err(id, 400, e.to_string()),
        }
    }

    fn handle_tab_page_assets_bundle(&mut self, id: JsonRpcId, params: Value) -> JsonRpcResponse {
        let Some(entries) = params.get("entries").and_then(Value::as_array) else {
            return JsonRpcResponse::err(id, 400, "tab_page_assets_bundle requires params.entries");
        };
        let mut statuses = vec![];
        for entry in entries {
            let asset_id = entry.get("assetId").and_then(Value::as_str).unwrap_or("asset").to_string();
            let entry_id = entry.get("entryId").and_then(Value::as_str).unwrap_or("entry").to_string();
            if let Ok(status) = self.tab_assets.create_tab_context_asset(asset_id.clone(), entry_id) { statuses.push(status); }
            if let Some(text) = entry.get("text").and_then(Value::as_str) {
                let _ = self.tab_assets.append_tab_context_asset_chunk(&asset_id, text.as_bytes());
                if let Ok(status) = self.tab_assets.finish_tab_context_asset(&asset_id) { statuses.push(status); }
            }
        }
        JsonRpcResponse::ok(id, json!({"ok": true, "assets": statuses}))
    }

    async fn route_message_to_client(&self, id: JsonRpcId, params: Value) -> JsonRpcResponse {
        let Some(client_id) = params.get("clientId").and_then(Value::as_str) else { return JsonRpcResponse::err(id, 400, "missing clientId"); };
        let payload = params.get("payload").cloned().unwrap_or(Value::Null);
        match self.client_writers.send_to(client_id, payload).await {
            Ok(()) => JsonRpcResponse::ok(id, json!({"ok": true})),
            Err(e) => JsonRpcResponse::err(id, 404, e.to_string()),
        }
    }
}

#[derive(Debug)]
pub enum RouterError { Transport(std::io::Error), Serialize(serde_json::Error) }
impl std::fmt::Display for RouterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self { Self::Transport(e) => write!(f, "transport error: {e}"), Self::Serialize(e) => write!(f, "serialize error: {e}") }
    }
}
impl std::error::Error for RouterError {}
