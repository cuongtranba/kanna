#!/usr/bin/env bash
#
# Oracle for the session-tabs feature.
#
# Exits 0 ONLY when the feature is actually built and the whole repo is green.
# Scoped to the TERMINAL state, not to whichever phase is in flight — a phase
# finishing does not turn this green.
#
# Deliberately not greps over source: an import line satisfies a grep, it does
# not satisfy an assertion. Every check below is either "this test passes" or
# "this gate passes".

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail() { echo "ORACLE-FAIL: $1"; exit 1; }

# ─── 1. The proof tests must EXIST ─────────────────────────────────────────
# A missing file cannot pass, and `bun test <missing>` is not a reliable
# non-zero, so existence is checked explicitly.
REQUIRED_TESTS=(
  "src/client/stores/chatStateStore.test.ts"
  "src/client/app/ChatPage/ChatTabRoot.multi.loop.test.tsx"
)
for path in "${REQUIRED_TESTS[@]}"; do
  [ -f "$path" ] || fail "required proof test missing: $path"
done

# ─── 2. Per-chat state isolation — the core of side-by-side ────────────────
bun test --conditions production src/client/stores/chatStateStore.test.ts \
  || fail "per-chat store isolation tests fail"

# ─── 3. Two chat transcripts mounted together, no render loop ──────────────
bun test --conditions production src/client/app/ChatPage/ChatTabRoot.multi.loop.test.tsx \
  || fail "two mounted chat tabs fail (render loop or wrong transcript)"

# ─── 4. Tab model, presentation, keyboard ──────────────────────────────────
bun test --conditions production \
  src/client/lib/paneTree/ \
  src/client/components/panes/ \
  || fail "pane tree / tab strip tests fail"

# ─── 5. One socket for N mounted chat tabs ─────────────────────────────────
bun test --conditions production src/client/app/KannaSocketProvider.test.tsx \
  || fail "socket provider tests fail"

# ─── 6. Whole repo green: ast-grep + lint + typecheck + every test ─────────
# This is what stops a phase from being declared done while it has broken
# something elsewhere.
bun run verify:client-arch || fail "verify:client-arch (ast-grep + lint + typecheck + test) fails"

echo "ORACLE-PASS: session tabs built and the repo is green"
