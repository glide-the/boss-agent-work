# Browser Client recovery tools

This tool package is managed and executed with Bun 1.2.20. It analyzes the
verified Browser Client bundle, typechecks the reconstructed TypeScript source,
produces Node ESM bundles with `Bun.build`, and compares them with the baseline.

```bash
cd /Users/dmeck/project/boss-agent-work/develop/tools/browser-client-recovery
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Generated artifacts:

```text
recovery/browser-client/dist/browser-client.mjs
recovery/browser-client/dist/security/site-status-policy.mjs
recovery/browser-client/dist/build-manifest.json
```

The candidate `browser-client.mjs` keeps the baseline bundle as a compatibility
kernel. It does not overwrite `components/codex-plugin/scripts/browser-client.mjs`
and is not used by marketplace assembly until a separate acceptance decision.
