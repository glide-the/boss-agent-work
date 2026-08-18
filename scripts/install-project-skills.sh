#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_ROOT="$WORKSPACE_ROOT/components/skills"
CODEX_DATA_DIR="${CODEX_HOME:-$HOME/.codex}"

if [[ -z "$CODEX_DATA_DIR" || "$CODEX_DATA_DIR" != /* || "$CODEX_DATA_DIR" == "/" ]]; then
  echo "Refusing unsafe CODEX_HOME: $CODEX_DATA_DIR" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required to install project skills." >&2
  exit 1
fi

DESTINATION_ROOT="$CODEX_DATA_DIR/skills"
SKILLS=(chrome-file-upload-patterns)

mkdir -p "$DESTINATION_ROOT"

for skill_name in "${SKILLS[@]}"; do
  source_dir="$SOURCE_ROOT/$skill_name"
  destination_dir="$DESTINATION_ROOT/$skill_name"

  if [[ ! -f "$source_dir/SKILL.md" ]]; then
    echo "Project skill is incomplete: $source_dir/SKILL.md" >&2
    exit 1
  fi
  if [[ -L "$destination_dir" ]]; then
    echo "Refusing to replace symlinked skill destination: $destination_dir" >&2
    exit 1
  fi
  if [[ -e "$destination_dir" && ! -d "$destination_dir" ]]; then
    echo "Skill destination exists but is not a directory: $destination_dir" >&2
    exit 1
  fi

  mkdir -p "$destination_dir"
  rsync -a --delete --exclude '.DS_Store' "$source_dir/" "$destination_dir/"
  echo "Installed project skill: $skill_name -> $destination_dir"
done
