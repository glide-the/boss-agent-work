# Package Manifest

Bundled asset:

`assets/chrome-plugin-fix-delivery-20260727.tar.gz`

Actual SHA1 observed when creating this skill:

`e52d245d3a157edfb8703ec2fb3b8fb0b0ca13b7`

Earlier handoff text mentioned `2ed14a2c...`; treat that as unverified handoff text unless a different package file is supplied.

## Contents

The package contains:

- `MANIFEST.md`: deployment, rollback, and caution notes.
- `modules/codex-extension-1.1.5_0-patched.tar.gz`: full unpacked Codex Chrome extension, including the `cn()` always-attach fix and original backup.
- `modules/chrome-plugin-26.601.21317-patched.tar.gz`: full Codex Chrome plugin module, including `browser-client.mjs` Statsig redirect and `Ly()` default security-mode fix.
- `modules/codex-browser-config.tar.gz`: browser approval config for the bundled Codex home and home Codex config.
- `modules/skills-chrome-plugin.tar.gz`: `chrome-plugin-hang-fix` and `chrome-plugin-debug`.
- `backups/extension-background.js.pristine`: original extension background file.
- `backups/browser-client.mjs.pristine`: original plugin client.
- `backups/home-codex-browser-config.toml.pristine`: original `~/.codex/browser/config.toml`.
- `evidence/`: raw and excerpted logs for retry storms, 30s kernel gaps, and fast-path validation.

## Default Targets

- Chrome plugin module parent:
  `/Users/dmeck/.codex/plugins/cache/openai-bundled/chrome`
- Chrome plugin module version:
  `26.601.21317`
- Chrome plugin `latest` symlink:
  `/Users/dmeck/.codex/plugins/cache/openai-bundled/chrome/latest`
- Unpacked Chrome extension parent:
  `/Users/dmeck/project/CodexChromePlug/codex-1.1.5_0`
- Unpacked Chrome extension directory:
  `/Users/dmeck/project/CodexChromePlug/codex-1.1.5_0/1.1.5_0`
- Skill target:
  `/Users/dmeck/.agents/skills`
- Codex browser config:
  `/Users/dmeck/.codex/browser/config.toml`
- Home Codex browser config:
  `/Users/dmeck/.codex/browser/config.toml`

## Fix Summary

- `browser-client.mjs`: `Ly()` defaults to `"disabled-for-local-testing"`, avoiding repeated site-status/origin checks that can add 30 seconds per command.
- `browser-client.mjs`: Statsig endpoint changed from `ab.chatgpt.com` to `127.0.0.1:1` to avoid telemetry stalls.
- `background.js`: `cn()` always performs a real `chrome.debugger.attach`, allowing repeat attach errors to be swallowed while healing stale attached-state memory.
- `config.toml`: allows `https://www.zhipin.com` and `https://example.com` origins.

## Rollback

Use package backups for direct rollback:

- Copy `backups/browser-client.mjs.pristine` to the active `scripts/browser-client.mjs`.
- Copy `backups/extension-background.js.pristine` to the active extension `background.js`.
- Copy `backups/home-codex-browser-config.toml.pristine` to `/Users/dmeck/.codex/browser/config.toml`.

After rolling back extension code, reload the unpacked extension in `chrome://extensions`.
