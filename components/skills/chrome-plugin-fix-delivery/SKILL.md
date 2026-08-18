---
name: chrome-plugin-fix-delivery
description: Diagnose, inspect, deploy, and roll back the Codex Chrome plugin fix delivery package for Browser/Chrome automation hangs. Use when @Chrome/node_repl browser control reports unavailable extension, setupBrowserRuntime timeouts, exact 30s Playwright command delays on BOSS/zhipin busy pages, stale extension-host retry storms, or when asked to install the chrome-plugin-fix-delivery-20260727.tar.gz repair bundle.
---

# Chrome Plugin Fix Delivery

Use this skill to work with the bundled Codex Chrome plugin repair package. The package addresses two known failure modes:

- Every `tab.playwright` command takes about 30 seconds on busy pages such as BOSS.
- After a node_repl reset, Chrome commands hang because the extension believes it is attached while Chrome has detached the debugger.

The package is bundled at:

`assets/chrome-plugin-fix-delivery-20260727.tar.gz`

## Safety

- Prefer inspection before deployment.
- Do not claim @Chrome is fixed until a fresh node_repl session verifies the extension backend is available and a simple page command completes quickly.
- The `browser-client.mjs` patch disables browser-use URL/origin/file-transfer safety checks for local automation. Call this out before deploying to a shared or untrusted environment.
- After deploying the unpacked Chrome extension module, tell the user to reload the Codex extension in `chrome://extensions`; the extension Service Worker will not load changed code until reload.
- If the user requires the exact SHA1 from a prompt, compute the real hash first. The bundled asset in this skill currently hashes to `e52d245d3a157edfb8703ec2fb3b8fb0b0ca13b7`, while an earlier handoff text mentioned `2ed14a2c...`.

## Quick Start

Inspect the bundled package:

```bash
python3 /Users/dmeck/.agents/skills/chrome-plugin-fix-delivery/scripts/deploy_package.py --inspect
```

Deploy all package modules to the known local paths:

```bash
python3 /Users/dmeck/.agents/skills/chrome-plugin-fix-delivery/scripts/deploy_package.py --deploy-all
```

Deploy only the lower-risk client/config/skill modules and leave the unpacked Chrome extension untouched:

```bash
python3 /Users/dmeck/.agents/skills/chrome-plugin-fix-delivery/scripts/deploy_package.py --deploy-client --deploy-config --deploy-skills
```

Rollback package-managed files from the pristine backups included in the bundle:

```bash
python3 /Users/dmeck/.agents/skills/chrome-plugin-fix-delivery/scripts/deploy_package.py --rollback
```

## Workflow

1. Read `references/package-manifest.md` when you need package contents, deployment targets, or rollback notes.
2. Run `deploy_package.py --inspect` and report the package hash and module counts.
3. Kill stale retry storms before deployment:

```bash
pkill -f extension-host || true
```

4. Deploy only the modules needed for the observed failure.
5. Ask the user to reload the Codex extension in `chrome://extensions` if the extension module changed.
6. Reset node_repl and verify with the Chrome plugin. Do not use local Playwright/Selenium as a substitute for @Chrome verification.

## Verification Pattern

Use a fresh node_repl session and the Chrome plugin browser client:

```js
var pluginRoot = "/Users/dmeck/.codex/plugins/cache/openai-bundled/chrome/latest";
var browserClient = await import(`${pluginRoot}/scripts/browser-client.mjs`);
await browserClient.setupBrowserRuntime({ globals: globalThis });
var browser = await globalThis.agent.browsers.get("extension");
var tab = await browser.tabs.new();
await tab.goto("https://www.zhipin.com/web/geek/chat?ka=header-message");
var t0 = Date.now();
var state = await tab.playwright.evaluate(() => ({ href: location.href, title: document.title }), null, { timeoutMs: 8000 });
nodeRepl.write(JSON.stringify({ elapsedMs: Date.now() - t0, state }, null, 2));
```

Stop and report the exact blocker if verification returns `Browser is not available: extension`, login/CAPTCHA/403, or repeated command timeout.
