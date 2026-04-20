#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GLOBAL_LINK="$HOME/.bun/install/global/node_modules/kanna-code"
LAUNCHD_LABEL="io.silentium.kanna"

cd "$REPO_DIR"

# One-time: replace global copy with symlink to repo
if [[ ! -L "$GLOBAL_LINK" ]]; then
  echo "→ Linking $GLOBAL_LINK → $REPO_DIR"
  rm -rf "$GLOBAL_LINK"
  mkdir -p "$(dirname "$GLOBAL_LINK")"
  ln -s "$REPO_DIR" "$GLOBAL_LINK"
fi

# Install deps if lockfile changed
if [[ ! -d node_modules ]] || [[ package.json -nt node_modules ]] || [[ bun.lock -nt node_modules ]]; then
  echo "→ bun install"
  bun install
fi

echo "→ bun run build"
bun run build

echo "→ launchctl kickstart -k gui/$(id -u)/$LAUNCHD_LABEL"
launchctl kickstart -k "gui/$(id -u)/$LAUNCHD_LABEL"

sleep 2
PID=$(launchctl list | awk -v l="$LAUNCHD_LABEL" '$3==l{print $1}')
echo "✓ kanna running (PID $PID)"
