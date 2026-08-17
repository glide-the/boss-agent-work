import type {
  BaselineRuntimeModule,
  SetupBrowserRuntime,
} from "../contracts/runtime.js";

/*
 * This URL is intentionally relative to the generated candidate at
 * recovery/browser-client/dist/browser-client.mjs.
 *
 * Phase 1 delegates the un-recovered runtime to the verified bundle. That
 * keeps protocol behavior exact while independently recovered modules replace
 * narrow, testable boundaries. The marketplace continues to load the verified
 * bundle directly, so this adapter is not yet a production switch.
 */
const BASELINE_RUNTIME_URL = new URL(
  "../../../components/codex-plugin/scripts/browser-client.mjs",
  import.meta.url,
);

let baselineRuntimePromise: Promise<BaselineRuntimeModule> | undefined;

async function loadBaselineRuntime(): Promise<BaselineRuntimeModule> {
  baselineRuntimePromise ??= import(BASELINE_RUNTIME_URL.href) as Promise<BaselineRuntimeModule>;
  const runtime = await baselineRuntimePromise;
  if (typeof runtime.setupBrowserRuntime !== "function") {
    throw new Error("Baseline Browser Client does not export setupBrowserRuntime.");
  }
  return runtime;
}

export const setupBrowserRuntime: SetupBrowserRuntime = async (options) => {
  const runtime = await loadBaselineRuntime();
  await runtime.setupBrowserRuntime(options);
};
