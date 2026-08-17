// reconstructed module: open_local_file
// evidence: extension_host::open_local_file::open, Failed to open local file string
// confidence: medium

use std::path::{Path, PathBuf};

pub struct LocalFileOpener { allowed_roots: Vec<PathBuf> }

impl LocalFileOpener {
    pub fn new(allowed_roots: Vec<PathBuf>) -> Self { Self { allowed_roots } }

    pub fn validate(&self, requested: &Path) -> Result<PathBuf, OpenLocalFileError> {
        let canonical = requested.canonicalize().map_err(OpenLocalFileError::Io)?;
        if self.allowed_roots.iter().any(|root| canonical.starts_with(root)) { Ok(canonical) } else { Err(OpenLocalFileError::OutsideAllowedRoots(canonical)) }
    }

    pub fn build_open_command(&self, requested: &Path) -> Result<std::process::Command, OpenLocalFileError> {
        let path = self.validate(requested)?;
        let mut cmd = std::process::Command::new("open");
        cmd.arg(path);
        Ok(cmd)
    }
}

#[derive(Debug)]
pub enum OpenLocalFileError { Io(std::io::Error), OutsideAllowedRoots(PathBuf) }
impl std::fmt::Display for OpenLocalFileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self { Self::Io(e) => write!(f, "Failed to open local file: {e}"), Self::OutsideAllowedRoots(path) => write!(f, "refusing to open path outside allowed roots: {}", path.display()) }
    }
}
impl std::error::Error for OpenLocalFileError {}
