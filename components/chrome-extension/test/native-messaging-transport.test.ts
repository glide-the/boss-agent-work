import { describe, expect, test } from 'bun:test';

import { NativeMessagingTransport } from '../src/background/native-messaging-transport';

describe('NativeMessagingTransport reconnect circuit', () => {
  test('stops after five bounded reconnect attempts', async () => {
    let alarmListener: ((alarm: { name: string }) => void) | undefined;
    let connectCalls = 0;
    let clearCalls = 0;
    (globalThis as { chrome?: unknown }).chrome = {
      alarms: {
        onAlarm: { addListener(listener: (alarm: { name: string }) => void) { alarmListener = listener; } },
        async get() { return undefined; },
        async create() {},
        async clear() { clearCalls += 1; return true; },
      },
      runtime: {
        connectNative() {
          connectCalls += 1;
          throw new Error('host unavailable');
        },
      },
    };

    const transport = new NativeMessagingTransport('com.example.test');
    for (let index = 0; index < 10; index += 1) {
      alarmListener?.({ name: 'native-transport-reconnect:com.example.test' });
    }
    await Promise.resolve();

    expect(connectCalls).toBe(6);
    expect(transport.getStatus()).toMatchObject({
      state: 'disconnected',
      reconnectAttempt: 5,
    });
    expect(clearCalls).toBeGreaterThan(0);
    expect(() => transport.sendMessage({ jsonrpc: '2.0', method: 'ping' })).toThrow(
      'reconnect limit reached',
    );
    expect(connectCalls).toBe(6);
  });
});
