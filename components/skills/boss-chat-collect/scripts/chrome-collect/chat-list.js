// 聊天列表采集。BOSS 聊天列表是虚拟滚动，必须用滚轮（cua.scroll）触发加载。
// 注意：evaluate 是只读作用域，直接改 scrollTop 会被拦截，所以滚动走 CUA。

/** 抓取当前可见的列表项。 */
export async function grabVisibleItems(tab) {
  return await tab.playwright.evaluate(() => {
    const out = [];
    document.querySelectorAll(".chat-user .user-list-content li").forEach((li) => {
      const name = li.querySelector(".name-text")?.textContent?.trim() || "";
      const titleBox = li.querySelector(".title-box")?.textContent?.trim() || "";
      const lastMsg = li.querySelector(".last-msg")?.textContent?.trim() || "";
      const timeEl = li.querySelector('.time, [class*="time"]');
      const time = timeEl?.textContent?.trim() || "";
      if (name) out.push({ name, titleBox, lastMsg, time });
    });
    return out;
  });
}

/**
 * 滚动采集完整聊天列表。
 * @param tab 聊天页标签
 * @param {object} opts x,y 需落在列表区域内；连续 stableRounds 轮无新增即停
 * @returns {Promise<Array>} 按 name|titleBox 去重后的列表项
 */
export async function collectFullChatList(tab, opts = {}) {
  const { x = 300, y = 500, step = 900, maxRounds = 80, stableRounds = 6 } = opts;
  const map = new Map();
  const merge = async () => {
    for (const it of await grabVisibleItems(tab)) {
      map.set(it.name + "|" + it.titleBox, it);
    }
  };
  await merge();
  let lastN = 0, stable = 0;
  for (let i = 0; i < maxRounds && stable < stableRounds; i++) {
    await tab.cua.scroll({ x, y, scrollX: 0, scrollY: step });
    await tab.playwright.waitForTimeout(450);
    await merge();
    if (map.size === lastN) stable++;
    else { stable = 0; lastN = map.size; }
  }
  return Array.from(map.values());
}

/** 把列表滚回顶部。 */
export async function scrollListToTop(tab, opts = {}) {
  const { x = 300, y = 500 } = opts;
  for (let i = 0; i < 60; i++) {
    await tab.cua.scroll({ x, y, scrollX: 0, scrollY: -2000 });
    await tab.playwright.waitForTimeout(80);
  }
}
