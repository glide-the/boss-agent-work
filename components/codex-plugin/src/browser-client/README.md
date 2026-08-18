# Browser Client canonical source

This directory is the only production source and build root for
`components/codex-plugin/scripts`.

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

`browser-runtime.generated.js` is a deterministic, formatted
semantic-equivalence kernel materialized from the fixed published bundle.
Production builds read the checked-in kernel and extracted TypeScript modules,
never `scripts-bak` or the currently deployed `scripts`. The kernel is not the
upstream authors' original source. Its evidence and range mappings live under
`recovery/browser-client/reconstruction`.
