---
name: boss-chat-reply
description: 通过 Codex Chrome 插件（@Chrome / node_repl 内核）处理 BOSS 直聘聊天页（zhipin.com/web/geek/chat）的未读会话。当用户要求「点击未读」「处理未读对话」「回复 boss」「按未读筛选逐条回复」、读取某条 BOSS 聊天并分句回复、同意招聘方的附件简历请求并发送简历、或对拒绝类消息做礼貌收尾时使用。也适用于聊天页操作排错（列表点错会话、同意误点拒绝、消息流看不到最新回复）。岗位搜索页批量「立即沟通」走 boss-job-greet，全量聊天采集走 boss-chat-collect，本技能负责会话内的读与回。
---

# BOSS Chat Reply

在已登录 BOSS 账号的 Chrome 中，处理聊天页未读会话：未读筛选 → 逐条读取 → 分句回复 / 同意简历请求 / 礼貌收尾 → 落盘。

## 硬性约束

1. 只用 Codex Chrome 插件（node_repl 内核的 `tab.playwright`）。禁止本地 Playwright/Selenium/Puppeteer/agent-browser；@Chrome 不可用立即停止并报告。
2. 出现滑块/安全验证立即停止，不绕过。
3. 发送前必须核对当前会话归属（`extractConv()` 的 `name`/`pos` 与目标一致）。归属不符，中止该条并报告。
4. 不虚构发送结果；发完用 `verifyMyLastMessages()` 核对。
5. 内核不能写文件：回复日志用 `nodeRepl.write(JSON)` 输出后由 shell 追加到项目 `data/reply_progress.jsonl`。

## 快速开始

先在外部 shell 探测 Chrome 插件路径（内核没有 `node:fs`）：

```bash
ls ~/.codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs
```

然后在 node_repl 内核中：

```js
const M = "/Users/dmeck/.agents/skills/boss-chat-reply/scripts/chat-reply";
const R = await import(`${M}/index.js`);
const { tab } = await R.connectAndOpenChat(globalThis, "<上一步的 latest 目录>");
globalThis.tab = tab;

await R.clickUnreadFilter(tab);          // 点「未读」筛选，返回 "未读(N)"
const items = await R.scanList(tab);     // 当前未读列表
```

逐条处理（每条都要重新扫描列表再点，已读条目会消失）：

```js
const r = await R.clickListConv(tab, "<titleBox 全文>");
const conv = await R.extractConv(tab);
// 核对 conv.name/pos 与预期一致后才发送：
await R.sendMessages(tab, ["第一句。", "第二句。", "第三句。"]);
await R.verifyMyLastMessages(tab, 3);
```

列表找不到时用搜索兜底（同名给公司提示词）：

```js
await R.openConvBySearch(tab, "沈女士", "飞瑞");
```

同意简历请求（仅限出现正式请求卡片时）：

```js
await R.agreeAndSendResume(tab, "ink_memory_v5");   // 关键字选中正确简历版本
```

## 脚本（scripts/chat-reply/）

| 文件 | 职责 |
| --- | --- |
| `browser.js` | `connectAndOpenChat()` 连接插件 + 新标签页打开聊天页（内核重置后重调） |
| `chat-page.js` | 未读筛选 / 列表扫描 / 点击会话 / 搜索定位 / 会话提取 / 滚到底 / 分句发送 / 发送核对 |
| `resume.js` | `agreeAndSendResume()` 简历请求同意发送（防误触拒绝）；`checkSendResumeButton()` |
| `index.js` | 汇总导出 |

## 工作流

1. 连接并打开聊天页，`clickUnreadFilter()` 切到未读，`scanList()` 拿全量未读。
2. 逐条分类（规则见 [references/reply-playbook.md](references/reply-playbook.md)）：实质提问分句回复、正式简历卡走 `agreeAndSendResume()`、模板拒绝 1 句收尾、营销号婉拒。
3. 每条：点击/搜索打开 → `extractConv()` 核对归属 → 判定类型 → 发送 → `verifyMyLastMessages()` 核对 → 日志输出落盘。
4. 全部处理完再点一次未读筛选确认清零；对仍显示未读的条目点进去 `scrollConvToBottom()` 核验（徽标跨标签页可能残留）。

## References

- [references/dom-selectors.md](references/dom-selectors.md)：筛选 tab、列表、搜索、会话区、简历卡片与弹窗的全部选择器（改脚本前先读）。
- [references/pitfalls.md](references/pitfalls.md)：实战踩坑清单——虚拟列表索引偏移、同意误点拒绝、内核重置、消息流虚拟化等，操作前必读。
- [references/reply-playbook.md](references/reply-playbook.md)：回复分类决策表、拒绝收尾标准句、拒绝判定正则。
