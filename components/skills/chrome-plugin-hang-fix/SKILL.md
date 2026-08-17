---
name: chrome-plugin-hang-fix
description: 诊断并修复 Codex Chrome 插件（@Chrome / node_repl 内核 / browser-client.mjs / 解压版扩展）的两类确定性卡顿：每条 playwright 命令精确耗时 30 秒（busy 页面必现、安静页面正常），以及内核重置后同标签命令永久挂起（RPC id 暴涨的重试风暴）。当观测到「每条命令 30.0x 秒」「第一条命令成功后续命令挂死」「native-host:N:大编号」「evaluate 30s 才返回但扩展侧 5ms 就处理完」时使用。也适用于需要给 browser-client.mjs 或扩展 background.js 打功能补丁、插桩双侧日志、定位命令链路（内核→extension-host→扩展 Service Worker→chrome.debugger）延迟的场景。通用内核重置/绑定丢失/WAF 限流问题走 chrome-plugin-debug，本技能专攻延迟与挂起的根因修复。
---

# Chrome 插件卡顿与挂起修复

针对 Codex Chrome 插件链路（内核 browser-client → extension-host → 扩展 SW → chrome.debugger）的确定性延迟/挂起。通用内核重置/僵尸调用/WAF 问题见 `chrome-plugin-debug` 技能。

## 快速判定

| 观测 | 根因 | 处置 |
| --- | --- | --- |
| 每条命令恰好 30.0x s；example.com 正常、BOSS 等 busy 页面必现 | `ensureCommandAllowed`→`throwIfBlocksUrl` 每条命令请求 `/aura/site_status`，网络不可达挂满 30s 超时；失败不写缓存，条条都罚 | `scripts/apply-latency-fixes.js` |
| origin 授权每条命令都问、30s 自动放行 | 全局 `browser/config.toml` 缺失导致持久化审批读不到 | 同上（脚本会补建 config.toml） |
| 内核重置后同标签命令 >110s 无响应；扩展日志 rpc id 暴涨（如 `native-host:4:47106`） | 调试器被 Chrome 静默 detach，扩展 `se` 集合假附加 → sendCommand 秒败 → 客户端无限重试；extension-host 独立于内核存活，风暴跨重置持续 | `pkill -f extension-host`，再跑 `scripts/apply-latency-fixes.js`（含 cn() 总是 attach 补丁） |

## 修复流程

1. `pkill -f extension-host`（杀掉可能存在的重试风暴；内核会按需重启它）。
2. `node scripts/apply-latency-fixes.js`：幂等打三个补丁（均先备份、锚点计数校验、`node --check`）：
   - `browser-client.mjs`：`Ly()` 默认返回 `"disabled-for-local-testing"`，跳过 site_status 网络检查与 origin elicitation（本地自动化场景等价于设 `BROWSER_USE_SECURITY_MODE`，但 `nodeRepl.env` 冻结只能改码）。
   - 扩展 `background.js`：`cn()` 去掉 `if(!se.has(t))` 跳过逻辑，总是真实 `chrome.debugger.attach`（重复 attach 报 "Another debugger" 被 `Ma()` 吞掉），自愈假附加。
   - `<CODEX_HOME>/browser/config.toml`：补建全局 origins 审批（`--origins` 指定，默认 zhipin+example）。
3. 让用户在 `chrome://extensions` 重载 Codex 扩展（扩展代码只在 reload 时重读，无法免用户操作）。
4. 验证：新内核会话开 BOSS 聊天页，连续两次 `evaluate` 应 <100ms；再测一次 `locator.click`。

回滚：恢复同目录 `.bak-latency-fix`（扩展）与 `.bak-xk`（客户端）备份，重载扩展。

## 诊断方法（修复不匹配新症状时）

原则：**双侧打点时间戳对齐**。扩展侧处理 CDP 只要 5ms，若端到端 30s，延迟必在「内核 sock 静默期」，逐段打点即可夹出位置。

1. `node scripts/log-collector.js`（放 PTY 常驻，exec 后台 nohup 会被回收）：HTTP+WS 双通道 JSONL 收集器，默认 `127.0.0.1:8791` → `/tmp/ext-log.jsonl`。
2. `node scripts/instrument-extension.js`：给扩展 `background.js` 插 8 个探针（attach、executeCdp、En 超时、RPC 收发、onDetach/onEvent），WS 上报（**不要用 fetch**：Chrome 150 PNA 静默拦截 SW→127.0.0.1 的 fetch，连 preflight 都不发；WS 被 CSP `connect-src` 放行）。
3. `node scripts/instrument-client.js`：给 `browser-client.mjs` 插内核侧探针（sock 收发、executeTargetCdp、playwright handler、Ic 决策），用裸 `fetch` 批量上报（**内核无全局 WebSocket**；`console.error` 输出随 js 调用超时丢失，必须外发）。
4. 重载扩展 → 复现一次 → `grep -v dbg.onEvent /tmp/ext-log.jsonl` 按时间戳对齐两侧，看命令停在哪一段。
5. 诊断完务必还原（脚本均有备份），只留功能补丁。

## 关键事实（避免重走弯路）

- 链路：js → browser-client（内核）→ extension-host（Rust，经 unix socket）→ 扩展 SW（native messaging）→ chrome.debugger。extension-host 独立存活，内核重置不杀它；僵尸风暴直接 `pkill -f extension-host`。
- 内核 `nodeRepl.env` 冻结（不可运行时加 env）；内核有裸 `fetch`（无 allowlist），`nodeRepl.fetch` 才有 allowlist。
- 扩展是本地解压包，可直接改码；改后必须 `chrome://extensions` 手动 reload；`~/Library/Application Support/Google/Chrome/Default/Service Worker/ScriptCache/` 可确认新代码是否加载。
- MV3 SW 会被 30s 空闲杀死，事件（如 onDetach）在 SW 死亡期间丢失 → `se` 类内存状态会与 Chrome 真实状态脱节。
- 每条命令的安全检查链：`ensureCommandAllowed` → `throwIfBlocksUrl`（site_status 网络请求）+ origin elicitation（`nodeRepl.createElicitation`，30s 自动超时）。审批持久化在 `<CODEX_HOME>/browser/config.toml`（全局）与 `browser/sessions/<threadId>.toml`（会话级）。
- 脚本路径中的插件缓存目录含版本号，升级后失效：脚本内一律用 `.../chrome/latest/scripts/browser-client.mjs`，扩展目录通过 `manifest.json` 探测（见 scripts 内 `findExtensionDir`）。

## 参考

- [references/case-study-30s-hang.md](references/case-study-30s-hang.md)：2026-07-27 完整破案记录（症状时间线、证据、逐段代码分析），遇到变体症状时对照。
- [references/probe-map.md](references/probe-map.md)：background.js / browser-client.mjs 关键函数锚点图，插桩或打新补丁时定位用。
