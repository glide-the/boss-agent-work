use codex_native_host_asm_rust_reconstruction::{
    client_writer::ClientWriterRegistry,
    open_local_file::LocalFileOpener,
    peer_authorization::{CodeIdentity, PeerAuthorizer},
    tab_context_asset::TabContextAssetManager,
};
use serde_json::json;
use std::path::PathBuf;
use uuid::Uuid;

fn temp_root(label: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("codex-recon-test-{label}-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn tab_context_asset_lifecycle() {
    let root = temp_root("assets");
    let mut mgr = TabContextAssetManager::new(&root).unwrap();
    let created = mgr.create_tab_context_asset("assetA".into(), "entryA".into()).unwrap();
    assert_eq!(created.size_bytes, 0);
    let appended = mgr.append_tab_context_asset_chunk("assetA", b"abc").unwrap();
    assert_eq!(appended.size_bytes, 3);
    let finished = mgr.finish_tab_context_asset("assetA").unwrap();
    assert!(finished.finished);
    assert!(mgr.remove_tab_context_asset("assetA").unwrap());
}

#[tokio::test]
async fn client_writer_send_and_remove() {
    let reg = ClientWriterRegistry::new();
    let mut rx = reg.register("client-1".into(), 1).await;
    reg.send_to("client-1", json!({"hello":"world"})).await.unwrap();
    assert_eq!(rx.recv().await.unwrap()["hello"], "world");
    assert!(reg.remove("client-1").await);
}

#[test]
fn peer_authorizer_accepts_trusted_hash_and_rejects_unknown() {
    let auth = PeerAuthorizer::new(vec!["abc".into()]);
    let ok = CodeIdentity { pid: Some(1), bundle_identifier: None, team_identifier: None, executable_sha256: Some("abc".into()) };
    assert!(auth.authorize_identity(&ok).is_ok());
    let bad = CodeIdentity { pid: Some(2), bundle_identifier: Some("evil.app".into()), team_identifier: None, executable_sha256: Some("nope".into()) };
    assert!(auth.authorize_identity(&bad).is_err());
}

#[test]
fn open_local_file_rejects_outside_root() {
    let root = temp_root("open");
    let inside = root.join("a.txt");
    std::fs::write(&inside, "ok").unwrap();
    let opener = LocalFileOpener::new(vec![root.canonicalize().unwrap()]);
    assert!(opener.validate(&inside).is_ok());
    assert!(opener.validate(std::path::Path::new("/etc/hosts")).is_err());
}
