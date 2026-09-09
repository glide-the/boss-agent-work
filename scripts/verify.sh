#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXPECTED_ID="$(jq -r '.extensionId' "$WORKSPACE_ROOT/config/identity.json")"
EXPECTED_HOST="$(jq -r '.nativeHostName' "$WORKSPACE_ROOT/config/identity.json")"
PYTHON="$WORKSPACE_ROOT/.venv/bin/python"

(cd "$WORKSPACE_ROOT/components/codex-plugin/src/browser-client" && bun install --frozen-lockfile && bun run verify:deployed)

if [[ ! -x "$PYTHON" ]]; then
  "$WORKSPACE_ROOT/scripts/bootstrap.sh"
fi

SOURCE_MANIFEST="$WORKSPACE_ROOT/components/chrome-extension/public/manifest.json"
ACTUAL_ID="$(node "$WORKSPACE_ROOT/scripts/extension-id.mjs" "$SOURCE_MANIFEST")"
[[ "$ACTUAL_ID" == "$EXPECTED_ID" ]]
rg -qF "$EXPECTED_HOST" "$WORKSPACE_ROOT/components/chrome-extension/src/types/native.ts"
rg -q 'NATIVE_HOSTS\.dev' "$WORKSPACE_ROOT/components/chrome-extension/src/background/index.ts"

"$PYTHON" "$WORKSPACE_ROOT/scripts/validate_plugin.py" "$WORKSPACE_ROOT/components/codex-plugin"
test -f "$WORKSPACE_ROOT/components/codex-plugin/.mcp.json"
test -f "$WORKSPACE_ROOT/components/codex-plugin/scripts/browser-service.mjs"
test -x "$WORKSPACE_ROOT/components/codex-plugin/scripts/launch-browser-service.mjs"
node --test "$WORKSPACE_ROOT/components/codex-plugin"/test/*.test.mjs
node "$WORKSPACE_ROOT/components/codex-plugin/scripts/patch-browser-client-site-status.mjs" \
  --check "$WORKSPACE_ROOT/components/codex-plugin/scripts/browser-client.mjs"
bun test "$WORKSPACE_ROOT/components/electron-app/test"

for skill in "$WORKSPACE_ROOT/components/skills"/*; do
  "$PYTHON" "$WORKSPACE_ROOT/scripts/quick_validate_skill.py" "$skill"
done
"$WORKSPACE_ROOT/scripts/test-install-project-skills.sh"

for profile in baseline extension-dev full-reconstructed; do
  marketplace="$WORKSPACE_ROOT/dist/$profile/marketplace"
  if [[ -d "$marketplace" ]]; then
    metadata_entry="$(find "$marketplace" "$WORKSPACE_ROOT/dist/$profile/electron-app" \
      \( -name '.DS_Store' -o -name '._*' \) -print -quit)"
    if [[ -n "$metadata_entry" ]]; then
      echo "Unexpected macOS metadata in assembled output: $metadata_entry" >&2
      exit 4
    fi
    "$PYTHON" "$WORKSPACE_ROOT/scripts/validate_plugin.py" "$marketplace/plugins/chrome-dev"
    node "$marketplace/plugins/chrome-dev/scripts/patch-browser-client-site-status.mjs" \
      --check "$marketplace/plugins/chrome-dev/scripts/browser-client.mjs"
    node "$marketplace/plugins/chrome-dev/scripts/verify-standalone.mjs"
    test -f "$marketplace/plugins/chrome-dev/.mcp.json"
    test -f "$marketplace/plugins/chrome-dev/scripts/browser-service.mjs"
    test -x "$marketplace/plugins/chrome-dev/scripts/launch-browser-service.mjs"
    test ! -e "$marketplace/plugins/chrome-dev/scripts-bak"
    test ! -e "$marketplace/plugins/chrome-dev/src"
    test ! -e "$marketplace/plugins/chrome-dev/test"
    test -f "$marketplace/plugins/chrome-dev/config/site-status.env.example"
    test -f "$marketplace/plugins/chrome-dev/chrome-extension/manifest.json"
    test -x "$marketplace/plugins/chrome-dev/extension-host/macos/arm64/extension-host"
    test -f "$WORKSPACE_ROOT/dist/$profile/electron-app/src/boss-plugin-native-host-lifecycle.mjs"
    test -f "$WORKSPACE_ROOT/dist/$profile/electron-app/bin/reconcile-native-host.mjs"
    built_id="$(node "$WORKSPACE_ROOT/scripts/extension-id.mjs" "$marketplace/plugins/chrome-dev/chrome-extension/manifest.json")"
    [[ "$built_id" == "$EXPECTED_ID" ]]
  fi
done

RECONSTRUCTED_HOST="$WORKSPACE_ROOT/dist/full-reconstructed/marketplace/plugins/chrome-dev/extension-host/macos/arm64/extension-host"
if [[ -f "$RECONSTRUCTED_HOST" ]]; then
  if rg -a -qF "$WORKSPACE_ROOT" "$RECONSTRUCTED_HOST" || rg -a -qF "$HOME/" "$RECONSTRUCTED_HOST"; then
    echo "Reconstructed Native Host contains a local build path" >&2
    exit 4
  fi
fi

test -f "$WORKSPACE_ROOT/dist/electron-app/src/boss-plugin-native-host-lifecycle.mjs"
test -f "$WORKSPACE_ROOT/dist/electron-app/bin/reconcile-native-host.mjs"
node "$WORKSPACE_ROOT/dist/electron-app/bin/reconcile-native-host.mjs" --help >/dev/null

echo "Verification passed: extension ID=$EXPECTED_ID native host=$EXPECTED_HOST"
