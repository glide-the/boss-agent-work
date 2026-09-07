# Chrome 空结果响应超时修复设计

日期：2026-09-07

## 问题与证据

`standalone.8` 能完成个人插件加载、`boss_repl` 初始化、Chrome backend 发现、标签页列举和标签页创建，但 `browser.nameSession()` 与 `tab.goto()` 会等待到工具层超时。故障在访问任何网站前即可复现，因此没有证据支持 BOSS 直聘屏蔽导致本次连接错误。

根因已确认：Chrome Extension 的若干成功处理器返回 `undefined`。JSON 序列化会从响应中省略 `result: undefined`，Native Pipe 实际传回 `{jsonrpc, id}`。原始基线客户端会把这类响应作为成功的 void 结果处理；`standalone.8` 替换的可取消 JSON-RPC endpoint 只处理带 `result` 或结构化 `error` 的响应，导致 pending request 永不结束。扩展存储中出现失败任务的会话标题记录，证明 `nameSession` 副作用已执行而响应未被客户端结算。

升级后还发现一个旧 Native Host 进程仍打开已被安装器移入备份目录的 `.4` 文件映像。最小重载后，进程已确认使用 `.8` 二进制，但超时仍可复现，因此该版本漂移是需要恢复的运行状态，不是本次持续超时的根因。

## 最小方案

在 `CancellableJsonRpcEndpoint.handleIncomingMessage` 中保留现有错误解析；对于带匹配 `id`、没有结构化错误的响应，直接用 `message.result` 结束请求。字段缺失时该值为 `undefined`，与基线行为和 void API 语义一致。

不修改扩展 ID、Native Host 名称、代码签名、Native Messaging 协议、个人插件授权、旧 SHA 环境变量或站点安全策略。无需修改 Native Host 或 Chrome Extension。补充一个回归测试，模拟 JSON 序列化后的 id-only 成功响应，并断言请求以 `undefined` 完成且 pending 状态归零。

## 方案评审

| 检查项 | 结论 | 理由 |
| --- | --- | --- |
| 解决实际根因 | 通过 | 恢复基线对 void JSON-RPC 成功响应的兼容行为。 |
| 是否隐藏站点错误 | 通过 | 失败在网站访问前复现；修复只处理传输响应结算。 |
| 是否修改信任边界 | 通过 | 仅已匹配 pending id 的受信 Native Pipe 响应可结算；远端 error 仍拒绝。 |
| 是否需要 Native Host/扩展改造 | 通过，无需修改 | Host 已透传响应，Extension 已执行命令；缺陷位于客户端替换 endpoint。 |
| 是否过度设计 | 通过 | 一处分支修改和一项回归测试，无新变量、服务或协议版本。 |
| 兼容性 | 通过 | 有 `result` 的响应保持原值；id-only void 响应恢复基线语义；通知和未知 id 仍忽略。 |
| 可测试与回滚 | 通过 | Bun 单测、可复现构建、真实新任务读写隔离验证；回滚到修改前 scripts 快照。 |

## 验收

1. Bun 单测、类型检查、canonical build/verify 通过。
2. 真实新任务依次完成 `nameSession`、`tabs.list`、`tabs.new`。
3. 普通公开页 `https://example.com` 能完成导航并读取 URL/title。
4. 随后只读访问 BOSS 搜索页，记录 URL/title 与验证码、访问限制、登录或网络错误状态。
5. 不点击岗位、不提交表单、不发送消息、不上传文件。
6. 若只完成初始化或标签页读取，不宣称页面控制已恢复。

## 回滚

部署前将本轮会变化的 `browser-client.mjs` 和 `browser-service.mjs` 保存到 `components/codex-plugin/scripts-bak/snapshots/standalone.8-void-response-hang-prechange/`。回滚时恢复这两个文件并重新执行部署一致性检查；用户级 Native Host 与信任配置无需改变。

## 实施后证据

- Browser Client 34 项 Bun 单测与 TypeScript 类型检查通过，新增的 id-only void 响应回归用例通过。
- `.9` 用户级安装和带预期摘要的 preflight 通过；第二次 reconcile 返回 `no-op`。旧 `NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` 保留两个历史值，未加入 `.9` 摘要。
- 全新 Codex CLI 任务 `01a07ac8-ac88-72e0-8224-719ceaf44992` 从 `.9` 路径加载 `boss_repl`。`nameSession` 工具回执为 15 ms；访问 `https://example.com/` 并读取 `Example Domain` 用时 492 ms；随后访问 BOSS 公开搜索页并读取 `BOSS直聘` 用时 468 ms。
- 真实验收没有点击、输入、投递、发送消息、填写表单或上传文件，结束时清理了测试标签页。
- Desktop GUI 进程未被自动关闭。安装后、重启前创建的 GUI 任务仍登记 `.8`，所以 GUI 插件目录刷新仍需完整重启后验证。
