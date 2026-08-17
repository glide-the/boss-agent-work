// 编排入口。用法（node_repl 内核中）：
//
//   const m = await import("/Users/dmeck/project/boss-agent/src/chrome-collect/index.js");
//   const ctx = await m.bootstrap(globalThis);   // 连接浏览器 + 打开聊天页
//   await m.collectList(ctx);                    // 采集全量列表并建队列
//   await m.scrollListToTop(ctx.tab);
//   await m.runScroll(ctx, 40);                  // 扫场采集 N 条
//   await m.runSearch(ctx, 20);                  // 限流后搜索补漏 N 条
//   m.syncToWorkspace();                         // 同步落盘到工作区

import { setupChrome, openChatPage } from "./browser.js";
import { collectFullChatList, scrollListToTop } from "./chat-list.js";
import { processScrollBatch } from "./collect-scroll.js";
import { processSearchBatch } from "./collect-search.js";
import { loadDoneKeys, buildQueue, syncToWorkspace, configurePaths, PATHS } from "./store.js";

export * from "./browser.js";
export * from "./chat-list.js";
export * from "./chat-extract.js";
export * from "./job-extract.js";
export * from "./store.js";
export * from "./collect-scroll.js";
export * from "./collect-search.js";

/**
 * 初始化上下文：浏览器 + 聊天页 + 状态恢复。
 * @param {object} g 内核全局对象
 * @param {object} opts { sessionName, raw, workspaceRaw, prevRaws }
 */
export async function bootstrap(g, opts = {}) {
  configurePaths(opts);
  const { browser, tab } = await setupChrome(g, opts.sessionName);
  await openChatPage(tab);
  return {
    browser,
    tab,
    rawPath: PATHS.raw,
    // 合并历史采集避免重采
    doneKeys: loadDoneKeys([PATHS.raw, ...PATHS.prevRaws]),
    chatList: null,
    queue: [],
  };
}

/** 采集全量聊天列表并构建待处理队列。 */
export async function collectList(ctx) {
  ctx.chatList = await collectFullChatList(ctx.tab);
  ctx.queue = buildQueue(ctx.chatList, ctx.doneKeys);
  return { total: ctx.chatList.length, done: ctx.doneKeys.size, queued: ctx.queue.length };
}

/** 扫场批量采集（列表未限流阶段）。调用前建议 scrollListToTop(ctx.tab)。 */
export async function runScroll(ctx, N = 40) {
  return await processScrollBatch(ctx.tab, ctx, N);
}

/** 搜索补漏采集（列表限流只显示 50 条之后）。 */
export async function runSearch(ctx, N = 20) {
  return await processSearchBatch(ctx.tab, ctx, N);
}

export { scrollListToTop, syncToWorkspace };
