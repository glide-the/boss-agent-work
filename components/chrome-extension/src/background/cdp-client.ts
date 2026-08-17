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
}

const DEFAULT_CDP_TIMEOUT_MS = 30_000;

export async function sendCdpCommand<T = unknown>(request: CdpCommandRequest): Promise<T> {
  const timeoutMs = request.timeoutMs && request.timeoutMs > 0 ? request.timeoutMs : DEFAULT_CDP_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CdpCommandTimeoutError(request.method, timeoutMs)), timeoutMs);
  });
  try {
    const command = request.method === 'Target.getTargets'
      ? chrome.debugger.getTargets().then((targetInfos: unknown) => ({ targetInfos }))
      : chrome.debugger.sendCommand(request.target, request.method, request.commandParams);
    return await Promise.race([command, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function attachDebugger(tabId: number): Promise<void> {
  await chrome.debugger.attach({ tabId }, '1.3');
}

export async function detachDebugger(tabId: number): Promise<void> {
  await chrome.debugger.detach({ tabId });
}
