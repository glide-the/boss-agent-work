async function openSidePanelAndClosePopup() {
  if (chrome.sidePanel == null) throw new Error('Chrome side panel API is unavailable');
  const currentWindow = await chrome.windows.getCurrent();
  if (currentWindow.id == null) throw new Error('Unable to find the current Chrome window');
  await chrome.sidePanel.open({ windowId: currentWindow.id });
  window.close();
}

export function OpenSidePanelButton() {
  return (
    <button className="codex-popup-open-sidepanel-button" type="button" onClick={() => void openSidePanelAndClosePopup()}>
      Open side panel
    </button>
  );
}
