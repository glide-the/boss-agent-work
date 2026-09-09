import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasSentResumeText,
  inspectResumeState,
  sendResumeOnceAfterBossReply,
} from './resume.js';

const baseState = {
  bossReplyCount: 1,
  pageAlreadySent: false,
  toolbar: { total: 1, exactCount: 1, index: 0, disabled: false },
  agreeButtonCount: 0,
};

function fakeTab(state) {
  return { playwright: { evaluate: async () => structuredClone(state) } };
}

test('recognizes BOSS resume success messages', () => {
  assert.equal(hasSentResumeText('您的附件简历 demo.pdf 已发送给Boss'), true);
  assert.equal(hasSentResumeText('普通聊天消息'), false);
});

test('persistent evidence participates in dedupe', async () => {
  const state = await inspectResumeState(fakeTab(baseState), { knownAlreadySent: true });
  assert.equal(state.alreadySent, true);
  assert.equal(state.knownAlreadySent, true);
});

test('already-sent conversation is skipped before UI interaction', async () => {
  const result = await sendResumeOnceAfterBossReply(
    fakeTab(baseState),
    'ink_memory_v5',
    { knownAlreadySent: true },
  );
  assert.deepEqual(
    { step: result.step, ok: result.ok, sent: result.sent, skipped: result.skipped },
    { step: 'dedupe', ok: true, sent: false, skipped: true },
  );
});

test('conversation without a boss reply is not eligible', async () => {
  const result = await sendResumeOnceAfterBossReply(
    fakeTab({ ...baseState, bossReplyCount: 0 }),
    'ink_memory_v5',
  );
  assert.equal(result.step, 'eligibility');
  assert.equal(result.sent, false);
});
