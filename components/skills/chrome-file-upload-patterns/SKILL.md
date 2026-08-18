---
name: chrome-file-upload-patterns
description: Classify, operate, verify, and document Chrome file-upload controls across websites. Use when Codex must upload an image, document, resume, or attachment through an authorized Chrome controller; when a visible or hidden file input, custom upload button, file chooser, drag-and-drop zone, rich-text editor attachment, iframe, or shadow DOM control behaves unexpectedly; or when a newly discovered site-specific Chrome upload pattern should be added to the reusable experience library.
---

# Chrome File Upload Patterns

Use the browser controller explicitly authorized for the task. Preserve any user constraint that forbids local Playwright, Selenium, JavaScript injection, or alternate browser tools.

## Workflow

1. Identify the domain, route, intended file type, and whether choosing a file immediately sends it or only stages it.
2. Query the site registry before probing the page:

   ```bash
   python3 scripts/site_profiles.py find --url "<current-url>"
   ```

3. If no verified profile matches, inspect the accessibility snapshot and file inputs. Record input count, `accept`, `multiple`, nearby accessible name, parent label, iframe, and shadow-root boundaries. Read [references/control-taxonomy.md](references/control-taxonomy.md) to classify the control.
4. Prefer a chooser-event flow for custom controls:

   ```js
   const chooserPromise = tab.playwright.waitForEvent("filechooser");
   await tab.playwright.locator("<verified-trigger>").click();
   const chooser = await chooserPromise;
   await chooser.setFiles("/absolute/path/to/file");
   ```

   Start waiting before clicking. Click the real visible trigger or its accessible wrapper, not the hidden input. Do not use `DOM.setFileInputFiles` when the browser controller requires `filechooser` + `setFiles`.
5. Verify two separate states:
   - staged/uploaded: thumbnail, filename, progress completion, or attachment card exists;
   - submitted/delivered: message, form, or post shows the attachment and its delivery state.
6. Stop on identity mismatch, security verification, upload denial, unsupported file type, ambiguous send semantics, or a browser-controller disconnect. Never claim success from a chooser event alone.
7. Add or update the site profile only from observed evidence. Mark untested selectors as `hypothesis`, not `verified`. Read [references/update-guide.md](references/update-guide.md) before changing the registry.

## Registry Commands

```bash
python3 scripts/site_profiles.py list
python3 scripts/site_profiles.py find --url "https://www.zhipin.com/web/geek/chat"
python3 scripts/site_profiles.py get --site-id boss-zhipin-chat
python3 scripts/site_profiles.py validate
python3 scripts/site_profiles.py upsert --profile ./new-profile.json --dry-run
python3 scripts/site_profiles.py upsert --profile ./new-profile.json
```

The registry is [references/site-profiles.json](references/site-profiles.json). Keep selectors narrow, evidence dated, and verification signals explicit.

## Safety Rules

- Confirm the target conversation, record, form, or account before attaching a file.
- Check `accept`, size, and sensitivity before upload.
- Treat file selection and final submission as distinct actions unless the site profile proves auto-send behavior.
- Do not bypass extension permissions, browser approvals, CAPTCHA, malware warnings, or site security checks.
- Do not log file contents, tokens, or private paths beyond what is needed for reproducibility.
