// resume.js — 处理招聘方「附件简历请求」：点同意 → 选简历 → 发送（2026-07-22 验证）
// 高风险操作：同意/拒绝按钮相邻，历史上发生过 hasText 匹配误点「拒绝」。
// 本模块用「按钮组 + 文本逐一核对 + 双下标点击」，并在点击后检查是否误拒。

/**
 * 同意简历请求并发送指定附件简历。
 * @param {object} tab
 * @param {string} resumeKeyword 简历文件名关键字（如 "ink_memory_v5"），在弹窗中选中正确版本
 * @returns {Promise<{step:string, ok:boolean, detail?:any}>}
 */
export async function agreeAndSendResume(tab, resumeKeyword) {
  // 1. 在简历请求卡片按钮组内逐一核对文本，只定位文本严格等于「同意」的按钮
  const agreeState = await tab.playwright.evaluate(() => {
    const groups = Array.from(document.querySelectorAll('.chat-conversation .message-card-buttons'));
    for (let gi = 0; gi < groups.length; gi++) {
      const btns = Array.from(groups[gi].querySelectorAll('span.card-btn'));
      for (let bi = 0; bi < btns.length; bi++) {
        if (btns[bi].textContent.trim() === '同意') {
          return { groupIndex: gi, btnIndex: bi, btnTexts: btns.map(b => b.textContent.trim()) };
        }
      }
    }
    return null;
  });
  if (!agreeState) return { step: 'locate-agree', ok: false, detail: '未找到简历请求卡片的同意按钮' };

  // 用 group+btn 双下标点击，避免 hasText 模糊匹配命中「拒绝」
  await tab.playwright
    .locator('.chat-conversation .message-card-buttons')
    .nth(agreeState.groupIndex)
    .locator('span.card-btn')
    .nth(agreeState.btnIndex)
    .click({ timeoutMs: 8000 });
  await tab.playwright.waitForTimeout(2500);

  // 2. 点击后立即检查是否误拒（出现该系统消息说明点错，需要人工话术补救）
  const rejectCheck = await tab.playwright.evaluate(() =>
    document.querySelector('.chat-conversation')?.textContent?.includes('您已拒绝向对方发送简历') || false);
  if (rejectCheck) {
    return { step: 'agree-click', ok: false, detail: '误触拒绝：已产生「您已拒绝向对方发送简历」系统消息，需文字向招聘方说明误操作' };
  }

  // 3. 简历选择弹窗：选中文件名包含 resumeKeyword 的项，点「发送」
  const dlg = tab.playwright.locator('.dialog-wrap.active');
  const items = dlg.locator('.resume-list .list-item');
  const cnt = await items.count();
  let picked = -1;
  for (let i = 0; i < cnt; i++) {
    const t = await items.nth(i).textContent();
    if (t.includes(resumeKeyword)) { picked = i; break; }
  }
  if (picked < 0) return { step: 'pick-resume', ok: false, detail: `弹窗 ${cnt} 个版本中未找到含「${resumeKeyword}」的简历` };
  await items.nth(picked).click({ timeoutMs: 5000 });
  await tab.playwright.waitForTimeout(800);
  await dlg.locator('.btn-confirm').click({ timeoutMs: 5000 });
  await tab.playwright.waitForTimeout(2500);

  // 4. 核对系统消息确认发送成功
  const sentCheck = await tab.playwright.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.chat-conversation .message-item, .chat-conversation [class*="system"]')).slice(-4);
    const texts = items.map(el => el.textContent?.replace(/\s+/g, ' ').trim() || '');
    return { ok: texts.some(t => t.includes('已发送给Boss')), texts };
  });
  return { step: 'done', ok: sentCheck.ok, detail: sentCheck.texts };
}

/**
 * 检查「发简历」工具栏按钮状态。
 * 招聘方用文字（非正式卡片）要简历时按钮为 unable 态，此时正确话术是请对方点「求简历」发起，
 * 不要假装已发送简历。
 */
export async function checkSendResumeButton(tab) {
  return await tab.playwright.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.chat-conversation div.toolbar-btn, .chat-editor div.toolbar-btn'));
    const el = els.find(e => e.textContent?.trim() === '发简历');
    if (!el) return { found: false };
    return { found: true, disabled: (el.className || '').includes('unable') };
  });
}
