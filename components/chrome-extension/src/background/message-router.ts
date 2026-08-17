import { NATIVE_HOST_STATUS_STORAGE_KEY } from '../shared/constants';
import type { ExtensionMessage } from '../types/messages';
import type { NativeMessagingTransport } from './native-messaging-transport';
import { isAnySidePanelOpen, restoreSidePanelOpenWindows } from './side-panel-state';
import type { AgentCursorSessionManager } from './agent-cursor-session-manager';

export function persistNativeHostStatus(status: unknown): void {
  void chrome.storage.local.set({ [NATIVE_HOST_STATUS_STORAGE_KEY]: status });
}

export function routePopupOrSidePanelMessage(
  nativeTransport: NativeMessagingTransport,
  message: ExtensionMessage,
  sendResponse: (response: unknown) => void,
): boolean {
  if (message?.type === 'GET_NATIVE_HOST_STATUS') {
    const status = nativeTransport.refreshStatus();
    persistNativeHostStatus(status);
    sendResponse({ ok: status.state === 'connected', status, error: status.error });
    return true;
  }

  if (message?.type === 'ensure_codex_app_server') {
    void (async () => {
      await restoreSidePanelOpenWindows();
      const windowId = 'windowId' in message ? message.windowId : undefined;
      if (!isAnySidePanelOpen(windowId)) {
        const status = nativeTransport.refreshStatus();
        persistNativeHostStatus(status);
        sendResponse({ ok: false, error: 'Codex side panel is not open.', nativeHostStatus: status, sidePanelOpen: false });
        return;
      }
      try {
        const result = await nativeTransport.requestHost('ensureCodexAppServer');
        const status = nativeTransport.refreshStatus();
        persistNativeHostStatus(status);
        sendResponse({ ok: true, nativeHostStatus: status, sidePanelOpen: true, ...(typeof result === 'object' && result ? result : {}) });
      } catch (error) {
        const status = nativeTransport.refreshStatus();
        persistNativeHostStatus(status);
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), nativeHostStatus: status, sidePanelOpen: true });
      }
    })();
    return true;
  }

  return false;
}

export function routeContentScriptMessage(
  cursorSessions: AgentCursorSessionManager,
  message: ExtensionMessage,
  sender: any,
  sendResponse: (response: unknown) => void,
): boolean {
  const tabId = sender.tab?.id;
  if (message?.type === 'GET_AGENT_CURSOR_STATE') {
    sendResponse({ ok: true, state: cursorSessions.readCursorOverlayState(typeof tabId === 'number' ? tabId : -1) });
    return true;
  }
  if (message?.type === 'AGENT_CURSOR_ARRIVED') {
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false });
      return true;
    }
    cursorSessions.notifyCursorArrived(message);
    sendResponse({ ok: true });
    return true;
  }
  return false;
}
