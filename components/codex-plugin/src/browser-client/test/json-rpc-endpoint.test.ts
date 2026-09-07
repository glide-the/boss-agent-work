import { describe, expect, test } from "bun:test";

import { BrowserOperationError } from "../runtime/browser-operation.ts";
import { CancellableJsonRpcEndpoint } from "../runtime/json-rpc-endpoint.ts";

type Message = Record<string, unknown>;

class FakeTransport {
  readonly sent: Message[] = [];
  private messageCallback: (message: Message) => void = () => {};
  private closeCallback: (error?: Error) => void = () => {};

  sendMessage(message: Message): void {
    this.sent.push(message);
    if (message.method === "cancelBrowserOperation") {
      queueMicrotask(() => this.receive({
        jsonrpc: "2.0",
        id: message.id,
        result: { browserCleanupComplete: true },
      }));
    }
  }

  setMessageCallback(callback: (message: Message) => void): void {
    this.messageCallback = callback;
  }

  addCloseListener(callback: (error?: Error) => void): () => void {
    this.closeCallback = callback;
    return () => {};
  }

  receive(message: Message): void {
    this.messageCallback(message);
  }

  close(error = new Error("disconnected")): void {
    this.closeCallback(error);
  }
}

function cancellableRequest(endpoint: CancellableJsonRpcEndpoint, controller: AbortController, operationId: string) {
  return endpoint.sendRequest("executeCdp", { method: "Runtime.evaluate" }, {
    signal: controller.signal,
    timeoutMs: 1_000,
    operation: "playwright.domSnapshot",
    operationId,
    tabId: 21,
    cancelRequest: {
      method: "cancelBrowserOperation",
      params: { operationId },
    },
  });
}

describe("CancellableJsonRpcEndpoint", () => {
  test("resolves normal responses and removes pending state", async () => {
    const transport = new FakeTransport();
    const endpoint = new CancellableJsonRpcEndpoint(transport);
    const request = endpoint.sendRequest("ping");
    transport.receive({ jsonrpc: "2.0", id: 1, result: "pong" });

    expect(await request).toBe("pong");
    expect(endpoint.debugSnapshot()).toEqual({ pendingRequests: 0, tombstones: 0 });
  });

  test("propagates cancellation, acknowledges browser cleanup, and drops a late response", async () => {
    const transport = new FakeTransport();
    const endpoint = new CancellableJsonRpcEndpoint(transport);
    const controller = new AbortController();
    const request = cancellableRequest(endpoint, controller, "operation:1");

    controller.abort({ reason: "dialog", dialogDetected: true });
    await expect(request).rejects.toMatchObject({
      name: "BrowserOperationError",
      details: {
        operation: "playwright.domSnapshot",
        tabId: 21,
        reason: "dialog",
        dialogDetected: true,
        browserCleanupComplete: true,
        requestId: "operation:1",
      },
    });
    expect(endpoint.debugSnapshot()).toEqual({ pendingRequests: 0, tombstones: 1 });
    transport.receive({ jsonrpc: "2.0", id: 1, result: "late" });
    expect(endpoint.debugSnapshot()).toEqual({ pendingRequests: 0, tombstones: 0 });
  });

  test("labels endpoint-owned timeout as timeout and cleans pending state", async () => {
    const transport = new FakeTransport();
    const endpoint = new CancellableJsonRpcEndpoint(transport);

    const request = endpoint.sendRequest("executeCdp", {}, {
      timeoutMs: 5,
      operation: "playwright.domSnapshot",
      operationId: "operation:timeout",
      tabId: 23,
    });
    await expect(request).rejects.toMatchObject({
      details: { reason: "timeout", browserCleanupComplete: false },
    });
    expect(endpoint.debugSnapshot().pendingRequests).toBe(0);
  });

  test("rejects operations structurally when the browser transport closes", async () => {
    const transport = new FakeTransport();
    const endpoint = new CancellableJsonRpcEndpoint(transport);
    const controller = new AbortController();
    const request = cancellableRequest(endpoint, controller, "operation:disconnect");

    transport.close();
    await expect(request).rejects.toMatchObject({
      name: "BrowserOperationError",
      details: {
        reason: "browser_disconnected",
        browserCleanupComplete: false,
        requestId: "operation:disconnect",
      },
    });
    expect(endpoint.debugSnapshot().pendingRequests).toBe(0);
  });

  test("returns to baseline after 50 cancelled requests", async () => {
    const transport = new FakeTransport();
    const endpoint = new CancellableJsonRpcEndpoint(transport);
    for (let index = 0; index < 50; index += 1) {
      const controller = new AbortController();
      const request = cancellableRequest(endpoint, controller, `operation:${index}`);
      controller.abort();
      await expect(request).rejects.toBeInstanceOf(BrowserOperationError);
      expect(endpoint.debugSnapshot().pendingRequests).toBe(0);
      transport.receive({ jsonrpc: "2.0", id: 1 + index * 2, result: "late" });
    }
    expect(endpoint.debugSnapshot()).toEqual({ pendingRequests: 0, tombstones: 0 });
  });
});
