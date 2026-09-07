import { describe, expect, test } from "bun:test";

import {
  BrowserOperationCoordinator,
  BrowserOperationError,
} from "../runtime/browser-operation.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("BrowserOperationCoordinator", () => {
  test("returns a normal DOM snapshot and clears the pending entry", async () => {
    const coordinator = new BrowserOperationCoordinator();
    const result = await coordinator.run({
      key: "browser:7",
      operation: "playwright.domSnapshot",
      tabId: 7,
      execute: async () => "snapshot",
    });

    expect(result).toBe("snapshot");
    expect(coordinator.pendingCount).toBe(0);
  });

  test("uses single-flight for concurrent snapshots on the same tab", async () => {
    const coordinator = new BrowserOperationCoordinator();
    const pending = deferred<string>();
    let executions = 0;
    const run = () => coordinator.run({
      key: "browser:9",
      operation: "playwright.domSnapshot",
      tabId: 9,
      execute: async () => {
        executions += 1;
        return pending.promise;
      },
    });

    const snapshots = Array.from({ length: 20 }, run);
    expect(executions).toBe(0);
    await Promise.resolve();
    expect(executions).toBe(1);
    expect(coordinator.pendingCount).toBe(1);
    pending.resolve("one snapshot");
    expect(await Promise.all(snapshots)).toEqual(Array(20).fill("one snapshot"));
    expect(coordinator.pendingCount).toBe(0);
  });

  test("propagates caller cancellation with structured details", async () => {
    const coordinator = new BrowserOperationCoordinator();
    const controller = new AbortController();
    const result = coordinator.run({
      key: "browser:11",
      operation: "playwright.domSnapshot",
      tabId: 11,
      signal: controller.signal,
      execute: async ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });

    controller.abort();
    await expect(result).rejects.toMatchObject({
      name: "BrowserOperationError",
      code: "BROWSER_OPERATION_CANCELLED",
      details: {
        operation: "playwright.domSnapshot",
        tabId: 11,
        reason: "cancelled",
        dialogDetected: false,
      },
    });
    expect(coordinator.pendingCount).toBe(0);
  });

  test("times out with a bounded structured failure", async () => {
    const coordinator = new BrowserOperationCoordinator();
    const result = coordinator.run({
      key: "browser:13",
      operation: "playwright.domSnapshot",
      tabId: 13,
      timeoutMs: 5,
      execute: async ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });

    await expect(result).rejects.toMatchObject({
      details: { reason: "timeout", tabId: 13 },
    });
    expect(coordinator.pendingCount).toBe(0);
  });

  test("does not start work when the caller signal is already aborted", async () => {
    const coordinator = new BrowserOperationCoordinator();
    const controller = new AbortController();
    controller.abort();
    let executions = 0;

    await expect(coordinator.run({
      key: "browser:15",
      operation: "playwright.domSnapshot",
      tabId: 15,
      signal: controller.signal,
      execute: async () => {
        executions += 1;
        return "unexpected";
      },
    })).rejects.toBeInstanceOf(BrowserOperationError);
    expect(executions).toBe(0);
    expect(coordinator.pendingCount).toBe(0);
  });

  test("releases all state over 50 cancellation cycles", async () => {
    const coordinator = new BrowserOperationCoordinator();
    for (let index = 0; index < 50; index += 1) {
      const operation = coordinator.run({
        key: "browser:17",
        operation: "playwright.domSnapshot",
        tabId: 17,
        execute: async ({ signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      });
      await Promise.resolve();
      coordinator.cancelAll("cancelled");
      await expect(operation).rejects.toBeInstanceOf(BrowserOperationError);
      expect(coordinator.pendingCount).toBe(0);
    }
  });
});
