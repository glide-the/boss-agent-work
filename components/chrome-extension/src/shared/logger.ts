export const logger = {
  debug: (...args: unknown[]) => console.debug('[codex-reconstructed]', ...args),
  log: (...args: unknown[]) => console.log('[codex-reconstructed]', ...args),
  warn: (...args: unknown[]) => console.warn('[codex-reconstructed]', ...args),
  error: (...args: unknown[]) => console.error('[codex-reconstructed]', ...args),
};
