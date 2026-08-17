import { sendCdpCommand, attachDebugger, detachDebugger } from './cdp-client';

export class ChromeBrowserControlHandler {
  async executeCdp(params: any): Promise<unknown> {
    return sendCdpCommand(params);
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
