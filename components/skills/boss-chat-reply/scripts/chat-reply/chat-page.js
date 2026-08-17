// chat-page.js — BOSS 聊天页操作原语（2026-07-22 验证）
// 所有函数在 node_repl 内核中运行，tab 来自 browser.js 的 connectAndOpenChat()。

/** 点击列表上方的「未读」筛选 tab（label-list 中的 li）。返回未读计数文本，如 "未读(29)"。 */
export async function clickUnreadFilter(tab) {
  const idx = await tab.playwright.evaluate(() => {
    const lis = Array.from(document.querySelectorAll('.chat-user .label-list li'));
    return lis.findIndex(l => l.textContent.trim().startsWith('未读'));
  });
  if (idx < 0) return null;
  await tab.playwright.locator('.chat-user .label-list li').nth(idx).click({ timeoutMs: 8000 });
  await tab.playwright.waitForTimeout(2500);
  return await tab.playwright.evaluate(() => {
    const lis = Array.from(document.querySelectorAll('.chat-user .label-list li'));
    return lis.find(l => l.textContent.trim().startsWith('未读'))?.textContent?.trim() || null;
  });
}

/** 扫描当前渲染的列表项。返回 [{name,titleBox,lastMsg,time,badge}]。 */
export async function scanList(tab) {
  return await tab.playwright.evaluate(() => {
    const lis = Array.from(document.querySelectorAll('.chat-user .user-list-content li'));
    return lis.map(li => ({
      name: li.querySelector('.name-text')?.textContent?.trim() || '',
      titleBox: li.querySelector('.title-box')?.textContent?.trim() || '',
      lastMsg: (li.querySelector('.last-msg')?.textContent?.trim() || '').slice(0, 60),
      time: (li.querySelector('.time') || li.querySelector('[class*="time"]'))?.textContent?.trim() || '',
      badge: li.querySelector('[class*="badge"], [class*="unread"], [class*="count"], [class*="num"]')?.textContent?.trim() || '',
    }));
  });
}

/**
 * 在当前筛选列表中按 titleBox 全等匹配点击会话。
 * 警告：虚拟滚动列表 evaluate 找 idx 与 locator.nth(idx) 点击之间存在重排窗口，
 * 可能点到错误会话（见 references/pitfalls.md P1）。点击后返回当前会话姓名，
 * 调用方必须核对与预期一致再发送消息；不一致时中止该条并报告，不得将错就错发送。
 * 找不到时向下滚动重试，最多 8 次。
 */
export async function clickListConv(tab, titleBoxText) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const idx = await tab.playwright.evaluate((tb) => {
      const lis = Array.from(document.querySelectorAll('.chat-user .user-list-content li'));
      return lis.findIndex(l => l.querySelector('.title-box')?.textContent?.trim() === tb);
    }, titleBoxText);
    if (idx >= 0) {
      await tab.playwright.locator('.chat-user .user-list-content li').nth(idx).click({ timeoutMs: 5000 });
      await tab.playwright.waitForTimeout(1800);
      const cur = await tab.playwright.evaluate(() =>
        document.querySelector('.chat-conversation [class*="name"]')?.textContent?.trim() || '');
      return { ok: true, currentName: cur, expected: titleBoxText };
    }
    await tab.cua.scroll({ x: 300, y: 500, scrollX: 0, scrollY: 600 });
    await tab.playwright.waitForTimeout(900);
  }
  return { ok: false };
}

/**
 * 搜索定位会话（列表限流或点击失败时的首选兜底，稳定性高于滚动）。
 * 搜索框只覆盖 30 天内联系人。companyHint 用于同名联系人消歧（匹配结果文本）。
 */
export async function openConvBySearch(tab, name, companyHint = null) {
  const box = tab.playwright.getByPlaceholder("搜索30天内的联系人");
  await box.click({ timeoutMs: 8000 });
  await tab.playwright.waitForTimeout(400);
  await box.fill("", { timeoutMs: 5000 }).catch(() => {});
  await box.type(name, { timeoutMs: 8000 });
  await tab.playwright.waitForTimeout(2500);
  const pick = await tab.playwright.evaluate((hint) => {
    const lis = Array.from(document.querySelectorAll('.boss-search-result .search-list li, [class*="search-result"] li'));
    const texts = lis.map(li => li.textContent.replace(/\s+/g, ' ').trim());
    let idx = texts.length ? 0 : -1;
    if (hint) {
      const h = texts.findIndex(t => t.includes(hint));
      idx = h >= 0 ? h : -1;
    }
    return { texts, idx };
  }, companyHint);
  if (pick.idx < 0) return { ok: false, results: pick.texts };
  await tab.playwright.locator('.boss-search-result .search-list li, [class*="search-result"] li')
    .nth(pick.idx).click({ timeoutMs: 8000 });
  await tab.playwright.waitForTimeout(2200);
  return { ok: true, picked: pick.texts[pick.idx] };
}

/**
 * 提取当前会话：会话人姓名 + 职位条 + 最近 20 条消息（含方向）。
 * 消息流也是虚拟化的：核验我方最新回复是否落在此会话时，先 scrollConvToBottom()。
 */
export async function extractConv(tab) {
  return await tab.playwright.evaluate(() => {
    const pos = document.querySelector('.chat-conversation .chat-position-content')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const name = document.querySelector('.chat-conversation [class*="name"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 40) || '';
    const items = Array.from(document.querySelectorAll('.chat-conversation .message-item, .chat-conversation li.item-time'));
    const msgs = items.slice(-20).map(el => {
      if (el.classList.contains('item-time')) return { who: 'time', text: el.textContent.trim() };
      const who = el.classList.contains('item-myself') ? 'me' : el.classList.contains('item-friend') ? 'boss' : 'sys';
      const t = el.querySelector('.message-content .text')?.textContent?.trim()
        || el.querySelector('.message-content')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      return { who, text: t.slice(0, 300) };
    }).filter(m => m.text);
    return { name, pos, msgs };
  });
}

/** 把消息流滚到底部（核验我方最新回复是否存在于此会话时用）。 */
export async function scrollConvToBottom(tab) {
  for (let i = 0; i < 4; i++) {
    await tab.cua.scroll({ x: 1100, y: 500, scrollX: 0, scrollY: 1500 });
    await tab.playwright.waitForTimeout(700);
  }
}

/** 分句发送：每句一条消息，Enter 发送。返回发送句数。 */
export async function sendMessages(tab, msgs) {
  const input = tab.playwright.locator("#chat-input");
  await input.click({ timeoutMs: 8000 });
  for (const m of msgs) {
    await input.type(m, { timeoutMs: 15000 });
    await tab.playwright.waitForTimeout(350);
    await input.press("Enter", { timeoutMs: 5000 });
    await tab.playwright.waitForTimeout(800);
  }
  return msgs.length;
}

/** 验证最后 N 条我方消息文本（发送后核对）。 */
export async function verifyMyLastMessages(tab, n = 3) {
  return await tab.playwright.evaluate((cnt) => {
    const items = Array.from(document.querySelectorAll('.chat-conversation .message-item.item-myself')).slice(-cnt);
    return items.map(el => el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 50) || '');
  }, n);
}
