import { OVERLAY_ROOT_ID } from '../shared/constants';
import { mountCursorOverlay, type CursorOverlayController } from './cursor-overlay';
import type { AgentCursorOverlayState } from '../types/messages';

const OVERLAY_CLASS = 'codex-agent-overlay';
const OWNER_DATASET_KEY = 'codexAgentOverlayRoot';

const EMPTY_STATE: AgentCursorOverlayState = {
  cursor: null,
  isVisible: false,
  sessionId: null,
  turnId: null,
};

export function mountAgentOverlay(): () => void {
  const host = ensureOverlayHost();
  if (!host) return () => undefined;

  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `.${OVERLAY_CLASS}{all:initial;z-index:2147483646;pointer-events:none;position:fixed;inset:0}@media print{.${OVERLAY_CLASS}{display:none}}`;
  shadow.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute('aria-hidden', 'true');
  shadow.appendChild(overlay);

  let state = EMPTY_STATE;
  let controller: CursorOverlayController | null = null;

  if (window.top === window.self) {
    controller = mountCursorOverlay(overlay, (moveSequence) => {
      if (state.sessionId == null || state.turnId == null) return;
      void chrome.runtime.sendMessage({ type: 'AGENT_CURSOR_ARRIVED', sessionId: state.sessionId, turnId: state.turnId, moveSequence });
    });
  }

  const apply = (next: AgentCursorOverlayState) => {
    state = next;
    controller?.setState(state);
  };

  const onMessage = (message: any, _sender: any, sendResponse: (response: unknown) => void) => {
    if (message?.type !== 'AGENT_CURSOR_STATE') return false;
    apply(normalizeState(message.state));
    sendResponse({ ok: true });
    return true;
  };

  chrome.runtime.onMessage.addListener(onMessage);
  void chrome.runtime.sendMessage({ type: 'GET_AGENT_CURSOR_STATE' }).then((response: any) => {
    if (response?.ok) apply(normalizeState(response.state));
  }).catch(() => undefined);

  return () => {
    controller?.destroy();
    chrome.runtime.onMessage.removeListener(onMessage);
    host.remove();
  };
}

function ensureOverlayHost(): HTMLDivElement | null {
  const existing = document.getElementById(OVERLAY_ROOT_ID);
  if (existing) {
    if (existing instanceof HTMLDivElement && existing.dataset[OWNER_DATASET_KEY] === 'true') existing.remove();
    else return null;
  }
  if (!document.documentElement) return null;
  const host = document.createElement('div');
  host.id = OVERLAY_ROOT_ID;
  host.dataset[OWNER_DATASET_KEY] = 'true';
  document.documentElement.appendChild(host);
  return host;
}

function normalizeState(value: unknown): AgentCursorOverlayState {
  if (!value || typeof value !== 'object') return EMPTY_STATE;
  const raw = value as any;
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : null;
  const turnId = typeof raw.turnId === 'string' ? raw.turnId : null;
  const cursor = raw.cursor && typeof raw.cursor === 'object' && typeof raw.cursor.x === 'number' && typeof raw.cursor.y === 'number' && typeof raw.cursor.visible === 'boolean'
    ? raw.cursor
    : null;
  return { cursor, isVisible: raw.isVisible === true && sessionId != null, sessionId, turnId };
}
