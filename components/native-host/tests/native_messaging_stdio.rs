use codex_native_host_asm_rust_reconstruction::transport::{stdio::StdioTransport, MessageTransport};
use std::io::Cursor;

#[test]
fn stdio_transport_reads_length_prefixed_frame() {
    let body = br#"{"jsonrpc":"2.0","id":1,"method":"GET_NATIVE_HOST_STATUS"}"#;
    let mut input = Vec::new();
    input.extend_from_slice(&(body.len() as u32).to_le_bytes());
    input.extend_from_slice(body);
    let mut transport = StdioTransport::with_io(Cursor::new(input), Cursor::new(Vec::<u8>::new()));
    let frame = transport.receive_frame().unwrap();
    assert_eq!(frame, body);
}

#[test]
fn stdio_transport_writes_length_prefixed_frame() {
    let body = br#"{"ok":true}"#;
    let transport = StdioTransport::with_io(Cursor::new(Vec::<u8>::new()), Cursor::new(Vec::<u8>::new()));
    let mut transport = transport;
    transport.send_frame(body).unwrap();
    let (_reader, writer) = transport.into_parts();
    let out = writer.into_inner();
    assert_eq!(&out[..4], &(body.len() as u32).to_le_bytes());
    assert_eq!(&out[4..], body);
}
