#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_ROOT="$WORKSPACE_ROOT/components/skills"
AGENTS_DATA_DIR="${AGENTS_HOME:-$HOME/.agents}"
CODEX_DATA_DIR="${CODEX_HOME:-$HOME/.codex}"
MODE="install"

usage() {
  cat <<'EOF'
Usage: scripts/install-project-skills.sh [--check|--migrate-existing]

  (no flag)          Create missing links; migrate identical directories.
  --check            Verify every managed destination is the expected link.
  --migrate-existing Archive divergent directories, then link project sources.
EOF
}

if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi
if [[ $# -eq 1 ]]; then
  case "$1" in
    --check) MODE="check" ;;
    --migrate-existing) MODE="migrate" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
fi

validate_root() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" || "$value" != /* || "$value" == "/" ]]; then
    echo "Refusing unsafe $name: $value" >&2
    exit 1
  fi
}

validate_root "AGENTS_HOME" "$AGENTS_DATA_DIR"
validate_root "CODEX_HOME" "$CODEX_DATA_DIR"

AGENT_SKILLS=(
  boss-chat-collect
  boss-chat-reply
  boss-job-greet
  chrome-plugin-debug
  chrome-plugin-fix-delivery
  chrome-plugin-hang-fix
)
CODEX_SKILLS=(
  boss-send-resume-button
  chrome-file-upload-patterns
)
BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"

backup_existing() {
  local destination="$1"
  local data_root="$2"
  local skill_name="$3"
  local backup_root="$data_root/backups/project-skill-links/$BACKUP_STAMP"
  local backup_path="$backup_root/$skill_name"

  mkdir -p "$backup_root"
  mv "$destination" "$backup_path"
  echo "Archived previous skill entry: $destination -> $backup_path"
}

preflight_skill_link() {
  local skill_name="$1"
  local data_root="$2"
  local source_dir="$SOURCE_ROOT/$skill_name"
  local destination="$data_root/skills/$skill_name"

  if [[ ! -f "$source_dir/SKILL.md" ]]; then
    echo "Project skill is incomplete: $source_dir/SKILL.md" >&2
    exit 1
  fi
  if [[ "$MODE" == "check" ]]; then
    if [[ ! -L "$destination" ]]; then
      echo "Project skill link is missing or not a symlink: $destination" >&2
      exit 1
    fi
    if [[ "$(readlink "$destination")" != "$source_dir" ]]; then
      echo "Project skill link points elsewhere: $destination -> $(readlink "$destination")" >&2
      exit 1
    fi
    return
  fi
  if [[ -L "$destination" || ! -e "$destination" ]]; then
    return
  fi
  if [[ ! -d "$destination" ]]; then
    echo "Skill destination exists but is not a directory: $destination" >&2
    exit 1
  fi
  if [[ "$MODE" != "migrate" ]] && \
    ! diff -qr --exclude='.DS_Store' "$source_dir" "$destination" >/dev/null; then
    echo "Refusing to replace divergent skill directory: $destination" >&2
    echo "Merge its changes into $source_dir, then rerun with --migrate-existing." >&2
    diff -qr --exclude='.DS_Store' "$source_dir" "$destination" >&2 || true
    exit 1
  fi
}

ensure_skill_link() {
  local skill_name="$1"
  local data_root="$2"
  local destination_root="$data_root/skills"
  local source_dir="$SOURCE_ROOT/$skill_name"
  local destination="$destination_root/$skill_name"

  if [[ ! -f "$source_dir/SKILL.md" ]]; then
    echo "Project skill is incomplete: $source_dir/SKILL.md" >&2
    exit 1
  fi

  if [[ -L "$destination" ]]; then
    local current_target
    current_target="$(readlink "$destination")"
    if [[ "$current_target" == "$source_dir" ]]; then
      echo "Project skill link ready: $destination -> $source_dir"
      return
    fi
    if [[ "$MODE" == "check" ]]; then
      echo "Project skill link points elsewhere: $destination -> $current_target" >&2
      exit 1
    fi
    backup_existing "$destination" "$data_root" "$skill_name"
  elif [[ -e "$destination" ]]; then
    if [[ "$MODE" == "check" ]]; then
      echo "Project skill destination is not a symlink: $destination" >&2
      exit 1
    fi
    if [[ ! -d "$destination" ]]; then
      echo "Skill destination exists but is not a directory: $destination" >&2
      exit 1
    fi
    if ! diff -qr --exclude='.DS_Store' "$source_dir" "$destination" >/dev/null; then
      if [[ "$MODE" != "migrate" ]]; then
        echo "Refusing to replace divergent skill directory: $destination" >&2
        echo "Merge its changes into $source_dir, then rerun with --migrate-existing." >&2
        diff -qr --exclude='.DS_Store' "$source_dir" "$destination" >&2 || true
        exit 1
      fi
    fi
    backup_existing "$destination" "$data_root" "$skill_name"
  elif [[ "$MODE" == "check" ]]; then
    echo "Project skill link is missing: $destination" >&2
    exit 1
  fi

  mkdir -p "$destination_root"
  ln -s "$source_dir" "$destination"
  echo "Linked project skill: $destination -> $source_dir"
}

for skill_name in "${AGENT_SKILLS[@]}"; do
  preflight_skill_link "$skill_name" "$AGENTS_DATA_DIR"
done
for skill_name in "${CODEX_SKILLS[@]}"; do
  preflight_skill_link "$skill_name" "$CODEX_DATA_DIR"
done
for skill_name in "${AGENT_SKILLS[@]}"; do
  ensure_skill_link "$skill_name" "$AGENTS_DATA_DIR"
done
for skill_name in "${CODEX_SKILLS[@]}"; do
  ensure_skill_link "$skill_name" "$CODEX_DATA_DIR"
done
