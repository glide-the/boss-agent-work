type ProcessEventListener = (...arguments_: unknown[]) => unknown;

export interface BrowserRuntimeProcessShim {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: string;
  version: string;
  versions: { node: string; icu: string };
  pid: number;
  argv: string[];
  availableMemory: undefined;
  cwd(): string;
  uptime(): number;
  memoryUsage(): { rss: number };
  on(event: string, listener: ProcessEventListener): BrowserRuntimeProcessShim;
  off(event: string, listener: ProcessEventListener): BrowserRuntimeProcessShim;
  listeners(event: string): ProcessEventListener[];
  exit(code?: number): never;
}

const listenersByEvent = new Map<string, Set<ProcessEventListener>>();
const replProcessMetadata = globalThis.process;

export const processShim: BrowserRuntimeProcessShim = {
  env: replProcessMetadata?.env ?? {},
  platform: replProcessMetadata?.platform ?? "darwin",
  arch: replProcessMetadata?.arch ?? "arm64",
  version: "v20.0.0",
  versions: {
    node: "20.0.0",
    icu: "shim",
  },
  pid: 0,
  argv: ["node", ""],
  cwd: () => "/",
  uptime: () => 0,
  memoryUsage: () => ({ rss: 0 }),
  availableMemory: undefined,
  on(event, listener) {
    const listeners = listenersByEvent.get(event) ?? new Set();
    listeners.add(listener);
    listenersByEvent.set(event, listeners);
    return processShim;
  },
  off(event, listener) {
    listenersByEvent.get(event)?.delete(listener);
    return processShim;
  },
  listeners: (event) => Array.from(listenersByEvent.get(event) ?? []),
  exit(code = 0): never {
    throw new Error(`process.exit(${code}) called`);
  },
};

export function installProcessShim(): void {
  globalThis.global ??= globalThis;
}
