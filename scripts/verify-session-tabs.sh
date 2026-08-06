#!/usr/bin/env bash
#
# Oracle for the session-tabs feature.
#
# Exits 0 ONLY when the feature is actually built and the whole repo is green.
# Scoped to the TERMINAL state of the plan, not to whichever phase is in
# flight — a phase finishing does not turn this green.
#
# ── Why this shape ─────────────────────────────────────────────────────────
# A previous version of this oracle passed (4910 tests green) while the app
# was UNUSABLE: every chat opened to a blank white page, because ChatPage read
# a scoped store from above its own Provider. Nothing caught it, because every
# test mounted the Provider by hand and none rendered the real router.
#
# Two consequences, both encoded below:
#   1. Checking "a test file exists and passes" is too weak — a worker can
#      satisfy it with a test that asserts nothing interesting. So this oracle
#      demands SPECIFIC NAMED tests (exact `test("...")` names, matched in the
#      junit report). The names ARE the contract; they are also written into
#      PROGRESS-session-tabs.md so the worker knows what to implement.
#   2. One of those named tests must render the REAL ROUTER at a chat URL.
#      Component-level tests structurally cannot catch a missing-Provider
#      regression; only a route-level mount can.
#
# Deliberately not greps over source: an import line satisfies a grep, it does
# not satisfy an assertion.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail() { echo "ORACLE-FAIL: $1"; exit 1; }

JUNIT="$(mktemp -t session-tabs-junit-XXXXXX.xml)"
trap 'rm -f "$JUNIT"' EXIT

# ─── 1. Static gates ───────────────────────────────────────────────────────
# Cheap, and they fail fast before the expensive suite run.
bunx ast-grep scan || fail "ast-grep scan (React #185 / inline-state rules) fails"
bun run lint       || fail "lint --max-warnings=0 fails"
bun run typecheck  || fail "TS7 typecheck fails"

# ─── 2. Whole repo green, captured as junit so names can be asserted ───────
# One full-suite run serves both purposes: the exit code proves nothing is
# broken anywhere, and the report proves the named tests below actually ran.
bun test --conditions production --timeout 30000 \
    --reporter=junit --reporter-outfile="$JUNIT" \
  || fail "full test suite fails"

[ -s "$JUNIT" ] || fail "junit report was not written — cannot verify named tests"

# ─── 3. The feature contract: these exact tests must exist and have run ────
# Suite exit was 0 above, so "present in the report" == "passed".
#
# Each name maps to one clause of the goal:
#   goal: one tab per open chat, N open = N tabs, keyboard switching,
#         two chat tabs render two different live transcripts side by side
require_test() {
  grep -qF "name=\"$1\"" "$JUNIT" \
    || fail "missing required test: \"$1\" (see PROGRESS-session-tabs.md for the contract)"
}

# (a) The regression that blanked the app. Must mount the REAL router at a
#     chat URL and assert the tree is non-empty. Nothing else catches a
#     Provider mounted below its consumer.
require_test "renders the chat route through the real router"

# (b) One tab per open chat, N open = N tabs.
require_test "N open chats produce N tabs"

# (c) The headline feature: two tabs, two DIFFERENT live transcripts, at once.
require_test "two chat tabs render two different transcripts"

# (d) Keyboard switching between tabs.
require_test "keyboard switches to the next chat tab"

# (e) Per-chat state isolation — what makes (c) possible at the store layer.
require_test "updating chatA does not affect chatB slice reference"

# (f) One socket shared by N mounted chat tabs.
require_test "opens exactly ONE connection for two consumers"

echo "ORACLE-PASS: session tabs built and the repo is green"
