---
name: chrome-plugin-debug
description: 排查 Codex Chrome 插件（@Chrome / node_repl 内核 tab.playwright）故障的经验技能。当出现 js 调用超时、"kernel reset, rerun your request"、顶层绑定丢失（xxx is not defined）、evaluate 卡死 30-120s、tab.goto 长时间不返回、标签页变成 about:blank、浏览器自动化批处理中断需要断点恢复、插件缓存目录升级导致 Module not found、或怀疑 BOSS 等站点 WAF 限流时使用。也适用于为基于 Chrome 插件的自动化任务设计防重置、可恢复的架构。
---

# Chrome 插件调试（node_repl 内核）

通过 node_repl 内核的 `tab.playwright` 控制 Chrome 时的故障排查手册。核心教训来自 BOSS 直聘自动化（job-greet / chat-reply / chat-collect）多次实战复盘。

## 首要原则

1. **内核随时会重置，磁盘是唯一可靠状态**：所有进度立即落盘 JSONL；内核中的绑定（模块、队列、计数）都视为易失。
2. **小步快跑**：单次 js 调用目标 < 30s，硬上限 60s；批处理每批 ≤ 5 个业务对象。
3. **超时的调用不会死，会变成僵尸**：重置前先 `js_reset` 清场，否则旧调用占着事件循环，新调用排队超时。

## 症状速查

| 症状 | 原因 | 处置 |
| --- | --- | --- |
| `js execution timed out; kernel reset` | 单次调用超内核超时（约 30-60s） | 拆小调用；状态落盘；按恢复流程重建 |
| 简单调用也卡 118s 后超时 | 前一次超时调用仍在内核中运行（僵尸），新调用排队 | `js_reset` 清场，再从磁盘状态恢复 |
| 设了 `timeout_ms: 280000` 仍在 120s 失败 | MCP 工具层硬上限约 120s，与内核超时无关 | 单调用控制在 100s 内；长任务拆步 |
| busy 页面每条命令精确 30s、安静页面正常 | `site_status` 安全检查请求国内不可达，30s 超时/条 | 见 pitfalls「每条命令精确 30s」：patch `Ly()` 默认 `disabled-for-local-testing` |
| 内核重置后同标签命令永久挂起、rpc id 暴涨 | 调试器被静默 detach + 扩展 `se` 假附加 + 客户端无限重试 | `pkill -f extension-host`；patch 扩展 `cn()` 总是真实 attach |
| `xxx is not defined`（JG/tab 丢失） | 内核已被重置，顶层绑定清空 | 重新 import → setupChrome → 恢复进度 |
| `evaluate` 30s 无响应、页面"卡死" | 对认领的用户标签页操作（无 playwright 能力） | 改用 `browser.tabs.new()` 开新标签页 |
| `tab.goto` >15s URL 不变但 curl 正常 | 目标站 WAF 限流 | 立即停止，冷却 1-2 小时；不刷新轰炸、不换工具绕过 |
| 标签页变 `about:blank` | 内核剧烈重置后标签状态丢失 | 正常现象，直接重新 `tab.goto` |
| import 报 `Module not found: browser-client.mjs` | 插件缓存目录按版本号升级，旧路径失效 | 用 `.../chrome/latest` 目录或重新探测实际版本目录 |
| 输出出现 `ERROR [Statsig] ab.chatgpt.com` | 加载了仍含远程初始化的旧版个人 Browser Client | 检查实际插件版本和 `latest` 指向；升级后重新加载个人插件 |

## 标准恢复流程（内核重置后）

```js
const JG = await import("<模块绝对路径>");   // 本地文件模块每次 import 都会重载
globalThis.JG = JG;
const { tab } = await JG.setupChrome();       // 幂等重连
globalThis.tab = tab;
const progress = await JG.createProgress(JG.PROGRESS_FILE, []);  // 从 JSONL 恢复 doneKeys
// 重新注册运行时状态（消息模板、剩余清单），用 doneKeys 去重后续跑
```

## 防重置的任务设计

- 去重键、已完成集合、待处理标题清单全部落盘；重置后凭标题清单 + doneKeys 重建队列，**避免全量重扫**。
- 长列表扫描不要一把梭：`scanAllWithScroll` 在结果多、页面变慢时会超限。改为每屏 `scanCards` + 单次滚动各一次 js 调用，逐步收集目标 ID。
- 浏览器交互调用用 `Promise.race` 包 20s 快速失败，避免整批被一次卡顿拖死。
- 内核中 `node:fs/os/path` 不可用：文件路径在外部 shell 探测后以硬编码字符串传入。

## 详细坑位

完整坑位目录（含 BOSS 业务侧的点击偏移、误触等教训）见 [references/pitfalls.md](references/pitfalls.md)。插件 API 形态（playwright 子集、CUA 参数签名）见 [references/api-notes.md](references/api-notes.md)。
