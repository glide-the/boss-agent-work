/**
 * Sole production entrypoint for the Browser Client reconstruction.
 *
 * The checked-in compatibility kernel is deterministic recovered JavaScript,
 * with reviewed business boundaries progressively extracted into strict
 * TypeScript modules. The production build never reads the immutable bundle
 * fixture or the generated scripts directory.
 */
export { setupBrowserRuntime } from "./browser-runtime.generated.js";
