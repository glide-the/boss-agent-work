import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  cancelAllCdpOperations,
  cancelCdpOperation,
  cancelCdpOperationsForTab,
  cdpOperationDiagnostics,
  handleCdpLifecycleEvent,
  sendCdpCommand,
} from '../src/background/cdp-client';

type RejectCommand = (error: Error) => void;

let rejectCommand: RejectCommand | undefined;
let detachCalls = 0;
let sendCalls = 0;

function installChromeMock(sendCommand: () => Promise<unknown>): void {
  rejectCommand = undefined;
  detachCalls = 0;
  sendCalls = 0;
  (globalThis as { chrome?: unknown }).chrome = {
    debugger: {
      async attach() {},
      async detach() {
        detachCalls += 1;
        rejectCommand?.(new Error('Debugger detached'));
      },
      async getTargets() { return []; },
      sendCommand() {
        sendCalls += 1;
        return sendCommand();
      },
    },
  };
}

function hangingCommand(): Promise<unknown> {
  return new Promise((_resolve, reject) => {
    rejectCommand = reject;
  });
}

function request(tabId: number, operationId: string, timeoutMs = 1_000) {
  return sendCdpCommand({
    target: { tabId },
    method: 'Runtime.evaluate',
    commandParams: { expression: 'document.body.innerText' },
    operation: 'playwright.domSnapshot',
    operationId,
    timeoutMs,
  });
}

beforeEach(async () => {
  installChromeMock(async () => ({ result: { value: 'snapshot' } }));
  await cancelAllCdpOperations();
});

afterEach(async () => {
  await cancelAllCdpOperations();
  expect(cdpOperationDiagnostics().activeOperations).toBe(0);
});

describe('CDP browser operation cancellation', () => {
  test('normal DOM evaluation succeeds without leaked operation state', async () => {
    expect(await request(31, 'normal')).toEqual({ result: { value: 'snapshot' } });
    expect(cdpOperationDiagnostics()).toEqual({ activeOperations: 0, activeDialogs: 0 });
    expect(detachCalls).toBe(0);
  });

  test('an already-open native dialog fails before dispatch with structured details', async () => {
    handleCdpLifecycleEvent({ tabId: 33 }, 'Page.javascriptDialogOpening', { type: 'confirm' });

    await expect(request(33, 'dialog-preflight')).rejects.toMatchObject({
      name: 'ChromeBrowserOperationError',
      code: 'BROWSER_OPERATION_CANCELLED',
      data: {
        operation: 'playwright.domSnapshot',
        tabId: 33,
        reason: 'dialog',
        dialogDetected: true,
        browserCleanupComplete: true,
        requestId: 'dialog-preflight',
      },
    });
    expect(sendCalls).toBe(0);

    handleCdpLifecycleEvent({ tabId: 33 }, 'Page.javascriptDialogClosed', {});
    expect(await request(33, 'after-dialog')).toEqual({ result: { value: 'snapshot' } });
  });

  test('a dialog opening cancels an in-flight command and detaches the debugger', async () => {
    installChromeMock(hangingCommand);
    const snapshot = request(35, 'dialog-in-flight');
    await Promise.resolve();

    handleCdpLifecycleEvent({ tabId: 35 }, 'Page.javascriptDialogOpening', { type: 'alert' });
    await expect(snapshot).rejects.toMatchObject({
      data: {
        reason: 'dialog',
        dialogDetected: true,
        browserCleanupComplete: true,
      },
    });
    expect(detachCalls).toBe(1);
    expect(cdpOperationDiagnostics()).toEqual({ activeOperations: 0, activeDialogs: 1 });
    handleCdpLifecycleEvent({ tabId: 35 }, 'Page.javascriptDialogClosed', {});
  });

  test('explicit cancellation is idempotent and leaves no active command', async () => {
    installChromeMock(hangingCommand);
    const snapshot = request(37, 'explicit-cancel');
    await Promise.resolve();

    expect(await cancelCdpOperation('explicit-cancel')).toEqual({ browserCleanupComplete: true });
    expect(await cancelCdpOperation('explicit-cancel')).toEqual({ browserCleanupComplete: true });
    await expect(snapshot).rejects.toMatchObject({ data: { reason: 'cancelled' } });
    expect(cdpOperationDiagnostics().activeOperations).toBe(0);
  });

  test('operation timeout detaches the debugger and reports timeout, not a generic error', async () => {
    installChromeMock(hangingCommand);

    await expect(request(39, 'timeout', 5)).rejects.toMatchObject({
      data: {
        reason: 'timeout',
        browserCleanupComplete: true,
      },
    });
    expect(detachCalls).toBe(1);
    expect(cdpOperationDiagnostics().activeOperations).toBe(0);
  });

  test('tab close and browser disconnect cancel their scoped operations', async () => {
    installChromeMock(hangingCommand);
    const closedTab = request(41, 'tab-close');
    await Promise.resolve();
    await cancelCdpOperationsForTab(41);
    await expect(closedTab).rejects.toMatchObject({ data: { reason: 'tab_closed' } });

    installChromeMock(hangingCommand);
    const disconnected = request(43, 'disconnect');
    await Promise.resolve();
    await cancelAllCdpOperations();
    await expect(disconnected).rejects.toMatchObject({ data: { reason: 'browser_disconnected' } });
    expect(cdpOperationDiagnostics()).toEqual({ activeOperations: 0, activeDialogs: 0 });
  });

  test('50 native-dialog cancellations do not accumulate operations or dialogs', async () => {
    installChromeMock(hangingCommand);
    for (let index = 0; index < 50; index += 1) {
      const tabId = 100 + index;
      const snapshot = request(tabId, `repeat:${index}`);
      await Promise.resolve();
      handleCdpLifecycleEvent({ tabId }, 'Page.javascriptDialogOpening', { type: 'confirm' });
      await expect(snapshot).rejects.toMatchObject({ data: { reason: 'dialog' } });
      handleCdpLifecycleEvent({ tabId }, 'Page.javascriptDialogClosed', {});
      expect(cdpOperationDiagnostics()).toEqual({ activeOperations: 0, activeDialogs: 0 });
    }
    expect(detachCalls).toBe(50);
  });
});
