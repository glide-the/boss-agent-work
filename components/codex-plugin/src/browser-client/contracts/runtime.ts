/**
 * Reconstructed public boundary from the only confirmed ESM export and the
 * setupBrowserRuntime destructuring visible in the baseline bundle.
 *
 * These names are reconstructed for maintainability; they are not claimed to
 * be the upstream authors' original TypeScript names.
 */
export interface BrowserRuntimeGlobals extends Record<string, unknown> {
  nodeRepl?: unknown;
}

export interface SetupBrowserRuntimeOptions {
  elicitationDisplayName?: string;
  globals: BrowserRuntimeGlobals;
}

export type SetupBrowserRuntime = (
  options: SetupBrowserRuntimeOptions,
) => Promise<void>;
