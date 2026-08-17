// reconstructed module: transport::unix
// evidence:
// - symbols: UnixSocketServer::bind, accept, UnixSocketTransport::shutdown, UnixSocketReader::receive, UnixSocketWriter::send
// - strings: bind_owner_only_socket, remove_stale_socket, path must be shorter than SUN_LEN
// confidence: high

use std::{fs, io, path::{Path, PathBuf}};
#[cfg(unix)]
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};

#[cfg(unix)]
pub struct UnixSocketServer {
    path: PathBuf,
    listener: UnixListener,
}

#[cfg(unix)]
pub struct UnixSocketTransport {
    stream: UnixStream,
}

#[cfg(unix)]
impl UnixSocketServer {
    pub fn bind_owner_only_socket(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref().to_path_buf();
        if path.as_os_str().len() > 100 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "path must be shorter than SUN_LEN"));
        }
        remove_stale_socket(&path)?;
        let listener = UnixListener::bind(&path)?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        Ok(Self { path, listener })
    }

    pub async fn accept(&self) -> io::Result<UnixSocketTransport> {
        let (stream, _) = self.listener.accept().await?;
        Ok(UnixSocketTransport { stream })
    }

    pub fn path(&self) -> &Path { &self.path }
}

#[cfg(unix)]
impl UnixSocketTransport {
    pub async fn shutdown(&mut self) -> io::Result<()> {
        use tokio::io::AsyncWriteExt;
        self.stream.shutdown().await
    }
}

#[cfg(unix)]
pub fn remove_stale_socket(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_socket() || meta.file_type().is_symlink() || meta.is_file() {
                fs::remove_file(path)?;
            }
            Ok(())
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

#[cfg(not(unix))]
pub struct UnixSocketServer;
