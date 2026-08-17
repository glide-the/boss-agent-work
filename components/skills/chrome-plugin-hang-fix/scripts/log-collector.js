// Local collector for extension/kernel diagnostic logs.
//   POST /log          -> append each body line to the JSONL log
//   GET  /ws (Upgrade) -> WebSocket; each text frame appended
//   GET  /ping         -> "pong"
// Usage: node log-collector.js [port] [logfile]
// Run it in a PTY session — backgrounded nohup processes may be reaped by the
// exec environment. Minimal RFC6455 implementation (no deps).
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";

const PORT = Number(process.argv[2] || 8791);
const LOG = process.argv[3] || "/tmp/ext-log.jsonl";
writeFileSync(LOG, "");

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Private-Network": "true",
};

const log = (line) => appendFileSync(LOG, line.replace(/\n/g, " ") + "\n");

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, HEADERS);
    res.end();
    return;
  }
  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      for (const line of body.split("\n")) if (line.trim()) log(line);
      res.writeHead(200, { ...HEADERS, "Content-Type": "text/plain" });
      res.end("ok");
    });
  } else if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, HEADERS);
    res.end("pong");
  } else {
    res.writeHead(404, HEADERS);
    res.end();
  }
});

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  log(JSON.stringify({ t: Date.now(), tag: "collector.ws-open", data: null }));

  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return;
      let payload = buf.subarray(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(off + maskLen + len);

      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if ((opcode === 0x1 || opcode === 0x0) && fin) log(payload.toString("utf8"));
    }
  });
  socket.on("error", () => {});
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`ext log collector (http+ws) on 127.0.0.1:${PORT} -> ${LOG}`),
);
