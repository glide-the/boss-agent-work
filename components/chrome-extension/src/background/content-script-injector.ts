import { CONTENT_SCRIPT_FILE } from '../shared/constants';
import { safeSendTabMessage } from '../shared/chrome-promisify';

export async function isContentScriptAlive(tabId: number): Promise<boolean> {
  const response = await safeSendTabMessage<{ ok?: boolean }>(tabId, { type: 'CONTENT_PING' }, 1000);
  return response?.ok === true;
}

export async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await isContentScriptAlive(tabId)) return true;
  try {
    await chrome.scripting.executeScript({
      files: [CONTENT_SCRIPT_FILE],
      injectImmediately: true,
      target: { tabId },
    });
  } catch {
    return false;
  }
  return isContentScriptAlive(tabId);
}
