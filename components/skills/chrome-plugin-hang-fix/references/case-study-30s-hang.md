# 案例：每条命令 30 秒与命令永久挂起（2026-07-27）

环境：macOS arm64，Chrome 150.0.7871.184，解压版 Codex 扩展 1.1.5（`hehggadaopoacecdllhhajmbjkdcmajg`），node_repl 内核 + `browser-client.mjs`（插件缓存 26.601.21317），国内网络。

## 目录

- 症状时间线
- 系统链路与诊断设施
- 根因一：site_status 检查每条命令罚 30s
- 根因二：origin elicitation 30s 自动超时
- 根因三：静默 detach + 假附加 + 无限重试风暴
- 修复与验证
- 方法论要点

## 症状时间线

1. 上午：插件正常（BOSS 聊天回复流程可用）。
2. 下午：每条 `tab.playwright.*` 命令恰好耗时 30.0x s（30036-30077ms），但总能成功；内核重置后同标签页的命令变成 >110s 永久挂起。
3. 对照实验：example.com 上 evaluate 66ms/39ms；BOSS（zhipin.com）上稳定 30s。证明与站点有关、与扩展/CDP 无关。
4. 扩展侧探针显示：`Runtime.evaluate` 从 `En.begin` 到 `En.resp` 只要 5-13ms，但 rpc.in 比内核发起时刻晚 30.0s → 延迟在内核发出之前。
5. 内核侧探针显示：`tabs.get` 完成后静默 30.0s，随后 `pweval.enter`，37ms 内完成全部 CDP 调用。

## 系统链路与诊断设施

```
js 调用 → browser-client.mjs（内核 Node 进程）
        → extension-host（Rust 二进制，unix socket，/tmp/codex-browser-use/*.sock）
        → 扩展 Service Worker（chrome.runtime.connectNative）
        → chrome.debugger（CDP）
```

- extension-host 独立于内核存活：内核 `js_reset` 不会杀它，其内部状态（含重试循环）跨内核重置持续。
- 扩展 SW 与内核都可改码插桩。日志通道：
  - 扩展 SW → 127.0.0.1 **fetch 被 Chrome 150 PNA 静默拦截**（服务器连 preflight 都收不到）；改用 **WebSocket**（manifest CSP `connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*` 放行）。
  - 内核无全局 `WebSocket`，用裸 `fetch` 批量 POST（`nodeRepl.fetch` 有 allowlist，裸 `fetch` 没有）。
  - `console.error` 在 js 调用超时时全部丢失，必须外发。
- MV3 SW 30s 空闲被杀；SW 死亡期间 `chrome.debugger.onDetach` 等事件丢失。

## 根因一：site_status 检查每条命令罚 30s

每条带 `tab_id` 的命令在 `executeAgentCommand` 里先过 `security.ensureCommandAllowed`：

```
ensureCommandAllowed → ensureCurrentTabOriginAllowed → ensureUrlOriginAllowed
  → uk(t, backend) = _j.throwIfBlocksUrl(url)
  → isBlocked → fetchBlocked → ak(endpoint) = nodeRepl.fetch(GET https://chatgpt.com/aura/site_status?site_url=...)
```

- 国内网络下该请求挂满 **30s 网络超时**，`throwIfBlocksUrl` catch 后放行（fail-open）。
- 成功才写 24h 缓存；**超时不写缓存 → 每条命令都重新罚 30s**。
- `Dy()` 对 localhost/127.0.0.1 直接返回 null（不查），解释了为何本地/部分页面无延迟。

## 根因二：origin elicitation 30s 自动超时

同一检查链里还有 `N1(ti, origin)`：

```
T1 → Ic：依次查 会话级 browser/sessions/<threadId>.toml、全局 browser/config.toml、网络策略
  → 无决定时 nodeRepl.createElicitation({message:"Allow Browser Use to access <origin>?", persist:"always"})
```

- elicitation 发给 MCP 客户端（Codex 桌面 app）；app 不弹窗时 **30s 后自动 accept**。
- 全局 `browser/config.toml` 缺失时 `Ic` 的 try 块抛错 → `catch{return null}` → 每条命令都走 elicitation（会话级审批文件存在也读不到）。
- 补建全局 config.toml 后会话/全局审批生效，elicitation 不再触发（但 site_status 的 30s 仍在）。

## 根因三：静默 detach + 假附加 + 无限重试风暴

内核重置（或 Chrome 150 的静默 auto-detach）后：

1. Chrome 侧调试器已断开；扩展 `background.js` 的 `se`（已 attach 集合）仍含该 tab —— SW 未收到/未处理 `onDetach`。
2. 客户端重连后调 `attach`：扩展 `cn()` 因 `se.has(tabId)` **跳过真实 attach**，秒回 ok。
3. `executeCdp` → `chrome.debugger.sendCommand` 秒败 "Debugger is not attached"（非超时错误，不触发 `hn()` 强分离，`se` 永不清除）。
4. 客户端 `executeTargetCdp` 遇 "not attached" 即 `forgetAttachedTab` + 递归重试 → **无限循环**（实测 80 秒 47000+ 次 RPC，`native-host:4:47106`）；extension-host 独立存活使风暴跨内核重置继续。
5. 此前观测到的「第一条命令恰好 30.05s 成功」是同一重试循环撞上 `En` 的 10s CDP 超时 → `hn()` 清 `se` → 下次 attach 变真实 → 成功的组合耗时。

## 修复与验证

| 补丁 | 位置 | 效果 |
| --- | --- | --- |
| `Ly()` 默认 `"disabled-for-local-testing"` | `browser-client.mjs` | 跳过 site_status 与 elicitation；evaluate 30054ms → 8-36ms |
| `cn()` 总是真实 attach（去掉 `if(!se.has(t))`） | 扩展 `background.js` | 假附加自愈，客户端首次重试即成功，风暴消失 |
| 补建 `<CODEX_HOME>/browser/config.toml` | CODEX_HOME | 全局 origin 审批落盘，elicitation 免触发 |

验证：扩展 reload 后，新内核会话 BOSS 聊天页 eval1 30ms / eval2 14ms / 点击未读+读列表 1.8s。

注意：`Ly()` 补丁关闭了全部 browser-use 安全检查（URL 黑名单、origin 授权、下载/上传检查），仅适合本机自用自动化；共享/生产环境应改用 `BROWSER_USE_SECURITY_MODE` 环境变量或只补 config.toml。

## 方法论要点

1. **先分段计时再读码**：双侧时间戳对齐把「30s」锁定在「内核 sock 静默期」，避免在扩展/CDP 里瞎找。
2. **对照页面**：busy 页 vs example.com 一组对照就把 CDP/扩展嫌疑排除。
3. **异常计数是信号**：rpc id `47106` 直接暴露重试风暴；`grep -c rpc.in` 是最便宜的健康检查。
4. **改码探针 > 猜**：扩展和客户端都是本地 JS，锚点替换 + 备份 + `node --check` 的探针成本远低于静态阅读压缩代码。
5. **传输通道先验证**：PNA 拦截 SW fetch 浪费了一轮迭代；新通道先用自测消息确认再插满探针。
6. **僵尸进程**：挂起类问题先 `pgrep -fl extension-host` 看是否有存活风暴，再开始诊断。
