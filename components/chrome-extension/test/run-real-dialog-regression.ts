import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  cdpOperationDiagnostics,
  handleCdpLifecycleEvent,
  sendCdpCommand,
} from '../src/background/cdp-client';

type CdpMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
  sessionId?: string;
};

class CdpConnection {
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    sessionId?: string;
  }>();
  onEvent: (message: CdpMessage) => void = () => {};

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => this.handleMessage(JSON.parse(String(event.data)) as CdpMessage));
    socket.addEventListener('close', () => this.rejectAll(new Error('CDP browser connection closed')));
  }

  static async connect(url: string): Promise<CdpConnection> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not open CDP websocket')), { once: true });
    });
    return new CdpConnection(socket);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, sessionId });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
    });
  }

  close(): void {
    this.socket.close();
  }

  private handleMessage(message: CdpMessage): void {
    if (message.method === 'Target.detachedFromTarget') {
      const detachedSessionId = String(message.params?.sessionId ?? '');
      for (const [id, pending] of this.pending) {
        if (pending.sessionId === detachedSessionId) {
          this.pending.delete(id);
          pending.reject(new Error('Debugger detached'));
        }
      }
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? 'CDP command failed'));
      else pending.resolve(message.result);
      return;
    }
    this.onEvent(message);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

const chromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'codex-dialog-regression-'));
const profileDirectory = path.join(temporaryRoot, 'profile');
const server = Bun.serve({
  port: 0,
  fetch: () => new Response('<!doctype html><html><body><button>Native dialog regression</button></body></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  }),
});
const pageUrl = `http://127.0.0.1:${server.port}/page`;
const chrome = Bun.spawn([
  chromeExecutable,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDirectory}`,
  'about:blank',
], { stdout: 'ignore', stderr: 'ignore' });

async function waitForDebugPort(): Promise<number> {
  const file = path.join(profileDirectory, 'DevToolsActivePort');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const port = Number((await readFile(file, 'utf8')).split('\n')[0]);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Google Chrome did not expose DevToolsActivePort');
}

type ProcessSample = { processCount: number; rssMiB: number; cpuPercent: number };
function processSample(rootPid: number): ProcessSample {
  const output = Bun.spawnSync(['ps', '-axo', 'pid=,ppid=,rss=,%cpu=']).stdout.toString();
  const rows = output.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), rss: Number(match[3]), cpu: Number(match[4]) }] : [];
  });
  const pids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (pids.has(row.ppid) && !pids.has(row.pid)) {
        pids.add(row.pid);
        changed = true;
      }
    }
  }
  const selected = rows.filter((row) => pids.has(row.pid));
  return {
    processCount: selected.length,
    rssMiB: Number((selected.reduce((sum, row) => sum + row.rss, 0) / 1024).toFixed(1)),
    cpuPercent: Number(selected.reduce((sum, row) => sum + row.cpu, 0).toFixed(1)),
  };
}

let connection: CdpConnection | undefined;
try {
  const port = await waitForDebugPort();
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()) as { webSocketDebuggerUrl: string };
  connection = await CdpConnection.connect(version.webSocketDebuggerUrl);
  const { targetId } = await connection.send<{ targetId: string }>('Target.createTarget', { url: pageUrl });
  const tabId = 1;
  let currentSessionId: string | undefined;
  const sessions = new Map<string, number>();

  async function attach(): Promise<void> {
    if (currentSessionId !== undefined) throw new Error('Debugger is already attached');
    const result = await connection!.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    currentSessionId = result.sessionId;
    sessions.set(result.sessionId, tabId);
  }

  async function detach(): Promise<void> {
    const sessionId = currentSessionId;
    if (sessionId === undefined) return;
    currentSessionId = undefined;
    await connection!.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
    sessions.delete(sessionId);
  }

  (globalThis as { chrome?: unknown }).chrome = {
    debugger: {
      attach: async () => attach(),
      detach: async () => detach(),
      getTargets: async () => [{ tabId, targetId, type: 'page' }],
      sendCommand: async (_target: unknown, method: string, params: Record<string, unknown> = {}) => {
        if (currentSessionId === undefined) throw new Error('Debugger is not attached');
        return connection!.send(method, params, currentSessionId);
      },
    },
  };
  connection.onEvent = (message) => {
    const eventTabId = message.sessionId === undefined ? undefined : sessions.get(message.sessionId);
    if (eventTabId !== undefined && message.method !== undefined) {
      handleCdpLifecycleEvent({ tabId: eventTabId }, message.method, message.params);
    }
  };

  await attach();
  await connection.send('Page.enable', {}, currentSessionId);
  await connection.send('Runtime.enable', {}, currentSessionId);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const snapshot = async (operationId: string) => {
    const value = await sendCdpCommand<{ result?: { value?: string } }>({
      target: { tabId },
      method: 'Runtime.evaluate',
      commandParams: { expression: 'document.body.innerText', returnByValue: true },
      operation: 'playwright.domSnapshot',
      operationId,
      timeoutMs: 500,
    });
    return value.result?.value ?? '';
  };
  const dismissDialog = async () => {
    if (currentSessionId === undefined) {
      await attach();
      await connection!.send('Page.enable', {}, currentSessionId);
    }
    await sendCdpCommand({
      target: { tabId },
      method: 'Page.handleJavaScriptDialog',
      commandParams: { accept: false },
      timeoutMs: 500,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  const waitForDialog = async () => {
    const deadline = Date.now() + 1_000;
    while (cdpOperationDiagnostics().activeDialogs === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    if (cdpOperationDiagnostics().activeDialogs === 0) throw new Error('Native dialog event was not observed');
  };
  const failure = async (promise: Promise<unknown>) => promise.then(
    () => null,
    (error) => typeof error === 'object' && error !== null ? error as Record<string, unknown> : { error: String(error) },
  );

  const samples: ProcessSample[] = [];
  const regression = (async () => {
    const normalBefore = await snapshot('normal:before');
    const inflightFailure = await failure(sendCdpCommand({
      target: { tabId },
      method: 'Runtime.evaluate',
      commandParams: { expression: "confirm('in-flight native dialog')", returnByValue: true },
      operation: 'playwright.domSnapshot',
      operationId: 'dialog:in-flight',
      timeoutMs: 1_000,
    }));
    await dismissDialog();

    const failures: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 50; index += 1) {
      await connection!.send('Runtime.evaluate', {
        expression: `setTimeout(() => confirm('repeat ${index}'), 0)`,
      }, currentSessionId);
      await waitForDialog();
      const blocked = await failure(snapshot(`dialog:repeat:${index}`));
      if (blocked === null) throw new Error(`Dialog-blocked snapshot ${index} unexpectedly succeeded`);
      failures.push(blocked);
      await dismissDialog();
      const diagnostics = cdpOperationDiagnostics();
      if (diagnostics.activeOperations !== 0 || diagnostics.activeDialogs !== 0) {
        throw new Error(`Operation state leaked after iteration ${index}: ${JSON.stringify(diagnostics)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return {
      cycles: failures.length,
      dialogFailures: failures.filter((item) => (item.data as { reason?: string } | undefined)?.reason === 'dialog').length,
      allDialogDetected: failures.every((item) => (item.data as { dialogDetected?: boolean } | undefined)?.dialogDetected === true),
      allCleanupComplete: failures.every((item) => (item.data as { browserCleanupComplete?: boolean } | undefined)?.browserCleanupComplete === true),
      inflightFailure,
      normalBefore,
      normalAfter: await snapshot('normal:after'),
      finalDiagnostics: cdpOperationDiagnostics(),
    };
  })();

  let regressionResult: Awaited<typeof regression> | undefined;
  while (regressionResult === undefined) {
    samples.push(processSample(chrome.pid));
    regressionResult = await Promise.race([
      regression,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 100)),
    ]);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const idleSample = processSample(chrome.pid);
  samples.push(idleSample);
  const nonzeroSamples = samples.filter((sample) => sample.processCount > 0);
  const first = nonzeroSamples[0] ?? { processCount: 0, rssMiB: 0, cpuPercent: 0 };
  const report = {
    chromeVersion: Bun.spawnSync([chromeExecutable, '--version']).stdout.toString().trim(),
    result: regressionResult,
    processMetrics: {
      samples: nonzeroSamples.length,
      first,
      peakRssMiB: Math.max(...nonzeroSamples.map((sample) => sample.rssMiB), 0),
      final: idleSample,
      peakCpuPercent: Math.max(...nonzeroSamples.map((sample) => sample.cpuPercent), 0),
      rssDecreases: nonzeroSamples.slice(1).filter((sample, index) => sample.rssMiB < nonzeroSamples[index]!.rssMiB).length,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  const inflightData = (regressionResult.inflightFailure as { data?: { reason?: string; browserCleanupComplete?: boolean } } | null)?.data;
  if (
    regressionResult.cycles !== 50 ||
    regressionResult.dialogFailures !== 50 ||
    regressionResult.allDialogDetected !== true ||
    regressionResult.allCleanupComplete !== true ||
    inflightData?.reason !== 'dialog' ||
    inflightData.browserCleanupComplete !== true ||
    regressionResult.finalDiagnostics.activeOperations !== 0 ||
    regressionResult.finalDiagnostics.activeDialogs !== 0
  ) process.exitCode = 1;
} finally {
  connection?.close();
  chrome.kill('SIGTERM');
  const exited = await Promise.race([
    chrome.exited.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!exited) {
    chrome.kill('SIGKILL');
    await chrome.exited;
  }
  server.stop(true);
  await rm(temporaryRoot, { recursive: true, force: true });
}
