// 顺序扫场批量采集：从列表当前位置向下滚动，逐个点击未处理的可见项并提取。
// 适用于列表完整加载（未限流）的阶段。

import { extractOpenChat, detectCaptcha } from "./chat-extract.js";
import { appendRecord } from "./store.js";

/**
 * @param tab 聊天页标签
 * @param {object} ctx { queue, doneKeys, rawPath }
 * @param {number} N 本轮最多处理条数
 */
export async function processScrollBatch(tab, ctx, N, opts = {}) {
  const { queue, doneKeys, rawPath } = ctx;
  const { scrollAttemptsMax = 30, waitMs = 1500 } = opts;
  const results = [];
  let scrollAttempts = 0;

  while (results.length < N && queue.length > 0 && scrollAttempts < scrollAttemptsMax) {
    const visible = await tab.playwright.evaluate(() => {
      const out = [];
      document.querySelectorAll(".chat-user .user-list-content li").forEach((li) => {
        const name = li.querySelector(".name-text")?.textContent?.trim() || "";
        const titleBox = li.querySelector(".title-box")?.textContent?.trim() || "";
        if (name) out.push({ key: name + "|" + titleBox, titleBox });
      });
      return out;
    });
    const next = visible.find((v) => !doneKeys.has(v.key));
    if (!next) {
      await tab.cua.scroll({ x: 300, y: 500, scrollX: 0, scrollY: 900 });
      await tab.playwright.waitForTimeout(550);
      scrollAttempts++;
      continue;
    }
    scrollAttempts = 0;
    const qi = queue.findIndex((q) => q.name + "|" + q.titleBox === next.key);
    const item =
      qi >= 0
        ? queue[qi]
        : {
            name: next.key.split("|")[0],
            titleBox: next.key.split("|").slice(1).join("|"),
            time: "",
            lastMsg: "",
          };
    try {
      await tab.playwright
        .locator(".chat-user .user-list-content li")
        .filter({
          hasText: item.titleBox.slice(item.name.length, item.name.length + 12) || item.name,
        })
        .first()
        .click({ timeoutMs: 5000 });
      await tab.playwright.waitForTimeout(waitMs);
      const data = await extractOpenChat(tab);
      const captcha = await detectCaptcha(tab);
      appendRecord(
        {
          key: next.key,
          name: item.name,
          titleBox: item.titleBox,
          listTime: item.time,
          listLastMsg: item.lastMsg,
          captcha,
          ...data,
        },
        rawPath
      );
      doneKeys.add(next.key);
      if (qi >= 0) queue.splice(qi, 1);
      results.push({ key: next.key.slice(0, 30), msgs: data.flowCount, captcha });
      if (captcha) {
        results.push({ STOP: "captcha" });
        break;
      }
    } catch (e) {
      appendRecord({ key: next.key, error: String(e).slice(0, 150) }, rawPath);
      doneKeys.add(next.key);
      if (qi >= 0) queue.splice(qi, 1);
      results.push({ key: next.key.slice(0, 30), error: true });
    }
  }
  return { processed: results.length, remaining: queue.length, results };
}
