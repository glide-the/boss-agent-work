# Browser Client 恢复证据与验证记录

## 基线

| 项目 | 结果 | 级别 |
|---|---|---|
| 当前 bundle SHA-256 | `cf71c5bf138839ff6f6df07328a63d6897458f122ed68ee0bf496e301cc06c45` | confirmed |
| AST parser | TypeScript Compiler API 6.0.3，0 parse diagnostics | confirmed |
| 公开导出 | `setupBrowserRuntime`，local symbol `ATe`，offset 989580，line 3255 | confirmed |
| Source Map | 无 `.map`、无 marker、无 `sourcesContent` | confirmed |
| 打包器 | esbuild | inferred |
| 运行环境 | Node ESM / node_repl，使用 Node 标准库与 process shim | confirmed |
| 原始作者源码 | 未找到 | unresolved |

## 修改前基线测试

2026-08-18 在当前工作树运行：

```text
node --check browser-client.mjs                         PASS
动态 import + export keys                              PASS: [setupBrowserRuntime]
site-status-policy.test.mjs                            PASS: 16/16
patch-browser-client-site-status.mjs --check           PASS
verify-standalone.mjs                                  NOT RUNNABLE IN SOURCE TREE
```

`verify-standalone.mjs` 需要已组装插件内的 `components/codex-plugin/chrome-extension/manifest.json`；源码树没有该文件，因此报 `ENOENT`。这不是身份检查通过，也不是 Browser Client 行为失败。只有 marketplace 组装后才能执行该检查。

## Confirmed

1. `setupBrowserRuntime` 是唯一 ESM export。
2. `setupBrowserRuntime` 初始化路径会安装 `agent` 和 `display`，并使用 node_repl telemetry/response metadata。
3. navigate command 进入 `ensureCommandAllowed`，目标 URL 走 `ensureTargetUrlOriginAllowed`。
4. `ensureTargetUrlOriginAllowed` 顺序为：`ensureUrlPolicyAllowed` → degraded host check `oP` → `ensureUrlOriginConsentAllowed`。
5. `ensureUrlPolicyAllowed` 顺序为基础 URL policy `GH` → 本地 `site_status` adapter `nP`。
6. origin、file upload/download、page asset、full CDP/raw CDP 使用独立授权函数。
7. `site_status` 默认关闭；启用时只接受 loopback service；运行错误 fail-open；配置错误不被吞掉。
8. `/aura/identity` 的 ChatGPT endpoint 字符串仍存在，恢复工作没有修改它。
9. 当前 bundle 含 punycode、Statsig、Zod 等第三方实现。
10. Git HEAD 与 chrome-dev 26.707.30751-standalone.3 cache bundle 字节一致。

## Inferred

1. 打包器为 esbuild，置信度 medium-high；没有 banner、metafile 或 source map 可直接确认。
2. line 76 的大区域聚合了 schema、Browser API、JSON-RPC 和 telemetry；缺少原模块路径，具体文件边界为模块候选而非原始边界。
3. Native Host/Chrome Extension 的端到端路径可由协议和相邻项目确认，但 Browser Client 内动态 backend dispatch 需要 mock transport 或真实环境才能完全证明。

## Reconstructed

| 名称/模块 | 证据 | 置信度 |
|---|---|---|
| `SetupBrowserRuntimeOptions` | 唯一 export 与入口参数解构 | high |
| `BrowserRuntimeGlobals` | globals 注入和 node_repl 动态访问 | medium |
| `BaselineRuntimeModule` | export 集合 | high |
| `SiteStatusConfiguration` | 现有独立模块的返回对象 | high |
| `SiteStatusRequest` | endpoint/cacheKey/displayUrl/diagnostic 数据流 | high |
| `compatibility-runtime` | 阶段性架构选择，不是上游原模块 | explicit reconstruction |

## Unresolved

1. 作者原始目录、模块名、局部变量名和注释。
2. 原始 TypeScript interface、generic 和 private/public 设计。
3. esbuild 具体版本、构建参数和完整 dependency manifest。
4. 所有动态 Proxy/reflection/transport call 的精确调用图。
5. Browser/Tab API 全对象在独立恢复实现中的行为等价性。
6. 三档 marketplace 切换到候选后的结果；当前没有切换。
7. 真实 Chrome、Native Host 和外部网站验证；当前未获授权且未执行。

## 第一阶段差分结果

`tools/browser-client-recovery/verify-recovery.mjs` 已确认：

