import { mountAgentOverlay } from './overlay-root';
import { setFaviconBadge } from './favicon-badge';

let cleanupOverlay: (() => void) | null = null;
let initialized = false;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFaviconBadgeMessage(message: unknown): message is { type: 'TAB_FAVICON_BADGE'; badge: null | 'active' | 'deliverable' | 'handoff'; faviconDataUrl: string | null } {
  if (!isObject(message) || message.type !== 'TAB_FAVICON_BADGE') return false;
  const badge = message.badge;
  if (badge == null) return message.faviconDataUrl == null;
  return ['active', 'deliverable', 'handoff'].includes(String(badge)) && typeof message.faviconDataUrl === 'string';
}

export function initializeContentScript(): void {
  if (initialized) {
    cleanupOverlay?.();
  }
  initialized = true;
  cleanupOverlay = mountAgentOverlay();

  chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
    if (isObject(message) && message.type === 'CONTENT_PING') {
      sendResponse({ ok: true });
      return true;
    }
    if (isFaviconBadgeMessage(message)) {
      setFaviconBadge(message.badge, message.faviconDataUrl);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
}

initializeContentScript();
