import type { JsonRpcMessage, JsonRpcRequest } from '../types/native';
import type { NativeHostStatus } from '../types/messages';

const RECONNECT_ALARM_PREFIX = 'native-transport-reconnect';
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_ALARM_PERIOD_MINUTES = 30_000 / 60_000;

type PendingHostRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class NativeMessagingTransport {
  private port: any = null;
  private messageCallback: ((message: JsonRpcMessage) => void) | null = null;
  private nextHostRequestId = 0;
  private pendingHostRequests = new Map<string, PendingHostRequest>();
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private status: NativeHostStatus;

  constructor(
    private readonly application = 'com.openai.codexextension.dev',
    private readonly options: { onStatusChange?: (status: NativeHostStatus) => void; onDisconnect?: () => void } = {},
  ) {
    this.status = { state: 'disconnected', hostName: application, lastChecked: Date.now(), reconnectAttempt: 0 };
    chrome.alarms.onAlarm.addListener((alarm: any) => {
      if (alarm.name === this.reconnectAlarmName) this.runReconnectAttempt();
    });
    if (!this.connect()) this.scheduleReconnect();
  }

  private get reconnectAlarmName(): string {
    return `${RECONNECT_ALARM_PREFIX}:${this.application}`;
  }

  sendMessage(message: JsonRpcMessage): void {
    if (!this.port) {
      this.scheduleReconnect();
      throw new Error(this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS
        ? 'Native transport is disconnected; reconnect limit reached'
        : 'Native transport is disconnected; reconnect is pending');
    }
    this.port.postMessage(message);
  }

  requestHost<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    if (!this.port) {
      this.scheduleReconnect();
      return Promise.reject(new Error(this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS
        ? 'Native transport is disconnected; reconnect limit reached'
        : 'Native transport is disconnected; reconnect is pending'));
    }
    const id = this.createHostRequestId();
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
    return new Promise<TResult>((resolve, reject) => {
      this.pendingHostRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try {
        this.port.postMessage(request);
      } catch (error) {
        this.pendingHostRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  setMessageCallback(callback: (message: JsonRpcMessage) => void): void {
    this.messageCallback = callback;
  }

  getStatus(): NativeHostStatus {
    return { ...this.status };
  }

  refreshStatus(): NativeHostStatus {
    this.updateStatus(this.port ? 'connected' : this.status.state, { error: this.status.error, nextRetryMs: this.status.nextRetryMs });
    return this.getStatus();
  }

  private connect(failureState: NativeHostStatus['state'] = 'disconnected'): boolean {
    if (this.port) return true;
    let port: any;
    try {
      port = chrome.runtime.connectNative(this.application);
    } catch (error) {
      this.updateStatus(failureState, { error: error instanceof Error ? error.message : String(error), nextRetryMs: failureState === 'reconnecting' ? RECONNECT_DELAY_MS : undefined });
      return false;
    }
    this.port = port;
    this.reconnectAttempt = 0;
    this.clearReconnectTimeout();
    chrome.alarms.clear(this.reconnectAlarmName).catch(() => undefined);
    this.updateStatus('connected');

    port.onMessage.addListener((message: JsonRpcMessage) => {
      this.reconnectAttempt = 0;
      this.updateStatus('connected');
      if (!this.handleHostResponse(message)) this.messageCallback?.(message);
    });
    port.onDisconnect.addListener(() => {
      this.port = null;
      this.reconnectAttempt = 0;
      this.rejectPendingHostRequests(new Error('Native transport disconnected'));
      this.options.onDisconnect?.();
      this.updateStatus('disconnected', { error: chrome.runtime?.lastError?.message });
      this.scheduleReconnect();
    });
    return true;
  }

  private createHostRequestId(): string {
    this.nextHostRequestId += 1;
    return `native-host:${this.nextHostRequestId}`;
  }

  private handleHostResponse(message: JsonRpcMessage): boolean {
    if (!('id' in message)) return false;
    const id = String(message.id);
    const pending = this.pendingHostRequests.get(id);
    if (!pending) return false;
    this.pendingHostRequests.delete(id);
    if ('error' in message) pending.reject(new Error(message.error.message));
    else if ('result' in message) pending.resolve(message.result);
    else pending.reject(new Error('Native host returned an invalid response'));
    return true;
  }

  private rejectPendingHostRequests(error: Error): void {
    for (const request of this.pendingHostRequests.values()) request.reject(error);
    this.pendingHostRequests.clear();
  }

  private scheduleReconnect(): void {
    if (this.port) return;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.clearReconnectTimeout();
      void chrome.alarms.clear(this.reconnectAlarmName);
      this.updateStatus('disconnected', {
        error: this.status.error ?? 'Native transport reconnect limit reached',
        nextRetryMs: undefined,
      });
      return;
    }
    const delayMs = this.currentReconnectDelayMs();
    this.scheduleReconnectTimeout(delayMs);
    void this.ensureReconnectAlarm();
    this.updateStatus('reconnecting', { error: this.status.error, nextRetryMs: delayMs });
  }

  private scheduleReconnectTimeout(delayMs: number): void {
    if (this.reconnectTimeoutId != null) return;
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.runReconnectAttempt();
    }, delayMs);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeoutId != null) clearTimeout(this.reconnectTimeoutId);
    this.reconnectTimeoutId = null;
  }

  private async ensureReconnectAlarm(): Promise<void> {
    if (this.port) return;
    const alarm = await chrome.alarms.get(this.reconnectAlarmName);
    if (!alarm) await chrome.alarms.create(this.reconnectAlarmName, { periodInMinutes: RECONNECT_ALARM_PERIOD_MINUTES });
  }

  private runReconnectAttempt(): void {
    if (this.port) return;
    this.clearReconnectTimeout();
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.scheduleReconnect();
      return;
    }
    this.reconnectAttempt += 1;
    if (!this.connect('reconnecting')) this.scheduleReconnect();
  }

  private currentReconnectDelayMs(): number {
    return Math.min(RECONNECT_DELAY_MS * (2 ** this.reconnectAttempt), MAX_RECONNECT_DELAY_MS);
  }

  private updateStatus(state: NativeHostStatus['state'], extra: Partial<NativeHostStatus> = {}): void {
    this.status = { state, hostName: this.application, lastChecked: Date.now(), reconnectAttempt: this.reconnectAttempt, ...extra };
    this.options.onStatusChange?.(this.getStatus());
  }
}
