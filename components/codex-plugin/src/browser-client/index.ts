/**
 * Browser Client semantic source recovery entrypoint.
 *
 * Phase 1 preserves the verified bundle as a compatibility kernel. The public
 * export set deliberately remains identical to the baseline.
 */
export { setupBrowserRuntime } from "./runtime/compatibility-runtime.js";
