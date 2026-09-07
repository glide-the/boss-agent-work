import type { SetupBrowserRuntime } from "./contracts/runtime.ts";

/** Confirmed as the only ESM export of the published Browser Client bundle. */
export const setupBrowserRuntime: SetupBrowserRuntime;

export interface BrowserServiceRuntime {
  apiManifest: unknown;
  disabledMemberIds: string[];
  dispose(): Promise<void>;
  executeAgentCommand(command: unknown): Promise<unknown>;
}

/** Internal entry used only by the isolated trusted service bundle. */
export function setupBrowserServiceRuntime(options: {
  elicitationDisplayName?: string;
  globals: Record<string, unknown>;
}): Promise<BrowserServiceRuntime>;
