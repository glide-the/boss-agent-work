#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALLER="$SCRIPT_DIR/install-project-skills.sh"
TEST_ROOT="$(mktemp -d)"
TEST_HOME="$TEST_ROOT/home"
TEST_AGENTS="$TEST_ROOT/agents root"
TEST_CODEX="$TEST_ROOT/codex root"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$TEST_HOME" "$TEST_AGENTS/skills" "$TEST_CODEX/skills"
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

for skill_name in "${AGENT_SKILLS[@]}"; do
  cp -R "$WORKSPACE_ROOT/components/skills/$skill_name" "$TEST_AGENTS/skills/$skill_name"
done
for skill_name in "${CODEX_SKILLS[@]}"; do
  cp -R "$WORKSPACE_ROOT/components/skills/$skill_name" "$TEST_CODEX/skills/$skill_name"
done
mkdir -p "$TEST_AGENTS/skills/unrelated-skill"
printf '%s\n' 'keep me' > "$TEST_AGENTS/skills/unrelated-skill/SKILL.md"

run_installer() {
  HOME="$TEST_HOME" AGENTS_HOME="$TEST_AGENTS" CODEX_HOME="$TEST_CODEX" \
    "$INSTALLER" "$@"
}

if HOME="$TEST_HOME" AGENTS_HOME=/ CODEX_HOME="$TEST_CODEX" \
  "$INSTALLER" --check >/dev/null 2>&1; then
  echo "Installer accepted filesystem root as AGENTS_HOME." >&2
  exit 1
fi

run_installer >/dev/null
run_installer --check >/dev/null
run_installer >/dev/null

for skill_name in "${AGENT_SKILLS[@]}"; do
  test -L "$TEST_AGENTS/skills/$skill_name"
  test "$(readlink "$TEST_AGENTS/skills/$skill_name")" = \
    "$WORKSPACE_ROOT/components/skills/$skill_name"
done
for skill_name in "${CODEX_SKILLS[@]}"; do
  test -L "$TEST_CODEX/skills/$skill_name"
  test "$(readlink "$TEST_CODEX/skills/$skill_name")" = \
    "$WORKSPACE_ROOT/components/skills/$skill_name"
done
test "$(cat "$TEST_AGENTS/skills/unrelated-skill/SKILL.md")" = "keep me"

unlink "$TEST_AGENTS/skills/chrome-plugin-debug"
ln -s "$TEST_ROOT/wrong-target" "$TEST_AGENTS/skills/chrome-plugin-debug"
run_installer >/dev/null
test "$(readlink "$TEST_AGENTS/skills/chrome-plugin-debug")" = \
  "$WORKSPACE_ROOT/components/skills/chrome-plugin-debug"

unlink "$TEST_AGENTS/skills/boss-chat-collect"
mkdir -p "$TEST_AGENTS/skills/boss-chat-collect"
printf '%s\n' 'divergent' > "$TEST_AGENTS/skills/boss-chat-collect/SKILL.md"
if run_installer >/dev/null 2>&1; then
  echo "Installer accepted a divergent directory without --migrate-existing." >&2
  exit 1
fi
run_installer --migrate-existing >/dev/null
test -L "$TEST_AGENTS/skills/boss-chat-collect"
test -n "$(find "$TEST_AGENTS/backups/project-skill-links" -path '*/boss-chat-collect/SKILL.md' -print -quit)"

run_installer --check >/dev/null
echo "Project skill symlink installer tests passed."
