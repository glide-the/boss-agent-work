# 07 Module Reconstruction Plan

The canonical target is `components/codex-plugin/src/browser-client`; this reconstruction directory does not contain a duplicate `reconstructed/` source tree.

Order:

1. readable standalone CLIs and JSON configuration;
2. process shim and public runtime contract;
3. Browser Security and authorization ordering;
4. JSON-RPC and Runtime Bridge;
5. Browser/Tab facade and command router;
6. CDP/Playwright/clipboard/page assets;
7. proven third-party packages through the canonical Bun lock.

No production module may import or embed `scripts-bak`.
