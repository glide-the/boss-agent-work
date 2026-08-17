import { CURSOR_ASSET_PATH } from '../shared/constants';
import type { AgentCursorOverlayState, CursorPoint } from '../types/messages';

export type CursorOverlayController = {
  setState(state: AgentCursorOverlayState): void;
  destroy(): void;
};

export function mountCursorOverlay(root: HTMLElement, onArrived: (moveSequence: number) => void): CursorOverlayController {
  const cursor = document.createElement('img');
  cursor.alt = '';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.src = chrome.runtime.getURL(CURSOR_ASSET_PATH);
  cursor.style.position = 'fixed';
  cursor.style.left = '0';
  cursor.style.top = '0';
  cursor.style.width = '32px';
  cursor.style.height = '32px';
  cursor.style.pointerEvents = 'none';
  cursor.style.filter = 'drop-shadow(0 0 6px rgba(51, 156, 255, 0.9)) drop-shadow(0 0 15px rgba(51, 156, 255, 0.48))';
  cursor.style.opacity = '0';
  cursor.dataset.browserAgentCursorAsset = 'true';
  root.appendChild(cursor);

  let lastMoveSequence: number | undefined;

  function setCursor(point: CursorPoint | null, visible: boolean): void {
    if (!point || !visible || !point.visible) {
      cursor.style.opacity = '0';
      return;
    }
    cursor.style.opacity = '1';
    cursor.style.transform = `translate3d(${Math.round(point.x - 16)}px, ${Math.round(point.y - 16)}px, 0) rotate(-44deg)`;
    if (Number.isInteger(point.moveSequence) && point.moveSequence !== lastMoveSequence) {
      lastMoveSequence = point.moveSequence;
      window.setTimeout(() => onArrived(point.moveSequence!), 0);
    }
  }

  return {
    setState(state) {
      setCursor(state.cursor, state.isVisible && state.sessionId != null);
    },
    destroy() {
      cursor.remove();
    },
  };
}
