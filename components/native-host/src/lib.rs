//! Assembly-driven Rust-like reconstruction of the Codex Chrome native host.
//!
//! This crate is not the official source. It is an evidence-backed reconstruction
//! built from three layers:
//!
//! 1. Mach-O / ARM64 function slices in `artifacts/native-host/assembly/`.
//! 2. Rust symbol names preserved in the binary symbol table.
//! 3. Protocol strings aligned with the Chrome extension bundle.
//!
//! The executable intentionally does not use a synthetic app-server. `ensure`
//! attempts the reconstructed real startup path and reports a failed status when
//! required local runtime files are missing.

pub mod app_server;
pub mod client_writer;
pub mod config;
pub mod open_local_file;
pub mod peer_authorization;
pub mod protocol;
pub mod rollout_tracker;
pub mod rpc_router;
pub mod tab_context_asset;
pub mod transport;
