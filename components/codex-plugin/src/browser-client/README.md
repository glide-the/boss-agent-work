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

`browser-runtime.generated.js` is a deterministic, formatted compatibility
kernel materialized from the fixed published bundle. The materializer replaces
the Process Shim, Tab API, Browser Security facade, Origins Security/session
policy and node_repl display bridge with extracted TypeScript modules. Most
transport, command routing, CDP/Playwright and inline dependency code still
retains minified identifiers and bundle-local boundaries. The mapped replaced
baseline ranges now total 19,634 of 989,621 input bytes (about 1.984%), leaving
about 98.016% in the transitional kernel. Byte share is not a semantic-
completeness metric, but it makes the limited recovery scope explicit.

Production builds read this checked-in kernel and never read `scripts-bak` or
the currently deployed `scripts`, so the build is reproducible. That property
does **not** mean semantic reconstruction is complete. The kernel is neither the
upstream authors' source nor an acceptable final state for the requested full
maintainable recovery. Its evidence and range mappings live under
`recovery/browser-client/reconstruction` and must be used to progressively
replace it with reviewed modules.
