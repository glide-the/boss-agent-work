// reconstructed module: transport
// evidence: extension_host::transport::stdio and extension_host::transport::unix symbols
// confidence: high

use std::io;

pub mod stdio;
pub mod unix;

pub trait MessageTransport {
    fn send_frame(&mut self, bytes: &[u8]) -> io::Result<()>;
    fn receive_frame(&mut self) -> io::Result<Vec<u8>>;
}
