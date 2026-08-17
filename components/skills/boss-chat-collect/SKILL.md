---
name: boss-chat-collect
description: 通过 Codex Chrome 插件（node_repl 内核）采集 BOSS 直聘聊天页数据并结构化为投递/岗位分析素材。当用户要求整理 BOSS 直聘聊天记录、投递反馈、沟通复盘、岗位详情（JD）采集、打开 zhipin.com/web/geek/chat 聊天列表逐条读取、或基于聊天做岗位市场分析时使用。也适用于列表限流（只剩 50 条）后的搜索补采和断点续采。
---

# BOSS Chat Collect

## Overview

在用户已登录的 Chrome 中，通过 Codex Chrome Extension（node_repl 内核的 `browser`/`tab` API）采集 BOSS 直聘聊天列表与逐条会话（职位条 + 消息流 + 系统消息），可选抽取「查看职位」JD，全程 JSONL 落盘支持断点续采。

## 硬性约束

1. 只用 Codex Chrome 插件控制浏览器（node_repl 内核）。禁止本地 Playwright/Selenium/Puppeteer/agent-browser 直连 BOSS。
2. 只读操作：不发送消息，不点击「发简历/换电话/换微信/发送」。
3. 每条采集完成立即落盘 JSONL；禁止只存内存（内核可能重置）。
4. 检测到滑块/安全验证 → 停止并报告，不绕过。
5. 单条间隔 ≥1.5s，每 40-50 条同步一次落盘到工作区。

## 快速开始

脚本位于 `scripts/chrome-collect/`，在 node_repl 内核中执行：

```js
const M = "/Users/dmeck/.agents/skills/boss-chat-collect/scripts/chrome-collect";
const bc = await import(`${M}/index.js`);
const ctx = await bc.bootstrap(globalThis, {
  sessionName: "💼 BOSS直聘采集",
  raw: "/tmp/boss_chats_raw.jsonl",
  workspaceRaw: "<项目>/data/boss_chats_raw.jsonl",
  prevRaws: ["<历史采集.jsonl>"],   // 可选：合并旧数据防重采
});
await bc.collectList(ctx);            // 全量列表 + 建队列
await bc.scrollListToTop(ctx.tab);
await bc.runScroll(ctx, 40);          // 扫场采集（列表完整时）
await bc.runSearch(ctx, 20);          // 限流后搜索补采
bc.syncToWorkspace();
```

注意：`import` 的模块字符串模板在内核中可用；若不行，用完整绝对路径逐字拼出。

## 采集工作流

1. **连接与打开**：`bootstrap()` 自动发现 Chrome 插件、打开聊天页、恢复 doneKeys。
2. **列表采集**：`collectList()` 滚轮加载全量列表（虚拟滚动，CUA 滚动），按 `name|titleBox` 去重建队列。
3. **扫场采集**：`runScroll()` 逐条点击会话 → 提取职位条/消息流/系统消息 → 落盘（~2s/条）。
4. **限流切换**：列表只返回 50 条且滚动不再加载时，改 `runSearch()` 按公司名/姓名搜索定位（~4s/条）。
5. **JD 抽取（可选）**：对重点会话（有回复/约面）调 `job-extract.js` 的 `openAndExtractJob(browser, tab)`，认领 `/job_detail/` 标签页抽取 JD。
6. **同步与交接**：`syncToWorkspace()` 落盘到项目 data 目录；后续整理（反馈判定、岗位四分类、五维拆解）按 `references/data-schema.md` 执行。

## 每轮操作前的规划协议

每轮新的页面操作（首轮打开、换批、翻页、换采集模式）前，先用一小段内部规划明确：本轮目标、输入、输出、异常处理、停止条件；然后执行，不让规划冲掉进度记忆（进度以 JSONL 为准）。

## 数据质量规则

- 每条记录可回溯：`key`（姓名|titleBox）+ `job.raw` + `listTime`。
- 去重优先按岗位详情链接，其次「公司+岗位名+城市+薪资」。
- 不确定字段标「待确认」；不臆测聊天里没说的内容；`searchMiss`/`error`/`captcha` 记录保留并统计。
- 异常标记：岗位已下架、聊天无职位入口、详情页打不开、职责过短。

## References

- [references/dom-selectors.md](references/dom-selectors.md)：聊天页/会话区/搜索/职位详情页全部 DOM 选择器与遍历方法（改脚本前先读）。
- [references/rate-limit.md](references/rate-limit.md)：限流表现、搜索兜底、节奏与异常处理（列表只剩 50 条时必读）。
- [references/data-schema.md](references/data-schema.md)：JSONL 记录结构、投递反馈判定规则、岗位四分类与五维拆解规则（整理阶段使用）。

## Scripts（scripts/chrome-collect/）

| 文件 | 职责 |
| --- | --- |
| `browser.js` | 插件路径自动发现 + bootstrap + 打开聊天页 |
| `chat-list.js` | 列表滚轮采集 / 回顶部 |
| `chat-extract.js` | 单会话提取（职位条、消息流、系统消息）+ 验证码检测 |
| `job-extract.js` | 「查看职位」详情页认领与 JD 抽取 |
| `store.js` | JSONL 落盘、doneKeys 恢复、队列构建、路径配置 |
| `collect-scroll.js` | 扫场批量采集 |
| `collect-search.js` | 搜索定位批量采集 |
| `index.js` | 编排入口（bootstrap/collectList/runScroll/runSearch/syncToWorkspace） |
