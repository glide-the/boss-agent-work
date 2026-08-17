export function getRuntimeLastErrorMessage(): string | undefined {
  try {
    return chrome.runtime?.lastError?.message;
  } catch {
    return undefined;
  }
}

export async function safeSendTabMessage<T = unknown>(tabId: number, message: unknown, timeoutMs = 1000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([chrome.tabs.sendMessage(tabId, message), timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
