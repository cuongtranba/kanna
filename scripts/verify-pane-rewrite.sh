#!/usr/bin/env bash
#
# Oracle for the tab + split-pane rewrite (branch feat/pane-tree).
#
# "Done" is not "the tests pass" — they already do, because the engine, store,
# renderer and tab strip all landed without anything calling them. Done means
# the tree is actually driving the chat page AND the layout it replaces is gone.
#
# Exit 0 only when all three hold:
#   1. ChatPage renders the SplitContainer.
#   2. The hard-coded layout components it replaces are deleted.
#   3. bun run verify:client-arch passes (ast-grep + lint + typecheck + test).
#
# Delete this script in the documentation stage; it is branch tooling, not a
# shipping asset.
set -uo pipefail

WORKTREE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHAT_PAGE="$WORKTREE/src/client/app/ChatPage/index.tsx"

fail() {
  echo "NOT DONE: $1"
  exit 1
}

[ -f "$CHAT_PAGE" ] || fail "cannot find $CHAT_PAGE"

grep -q "SplitContainer" "$CHAT_PAGE" \
  || fail "ChatPage does not render SplitContainer yet (stage 4 wiring)"

if grep -qE "function (ChatWorkspace|DesktopSidebarPane|MobileSidebarPane)" "$CHAT_PAGE"; then
  fail "the old hard-coded layout is still in ChatPage (stage 11 removal)"
fi

cd "$WORKTREE" || fail "cannot enter $WORKTREE"
if ! bun run verify:client-arch >/tmp/verify-pane-rewrite.log 2>&1; then
  echo "NOT DONE: verify:client-arch failed — tail of output:"
  tail -30 /tmp/verify-pane-rewrite.log
  exit 1
fi

echo "GOAL MET: SplitContainer is wired, the old layout is gone, verify:client-arch passes."
