// index.js — job-greet 编排入口
// 用法（node_repl 内核）：
//   const JG = await import("/Users/dmeck/project/boss-agent/src/job-greet/index.js");
//   const { tab } = await JG.setupChrome();
//   const progress = await JG.createProgress(JG.PROGRESS_FILE, ["13dbf4a6f09ad7de0nFz2dq1FFVT"]);
//   await JG.processCategory(tab, JG.CATEGORIES[0], progress, { chunkSize: 5 });
export { setupChrome, resolvePluginRoot } from "./browser.js";
export { URLS, CATEGORIES } from "./urls.js";
export { scanCards, scanAllWithScroll } from "./scan.js";
export { extractJobDetail, checkChatPage } from "./detail.js";
export { sendMessages } from "./chat.js";
export { aiMsgs, pmMsgs, itMsgs, emotionMsgs, algoMsgs, pickMsgs, setMsgsForKind, clearCustomMsgs } from "./messages.js";
export { SKIP_RE, shouldSkip, companyFromTxt, mkQ, titleKey, makeQueue } from "./filter.js";
export { createProgress } from "./progress.js";
export { processJobByUrl, runChunk } from "./process.js";

import { URLS } from "./urls.js";
import { scanAllWithScroll } from "./scan.js";
import { makeQueue } from "./filter.js";
import { runChunk } from "./process.js";

export const PROGRESS_FILE = "/Users/dmeck/project/boss-agent/data/job_greet_progress.jsonl";

// 单分类完整流程：打开搜索页 -> 滚动收集 -> 过滤去重 -> 分批沟通
// opts: { chunkSize=5, scrollRounds=10, defaultKind, onBatch }
export async function processCategory(tab, category, progress, opts = {}) {
  const chunkSize = opts.chunkSize || 5;
  const url = URLS[category.key] || category.url;
  await tab.goto(url);
  await tab.playwright.waitForTimeout(3500);
  const cards = await scanAllWithScroll(tab, opts.scrollRounds || 10);
  const queue = makeQueue(cards, progress.doneKeys, opts.defaultKind);
  const summary = { category: category.label, scanned: cards.length, queued: queue.length, results: [] };
  while (queue.length) {
    const chunk = queue.splice(0, chunkSize);
    const { results, stopped } = await runChunk(tab, chunk, category.label, progress, summary.results);
    if (opts.onBatch) await opts.onBatch(results, queue.length);
    if (stopped) {
      summary.stoppedByPlatform = true;
      break;
    }
  }
  return summary;
}
