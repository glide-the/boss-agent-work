# 03 Bundle Fingerprint

The Browser Client is a single Node ESM bundle with esbuild-like helpers and inlined CommonJS wrappers. The bundler identity is inferred, not confirmed. Machine counts and parser diagnostics are in `artifacts/ast-inventory.json` and `artifacts/reconstruction-summary.json`.

The only confirmed public Browser Client export is `setupBrowserRuntime`.
