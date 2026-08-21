#!/usr/bin/env bash
#
# Oracle for the typography-scale-preference feature.
#
# Exits 0 ONLY when the feature is actually built and the whole repo is green.
#
# ── Why this shape ─────────────────────────────────────────────────────────
# scripts/verify-session-tabs.sh exists because a previous oracle passed
# (thousands of tests green) while the app was UNUSABLE: a component read a
# scoped store from above its own Provider, and nothing caught it because
# every test mounted the Provider by hand and none rendered the real router.
#
# Two consequences, both encoded below, applied to this feature:
#   1. Checking "a test file exists and passes" is too weak — a worker can
#      satisfy it with a test that asserts nothing interesting. So this
#      oracle demands SPECIFIC NAMED tests (exact `test("...")` names,
#      matched in the junit report).
#   2. That weakness is LIVE in this repo: ChatPage.tabs.test.tsx:69 satisfies
#      a require_test for "renders through the real router" without
#      importing react-dom or react-router-dom at all — the string "renders
#      through the real router" is right there in the test name, asserting
#      nothing about how the component was mounted. So the P7 "real router"
#      requirement below is not just a name match: it is PAIRED with a grep
#      over the test file's source for `MemoryRouter` AND a real render call
#      (`createRoot`/`render(`) — something the test's NAME alone cannot
#      fake. `verify_real_router_evidence` below is that pairing check, and
#      the self-test that runs first proves the check itself is not vacuous
#      by feeding it a ChatPage.tabs.test.tsx:69-shaped fixture (right name,
#      no router, no render) and asserting the check REJECTS it — mirroring
#      src/server/design/tone-pairings.test.ts's own
#      "deliberately broken pairing fails the gate" meta-test.
#
# Deliberately not greps over source for the OTHER required tests: an import
# line satisfies a grep, it does not satisfy an assertion. Only P7 gets the
# extra pairing, because P7 is the one requirement a name alone can fake
# (see ChatPage.tabs.test.tsx:69, above).

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail() { echo "ORACLE-FAIL: $1"; exit 1; }

P7_TEST_FILE="src/client/app/SettingsPage.route.test.tsx"
P7_TEST_NAME="renders the account default typography scale through the real /settings/general route"

# ─── 0. Self-test: prove the P7 pairing check is not vacuous ───────────────
# verify_real_router_evidence is the function used at step 3 to pair the P7
# require_test with proof the test can't fake: grep the test FILE (not the
# junit report) for MemoryRouter and a real render call. This self-test feeds
# it ChatPage.tabs.test.tsx:69's exact failure mode — the RIGHT test name, in
# a file with no router import and no render call at all — and asserts the
# check rejects it. If this ever passes, the pairing check has stopped
# discriminating and the whole oracle is back to trusting a name alone.
verify_real_router_evidence() {
  local file="$1"
  grep -q "MemoryRouter" "$file" || return 1
  grep -Eq "createRoot\(|render\(" "$file" || return 1
  return 0
}

self_test() {
  local fake
  fake="$(mktemp -t typography-oracle-selftest-XXXXXX.tsx)"
  trap 'rm -f "$fake"' RETURN

  cat >"$fake" <<EOF
import { test, expect } from "bun:test"
// ChatPage.tabs.test.tsx:69's exact failure mode reproduced: the test carries
// the RIGHT NAME but never imports react-dom / react-router-dom and never
// renders anything through a router.
test("${P7_TEST_NAME}", () => {
  expect(true).toBe(true)
})
EOF

  if verify_real_router_evidence "$fake"; then
    fail "meta-test: verify_real_router_evidence ACCEPTED a fixture with the right test name but no MemoryRouter/render call — the P7 pairing check is vacuous and would let ChatPage.tabs.test.tsx:69's failure mode back in"
  fi
  echo "META-TEST-PASS: fixture with a faked test name but no router/render evidence was correctly rejected"

  verify_real_router_evidence "$P7_TEST_FILE" \
    || fail "meta-test sanity: the REAL P7 test file ($P7_TEST_FILE) itself fails verify_real_router_evidence — the check is broken, not just the fixture"
  echo "META-TEST-PASS: the real P7 test file carries MemoryRouter + a real render call"
}

self_test

# ─── 1. Static gates ───────────────────────────────────────────────────────
# Cheap, and they fail fast before the expensive suite run.
bunx ast-grep scan || fail "ast-grep scan (no-arbitrary-px-text and other repo-convention rules) fails"
bun run lint       || fail "lint --max-warnings=0 fails"
bun run typecheck  || fail "TS7 typecheck fails"

# ─── 2. Whole repo green, captured as junit so names can be asserted ───────
JUNIT="$(mktemp -t typography-scale-junit-XXXXXX.xml)"
trap 'rm -f "$JUNIT"' EXIT

bun test --conditions production --timeout 30000 \
    --reporter=junit --reporter-outfile="$JUNIT" \
  || fail "full test suite fails"

[ -s "$JUNIT" ] || fail "junit report was not written — cannot verify named tests"

# ─── 3. The feature contract: these exact tests must exist and have run ────
# Suite exit was 0 above, so "present in the report" == "passed".
require_test() {
  grep -qF "name=\"$1\"" "$JUNIT" \
    || fail "missing required test: \"$1\""
}

# (a) P1 pure core: the multiplier table is exactly the documented one.
require_test "multipliers match the documented table"

# (b) P3 stylesheet wiring: the ten --text-N scale tokens exist.
require_test "all ten --text-N tokens exist, each equal to N / 16 rem"

# (c) P4 the px ratchet is at zero, and the walker actually walked the tree.
require_test "count never rises above CAP (0)"

# (d) P5 escape hatches: xterm (canvas, immune to CSS) is scaled explicitly.
require_test "scales up with lg/xl/xxl, rounded to the nearest pixel"

# (e) P6 pre-paint: an override wins over a stale server-default cache.
require_test "override wins over cache when both are present"

# (f) P7 the regression that blanked the app. Must mount the REAL router at
#     the settings route and assert the control renders. Name-matched AND
#     evidence-paired (see step 0) — nothing else catches a test whose NAME
#     claims a real mount but whose body never performs one.
require_test "$P7_TEST_NAME"
verify_real_router_evidence "$P7_TEST_FILE" \
  || fail "P7 test \"$P7_TEST_NAME\" is present in the junit report, but $P7_TEST_FILE carries no MemoryRouter + real render evidence — the test's name cannot be trusted alone"

echo "ORACLE-PASS: typography scale built and the repo is green"
