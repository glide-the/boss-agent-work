# 探针锚点图（background.js / browser-client.mjs）

压缩/打包后的关键函数与行为。名字可能随版本变化，按行为定位。诊断探针见 `scripts/instrument-*.js`。

## 扩展 `background.js`（解压版 1.1.5）

| 函数 | 行为 | 备注 |
| --- | --- | --- |
| `cn(tabId)` | per-tab 锁 `xt` 内：`if(!se.has){chrome.debugger.attach(tabId,"1.3"); un(); se.add}` | **修复点**：`se` 假附加时跳过真实 attach |
| `dn(tabId, targetId)` | 同上，按 targetId attach（OOPIF） | 集合 `Ze`/`Fe` |
| `ka/Ca/hn` | detach（`hn` 为超时强制 detach，清 `se`） | 只有 CDP 超时才走 `hn` |
| `Ma(e)` | 错误消息含 "Another debugger" → 视为已附加 | 重复 attach 的安全阀 |
| `La(t)` | `Target.getTargets` 特判，否则 `chrome.debugger.sendCommand` | CDP 发送点 |
| `En(t)` | `La` 与 `setTimeout(Mn(timeoutMs))` 竞速；默认 `an=1e4` | 超时抛 `CdpCommandTimeoutError` |
| `on.executeCdp`（session） | `requireSessionTab` + `se.has` 检查 → `En`；超时则 `hn` | 「Debugger unattached」抛出点 |
| `Sr/Tr.handleIncomingRequest` | JSON-RPC 分发，总是回 result/error | 挂起=handler promise 未 settle |
| `Bn` | `connectNative("com.openai.codexextension")`，断线 5s 重连 | native 传输 |
| `rn()` | 注册 `chrome.debugger.onDetach` → 清 `se/Ze/Fe` | SW 死亡期间事件丢失 |

## 内核 `browser-client.mjs`（插件缓存 26.601.21317）

| 函数 | 行为 | 备注 |
| --- | --- | --- |
| socket transport `sendMessage/handleData` | 内核↔extension-host 帧收发（`mk` 封帧） | "native pipe is closed" 来源 |
| `executeAgentCommand`（setupBrowserRuntime 内） | 找后端 → `security.ensureCommandAllowed` → 注册表 `Sq`/`jl` 分发 | 安全检查入口 |
| `Uc.ensureCommandAllowed` | `ri()` 短路 → 按命令类型查 origin | `ri()`=`Ly()==="disabled-for-local-testing"` |
| `Eh.throwIfBlocksUrl/isBlocked/fetchBlocked` | `nodeRepl.fetch(GET <D2>/aura/site_status?site_url=...)`；24h 缓存只写成功 | **30s/条根因** |
| `Dy/M2` | 构造 site_status 请求；localhost/127.0.0.1 返回 null 跳过 | |
| `N1/T1/Ic/Rc` | origin 审批：会话 toml → 全局 toml → turn 缓存 → elicitation | 审批持久化读写 |
| `Ly()` | 读 `nodeRepl.env["BROWSER_USE_SECURITY_MODE"]` | **修复点**：默认补 `"disabled-for-local-testing"` |
| `Ou(e)` | `globalThis.nodeRepl?.env[e]`（env 冻结，运行时不可写） | |
| `u1=_(oe.PlaywrightEvaluate, …)` | evaluate handler：`Page.getFrameTree` → `Page.createIsolatedWorld`（`Qo` 缓存）→ `Runtime.evaluate` | |
| `executeTargetCdp` | `ensureAttachedTab` → `api.executeCdp`；遇 "not attached" `forgetAttachedTab` 后**递归重试（无上限）** | **风暴根因** |
| `readRawCdpEvents` | `afterSequence` 等待事件，`timeoutMs` 兜底 | 只被显式命令调用 |
| `Ma`（FunctionAgentTransport） | `send({command})` → `executeAgentCommand` | tab.playwright.* 的入口 |
| 配置持久化 | `Vi="browser/config.toml"`；会话级 `browser/sessions/<threadId>.toml` | `Ic` 读任一处抛错 → 每命令 elicit |

## 相关外部位置

- 扩展目录：`/Users/dmeck/project/CodexChromePlug/codex-1.1.5_0/1.1.5_0/`（Chrome Secure Preferences `extensions.settings.hehggadaopoacecdllhhajmbjkdcmajg.path` 可查实际加载路径）
- SW 脚本缓存：`~/Library/Application Support/Google/Chrome/Default/Service Worker/ScriptCache/`（验证 reload 后新代码是否生效）
- extension-host 套接字：`/tmp/codex-browser-use/*.sock`
- 审批文件：`<CODEX_HOME>/browser/config.toml`、`<CODEX_HOME>/browser/sessions/*.toml`
