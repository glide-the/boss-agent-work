#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

for target in \
  "$WORKSPACE_ROOT/dist" \
  "$WORKSPACE_ROOT/artifacts" \
  "$WORKSPACE_ROOT/components/chrome-extension/dist" \
  "$WORKSPACE_ROOT/components/chrome-extension/node_modules" \
  "$WORKSPACE_ROOT/components/native-host/target" \
  "$WORKSPACE_ROOT/.cache"; do
  case "$target" in
    "$WORKSPACE_ROOT"/*) ;;
    *) echo "Refusing unsafe clean target: $target" >&2; exit 3 ;;
  esac
  if [[ -d "$target" ]]; then
    find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  fi
done

echo "Build outputs and component caches cleaned."
