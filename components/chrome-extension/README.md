# Boss投递 Chrome 扩展源码

此目录基于 Codex for Chrome 1.1.5 的 TypeScript/React 语义重建源码，并应用 Boss投递独立身份：

- 扩展名称：`Boss投递`
- 扩展版本：`1.1.5.2`
- Native Host：`com.openai.codexextension.dev`
- 固定扩展 ID：`jigmpnbdhhempldjgegphdgkochgpagi`

这不是 OpenAI 官方源代码的字节级恢复。构建结果用于开发和协议验证，发布前仍需完成 Chrome 实机测试。

运行 `make extension` 构建，产物输出到工作区根目录的 `dist/chrome-extension/`。

## 浏览器操作取消协议

`executeCdp` 可携带 `operationId` 与操作名。扩展为这些调用维护有界的在途
注册表；原生 JavaScript Dialog 打开、调用方发送
`cancelBrowserOperation`、标签关闭或 Native Host 断连时，会取消对应操作并
detach 调试器。错误通过 JSON-RPC `data` 返回操作名、tab ID、取消原因、
Dialog 状态、request ID 与浏览器侧清理结果。重复取消幂等，晚到的 CDP
结果不会重新登记操作。Native Host 自动重连每轮最多 5 次，并采用有上限的
指数退避。
