import { SIDE_PANEL_OPEN_WINDOWS_KEY } from '../shared/constants';

const openWindowIds = new Set<number>();

export async function restoreSidePanelOpenWindows(): Promise<void> {
  const result = await chrome.storage.session.get(SIDE_PANEL_OPEN_WINDOWS_KEY);
  openWindowIds.clear();
  const value = result[SIDE_PANEL_OPEN_WINDOWS_KEY];
  if (Array.isArray(value)) {
    for (const item of value) if (typeof item === 'number' && Number.isSafeInteger(item)) openWindowIds.add(item);
  }
}

async function persist(): Promise<void> {
  await chrome.storage.session.set({ [SIDE_PANEL_OPEN_WINDOWS_KEY]: [...openWindowIds] });
}

export async function setSidePanelOpen(windowId: number, open: boolean): Promise<void> {
  if (open) openWindowIds.add(windowId);
  else openWindowIds.delete(windowId);
  await persist();
}

export function isAnySidePanelOpen(windowId?: number): boolean {
  return typeof windowId === 'number' ? openWindowIds.has(windowId) : openWindowIds.size > 0;
}

export function registerSidePanelListeners(): void {
  chrome.sidePanel?.onOpened?.addListener((event: { windowId: number }) => void setSidePanelOpen(event.windowId, true));
  chrome.sidePanel?.onClosed?.addListener((event: { windowId: number }) => void setSidePanelOpen(event.windowId, false));
}
