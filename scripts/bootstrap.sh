#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV="$WORKSPACE_ROOT/.venv"

if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --disable-pip-version-check -r "$WORKSPACE_ROOT/requirements-dev.txt"

"$WORKSPACE_ROOT/scripts/install-project-skills.sh"

echo "Development environment ready: $VENV"
