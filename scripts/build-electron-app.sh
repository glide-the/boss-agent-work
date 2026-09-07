#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$WORKSPACE_ROOT/components/electron-app"
OUTPUT="$WORKSPACE_ROOT/dist/electron-app"

bun test "$SOURCE/test"

case "$OUTPUT" in
  "$WORKSPACE_ROOT"/dist/*) ;;
  *) echo "Refusing unsafe output path: $OUTPUT" >&2; exit 3 ;;
esac

rm -rf "$OUTPUT"
mkdir -p "$OUTPUT"
rsync -a --exclude test "$SOURCE/" "$OUTPUT/"

echo "Electron Main integration built: $OUTPUT"
