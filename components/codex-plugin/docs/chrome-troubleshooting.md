# Chrome Troubleshooting
## General Guidance
- If communication with the Boss投递 Chrome extension ultimately fails, even after checks, do not attempt to complete the user's request using AppleScript, shell commands, or another hidden browser-control path.
- Do not overwrite another native host registration. If setup appears broken, reinstall only `chrome-dev` from `codex-chrome-automation-local`.

## Chrome Extension Checks
On the first Chrome-backed browser task in a session, try a lightweight browser-client call such as listing open tabs after bootstrap. If the call fails, wait 2 seconds and retry the same lightweight browser-client call once. Any non-error response means the extension is installed and working.

If browser-client still reports that it cannot communicate with Chrome after that retry, confirm that Chrome is installed, running and that the extension is present in the selected Chrome profile:

From the plugin root, use `node_repl` to run:

```
scripts/chrome-is-running.js --check
scripts/installed-browsers.js --check
scripts/check-extension-installed.js --json
scripts/check-native-host-manifest.js --json
```

Depending on the outcome follow the following checks. Be sure to ask the user permission when required, if it is stated in the check.

### 1. Chrome is not installed
Keep the first response short and non-technical unless the user asks for more information.

If Chrome is not installed, then inform the user that this plugin only works with the Chrome browser.

### 2. Chrome is not running
Keep the first response short and non-technical unless the user asks for more information.

If Chrome is not running then ALWAYS ask the User if they would like to launch Chrome. ALWAYS wait for a user response before taking action.

### 3. The native host manifest is not installed, or is invalid
Keep the first response short and non-technical unless the user asks for more information.

Do not overwrite another native host registration. If setup appears broken, reinstall only this standalone plugin from its local marketplace.

### 4. The Boss投递 Chrome extension is not installed
Keep the first response short and non-technical unless the user asks for more information.

If the Boss投递 Chrome extension is missing, tell the user:

`Cannot communicate with the Boss投递 Chrome extension. Confirm that the included unpacked extension is installed and enabled in Chrome.`

Ask the User if you can open the Google Chrome Extension Manager so they can load the `chrome-extension` directory included in this plugin. ALWAYS wait for a user response before opening Chrome UI. This standalone extension is not installed from the official Web Store listing.

### 4. The Boss投递 Chrome extension is not enabled
Keep the first response short and non-technical unless the user asks for more information.

If the Boss投递 Chrome extension is not enabled, ask the User if you can open the Google Chrome Extension Manager so they can verify that the extension is enabled. ALWAYS wait for a user response before taking action. Always refer to the Google Chrome Extension Manager as [Google Chrome Extension Manager](chrome://extensions/).

### 5. The standalone extension is installed and enabled, the manifest file is installed, but communication still fails
Keep the first response short and non-technical unless the user asks for more information.

If Chrome is running and the extension/native-host checks pass, ask the User if you can open a Chrome window for the selected Chrome profile and retry the connection. ALWAYS wait for a user response before taking action.

If the User agrees, run:

```
scripts/open-chrome-window.js
```

Then wait 2 seconds and retry the browser-client setup once.

After one successful setup check in a session, do not repeat extension detection unless browser-client reports an extension connection failure.

If the issue is specifically the native host or extension-backed install path, or if communication still fails after opening a Chrome window and retrying setup once, tell the user to reinstall `chrome-dev` from `codex-chrome-automation-local`. Never import or run `scripts/installManifest.mjs` yourself.

## Commands
### installed-browsers.js
This script reports which browsers are installed.

From the plugin root, use `node_repl` to run:

```
scripts/installed-browsers.js
```

Use JSON output when another tool or script needs structured data:

```
scripts/installed-browsers.js --json
```

### chrome-is-running.js
This script checks whether Google Chrome is actively running. It exits `0` when Chrome is running, `1` when Chrome is not running, and `2` for usage or runtime errors.

From the plugin root, use `node_repl` to run:

```
scripts/chrome-is-running.js --check
```

Use JSON output when another tool or script needs structured data:

```
scripts/chrome-is-running.js --json
```

### open-chrome-window.js
This script opens `about:blank` in a Google Chrome window for the same selected Chrome profile used by `check-extension-installed.js`. Use it only after the User gives permission.

From the plugin root, use `node_repl` to run:

```
scripts/open-chrome-window.js
```

Use dry-run JSON output when another tool or script needs to verify the selected launch command without opening Chrome:

```
scripts/open-chrome-window.js --dry-run --json
```

### check-extension-installed.js
This script checks every usable Google Chrome profile for the configured extension and reports whether each profile has it registered, installed, and enabled. The JSON output includes the full `profiles` array plus a `selectedProfileDirectory` hint from `Local State` when available. The top-level `installed`, `enabled`, and exit code reflect the selected profile so Chrome troubleshooting can decide whether the profile it will launch is actually ready. It exits `0` when the selected profile has the extension installed and enabled, `1` when the selected profile has it installed but not enabled, `2` when the selected profile does not have it installed, and `3` for usage or runtime errors.

From the plugin root, use `node_repl` to run:

```
scripts/check-extension-installed.js
```

Use JSON output when another tool or script needs structured data:

```
scripts/check-extension-installed.js --json
```

The check reads the configured extension ID from `scripts/extension-id.json`. By default it scans every `Default` or `Profile X` directory with `Preferences`, and it also marks the profile that `Local State` would have selected. For debugging or tests, override the scanned root with `CODEX_CHROME_USER_DATA_DIR=/path/to/chrome-root` or restrict the output to one profile with `CODEX_CHROME_PREFERENCES_PATH=/path/to/Profile/Preferences`.

### check-native-host-manifest.js
This script checks whether the Chrome Native Messaging Host manifest exists for the configured native host name and allows the Chrome extension ID from `scripts/extension-id.json`. On Windows it also checks the Chrome NativeMessagingHosts registry key. It exits `0` when correct, `1` when missing or incorrect, and `2` for usage or runtime errors.

From the plugin root, use `node_repl` to run:

```
scripts/check-native-host-manifest.js
```

Use JSON output when another tool or script needs structured data:

```
scripts/check-native-host-manifest.js --json
```
