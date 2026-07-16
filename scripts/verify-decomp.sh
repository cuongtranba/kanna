#!/bin/sh
# Loop oracle for the "decompose large files" refactor.
# Exit 0 ONLY when every target file is under the LOC cap AND all gates pass.
# Temporary artifact: delete this script in the final commit before marking the PR ready.
set -e

MAX_LOC=600
FILES="src/server/ws-router.ts src/server/agent.ts src/server/event-store.ts src/server/diff-store.ts src/shared/types.ts"

fail=0
for f in $FILES; do
  if [ ! -f "$f" ]; then
    echo "SKIP: $f (moved/deleted — verify the decomposition is complete)"
    continue
  fi
  n=$(wc -l < "$f")
  if [ "$n" -gt "$MAX_LOC" ]; then
    echo "FAIL: $f = $n LOC (>$MAX_LOC)"
    fail=1
  else
    echo "OK:   $f = $n LOC"
  fi
done
[ "$fail" -eq 0 ] || { echo "LOC gate failed"; exit 1; }

echo "--- lint ---"
bun run lint
echo "--- typecheck ---"
bun run typecheck
echo "--- test ---"
bun run test

# C3 architecture seal (local tool; skipped if not installed on this machine)
C3X="${C3X_BIN:-$HOME/.claude/skills/c3/bin/c3x.sh}"
if [ -x "$C3X" ]; then
  echo "--- c3 check ---"
  bash "$C3X" check
else
  echo "SKIP: c3 check (c3x not found at $C3X)"
fi

echo "GOAL MET"