- 当前 bundle 与 AST fingerprint 哈希一致。
- baseline/candidate export keys 均为 `setupBrowserRuntime`。
- candidate 可以动态 import。
- baseline JS policy 与 recovered TS policy 的导出集合一致。
- 默认关闭不请求。
- 本地启用只访问 loopback endpoint。
- `www.` host cache 归一化一致。
- 网络失败 fail-open 和脱敏 diagnostic 一致。
- 同 host 并发请求合并一致。
- blocked error class/message 一致。
- origin、file transfer、full CDP 和 `/aura/identity` 锚点仍存在。
- ChatGPT remote `site_status` fallback 没有重新出现。

## 证据文件

- `recovery/browser-client/analysis/bundle-fingerprint.json`
- `recovery/browser-client/analysis/ast-inventory.json`
- `recovery/browser-client/analysis/protocol-string-index.json`
- `recovery/browser-client/analysis/call-graph.json`
- `recovery/browser-client/analysis/module-boundaries.json`
- `recovery/browser-client/fixtures/baseline-manifest.json`
- `recovery/browser-client/dist/build-manifest.json`

## 验收状态

| 验收项 | 状态 | 说明 |
|---|---|---|
| 模块可解析和可构建 | PASS | strict TypeScript + Node ESM candidate |
| 公开导出集合 | PASS | `[setupBrowserRuntime]` |
| `setupBrowserRuntime` 可导入 | PASS | candidate import smoke |
| Browser/Tab 基本对象结构 | DEFERRED | 仍由兼容内核提供，尚无独立 mock snapshot |
| `tab.goto` 调用链 | STATIC PASS | AST/锚点确认；独立实现未完成 |
| 基础 URL 安全检查 | STATIC PASS | 调用顺序确认 |
| `site_status` 默认关闭 | PASS | 双运行差分 + 现有单测 |
| `site_status` 本地启用 | PASS | 双运行差分 + 现有单测 |
| origin 授权 | STATIC PASS | 独立调用链锚点保留 |
| 文件传输授权 | STATIC PASS | 独立调用链锚点保留 |
| 错误文本/类型 | PARTIAL PASS | `site_status` 已差分；全 bundle 未完成 |
| 缓存 TTL/并发合并 | PASS | 现有单测 + 双运行差分 |
| Extension/Native Host 协议 | DEFERRED | 未重写，尚无 mock 双运行 |
| 无效输入/超时/连接失败 | PASS for site_status | 全命令面待恢复 |
| 三档 marketplace 构建 | PASS for current entry | baseline、extension-dev、full-reconstructed 均组装并通过插件验证；候选未接入 |
| standalone 身份检查 | PASS for current entry | 三档 `correct: true`、failures 为空；扩展 ID 与 Native Host 身份一致 |

## 最终本地验证

2026-08-18 完成：

```text
bun frozen install + analyze + strict build + bundle + diff PASS
recovery dist repeated-build aggregate hash                 PASS
  b28e18002e75069632d7ffcd9f6d9d1673bc81c5f0a33f9b7d8fcd37956c91d5
site_status tests                                            PASS 16/16
electron/manual-install tests                                PASS 8/8
skill validators                                             PASS 7/7
baseline marketplace assembly                               PASS
extension-dev marketplace assembly                          PASS
full-reconstructed marketplace assembly                     PASS
standalone identity in all three assembled profiles          PASS
project scripts/verify.sh                                    PASS
```

Bun 构建产物：

```text
recovery/browser-client/dist/browser-client.mjs
  Bun.build Node ESM bundle；唯一导出 setupBrowserRuntime
recovery/browser-client/dist/security/site-status-policy.mjs
  Bun.build Node ESM bundle；用于与现行策略双运行差分
recovery/browser-client/dist/build-manifest.json
  Bun/TypeScript 版本、构建参数、输入/输出哈希
```

身份验证结果为扩展 ID `jigmpnbdhhempldjgegphdgkochgpagi`、Native Host `com.openai.codexextension.dev`。这些组装验证继续使用现行 `scripts/browser-client.mjs`；恢复 candidate 没有接入 marketplace。

## 回滚

现行 bundle、assembly 入口和插件身份未被恢复工程改写。停止使用候选只需不运行或删除独立恢复目录；`scripts/browser-client.mjs` 仍是可用基线。未经明确要求，不提交、不推送、不修改本机 Codex/Chrome 注册。
