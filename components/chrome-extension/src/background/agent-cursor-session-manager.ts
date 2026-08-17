import type { AgentCursorOverlayState, CursorPoint } from '../types/messages';
import { ensureContentScript } from './content-script-injector';
import { safeSendTabMessage } from '../shared/chrome-promisify';

const EMPTY_CURSOR_STATE: AgentCursorOverlayState = {
  cursor: null,
  isVisible: false,
  sessionId: null,
  turnId: null,
};

type SessionState = {
  tabIds: Set<number>;
  isRunning: boolean;
  currentTurnId: string | null;
  cursorByTabId: Map<number, CursorPoint>;
  activeRequests: number;
  abortController: AbortController | null;
};

export class AgentCursorSessionManager {
  private sessions = new Map<string, SessionState>();
  private tabSessions = new Map<number, Set<string>>();
  private activityChanged: (active: boolean) => void = () => undefined;
  private lastActive = false;

  setBrowserControlActivityChangeHandler(handler: (active: boolean) => void): void {
    this.activityChanged = handler;
    this.updateActivity();
  }

  isBrowserControlActive(): boolean {
    for (const session of this.sessions.values()) {
      if (session.isRunning || session.activeRequests > 0) return true;
    }
    return false;
  }

  async startSession(sessionId: string, turnId: string | null = null): Promise<void> {
    const session = this.ensureSession(sessionId);
    if (turnId != null && session.currentTurnId !== turnId) session.cursorByTabId.clear();
    session.currentTurnId = turnId ?? session.currentTurnId;
    session.isRunning = true;
    await this.publishSessionTabs(sessionId);
    this.updateActivity();
  }

  async finishSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const tabIds = [...session.tabIds];
    this.detachSession(sessionId, session);
    await this.publishTabs(tabIds);
    this.updateActivity();
  }

  async trackTab(sessionId: string, tabId: number): Promise<void> {
    const session = this.ensureSession(sessionId);
    session.tabIds.add(tabId);
    const tabSet = this.tabSessions.get(tabId) ?? new Set<string>();
    tabSet.add(sessionId);
    this.tabSessions.set(tabId, tabSet);
    await this.publishTabState(tabId);
  }

  async setCursorState(sessionId: string, tabId: number, turnId: string, cursor: CursorPoint): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session?.isRunning) return false;
    session.currentTurnId = turnId;
    session.cursorByTabId.set(tabId, cursor);
    await this.publishTabCursorState(tabId);
    return true;
  }

  readCursorOverlayState(tabId: number): AgentCursorOverlayState {
    const sessionId = this.getHighestPrioritySessionIdForTab(tabId);
    if (sessionId == null) return EMPTY_CURSOR_STATE;
    const session = this.sessions.get(sessionId);
    if (!session?.isRunning) return EMPTY_CURSOR_STATE;
    return {
      cursor: session.cursorByTabId.get(tabId) ?? null,
      isVisible: true,
      sessionId,
      turnId: session.currentTurnId,
    };
  }

  async publishTabCursorState(tabId: number): Promise<boolean> {
    if (!(await ensureContentScript(tabId))) return false;
    const state = this.readCursorOverlayState(tabId);
    const response = await safeSendTabMessage<{ ok?: boolean }>(tabId, { type: 'AGENT_CURSOR_STATE', state }, 1000);
    return response?.ok === true;
  }

  notifyCursorArrived(message: { sessionId: string; turnId: string; moveSequence: number }): void {
    // The original bundle forwards this event toward the native side through the browser-control handler.
    console.debug('cursor arrived', message);
  }

  private ensureSession(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { tabIds: new Set(), isRunning: false, currentTurnId: null, cursorByTabId: new Map(), activeRequests: 0, abortController: null };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private detachSession(sessionId: string, session: SessionState): void {
    for (const tabId of session.tabIds) {
      const tabSet = this.tabSessions.get(tabId);
      tabSet?.delete(sessionId);
      if (tabSet?.size === 0) this.tabSessions.delete(tabId);
    }
    this.sessions.delete(sessionId);
  }

  private getHighestPrioritySessionIdForTab(tabId: number): string | null {
    const sessions = this.tabSessions.get(tabId);
    return sessions?.values().next().value ?? null;
  }

  private async publishSessionTabs(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) await this.publishTabs([...session.tabIds]);
  }

  private async publishTabs(tabIds: number[]): Promise<void> {
    await Promise.allSettled(tabIds.map((tabId) => this.publishTabState(tabId)));
  }

  private async publishTabState(tabId: number): Promise<void> {
    await this.publishTabCursorState(tabId);
  }

  private updateActivity(): void {
    const active = this.isBrowserControlActive();
    if (active !== this.lastActive) {
      this.lastActive = active;
      this.activityChanged(active);
    }
  }
}
