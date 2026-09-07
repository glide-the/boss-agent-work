export class CdpCommandTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for CDP command ${method}.`);
    this.name = 'CdpCommandTimeoutError';
  }
}

export interface CdpCommandRequest {
  target: { tabId?: number; targetId?: string };
  method: string;
  commandParams?: Record<string, unknown>;
  timeoutMs?: number;
  operationId?: string;
  operation?: string;
}

const DEFAULT_CDP_TIMEOUT_MS = 30_000;

type CancellationReason = 'timeout' | 'cancelled' | 'dialog' | 'tab_closed' | 'browser_disconnected';

type ActiveOperation = {
  operationId: string;
  operation: string;
  tabId: number;
  method: string;
  controller: AbortController;
  cleanupPromise: Promise<boolean>;
  resolveCleanup: (complete: boolean) => void;
};

export class ChromeBrowserOperationError extends Error {
  readonly code = 'BROWSER_OPERATION_CANCELLED';
  readonly data: {
    operation: string;
    tabId: number;
    reason: CancellationReason;
    dialogDetected: boolean;
    browserCleanupComplete: boolean;
    requestId: string;
  };

  constructor(operation: ActiveOperation | { operationId: string; operation: string; tabId: number }, reason: CancellationReason, cleanupComplete: boolean) {
    super(`${operation.operation} ${reason} for tab ${operation.tabId}`);
    this.name = 'ChromeBrowserOperationError';
    this.data = {
      operation: operation.operation,
      tabId: operation.tabId,
      reason,
      dialogDetected: reason === 'dialog',
      browserCleanupComplete: cleanupComplete,
      requestId: operation.operationId,
    };
  }
}

class CdpOperationRegistry {
  private readonly active = new Map<string, Set<ActiveOperation>>();
  private readonly dialogs = new Map<number, string>();

  begin(request: CdpCommandRequest): ActiveOperation | null {
    if (!request.operationId) return null;
    const tabId = request.target.tabId;
    if (!Number.isInteger(tabId)) return null;
    if (request.method !== 'Page.handleJavaScriptDialog' && this.dialogs.has(tabId!)) {
      throw new ChromeBrowserOperationError({
        operationId: request.operationId,
        operation: request.operation ?? 'browser.operation',
        tabId: tabId!,
      }, 'dialog', true);
    }
    let resolveCleanup = (_complete: boolean) => {};
    const cleanupPromise = new Promise<boolean>((resolve) => { resolveCleanup = resolve; });
    const operation: ActiveOperation = {
      operationId: request.operationId,
      operation: request.operation ?? 'browser.operation',
      tabId: tabId!,
      method: request.method,
      controller: new AbortController(),
      cleanupPromise,
      resolveCleanup,
    };
    const operations = this.active.get(request.operationId) ?? new Set<ActiveOperation>();
    operations.add(operation);
    this.active.set(request.operationId, operations);
    return operation;
  }

  finish(operation: ActiveOperation | null): void {
    if (!operation) return;
    const operations = this.active.get(operation.operationId);
    operations?.delete(operation);
    if (operations?.size === 0) this.active.delete(operation.operationId);
  }

  async cancel(operationId: string, reason: CancellationReason = 'cancelled'): Promise<boolean> {
    const operations = [...(this.active.get(operationId) ?? [])];
    if (operations.length === 0) return true;
    for (const operation of operations) operation.controller.abort(reason);
    const results = await Promise.all(operations.map((operation) => operation.cleanupPromise));
    return results.every(Boolean);
  }

  async cancelTab(tabId: number, reason: CancellationReason): Promise<void> {
    const ids = new Set<string>();
    for (const operations of this.active.values()) {
      for (const operation of operations) if (operation.tabId === tabId) ids.add(operation.operationId);
    }
    await Promise.all([...ids].map((id) => this.cancel(id, reason)));
    if (reason === 'tab_closed') this.dialogs.delete(tabId);
  }

  async cancelAll(reason: CancellationReason): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.cancel(id, reason)));
    if (reason === 'browser_disconnected') this.dialogs.clear();
  }

  handleCdpEvent(source: { tabId?: number }, method: string, params: unknown): void {
    const tabId = source.tabId;
    if (!Number.isInteger(tabId)) return;
    if (method === 'Page.javascriptDialogOpening') {
      const type = typeof params === 'object' && params !== null && 'type' in params ? String((params as { type: unknown }).type) : 'dialog';
      this.dialogs.set(tabId!, type);
      void this.cancelTab(tabId!, 'dialog');
    } else if (method === 'Page.javascriptDialogClosed') {
      this.dialogs.delete(tabId!);
    }
  }

  diagnostics(): { activeOperations: number; activeDialogs: number } {
    let activeOperations = 0;
    for (const operations of this.active.values()) activeOperations += operations.size;
    return { activeOperations, activeDialogs: this.dialogs.size };
  }
}

const operationRegistry = new CdpOperationRegistry();

async function detachTarget(target: CdpCommandRequest['target']): Promise<boolean> {
  try {
    return await Promise.race([
      chrome.debugger.detach(target).then(() => true, () => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
  } catch {
    return false;
  }
}

export async function sendCdpCommand<T = unknown>(request: CdpCommandRequest): Promise<T> {
  const timeoutMs = request.timeoutMs && request.timeoutMs > 0 ? request.timeoutMs : DEFAULT_CDP_TIMEOUT_MS;
  const activeOperation = operationRegistry.begin(request);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener = () => {};
  try {
    const rawCommand = request.method === 'Target.getTargets'
      ? chrome.debugger.getTargets().then((targetInfos: unknown) => ({ targetInfos }))
      : chrome.debugger.sendCommand(request.target, request.method, request.commandParams);
    const command = rawCommand.catch(async (error: unknown) => {
      if (!activeOperation?.controller.signal.aborted) throw error;
      const cleanupComplete = await activeOperation.cleanupPromise;
      throw new ChromeBrowserOperationError(
        activeOperation,
        activeOperation.controller.signal.reason as CancellationReason,
        cleanupComplete,
      );
    }) as Promise<T>;
    void command.catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (activeOperation) activeOperation.controller.abort('timeout');
        else reject(new CdpCommandTimeoutError(request.method, timeoutMs));
      }, timeoutMs);
    });
    const cancelled = activeOperation == null
      ? new Promise<never>(() => {})
      : new Promise<never>((_, reject) => {
          const onAbort = () => {
            const reason = activeOperation.controller.signal.reason as CancellationReason;
            void detachTarget(request.target).then((cleanupComplete) => {
              activeOperation.resolveCleanup(cleanupComplete);
              reject(new ChromeBrowserOperationError(activeOperation, reason, cleanupComplete));
            });
          };
          activeOperation.controller.signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => activeOperation.controller.signal.removeEventListener('abort', onAbort);
        });
    return await Promise.race([command, timeout, cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
    removeAbortListener();
    if (activeOperation && !activeOperation.controller.signal.aborted) activeOperation.resolveCleanup(true);
    operationRegistry.finish(activeOperation);
  }
}

export async function cancelCdpOperation(operationId: string, reason: CancellationReason = 'cancelled'): Promise<{ browserCleanupComplete: boolean }> {
  return { browserCleanupComplete: await operationRegistry.cancel(operationId, reason) };
}

export function handleCdpLifecycleEvent(source: { tabId?: number }, method: string, params: unknown): void {
  operationRegistry.handleCdpEvent(source, method, params);
}

export async function cancelCdpOperationsForTab(tabId: number, reason: CancellationReason = 'tab_closed'): Promise<void> {
  await operationRegistry.cancelTab(tabId, reason);
}

export async function cancelAllCdpOperations(reason: CancellationReason = 'browser_disconnected'): Promise<void> {
  await operationRegistry.cancelAll(reason);
}

export function cdpOperationDiagnostics(): { activeOperations: number; activeDialogs: number } {
  return operationRegistry.diagnostics();
}

export async function attachDebugger(tabId: number): Promise<void> {
  await chrome.debugger.attach({ tabId }, '1.3');
}

export async function detachDebugger(tabId: number): Promise<void> {
  await chrome.debugger.detach({ tabId });
}
