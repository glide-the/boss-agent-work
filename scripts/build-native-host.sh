#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPONENT="$WORKSPACE_ROOT/components/native-host"
OUTPUT="$WORKSPACE_ROOT/dist/native-host/macos/arm64"
BUILD_CACHE="$WORKSPACE_ROOT/.cache/cargo-target"

CARGO_TARGET_DIR="$BUILD_CACHE" cargo test --manifest-path "$COMPONENT/Cargo.toml"
CARGO_TARGET_DIR="$BUILD_CACHE" cargo build --release --manifest-path "$COMPONENT/Cargo.toml"

mkdir -p "$OUTPUT"
install -m 755 "$BUILD_CACHE/release/codex-native-host-reconstructed" "$OUTPUT/extension-host"

echo "Reconstructed Native Host built: $OUTPUT/extension-host"
