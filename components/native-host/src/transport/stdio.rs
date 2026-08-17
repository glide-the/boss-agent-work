// reconstructed module: transport::stdio
// evidence:
// - symbols: StdioTransport, StdioReader, StdioWriter
// - strings: stdin read failed, stdout write failed, message too large for 4-byte length prefix
// - Chrome Native Messaging uses little-endian 4-byte length prefix + JSON body
// confidence: high

use super::MessageTransport;
use std::io::{self, Read, Write};

pub const MAX_NATIVE_MESSAGE_BYTES: usize = 1024 * 1024 * 64;

pub struct StdioTransport<R = std::io::Stdin, W = std::io::Stdout> {
    reader: R,
    writer: W,
}

impl StdioTransport<std::io::Stdin, std::io::Stdout> {
    pub fn new() -> Self { Self { reader: io::stdin(), writer: io::stdout() } }
}

impl<R, W> StdioTransport<R, W> where R: Read, W: Write {
    pub fn with_io(reader: R, writer: W) -> Self { Self { reader, writer } }
    pub fn into_parts(self) -> (R, W) { (self.reader, self.writer) }

    fn read_len(&mut self) -> io::Result<usize> {
        let mut len_buf = [0u8; 4];
        self.reader.read_exact(&mut len_buf)?;
        let len = u32::from_le_bytes(len_buf) as usize;
        if len > MAX_NATIVE_MESSAGE_BYTES {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "message exceeded maximum native host frame size"));
        }
        Ok(len)
    }
}

impl<R, W> MessageTransport for StdioTransport<R, W> where R: Read, W: Write {
    fn receive_frame(&mut self) -> io::Result<Vec<u8>> {
        let len = self.read_len()?;
        let mut body = vec![0u8; len];
        self.reader.read_exact(&mut body)?;
        Ok(body)
    }

    fn send_frame(&mut self, bytes: &[u8]) -> io::Result<()> {
        let len: u32 = bytes.len().try_into().map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "message too large for 4-byte length prefix"))?;
        self.writer.write_all(&len.to_le_bytes())?;
        self.writer.write_all(bytes)?;
        self.writer.flush()
    }
}
