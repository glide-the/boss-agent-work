// Button-only BOSS attachment-resume workflow.
// This module never interacts with the chat editor and never sends text messages.

export async function inspectFormalResumeRequest(tab) {
  return await tab.playwright.evaluate(() => {
    const groups = Array.from(document.querySelectorAll('.chat-conversation .message-card-buttons'));
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const buttons = Array.from(groups[gi].querySelectorAll('span.card-btn'));
      const texts = buttons.map((button) => button.textContent.trim());
      const agreeIndex = texts.findIndex((text) => text === '同意');
      if (agreeIndex >= 0) {
        return {
          ok: texts.includes('拒绝'),
          groupIndex: gi,
          agreeIndex,
          buttonTexts: texts,
          detail: texts.includes('拒绝') ? '找到正式求简历卡片' : '按钮组缺少严格匹配的拒绝按钮',
        };
      }
    }
    return { ok: false, detail: '未找到含严格“同意”按钮的正式求简历卡片' };
  });
}

export async function sendRequestedResume(tab, resumeKeyword) {
  if (!resumeKeyword || !String(resumeKeyword).trim()) {
    return { step: 'input', ok: false, detail: 'resumeKeyword 不能为空' };
  }

  const request = await inspectFormalResumeRequest(tab);
  if (!request.ok) return { step: 'locate-card', ok: false, detail: request.detail, request };

  await tab.playwright
    .locator('.chat-conversation .message-card-buttons')
    .nth(request.groupIndex)
    .locator('span.card-btn')
    .nth(request.agreeIndex)
    .click({ timeoutMs: 8000 });
  await tab.playwright.waitForTimeout(2500);

  const rejected = await tab.playwright.evaluate(() =>
    Boolean(document.querySelector('.chat-conversation')?.textContent?.includes('您已拒绝向对方发送简历'))
  );
  if (rejected) {
    return {
      step: 'agree-click',
      ok: false,
      detail: '检测到“您已拒绝向对方发送简历”，已停止后续操作',
    };
  }

  const dialog = tab.playwright.locator('.dialog-wrap.active');
  const items = dialog.locator('.resume-list .list-item');
  const count = await items.count();
  const matches = [];
  for (let index = 0; index < count; index++) {
    const text = await items.nth(index).textContent();
    if (text.includes(resumeKeyword)) matches.push({ index, text: text.trim() });
  }

  if (matches.length !== 1) {
    return {
      step: 'pick-resume',
      ok: false,
      detail: `在 ${count} 个简历版本中找到 ${matches.length} 个包含“${resumeKeyword}”的版本`,
      matches,
    };
  }

  await items.nth(matches[0].index).click({ timeoutMs: 5000 });
  await tab.playwright.waitForTimeout(800);
  await dialog.locator('.btn-confirm').click({ timeoutMs: 5000 });
  await tab.playwright.waitForTimeout(2500);

  const confirmation = await tab.playwright.evaluate(() => {
    const elements = Array.from(document.querySelectorAll(
      '.chat-conversation .message-item, .chat-conversation [class*="system"]'
    )).slice(-6);
    const texts = elements.map((element) => element.textContent?.replace(/\s+/g, ' ').trim() || '');
    return { ok: texts.some((text) => text.includes('已发送给Boss')), texts };
  });

  return {
    step: 'done',
    ok: confirmation.ok,
    selected: matches[0].text,
    detail: confirmation.texts,
  };
}
