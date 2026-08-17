import type { FaviconBadgeState } from '../types/messages';
import { ensureContentScript } from './content-script-injector';
import { safeSendTabMessage } from '../shared/chrome-promisify';

export class TabFaviconBadgeManager {
  private faviconDataUrls = new Map<number, string>();

  async republishBadge(tabId: number, badge: FaviconBadgeState): Promise<boolean> {
    if (!(await ensureContentScript(tabId))) return false;
    const faviconDataUrl = badge == null ? null : this.faviconDataUrls.get(tabId) ?? null;
    const response = await safeSendTabMessage<{ ok?: boolean }>(tabId, {
      type: 'TAB_FAVICON_BADGE',
      badge,
      faviconDataUrl,
    });
    return response?.ok === true;
  }

  rememberFavicon(tabId: number, dataUrl: string): void {
    this.faviconDataUrls.set(tabId, dataUrl);
  }

  forgetFavicon(tabId: number): void {
    this.faviconDataUrls.delete(tabId);
  }
}
