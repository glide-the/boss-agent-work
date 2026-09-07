export const DEFAULT_DOM_SNAPSHOT_TIMEOUT_MS = 3_000;
export const MAX_DOM_SNAPSHOT_TIMEOUT_MS = 60_000;

export type BrowserOperationReason = "timeout" | "cancelled" | "dialog" | "tab_closed" | "browser_disconnected";

export interface BrowserOperationErrorDetails {
  operation: string;
  tabId: number;
  reason: BrowserOperationReason;
  dialogDetected: boolean;
  browserCleanupComplete: boolean;
  requestId?: string;
}

export class BrowserOperationError extends Error {
  readonly code = "BROWSER_OPERATION_CANCELLED";
  readonly details: BrowserOperationErrorDetails;

  constructor(details: BrowserOperationErrorDetails, message?: string) {
    super(message ?? `${details.operation} ${details.reason} for tab ${details.tabId}`);
    this.name = "BrowserOperationError";
    this.details = details;
  }
}

export interface BrowserOperationContext {
  operationId: string;
  signal: AbortSignal;
  timeoutMs: number;
}

interface ActiveOperation<T> {
  controller: AbortController;
  promise: Promise<T>;
}

interface OperationAbortReason {
  reason: BrowserOperationReason;
  dialogDetected: boolean;
}

function isOperationAbortReason(value: unknown): value is OperationAbortReason {
  return typeof value === "object" && value !== null && "reason" in value;
}

export function throwIfBrowserOperationAborted(
  signal: AbortSignal | undefined,
  operation: string,
  tabId: number,
  requestId?: string,
): void {
  if (!signal?.aborted) return;
  const abortReason = isOperationAbortReason(signal.reason)
    ? signal.reason
    : { reason: "cancelled" as const, dialogDetected: false };
  throw new BrowserOperationError({
    operation,
    tabId,
    reason: abortReason.reason,
    dialogDetected: abortReason.dialogDetected,
    browserCleanupComplete: false,
    ...(requestId === undefined ? {} : { requestId }),
  });
}

function normalizedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_DOM_SNAPSHOT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_DOM_SNAPSHOT_TIMEOUT_MS) {
    throw new RangeError(`domSnapshot timeoutMs must be an integer between 1 and ${MAX_DOM_SNAPSHOT_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

function normalizeError(error: unknown, operation: string, tabId: number, signal: AbortSignal): Error {
  if (error instanceof BrowserOperationError) return error;
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "object" && data !== null && "reason" in data) {
      const record = data as Partial<BrowserOperationErrorDetails>;
      return new BrowserOperationError({
        operation: record.operation ?? operation,
        tabId: record.tabId ?? tabId,
        reason: record.reason ?? "cancelled",
        dialogDetected: record.dialogDetected === true,
        browserCleanupComplete: record.browserCleanupComplete === true,
        ...(record.requestId === undefined ? {} : { requestId: record.requestId }),
      }, error instanceof Error ? error.message : String(error));
    }
  }
  if (signal.aborted) {
    const abortReason = isOperationAbortReason(signal.reason)
      ? signal.reason
      : { reason: "cancelled" as const, dialogDetected: false };
    return new BrowserOperationError({
      operation,
      tabId,
      reason: abortReason.reason,
      dialogDetected: abortReason.dialogDetected,
      browserCleanupComplete: false,
    });
  }
  return error instanceof Error ? error : new Error(String(error));
}

export class BrowserOperationCoordinator {
  private readonly active = new Map<string, ActiveOperation<unknown>>();
  private sequence = 0;

  run<T>(options: {
    key: string;
    operation: string;
    tabId: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    execute: (context: BrowserOperationContext) => Promise<T>;
  }): Promise<T> {
    const existing = this.active.get(options.key);
    if (existing) return existing.promise as Promise<T>;

    const timeoutMs = normalizedTimeout(options.timeoutMs);
    const controller = new AbortController();
    const operationId = `${options.operation}:${options.tabId}:${Date.now()}:${++this.sequence}`;
    const abortFromCaller = () => controller.abort({ reason: "cancelled", dialogDetected: false });
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(
      () => controller.abort({ reason: "timeout", dialogDetected: false }),
      timeoutMs,
    );

    const promise = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) {
          throw normalizeError(controller.signal.reason, options.operation, options.tabId, controller.signal);
        }
        return options.execute({ operationId, signal: controller.signal, timeoutMs });
      })
      .catch((error: unknown) => {
        throw normalizeError(error, options.operation, options.tabId, controller.signal);
      })
      .finally(() => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abortFromCaller);
        if (this.active.get(options.key)?.promise === promise) this.active.delete(options.key);
      });
    this.active.set(options.key, { controller, promise });
    return promise;
  }

  cancelAll(reason: BrowserOperationReason = "cancelled"): void {
    for (const operation of this.active.values()) {
      operation.controller.abort({ reason, dialogDetected: reason === "dialog" });
    }
  }

  get pendingCount(): number {
    return this.active.size;
  }
}

export const domSnapshotOperations = new BrowserOperationCoordinator();
