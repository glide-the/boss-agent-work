#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 baseline|extension-dev|full-reconstructed" >&2
  exit 2
fi

PROFILE="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="$WORKSPACE_ROOT/dist/$PROFILE/marketplace"
PLUGIN_OUTPUT="$OUTPUT/plugins/chrome-dev"
PYTHON="$WORKSPACE_ROOT/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  "$WORKSPACE_ROOT/scripts/bootstrap.sh"
fi

case "$PROFILE" in
  baseline)
    EXTENSION_SOURCE="$WORKSPACE_ROOT/baselines/chrome-extension"
    HOST_SOURCE="$WORKSPACE_ROOT/baselines/native-host/macos/arm64/extension-host"
    ;;
  extension-dev)
    EXTENSION_SOURCE="$WORKSPACE_ROOT/dist/chrome-extension"
    HOST_SOURCE="$WORKSPACE_ROOT/baselines/native-host/macos/arm64/extension-host"
    ;;
  full-reconstructed)
    EXTENSION_SOURCE="$WORKSPACE_ROOT/dist/chrome-extension"
    HOST_SOURCE="$WORKSPACE_ROOT/dist/native-host/macos/arm64/extension-host"
    ;;
  *)
    echo "Unknown profile: $PROFILE" >&2
    exit 2
    ;;
esac

test -f "$EXTENSION_SOURCE/manifest.json"
test -x "$HOST_SOURCE"

case "$OUTPUT" in
  "$WORKSPACE_ROOT"/dist/*) ;;
  *) echo "Refusing unsafe output path: $OUTPUT" >&2; exit 3 ;;
esac

rm -rf "$OUTPUT"
mkdir -p "$OUTPUT/.agents/plugins" "$PLUGIN_OUTPUT/extension-host/macos/arm64"
rsync -a "$WORKSPACE_ROOT/components/codex-plugin/" "$PLUGIN_OUTPUT/"
rsync -a "$EXTENSION_SOURCE/" "$PLUGIN_OUTPUT/chrome-extension/"
install -m 755 "$HOST_SOURCE" "$PLUGIN_OUTPUT/extension-host/macos/arm64/extension-host"
install -m 644 "$WORKSPACE_ROOT/config/marketplace.json" "$OUTPUT/.agents/plugins/marketplace.json"

"$PYTHON" "$WORKSPACE_ROOT/scripts/validate_plugin.py" "$PLUGIN_OUTPUT"

jq -n \
  --arg profile "$PROFILE" \
  --arg extensionSource "${EXTENSION_SOURCE#$WORKSPACE_ROOT/}" \
  --arg nativeHostSource "${HOST_SOURCE#$WORKSPACE_ROOT/}" \
  '{profile: $profile, extensionSource: $extensionSource, nativeHostSource: $nativeHostSource}' \
  > "$OUTPUT/BUILD-PROVENANCE.json"

echo "Marketplace assembled: $OUTPUT"
