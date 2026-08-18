# Browser Client 恢复证据与状态

## 1. 状态纠正与迁移结果

2026-08-18 复审确认：此前交付只完成局部源码恢复，不能称为完整的可维护模块化重建。

直接证据：

1. `components/codex-plugin/src/browser-client/index.ts` 仅从 `#browser-client-baseline` 重新导出 `setupBrowserRuntime`。
2. Bun 插件把 `#browser-client-baseline` 解析到 `components/codex-plugin/scripts-bak/browser-client.mjs` 并嵌入产物。
3. `check-extension-installed.js`、`check-native-host-manifest.js`、`chrome-is-running.js`、`installed-browsers.js`、`open-chrome-window.js` 没有 TypeScript 来源。
4. `extension-id.json`、`standalone-identity.json` 没有纳入统一生成清单。
5. 旧的生产构建、部署和验证脚本位于 `tools/browser-client-recovery`，与唯一源码根分离。

因此，旧记录中的“顶层项目 MJS 5/5”“Browser/Tab compatibility pass”只能证明旧 bundle 被保留和重新打包，不能证明 Browser Client 主体已恢复为可维护 TypeScript。

本轮已经废止上述实现：旧工具目录已删除，`index.ts` 不再导入虚拟基线模块，5 个 CLI 和 2 个配置均有 canonical 来源，Process Shim、Tab API、Browser Security 与 node_repl display bridge 已从兼容内核抽取为严格 TypeScript 并实际进入 bundle。无法用本地证据恢复为原作者模块的剩余代码保留为格式化、可审计的 `browser-runtime.generated.js`；这是语义等价 JavaScript 恢复，不是作者的字节级或完整 TypeScript 原稿。

## 2. 已确认基线

| 项目 | 结果 | 级别 |
|---|---|---|
| 备份目录 | `components/codex-plugin/scripts-bak` | confirmed |
| 备份文件数 | 344 | confirmed |
| 备份树 SHA-256 | `85d1bc4f7d456ef75eceab7df6159ebfdfce23de0af51175ec9ba2dc9e579964` | confirmed |
| Browser Client SHA-256 | `cf71c5bf138839ff6f6df07328a63d6897458f122ed68ee0bf496e301cc06c45` | confirmed |
| Browser Client bytes | 989,621 | confirmed |
| Source Map / `sourcesContent` | 未发现 | confirmed |
| 唯一导出 | `setupBrowserRuntime` | confirmed |
| 上游打包器 | esbuild-like | inferred |
| 作者原始 TypeScript | 未找到 | unresolved |

## 3. 已完成且进入生产构建的源码

| 模块 | 状态 | 证据 |
|---|---|---|
| `security/site-status-policy.ts` | 可保留 | 默认关闭、loopback-only、fail-open、缓存/并发测试通过 |
| `scripts/install-manifest.ts` | 可保留 | installer 结构化差分通过 |
| `scripts/patch-browser-client-site-status.ts` | 可保留 | patch/check 差分通过 |
| `scripts/verify-standalone.ts` | 可保留 | 三档身份检查通过 |
| 五个辅助 CLI TypeScript | 已恢复 | help、错误参数、JSON 与 synthetic fixture 双运行差分通过 |
| `runtime/process-shim.ts` | 已恢复 | 从兼容内核提取，生产 dependency graph 已确认引用 |
| `runtime/tabs.ts` | 已恢复 | 7 项核心单测中的 Tab 委托与错误诊断通过 |
| `security/browser-security.ts` | 已恢复 | URL、site_status、degraded host、origin、文件传输与 CDP 顺序测试通过 |
| `runtime/node-repl-display.ts` | 已恢复 | runtime setup 差分快照确认全局对象和 hook 形状 |
| `vendor/classic-level-adapter.ts` | 已恢复边界 | Bun 生成 adapter；锁定 `classic-level@3.0.0` |
| `browser-runtime.generated.js` | 可审计兼容内核 | 固定基线哈希物化、Prettier 格式化、生产构建不读取基线 |
| `contracts/runtime.ts` | 可保留 | 公开入口与提取模块的保守类型；未知动态边界不滥用 `any` |

## 4. 已知限制与未证明内容

- 没有 Source Map、`sourcesContent`、原始仓库或同版本 debug build，无法证明变量名、目录和类型是作者原稿。
- JSON-RPC、transport、CDP/Playwright schema 和若干内联第三方 runtime 尚未可靠拆成独立 TypeScript；它们保留在 checked-in 兼容内核并受 setup/协议/安全差分约束。
- 自动验证使用 mock node_repl、协议 fixture 和双运行快照；没有执行真实 Chrome 或 BOSS 网站动作，不能宣称网站端到端通过。
- signed `classic-level.node` 是当前 OpenAI Developer ID 签名的发布资产，npm 重新编译不能得到字节相同签名，因此以 canonical vendor asset 固定哈希并在构建时验签。

## 5. 指定交互基线

任务 `01a0053b-dd48-77f2-9e1b-6f0f56ef4b8b` 直接确认：

- marketplace `codex-chrome-automation-local`；
- plugin `chrome-dev`；
- Extension ID `jigmpnbdhhempldjgegphdgkochgpagi`；
- Native Host `com.openai.codexextension.dev`；
- 动态 loopback Runtime 可建立连接；
- 官方 Host `com.openai.codexextension` 未被替换。

该历史任务没有执行 BOSS 页面业务动作。后续只能把它用作身份、连接和 Browser Runtime 初始化基线，不能声称网站端到端行为已验证。

## 6. 新验收门槛

当前生产接管验收结果：

```text
reconstruction 五类工程资源可从基线稳定重放             PASS
src/browser-client 是唯一生产源码/构建根                 PASS
tools/browser-client-recovery 不再承担生产职责            PASS
生产依赖图不含 scripts-bak 或当前 scripts                  PASS
10 个 JS/MJS 第一方入口都有 TS 来源                       PASS
2 个 JSON 有 config 唯一来源并由构建复制/校验              PASS
第三方依赖由 Bun lock 管理并有完整性清单                   PASS
Browser Security / node_repl display / Tab API 已提取       PASS
公开导出、协议、错误和安全差分                             PASS
三档 marketplace、standalone、类型检查、测试与打包          PASS
```

验收中的“PASS”表示当前发布行为的语义等价重建和生产接管通过，不表示作者原始 TypeScript 已被完整找回。剩余兼容内核的边界属于明确记录的限制，不得使用“字节级原始源码恢复”表述。

恢复工程的具体目录、脚本、artifact schema 和便携打包命令见 `docs/browser-client-reconstruction-resources.md`。它是迁移生产构建的前置条件，不是可选附件。

## 7. 回滚原则

迁移期间不覆盖 `scripts-bak`。新构建通过全部差分前，当前 `scripts` 保持为可运行回退。迁移后的回滚命令必须位于：

```bash
cd /Users/dmeck/project/boss-agent-work/develop/components/codex-plugin/src/browser-client
bun run rollback
```

回滚在写入前验证备份树哈希，并原子恢复完整 344 文件基线；不得修改本机 Codex cache、Chrome 注册或 Native Host 注册。
