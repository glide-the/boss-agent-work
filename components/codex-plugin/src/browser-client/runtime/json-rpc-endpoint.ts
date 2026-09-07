import { BrowserOperationError, type BrowserOperationReason } from "./browser-operation.ts";

type JsonRpcId = string | number;
type JsonRpcMessage = Record<string, unknown>;
type Transport = {
  sendMessage(message: JsonRpcMessage): void;
  setMessageCallback(callback: (message: JsonRpcMessage) => void): void;
  addCloseListener?: (callback: (error?: Error) => void) => (() => void) | void;
};

type RequestHandler = (params: unknown) => unknown | Promise<unknown>;
type EventHandler = (params: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
  disconnectedError: (reason: unknown) => unknown;
}

interface CancelRequest {
  method: string;
  params: Record<string, unknown>;
}

export interface SendRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  cancelRequest?: CancelRequest;
  operation?: string;
  tabId?: number;
  operationId?: string;
}

export class RemoteJsonRpcError extends Error {
  readonly code: number | string | undefined;
  readonly data: unknown;

  constructor(error: { code?: number | string; message?: string; data?: unknown }) {
    super(error.message ?? "JSON-RPC request failed");
    this.name = "RemoteJsonRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

export class CancellableJsonRpcEndpoint {
  private nextId = 1;
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly eventHandlers = new Map<string, EventHandler[]>();
  private readonly lateResponseTombstones = new Set<JsonRpcId>();

  constructor(private readonly transport: Transport) {
    transport.setMessageCallback((message) => void this.handleIncomingMessage(message));
    transport.addCloseListener?.((error) => {
      this.rejectPendingRequests(error ?? new Error("transport closed before response"));
    });
  }

  registerRequestHandlerObject(handlerObject: object): void {
    const names = new Set([
      ...Object.getOwnPropertyNames(handlerObject),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(handlerObject)),
    ]);
    for (const name of names) {
      if (name === "constructor") continue;
      const value = (handlerObject as Record<string, unknown>)[name];
      if (typeof value === "function") this.registerRequestHandler(name, value.bind(handlerObject));
    }
  }

  registerRequestHandler(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  addEventListener(method: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(method) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(method, handlers);
  }

  removeEventListener(method: string, handler: EventHandler): void {
    this.eventHandlers.set(method, (this.eventHandlers.get(method) ?? []).filter((item) => item !== handler));
  }

  sendNotification(method: string, params?: unknown): void {
    this.transport.sendMessage({ jsonrpc: "2.0", method, params });
  }

  sendRequest<TResult = unknown>(method: string, params?: unknown, options: SendRequestOptions = {}): Promise<TResult> {
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortFromSignal = () => {};
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", abortFromSignal);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        this.pendingRequests.delete(id);
        cleanup();
        callback();
      };
      const abort = (abortReason?: BrowserOperationReason, dialogDetectedOverride?: boolean) => {
        if (settled) return;
        this.rememberTombstone(id);
        const signalReason = options.signal?.reason as { reason?: BrowserOperationReason; dialogDetected?: boolean } | undefined;
        const reason = abortReason ?? signalReason?.reason ?? "cancelled";
        const dialogDetected = dialogDetectedOverride ?? signalReason?.dialogDetected === true;
        const cancel = options.cancelRequest == null
          ? Promise.resolve({ browserCleanupComplete: false })
          : this.sendRequest<Record<string, unknown>>(
              options.cancelRequest.method,
              { ...options.cancelRequest.params, reason },
              { timeoutMs: 1_000 },
            )
              .then((result) => ({ browserCleanupComplete: result.browserCleanupComplete === true }))
              .catch(() => ({ browserCleanupComplete: false }));
        finish(() => {
          void cancel.then(({ browserCleanupComplete }) => reject(new BrowserOperationError({
            operation: options.operation ?? method,
            tabId: options.tabId ?? 0,
            reason,
            dialogDetected,
            browserCleanupComplete,
            requestId: options.operationId ?? String(id),
          })));
        });
      };
      this.pendingRequests.set(id, {
        resolve: (value) => finish(() => resolve(value as TResult)),
        reject: (error) => finish(() => reject(error)),
        cleanup,
        disconnectedError: (error) => options.operationId == null
          ? error
          : new BrowserOperationError({
              operation: options.operation ?? method,
              tabId: options.tabId ?? 0,
              reason: "browser_disconnected",
              dialogDetected: false,
              browserCleanupComplete: false,
              requestId: options.operationId,
            }, error instanceof Error ? error.message : String(error)),
      });
      if (options.signal?.aborted) {
        abort();
        return;
      }
      abortFromSignal = () => abort();
      options.signal?.addEventListener("abort", abortFromSignal, { once: true });
      if (options.timeoutMs !== undefined) timer = setTimeout(() => abort("timeout", false), options.timeoutMs);
      try {
        this.transport.sendMessage({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }

  debugSnapshot(): { pendingRequests: number; tombstones: number } {
    return { pendingRequests: this.pendingRequests.size, tombstones: this.lateResponseTombstones.size };
  }

  private rememberTombstone(id: JsonRpcId): void {
    this.lateResponseTombstones.add(id);
    while (this.lateResponseTombstones.size > 1_024) {
      const first = this.lateResponseTombstones.values().next().value as JsonRpcId | undefined;
      if (first === undefined) break;
      this.lateResponseTombstones.delete(first);
    }
  }

  private async handleIncomingMessage(message: JsonRpcMessage): Promise<void> {
    if ("method" in message) return this.handleIncomingRequest(message);
    if (!("id" in message)) return;
    const id = message.id as JsonRpcId;
    if (this.lateResponseTombstones.delete(id)) return;
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    if ("error" in message && typeof message.error === "object" && message.error !== null) {
      const remote = message.error as { code?: number | string; message?: string; data?: unknown };
      pending.reject(remote.data === undefined
        ? (remote.message ?? "Something went wrong")
        : new RemoteJsonRpcError(remote));
    } else {
      // Void extension handlers serialize `result: undefined` without a result
      // property. Match the baseline client and settle those responses as void.
      pending.resolve(message.result);
    }
  }

  private rejectPendingRequests(reason: unknown): void {
    const pending = [...this.pendingRequests.values()];
    this.pendingRequests.clear();
    for (const request of pending) {
      request.cleanup();
      request.reject(request.disconnectedError(reason));
    }
  }

  private async handleIncomingRequest(request: JsonRpcMessage): Promise<void> {
    const method = typeof request.method === "string" ? request.method : "";
    if (!("id" in request)) {
      for (const handler of this.eventHandlers.get(method) ?? []) handler(request.params);
      return;
    }
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.transport.sendMessage({ jsonrpc: "2.0", id: request.id, error: { code: -1, message: `No handler registered for method: ${method}` } });
      return;
    }
    try {
      const result = await handler(request.params);
      this.transport.sendMessage({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      this.transport.sendMessage({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: 1, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
