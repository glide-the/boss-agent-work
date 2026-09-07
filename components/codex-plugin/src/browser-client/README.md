# Browser Client canonical build root (recovery in progress)

This directory is the only production build root for
`components/codex-plugin/scripts`. It is not yet a fully recovered,
maintainable source tree: the build still depends on the transitional
`browser-runtime.generated.js` compatibility kernel.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run verify
bun run deploy
bun run verify:deployed
```

`build` writes a staged candidate to `recovery/browser-client/dist`; it does
not modify the deployed scripts. `deploy` first verifies the immutable
`scripts-bak` hash and all differential gates, then atomically replaces the
scripts tree. `rollback` restores the complete immutable baseline.

The build emits three personal runtime artifacts: `browser-client.mjs` is the
unprivileged client, `browser-service.mjs` is the privileged trusted-service
handler, and `launch-browser-service.mjs` starts an isolated `node_repl` with
only the plugin-owned `boss_browser` service. The launcher removes the legacy
`NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S` value from its child environment; it
does not write user configuration or alter the official `browser` service.

`browser-runtime.generated.js` is a deterministic, formatted compatibility
kernel materialized from the fixed published bundle. The materializer replaces
the Process Shim, Tab API, Browser Security facade, Origins Security/session
policy, node_repl display bridge, browser-operation coordinator and cancellable
JSON-RPC pending-request lifecycle with extracted TypeScript modules. The
materializer owns the remaining compatibility glue that carries optional
`domSnapshot({ timeoutMs, signal })` cancellation through the transitional
kernel; direct edits to the generated file are not authoritative. Most command
routing, CDP/Playwright and inline dependency code still retains minified
identifiers and bundle-local boundaries.

DOM snapshots are single-flight per browser/tab. Timeout, caller abort and
runtime reset remove the client pending entry, send an idempotent
`cancelBrowserOperation` request to the extension and discard late JSON-RPC
responses. The extension returns structured operation, tab, reason, dialog and
browser-cleanup fields.

Production builds read this checked-in kernel and never read `scripts-bak` or
the currently deployed `scripts`, so the build is reproducible. That property
does **not** mean semantic reconstruction is complete. The kernel is neither the
upstream authors' source nor an acceptable final state for the requested full
maintainable recovery. Its evidence and range mappings live under
`recovery/browser-client/reconstruction` and must be used to progressively
replace it with reviewed modules.

The canonical security switches and their compatibility behavior are documented
in [`docs/browser-client-security-policy-config.md`](../../../../docs/browser-client-security-policy-config.md).
