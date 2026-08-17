// reconstructed module: tab_context_asset
// evidence:
// - symbols: create_tab_context_asset, append_tab_context_asset_chunk, finish_tab_context_asset, remove_tab_context_asset, remove_tab_context_asset_file
// - strings: tab-context.txt, assetId, entryId, Chrome tab context asset is too large, Invalid Chrome tab context asset chunk
// confidence: high

use crate::protocol::{AssetId, EntryId, TabContextAssetStatus};
use std::{collections::HashMap, fs::{self, OpenOptions}, io::{self, Write}, path::{Path, PathBuf}};
#[cfg(unix)] use std::os::unix::fs::PermissionsExt;

const MAX_ASSET_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone)]
struct AssetRecord {
    asset_id: AssetId,
    entry_id: EntryId,
    path: PathBuf,
    size_bytes: u64,
    finished: bool,
}

pub struct TabContextAssetManager {
    root: PathBuf,
    assets: HashMap<AssetId, AssetRecord>,
}

impl TabContextAssetManager {
    pub fn new(root: impl Into<PathBuf>) -> io::Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root)?;
        #[cfg(unix)] fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
        Ok(Self { root, assets: HashMap::new() })
    }

    pub fn create_tab_context_asset(&mut self, asset_id: AssetId, entry_id: EntryId) -> io::Result<TabContextAssetStatus> {
        validate_token(&asset_id)?;
        validate_token(&entry_id)?;
        if self.assets.contains_key(&asset_id) { return Err(io::Error::new(io::ErrorKind::AlreadyExists, "Chrome tab context asset already exists")); }
        let dir = self.root.join(&asset_id);
        fs::create_dir_all(&dir)?;
        #[cfg(unix)] fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        let path = dir.join("tab-context.txt");
        OpenOptions::new().create_new(true).write(true).open(&path)?;
        #[cfg(unix)] fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        let record = AssetRecord { asset_id: asset_id.clone(), entry_id, path, size_bytes: 0, finished: false };
        let status = record.status();
        self.assets.insert(asset_id, record);
        Ok(status)
    }

    pub fn append_tab_context_asset_chunk(&mut self, asset_id: &str, chunk: &[u8]) -> io::Result<TabContextAssetStatus> {
        let record = self.assets.get_mut(asset_id).ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Chrome tab context asset not found"))?;
        if record.finished { return Err(io::Error::new(io::ErrorKind::InvalidInput, "Chrome tab context asset is already finished")); }
        let new_size = record.size_bytes.saturating_add(chunk.len() as u64);
        if new_size > MAX_ASSET_BYTES { return Err(io::Error::new(io::ErrorKind::InvalidData, "Chrome tab context asset is too large")); }
        let mut file = OpenOptions::new().append(true).open(&record.path)?;
        file.write_all(chunk)?;
        record.size_bytes = new_size;
        Ok(record.status())
    }

    pub fn finish_tab_context_asset(&mut self, asset_id: &str) -> io::Result<TabContextAssetStatus> {
        let record = self.assets.get_mut(asset_id).ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Chrome tab context asset not found"))?;
        record.finished = true;
        Ok(record.status())
    }

    pub fn remove_tab_context_asset(&mut self, asset_id: &str) -> io::Result<bool> {
        let Some(record) = self.assets.remove(asset_id) else { return Ok(false); };
        remove_tab_context_asset_file(&record.path)?;
        if let Some(parent) = record.path.parent() { let _ = fs::remove_dir(parent); }
        Ok(true)
    }
}

impl AssetRecord {
    fn status(&self) -> TabContextAssetStatus {
        TabContextAssetStatus {
            asset_id: self.asset_id.clone(),
            entry_id: self.entry_id.clone(),
            path: self.path.display().to_string(),
            size_bytes: self.size_bytes,
            finished: self.finished,
        }
    }
}

pub fn remove_tab_context_asset_file(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) { Ok(()) => Ok(()), Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()), Err(e) => Err(e) }
}

fn validate_token(value: &str) -> io::Result<()> {
    if value.is_empty() || value.len() > 128 || !value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid Chrome tab context asset token"));
    }
    Ok(())
}
