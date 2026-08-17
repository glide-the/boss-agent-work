export type NativeHostState = 'connected' | 'disconnected' | 'reconnecting';

export interface NativeHostStatus {
  state: NativeHostState;
  hostName?: string;
  lastChecked: number;
  reconnectAttempt?: number;
  nextRetryMs?: number;
  error?: string;
}

export interface CursorPoint {
  visible: boolean;
  x: number;
  y: number;
  animateMovement?: boolean;
  moveSequence?: number;
}

export interface AgentCursorOverlayState {
  cursor: CursorPoint | null;
  isVisible: boolean;
  sessionId: string | null;
  turnId: string | null;
}

export type FaviconBadgeState = 'active' | 'deliverable' | 'handoff' | null;

export type PopupToBackgroundMessage =
  | { type: 'GET_NATIVE_HOST_STATUS' }
  | { type: 'ensure_codex_app_server'; windowId?: number };

export type BackgroundToContentMessage =
  | { type: 'CONTENT_PING' }
  | { type: 'AGENT_CURSOR_STATE'; state: AgentCursorOverlayState }
  | { type: 'TAB_FAVICON_BADGE'; badge: FaviconBadgeState; faviconDataUrl: string | null };

export type ContentToBackgroundMessage =
  | { type: 'GET_AGENT_CURSOR_STATE' }
  | { type: 'AGENT_CURSOR_ARRIVED'; sessionId: string; turnId: string; moveSequence: number };

export type ExtensionMessage =
  | PopupToBackgroundMessage
  | BackgroundToContentMessage
  | ContentToBackgroundMessage;

export interface NativeHostStatusResponse {
  ok: boolean;
  status?: NativeHostStatus;
  error?: string;
}
