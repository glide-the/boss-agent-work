// resume.js — BOSS 会话内的附件简历发送与去重。
// 两条入口：Boss 首次回复后从工具栏发送；正式请求卡片点「同意」发送。
// 高风险约束：发送前核对会话归属；同一会话只发一次；请求卡按钮必须严格匹配「同意」。

const SENT_RESUME_PATTERNS = [
  '已发送给Boss',
  '附件简历已发送给对方',
  '对方已同意，您的附件简历已发送给对方',
];

export function hasSentResumeText(text) {
  const value = String(text || '');
  return SENT_RESUME_PATTERNS.some(pattern => value.includes(pattern));
}

/**
 * 读取当前会话的简历发送状态。
 * knownAlreadySent 用于接入本地 reply_progress.jsonl 等持久化去重证据。
 */
export async function inspectResumeState(tab, { knownAlreadySent = false } = {}) {
  const state = await tab.playwright.evaluate(() => {
    const root = document.querySelector('.chat-conversation');
    const messages = Array.from(root?.querySelectorAll('.message-item') || []);
    const bossReplyCount = messages.filter(el => (el.className || '').includes('item-friend')).length;
    const text = root?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const sentPatterns = ['已发送给Boss', '附件简历已发送给对方', '对方已同意，您的附件简历已发送给对方'];
    const pageAlreadySent = sentPatterns.some(pattern => text.includes(pattern));

    const toolbarEls = Array.from(document.querySelectorAll(
      '.chat-conversation div.toolbar-btn, .chat-editor div.toolbar-btn'
    ));
    const resumeButtons = toolbarEls
      .map((el, index) => ({
        index,
        text: el.textContent?.trim() || '',
        className: el.className || '',
      }))
      .filter(item => item.text === '发简历');

    const agreeButtons = Array.from(document.querySelectorAll(
      '.chat-conversation .message-card-buttons span.card-btn'
    )).filter(el => el.textContent?.trim() === '同意');

    return {
      bossReplyCount,
      pageAlreadySent,
      toolbar: {
        total: toolbarEls.length,
        exactCount: resumeButtons.length,
        index: resumeButtons[0]?.index ?? -1,
        disabled: resumeButtons.length === 1
          ? resumeButtons[0].className.includes('unable')
          : null,
      },
      agreeButtonCount: agreeButtons.length,
    };
  });

  return {
    ...state,
    knownAlreadySent: Boolean(knownAlreadySent),
    alreadySent: Boolean(knownAlreadySent || state.pageAlreadySent),
  };
}

async function pickResumeAndSend(tab, resumeKeyword) {
  await tab.playwright.waitForTimeout(800);

  const dialogState = await tab.playwright.evaluate((keyword) => {
    const dialogs = Array.from(document.querySelectorAll('.dialog-wrap.active'));
    if (dialogs.length !== 1) return { dialogCount: dialogs.length, itemCount: 0, picked: -1, itemTexts: [] };
    const items = Array.from(dialogs[0].querySelectorAll('.resume-list .list-item'));
    const itemTexts = items.map(el => el.textContent?.replace(/\s+/g, ' ').trim() || '');
    return {
      dialogCount: 1,
      itemCount: items.length,
      picked: itemTexts.findIndex(text => text.includes(keyword)),
      itemTexts,
    };
  }, resumeKeyword);

  if (dialogState.dialogCount !== 1) {
    return { step: 'open-dialog', ok: false, sent: false, detail: `活动弹窗数量为 ${dialogState.dialogCount}` };
  }
  if (dialogState.picked < 0) {
    return {
      step: 'pick-resume',
      ok: false,
      sent: false,
      detail: `弹窗 ${dialogState.itemCount} 个版本中未找到含「${resumeKeyword}」的简历`,
    };
  }

  const dialog = tab.playwright.locator('.dialog-wrap.active');
  const dialogCount = await dialog.count();
  if (dialogCount !== 1) return { step: 'open-dialog', ok: false, sent: false, detail: `活动弹窗数量变为 ${dialogCount}` };

  const items = dialog.locator('.resume-list .list-item');
  const itemCount = await items.count();
  if (itemCount !== dialogState.itemCount) {
    return { step: 'pick-resume', ok: false, sent: false, detail: '简历列表在选择前发生变化' };
  }
  await items.nth(dialogState.picked).click({ timeoutMs: 5000 });

  const confirm = dialog.locator('.btn-confirm');
  const confirmCount = await confirm.count();
  if (confirmCount !== 1) return { step: 'confirm', ok: false, sent: false, detail: `发送按钮数量为 ${confirmCount}` };
  await confirm.click({ timeoutMs: 5000 });
  await tab.playwright.waitForTimeout(2500);

  const sentCheck = await tab.playwright.evaluate(() => {
    const root = document.querySelector('.chat-conversation');
    const text = root?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const patterns = ['已发送给Boss', '附件简历已发送给对方', '对方已同意，您的附件简历已发送给对方'];
    return { ok: patterns.some(pattern => text.includes(pattern)), tail: text.slice(-500) };
  });

  return { step: 'done', ok: sentCheck.ok, sent: sentCheck.ok, detail: sentCheck.tail };
}

