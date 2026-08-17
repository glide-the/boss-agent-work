// 搜索定位批量采集。
// 背景：连续打开几百个会话后 BOSS 聊天列表只返回前 50 条（限流），
// 剩余会话无法通过滚动到达，改用左上角「搜索30天内的联系人」逐个定位。

import { extractOpenChat } from "./chat-extract.js";
import { appendRecord } from "./store.js";

const ROLE_SUFFIX =
  /(招聘者|招聘专员|HRBP|HR|人事.*|招聘主管|招聘经理|猎头.*|经纪人|行政.*|总经理|ceo|CEO|产品总监|办公室主任|执行主任|员工|负责人|业务负责人|资深招聘专家|高级招聘顾问|人力.*|全栈开发|运营总监|研发技术总监|运营|经理|主管|总监|专员|助理|顾问|主任)$/g;

/** 从 titleBox（姓名+公司+招聘人职位 拼接）中提取搜索词。 */
export function buildSearchTerm(item) {
  const companyPart = item.titleBox.startsWith(item.name)
    ? item.titleBox.slice(item.name.length)
    : item.titleBox;
  const term = companyPart.replace(ROLE_SUFFIX, "").trim();
  return term.length >= 2 ? term : item.name;
}

/** 通过搜索框定位并采集单条会话。 */
export async function processBySearch(tab, item) {
  const key = item.name + "|" + item.titleBox;
  const companyPart = item.titleBox.startsWith(item.name)
    ? item.titleBox.slice(item.name.length)
    : item.titleBox;
  const term = buildSearchTerm(item);

  const box = tab.playwright.getByPlaceholder("搜索30天内的联系人");
  await box.click();
  await box.fill(term);
  await tab.playwright.waitForTimeout(1600);

  const results = await tab.playwright.evaluate(() =>
    Array.from(document.querySelectorAll(".boss-search-result .search-list")).map((li) =>
      li.innerText.replace(/\s+/g, " ").trim()
    )
  );
  const idx = results.findIndex(
    (t) =>
      t.includes(item.name) &&
      (companyPart.length < 2 || t.replace(/\s+/g, "").includes(companyPart.slice(0, 6)))
  );
  if (idx < 0) {
    await box.fill("");
    await tab.playwright.waitForTimeout(400);
    return { key, searchMiss: true, term, results: results.slice(0, 3) };
  }

  await tab.playwright.locator(".boss-search-result .search-list").nth(idx).click();
  await tab.playwright.waitForTimeout(1800);
  const data = await extractOpenChat(tab);
  await box.fill("");
  await tab.playwright.waitForTimeout(400);
  return {
    key,
    name: item.name,
    titleBox: item.titleBox,
    listTime: item.time,
    listLastMsg: item.lastMsg,
    term,
    ...data,
  };
}

/** 搜索式批量采集。 */
export async function processSearchBatch(tab, ctx, N) {
  const { queue, doneKeys, rawPath } = ctx;
  const out = [];
  for (let i = 0; i < N && queue.length > 0; i++) {
    const item = queue[0];
    try {
      const rec = await processBySearch(tab, item);
      appendRecord(rec, rawPath);
      doneKeys.add(rec.key);
      queue.shift();
      out.push({ k: rec.key.slice(0, 24), miss: !!rec.searchMiss, msgs: rec.flowCount });
    } catch (e) {
      appendRecord(
        { key: item.name + "|" + item.titleBox, error: String(e).slice(0, 150) },
        rawPath
      );
      doneKeys.add(item.name + "|" + item.titleBox);
      queue.shift();
      out.push({ k: item.name, error: true });
    }
  }
  return {
    processed: out.length,
    remaining: queue.length,
    misses: out.filter((o) => o.miss).length,
    errors: out.filter((o) => o.error).length,
    last3: out.slice(-3),
  };
}
