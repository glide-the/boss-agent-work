import type { JsonRpcMessage, JsonRpcRequest } from '../types/native';

type ResolveReject = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
type Transport = {
  sendMessage(message: JsonRpcMessage): void;
  setMessageCallback(callback: (message: JsonRpcMessage) => void): void;
  addCloseListener?: (callback: (error?: Error) => void) => void;
};

export class JsonRpcEndpoint {
  private nextId = 1;
  private pendingRequests = new Map<number, ResolveReject>();
  private requestHandlers = new Map<string, (params: unknown) => unknown | Promise<unknown>>();
  private eventHandlers = new Map<string, Array<(params: unknown) => void>>();

  constructor(private readonly transport: Transport) {
    transport.setMessageCallback((message) => void this.handleIncomingMessage(message));
    transport.addCloseListener?.((error) => this.rejectPendingRequests(error?.message ?? 'transport closed before response'));
  }

  registerRequestHandlerObject(handlerObject: object): void {
    const names = new Set([
      ...Object.getOwnPropertyNames(handlerObject),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(handlerObject)),
    ]);
    for (const name of names) {
      if (name === 'constructor') continue;
      const value = (handlerObject as Record<string, unknown>)[name];
      if (typeof value === 'function') this.registerRequestHandler(name, value.bind(handlerObject));
    }
  }

  registerRequestHandler(method: string, handler: (params: unknown) => unknown | Promise<unknown>): void {
    this.requestHandlers.set(method, handler);
  }

  addEventListener(method: string, handler: (params: unknown) => void): void {
    const handlers = this.eventHandlers.get(method) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(method, handlers);
  }

  removeEventListener(method: string, handler: (params: unknown) => void): void {
    const handlers = this.eventHandlers.get(method) ?? [];
    this.eventHandlers.set(method, handlers.filter((item) => item !== handler));
  }

  sendNotification(method: string, params?: unknown): void {
    this.transport.sendMessage({ jsonrpc: '2.0', method, params });
  }

  sendRequest<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try {
        this.transport.sendMessage({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  private async handleIncomingMessage(message: JsonRpcMessage): Promise<void> {
    if ('method' in message) return this.handleIncomingRequest(message as JsonRpcRequest);
    if (!('id' in message)) return;
    const pending = this.pendingRequests.get(Number(message.id));
    if (!pending) return;
    this.pendingRequests.delete(Number(message.id));
    if ('error' in message) pending.reject(message.error.message);
    else if ('result' in message) pending.resolve(message.result);
  }

  private rejectPendingRequests(reason: unknown): void {
    for (const pending of this.pendingRequests.values()) pending.reject(reason);
    this.pendingRequests.clear();
  }

  private async handleIncomingRequest(request: JsonRpcRequest): Promise<void> {
    if (request.id === undefined) {
      for (const handler of this.eventHandlers.get(request.method) ?? []) handler(request.params);
      return;
    }
    const handler = this.requestHandlers.get(request.method);
    if (!handler) {
      this.transport.sendMessage({ jsonrpc: '2.0', id: request.id, error: { code: -1, message: `No handler registered for method: ${request.method}` } });
      return;
    }
    try {
      const result = await handler(request.params);
      this.transport.sendMessage({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) {
      const structured = typeof error === 'object' && error !== null ? error as { code?: number | string; data?: unknown } : {};
      this.transport.sendMessage({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: typeof structured.code === 'number' || typeof structured.code === 'string' ? structured.code : 1,
          message: error instanceof Error ? error.message : String(error),
          ...(structured.data === undefined ? {} : { data: structured.data }),
        },
      });
    }
  }
}