/**
 * Boss 首次回复后，从工具栏发送一次指定附件简历。
 * @param {object} tab
 * @param {string} resumeKeyword
 * @param {{knownAlreadySent?: boolean}} options
 */
export async function sendResumeOnceAfterBossReply(tab, resumeKeyword, options = {}) {
  const state = await inspectResumeState(tab, options);
  if (state.alreadySent) {
    return { step: 'dedupe', ok: true, sent: false, skipped: true, detail: '该会话已有简历发送记录' };
  }
  if (state.bossReplyCount < 1) {
    return { step: 'eligibility', ok: false, sent: false, detail: 'Boss 尚未回复，暂不发送简历' };
  }
  if (state.toolbar.exactCount !== 1) {
    return {
      step: 'locate-toolbar',
      ok: false,
      sent: false,
      detail: `严格文本为「发简历」的工具栏按钮数量为 ${state.toolbar.exactCount}`,
    };
  }
  if (state.toolbar.disabled) {
    return { step: 'toolbar-disabled', ok: false, sent: false, detail: 'Boss 已回复，但当前工具栏「发简历」仍不可用' };
  }

  const toolbar = tab.playwright.locator(
    '.chat-conversation div.toolbar-btn, .chat-editor div.toolbar-btn'
  );
  const toolbarCount = await toolbar.count();
  if (toolbarCount !== state.toolbar.total) {
    return { step: 'locate-toolbar', ok: false, sent: false, detail: '工具栏在点击前发生变化' };
  }
  await toolbar.nth(state.toolbar.index).click({ timeoutMs: 5000 });
  return await pickResumeAndSend(tab, resumeKeyword);
}

/**
 * 同意正式简历请求卡片并发送一次指定附件简历。
 * @param {object} tab
 * @param {string} resumeKeyword
 * @param {{knownAlreadySent?: boolean}} options
 */
export async function agreeAndSendResume(tab, resumeKeyword, options = {}) {
  const state = await inspectResumeState(tab, options);
  if (state.alreadySent) {
    return { step: 'dedupe', ok: true, sent: false, skipped: true, detail: '该会话已有简历发送记录' };
  }

  const agreeState = await tab.playwright.evaluate(() => {
    const groups = Array.from(document.querySelectorAll('.chat-conversation .message-card-buttons'));
    const matches = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const buttons = Array.from(groups[groupIndex].querySelectorAll('span.card-btn'));
      for (let buttonIndex = 0; buttonIndex < buttons.length; buttonIndex++) {
        if (buttons[buttonIndex].textContent?.trim() === '同意') {
          matches.push({ groupIndex, buttonIndex, buttonCount: buttons.length });
        }
      }
    }
    return { groupCount: groups.length, matches };
  });

  if (agreeState.matches.length !== 1) {
    return {
      step: 'locate-agree',
      ok: false,
      sent: false,
      detail: `严格文本为「同意」的请求卡按钮数量为 ${agreeState.matches.length}`,
    };
  }

  const match = agreeState.matches[0];
  const groups = tab.playwright.locator('.chat-conversation .message-card-buttons');
  const groupCount = await groups.count();
  if (groupCount !== agreeState.groupCount) {
    return { step: 'locate-agree', ok: false, sent: false, detail: '请求卡片在点击前发生变化' };
  }
  const buttons = groups.nth(match.groupIndex).locator('span.card-btn');
  const buttonCount = await buttons.count();
  if (buttonCount !== match.buttonCount) {
    return { step: 'locate-agree', ok: false, sent: false, detail: '请求卡按钮在点击前发生变化' };
  }
  await buttons.nth(match.buttonIndex).click({ timeoutMs: 8000 });
  await tab.playwright.waitForTimeout(800);

  const rejected = await tab.playwright.evaluate(() =>
    document.querySelector('.chat-conversation')?.textContent?.includes('您已拒绝向对方发送简历') || false
  );
  if (rejected) {
    return {
      step: 'agree-click',
      ok: false,
      sent: false,
      detail: '误触拒绝：已产生「您已拒绝向对方发送简历」系统消息，需文字说明误操作',
    };
  }

  return await pickResumeAndSend(tab, resumeKeyword);
}

export async function checkSendResumeButton(tab) {
  const state = await inspectResumeState(tab);
  return {
    found: state.toolbar.exactCount === 1,
    disabled: state.toolbar.disabled,
    bossReplyCount: state.bossReplyCount,
    alreadySent: state.alreadySent,
  };
}
