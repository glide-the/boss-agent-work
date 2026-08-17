#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPONENT="$WORKSPACE_ROOT/components/chrome-extension"
OUTPUT="$WORKSPACE_ROOT/dist/chrome-extension"

cd "$COMPONENT"
npm ci --no-audit --no-fund
npm run typecheck
npm run build -- --outDir "$OUTPUT" --emptyOutDir

echo "Chrome extension built: $OUTPUT"
