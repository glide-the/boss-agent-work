import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NativeHostStatus } from '../../types/messages';

const STORAGE_KEY = 'NATIVE_HOST_STATUS';

function stringifyError(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error);
}

export function useNativeHostStatus() {
  const [status, setStatus] = useState<NativeHostStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_NATIVE_HOST_STATUS' });
      if (response?.status) setStatus(response.status);
      else if (response?.error) setStatus({ state: 'disconnected', error: response.error, lastChecked: Date.now() });
    } catch (error) {
      setStatus({ state: 'disconnected', error: stringifyError(error), lastChecked: Date.now() });
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    chrome.storage.local.get(STORAGE_KEY).then((result: Record<string, NativeHostStatus | undefined>) => {
      if (mounted) setStatus(result[STORAGE_KEY] ?? null);
    });
    void refresh();
    const onChanged = (changes: Record<string, any>, areaName: string) => {
      if (areaName === 'local' && changes[STORAGE_KEY]) setStatus(changes[STORAGE_KEY].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [refresh]);

  const manifest = useMemo(() => chrome.runtime.getManifest(), []);

  return { status, refresh, manifest };
}
