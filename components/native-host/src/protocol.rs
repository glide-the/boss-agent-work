// reconstructed module: protocol
// evidence:
// - strings: jsonrpc, method, params, id, result, error
// - status strings: nativeHostVersion, nativeHostProtocolVersion, appServerProtocolVersion, localAppServerUrl
// - extension strings: GET_NATIVE_HOST_STATUS, ensure_codex_app_server, tab_page_assets_bundle
// confidence: high

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub type ClientId = String;
pub type RuntimeSessionId = String;
pub type SessionId = String;
pub type TurnId = String;
pub type AssetId = String;
pub type EntryId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcEnvelope {
    Request(JsonRpcRequest),
    Response(JsonRpcResponse),
    Notification(JsonRpcNotification),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: JsonRpcId,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: JsonRpcId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(untagged)]
pub enum JsonRpcId {
    Number(u64),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl JsonRpcResponse {
    pub fn ok(id: JsonRpcId, result: impl Serialize) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(serde_json::to_value(result).unwrap_or(Value::Null)),
            error: None,
        }
    }

    pub fn err(id: JsonRpcId, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError { code, message: message.into(), data: None }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostStatus {
    pub native_host_version: String,
    pub native_host_protocol_version: String,
    pub native_host_state: NativeHostState,
    pub app_server_protocol_version: Option<String>,
    pub local_app_server_url: Option<String>,
    pub app_version: Option<String>,
    pub cli_version: Option<String>,
    pub channel: Option<String>,
    pub runtime_config: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeHostState {
    Uninitialized,
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NativeHostControl {
    GetNativeHostStatus,
    EnsureCodexAppServer { client_id: Option<ClientId> },
    ShutdownCodexAppServer,
    CreateTabContextAsset(CreateTabContextAsset),
    AppendTabContextAssetChunk(AppendTabContextAssetChunk),
    FinishTabContextAsset(FinishTabContextAsset),
    RemoveTabContextAsset(RemoveTabContextAsset),
    OpenLocalFile { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTabContextAsset {
    pub asset_id: AssetId,
    pub entry_id: EntryId,
    pub mime_type: Option<String>,
    pub expected_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendTabContextAssetChunk {
    pub asset_id: AssetId,
    pub entry_id: Option<EntryId>,
    pub chunk: String,
    pub encoding: ChunkEncoding,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChunkEncoding {
    Utf8,
    Base64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishTabContextAsset {
    pub asset_id: AssetId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveTabContextAsset {
    pub asset_id: AssetId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabContextAssetStatus {
    pub asset_id: AssetId,
    pub entry_id: EntryId,
    pub path: String,
    pub size_bytes: u64,
    pub finished: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnEndedEvent {
    pub session_id: SessionId,
    pub turn_id: TurnId,
    pub runtime_session_id: Option<RuntimeSessionId>,
    pub metadata: BTreeMap<String, Value>,
}

pub const METHOD_GET_NATIVE_HOST_STATUS: &str = "GET_NATIVE_HOST_STATUS";
pub const METHOD_ENSURE_CODEX_APP_SERVER: &str = "ensure_codex_app_server";
pub const METHOD_TAB_PAGE_ASSETS_BUNDLE: &str = "tab_page_assets_bundle";
pub const METHOD_TAB_PAGE_ASSETS_LIST: &str = "tab_page_assets_list";
pub const EVENT_NATIVE_TURN_ENDED: &str = "native-turn-ended";
