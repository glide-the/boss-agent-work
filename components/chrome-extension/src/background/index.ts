import { AgentCursorSessionManager } from './agent-cursor-session-manager';
import { ChromeBrowserControlHandler } from './chrome-browser-control-handler';
import { ExtensionUpdateReloader } from './extension-update-reloader';
import { NativeJsonRpcBridge } from './native-json-rpc-bridge';
import { NativeMessagingTransport } from './native-messaging-transport';
import { persistNativeHostStatus, routeContentScriptMessage, routePopupOrSidePanelMessage } from './message-router';
import { registerSidePanelListeners } from './side-panel-state';
import { NATIVE_HOSTS } from '../types/native';

const cursorSessions = new AgentCursorSessionManager();

async function main(): Promise<void> {
  const updateReloader = new ExtensionUpdateReloader(() => cursorSessions.isBrowserControlActive());
  updateReloader.register();
  cursorSessions.setBrowserControlActivityChangeHandler((active) => {
    if (!active) void updateReloader.maybeReloadForPendingUpdate();
  });

  const browserControlHandler = new ChromeBrowserControlHandler();
  const nativeTransport = new NativeMessagingTransport(NATIVE_HOSTS.dev, { onStatusChange: persistNativeHostStatus });
  const bridge = new NativeJsonRpcBridge(nativeTransport as any, browserControlHandler);

  registerSidePanelListeners();

  chrome.runtime.onInstalled.addListener(() => {
    void chrome.storage.local.set({ extensionInstanceId: crypto.randomUUID() });
  });

  chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (response: unknown) => void) => {
    if (routePopupOrSidePanelMessage(nativeTransport, message, sendResponse)) return true;
    if (routeContentScriptMessage(cursorSessions, message, sender, sendResponse)) return true;
    return false;
  });

  chrome.debugger.onEvent.addListener((source: unknown, method: string, params: unknown) => {
    bridge.sendCdpEvent({ source, method, params });
  });

  chrome.downloads.onCreated.addListener((item: unknown) => browserControlHandler.handleDownloadCreated(item));
  chrome.downloads.onChanged.addListener((delta: unknown) => browserControlHandler.handleDownloadChanged(delta));
}

void main();
