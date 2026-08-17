# Native Host Rust-like Logic Reconstruction

这不是官方 Rust 源码。它是根据 Mach-O 符号、字符串协议、Chrome 扩展侧 `connectNative` / message type、以及二进制模块名进行的逻辑级语义重建。

这一版不再停留在空骨架，而是补齐了主要控制流：

- Native Messaging stdio 4-byte length prefix framing
- JSON-RPC request / response / notification 建模
- RpcRouter 的 method dispatch 和 client route 逻辑
- AppServerManager 的状态机：Uninitialized / Starting / Running / Stopped / Failed
- ClientWriterRegistry 的 register / send_to / broadcast / evict_if_same
- TabContextAssetManager 的 create / append / finish / remove 文件生命周期
- Unix socket server 的 owner-only socket / stale socket 处理路线
- PeerAuthorizer 的 macOS code identity 校验流程占位
- RolloutTracker 的 request payload 观察与 turn-ended 事件建模
- open_local_file 的路径边界检查与 open 命令构造

文件顶部均保留 evidence / confidence / original symbol anchors，避免把语义重建伪装成官方源码。
