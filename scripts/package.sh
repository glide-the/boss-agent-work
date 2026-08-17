#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACTS="$WORKSPACE_ROOT/artifacts"

mkdir -p "$ARTIFACTS"

for profile in baseline extension-dev full-reconstructed; do
  source_dir="$WORKSPACE_ROOT/dist/$profile"
  test -d "$source_dir/marketplace"
  archive="$ARTIFACTS/boss-delivery-$profile.tar.gz"
  tar -czf "$archive" -C "$source_dir" marketplace
  (cd "$ARTIFACTS" && shasum -a 256 "$(basename "$archive")" > "$(basename "$archive").sha256")
  tar -tzf "$archive" >/dev/null
  echo "Packaged: $archive"
done
