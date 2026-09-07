import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { ChromeBrowserControlHandler } from '../src/background/chrome-browser-control-handler';
import { JsonRpcEndpoint } from '../src/background/json-rpc-endpoint';
import {
  CancellableJsonRpcEndpoint,
  RemoteJsonRpcError,
} from '../../codex-plugin/src/browser-client/runtime/json-rpc-endpoint';

type Message = Record<string, unknown>;

class MemoryTransport {
  peer?: MemoryTransport;
  callback: (message: Message) => void = () => {};
  closeCallback: (error?: Error) => void = () => {};

  sendMessage(message: Message): void {
    queueMicrotask(() => this.peer?.callback(message));
  }

  setMessageCallback(callback: (message: Message) => void): void {
    this.callback = callback;
  }

  addCloseListener(callback: (error?: Error) => void): () => void {
    this.closeCallback = callback;
    return () => {};
  }
}

function createPair(): [MemoryTransport, MemoryTransport] {
  const client = new MemoryTransport();
  const server = new MemoryTransport();
  client.peer = server;
  server.peer = client;
  return [client, server];
}

let rejectCommand: ((error: Error) => void) | undefined;

function installChromeMock(hang = false): void {
  rejectCommand = undefined;
  (globalThis as { chrome?: unknown }).chrome = {
    debugger: {
      async attach() {},
      async detach() { rejectCommand?.(new Error('Debugger detached')); },
      async getTargets() { return []; },
      sendCommand() {
        if (!hang) return Promise.resolve({ result: { value: 'snapshot' } });
        return new Promise((_resolve, reject) => { rejectCommand = reject; });
      },
    },
  };
}

function createProtocol() {
  const [clientTransport, serverTransport] = createPair();
  const handler = new ChromeBrowserControlHandler();
  const server = new JsonRpcEndpoint(serverTransport as never);
  server.registerRequestHandlerObject(handler);
  const client = new CancellableJsonRpcEndpoint(clientTransport);
  return { client, clientTransport, handler };
}

beforeEach(() => installChromeMock());

afterEach(async () => {
  const handler = new ChromeBrowserControlHandler();
  await handler.handleBrowserDisconnected();
});

describe('browser-client to Chrome extension cancellation protocol', () => {
  test('native dialog state crosses JSON-RPC as a structured operation error', async () => {
    const { client, handler } = createProtocol();
    handler.handleCdpEvent({ tabId: 51 }, 'Page.javascriptDialogOpening', { type: 'confirm' });

    const request = client.sendRequest('executeCdp', {
      target: { tabId: 51 },
      method: 'Runtime.evaluate',
      operation: 'playwright.domSnapshot',
      operationId: 'dialog:51',
    });
    try {
      await request;
      throw new Error('Expected the native dialog request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteJsonRpcError);
      expect(error).toMatchObject({
        code: 'BROWSER_OPERATION_CANCELLED',
        data: {
          operation: 'playwright.domSnapshot',
          tabId: 51,
          reason: 'dialog',
          dialogDetected: true,
          browserCleanupComplete: true,
          requestId: 'dialog:51',
        },
      });
    }
    handler.handleCdpEvent({ tabId: 51 }, 'Page.javascriptDialogClosed', {});
  });

  test('client abort sends the cancel command, waits for cleanup, and drops the late result', async () => {
    installChromeMock(true);
    const { client, handler } = createProtocol();
    const controller = new AbortController();
    const operationId = 'cancel:53';
    const request = client.sendRequest('executeCdp', {
      target: { tabId: 53 },
      method: 'Runtime.evaluate',
      operation: 'playwright.domSnapshot',
      operationId,
    }, {
      signal: controller.signal,
      operation: 'playwright.domSnapshot',
      operationId,
      tabId: 53,
      cancelRequest: { method: 'cancelBrowserOperation', params: { operationId } },
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort({ reason: 'cancelled', dialogDetected: false });

    await expect(request).rejects.toMatchObject({
      details: {
        reason: 'cancelled',
        browserCleanupComplete: true,
        requestId: operationId,
      },
    });
    await Promise.resolve();
    expect(client.debugSnapshot().pendingRequests).toBe(0);
    expect(handler.getBrowserOperationDiagnostics().activeOperations).toBe(0);
  });
});
