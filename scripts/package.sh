#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACTS="$WORKSPACE_ROOT/artifacts"

mkdir -p "$ARTIFACTS"

for profile in baseline extension-dev full-reconstructed; do
  source_dir="$WORKSPACE_ROOT/dist/$profile"
  test -d "$source_dir/marketplace"
  test -d "$source_dir/electron-app"
  archive="$ARTIFACTS/boss-delivery-$profile.tar.gz"
  COPYFILE_DISABLE=1 tar -czf "$archive" -C "$source_dir" marketplace electron-app
  (cd "$ARTIFACTS" && shasum -a 256 "$(basename "$archive")" > "$(basename "$archive").sha256")
  archive_listing="$(tar -tzf "$archive")"
  if rg -q '(^|/)(\._[^/]*|\.DS_Store|__MACOSX)(/|$)' <<< "$archive_listing"; then
    echo "Refusing archive with macOS metadata: $archive" >&2
    exit 4
  fi
  if rg -q '(^|/)\.\.?(/|$)' <<< "$archive_listing"; then
    echo "Refusing archive with unsafe path entry: $archive" >&2
    exit 4
  fi
  echo "Packaged: $archive"
done
