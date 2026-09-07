import {
  sendCdpCommand,
  attachDebugger,
  detachDebugger,
  cancelAllCdpOperations,
  cancelCdpOperation,
  cancelCdpOperationsForTab,
  cdpOperationDiagnostics,
  handleCdpLifecycleEvent,
} from './cdp-client';

export class ChromeBrowserControlHandler {
  async executeCdp(params: any): Promise<unknown> {
    return sendCdpCommand(params);
  }

  async cancelBrowserOperation(params: { operationId: string; reason?: 'timeout' | 'cancelled' | 'dialog' | 'tab_closed' | 'browser_disconnected' }): Promise<{ browserCleanupComplete: boolean }> {
    return cancelCdpOperation(params.operationId, params.reason);
  }

  getBrowserOperationDiagnostics(): { activeOperations: number; activeDialogs: number } {
    return cdpOperationDiagnostics();
  }

  handleCdpEvent(source: { tabId?: number }, method: string, params: unknown): void {
    handleCdpLifecycleEvent(source, method, params);
  }

  async handleTabClosed(tabId: number): Promise<void> {
    await cancelCdpOperationsForTab(tabId);
  }

  async handleBrowserDisconnected(): Promise<void> {
    await cancelAllCdpOperations();
  }

  async attach(params: { tabId: number }): Promise<{ ok: true }> {
    await attachDebugger(params.tabId);
    return { ok: true };
  }

  async detach(params: { tabId: number }): Promise<{ ok: true }> {
    await detachDebugger(params.tabId);
    return { ok: true };
  }

  async getTabs(): Promise<unknown> {
    return chrome.tabs.query({});
  }

  async createTab(params: { url?: string; active?: boolean }): Promise<unknown> {
    return chrome.tabs.create({ url: params.url, active: params.active });
  }

  async getUserHistory(params: { text?: string; maxResults?: number }): Promise<unknown> {
    return chrome.history.search({ text: params.text ?? '', maxResults: params.maxResults ?? 100 });
  }

  addDownloadChangeListener(listener: (change: unknown) => void): void {
    chrome.downloads.onChanged.addListener(listener);
  }

  handleDownloadCreated(item: unknown): void {
    console.debug('download created', item);
  }

  handleDownloadChanged(delta: unknown): void {
    console.debug('download changed', delta);
  }
}
