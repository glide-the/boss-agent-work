// scan.js — 岗位列表卡片扫描与滚动加载
// 注意：BOSS 列表每次渲染会重新生成加密 jobId，跨页去重须用 标题+公司+城市
export async function scanCards(tab) {
  return await tab.playwright.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll("a.job-name, a[href*=job_detail]").forEach((a) => {
      const m = (a.href || "").match(/job_detail\/([^.]+)/);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);
      let card = a;
      for (let i = 0; i < 6 && card.parentElement; i++) {
        card = card.parentElement;
        if (/job-card|card/.test(card.className || "")) break;
      }
      const txt = (card.textContent || "").replace(/\s+/g, " ").trim();
      out.push({ id: m[1], title: a.textContent.trim(), txt: txt.slice(0, 160) });
    });
    return out;
  });
}

// 滚动加载更多；连续两次无新增即停止，返回全部卡片
export async function scanAllWithScroll(tab, maxRounds = 12) {
  let prev = 0;
  let stagnant = 0;
  let cards = [];
  for (let i = 0; i < maxRounds; i++) {
    await tab.playwright.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await tab.playwright.waitForTimeout(2200);
    cards = await scanCards(tab);
    if (cards.length === prev) {
      stagnant++;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
    prev = cards.length;
  }
  return cards;
}
