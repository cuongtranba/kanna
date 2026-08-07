---
id: adr-20260806-loop-oracle-audit
c3-seal: e0d5251e94e1b226e8d6d612a77a053653ac3120c61b4676c43e8e7c4fe2e244
title: loop-oracle-audit
type: adr
goal: 'Stop a green-but-weak oracle from ending a loop over unfinished work: gate GOAL MET on one whole-plan read (orchestrator before stop_loop, worker before writing DONE), and audit the verify command at arm time so a grep/file-existence-shaped oracle is called out in the setup_loop reply while the operator can still tighten it.'
status: proposed
date: "2026-08-06"
---

## Goal

Stop a green-but-weak oracle from ending a loop over unfinished work: gate GOAL MET on one whole-plan read (orchestrator before stop_loop, worker before writing DONE), and audit the verify command at arm time so a grep/file-existence-shaped oracle is called out in the setup_loop reply while the operator can still tighten it.

## Context

Chat `e90f89d3` armed a loop to migrate an app's auth onto better-auth. Four iterations later the orchestrator printed **GOAL MET and disarmed — with the feature unfinished**: `login.ts` still ran the legacy password/session path; better-auth was installed but nothing called it. Three layers failed together, each following its rules:

1. **The oracle was satisfiable without the behavior existing.** The verify script was `test -f` probes, `grep -q` presence checks and an `ls … /dev/null` idiom, capped by the standing `task check` gate. Every marker was satisfied by files that existed but were never wired in, and the legacy tests stayed green because they test the legacy path. adr-20260805-loop-oracle-hardening's "prefer a test over a grep" guidance existed only as prose — nothing said it at the moment the oracle was armed.
2. **The plan-vs-oracle gate (adr-20260805) keyed on `## Next chunk` alone.** The final worker wrote `DONE` there honestly: the remaining five chunks lived in a non-canonical `## Chunks` section that the section-scoped read discipline meant nobody — worker or orchestrator — was ever shown. ORACLE TOO WEAK structurally could not fire.
3. **`setup_loop`'s only oracle-quality gate is the already-green refusal.** It proves the oracle can FAIL; it says nothing about whether the oracle can only PASS for the right reason. A weak-but-red oracle arms silently.

## Decision

Two additive changes; neither weakens the context-bounding discipline that motivated section-scoped reads.

**Terminal whole-plan check (template).** Step 3(a) of the rendered prompt now requires, before GOAL MET: call `query_tracking_file` with NO sections filter — the one whole-file read the loop permits — and scan EVERY section, canonical or not, for undone work; work found is case (b) ORACLE TOO WEAK. The worker brief gains the mirror-image rule: before replacing `Next chunk` with `DONE`, run the same check and write any remaining work into `Next chunk` instead. The whole-file ban in HARD RULES carves out exactly this check. Context cost is bounded by construction: at most one full read per loop, on the terminal iteration. New `requiredSubstrings` entries (`TERMINAL CHECK`, `EVERY section`, `with NO sections filter`, `Before writing DONE`) pin the clauses so a future template edit cannot drop them.

**Arm-time oracle audit (static, non-fatal).** Pure `extractOracleScriptPath` + `auditOracle` in `loop-template.ts`; a confined `readOracleScript` IO leaf in `loop-template-io.adapter.ts`; wiring through `LoopCommandDeps`. `setupLoop` audits `verifyCommand` (and the `.sh`/`.bash` it references, read from inside the workdir only) right after the already-green gate. Weak markers (`test -f`, `[ -f`, `grep -q|-c|-L`, `ls … /dev/null`) with no test-runner invocation → one warning saying the oracle can pass without the behavior existing; three or more markers gating a real test run → one warning that a green legacy suite proves nothing about new work; a referenced script that cannot be read → one warning saying the audit was skipped. Warnings ride a new required `oracleWarnings: string[]` on `SetupLoopHandlerResult` and render as an `Oracle audit:` block appended to the setup_loop success text — the `reconcileActions` precedent. Never a refusal: heuristics misfire, and the operator, not the pattern list, owns the oracle.

**Deliberately not done.** An adversarial probe subagent ("make this oracle pass without doing the work") is feasible via `delegateRun` wiring but adds a full subagent run to arm latency; deferred until the static audit's signal/noise is known. The audit outcome is not persisted on `loop_armed` — it is advice to the operator, not loop state.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| loop template + validator | N.A - src/server/loop-template.ts has no c3 component mapping (c3x lookup → no component) | Terminal-check clauses in the rendered prompt; new pure extractOracleScriptPath / auditOracle; four new requiredSubstrings entries | N.A - unmapped file | Side-effect seal: module stays pure |
| loop template IO adapter | N.A - src/server/loop-template-io.adapter.ts unmapped | New readOracleScript, confined to the loop workdir via confinePathToDir | N.A - unmapped file | .adapter.ts seal exemption; never reads outside workdir |
| loop command handlers | N.A - src/server/claude-loop-commands.ts unmapped | setupLoop runs the audit after the already-green gate; LoopCommandDeps gains readOracleScript | N.A - unmapped file | Side-effect seal: new IO injected via deps |
| kanna-mcp tool surface | N.A - src/server/kanna-mcp.ts unmapped | SetupLoopHandlerResult gains required oracleWarnings; setup_loop reply appends the Oracle audit: block | N.A - unmapped file | Warnings are advisory text; result stays ok |

## Work Breakdown

| Step | Change | Where |
| --- | --- | --- |
| 1 | Terminal-check clauses in step 3(a)/(b), HARD RULES carve-out, worker pre-DONE check, requiredSubstrings pins | src/server/loop-template.ts |
| 2 | Pure extractOracleScriptPath + auditOracle with weak/strong pattern tables and the 3-marker soft limit | src/server/loop-template.ts |
| 3 | Confined readOracleScript IO leaf | src/server/loop-template-io.adapter.ts |
| 4 | Audit call in setupLoop + readOracleScript dep + oracleWarnings on the ok result | src/server/claude-loop-commands.ts, src/server/agent-deps-builders.ts |
| 5 | oracleWarnings on SetupLoopHandlerResult; Oracle audit: block in the setup_loop reply | src/server/kanna-mcp.ts |

## Enforcement Surfaces

| Invariant | Surface |
| --- | --- |
| GOAL MET requires the terminal whole-plan check; DONE requires the worker's mirror check | requiredSubstrings in validateLoopSetup + renderLoopPrompt structural invariants tests |
| The terminal check is the ONLY whole-file read | HARD RULES carve-out wording; template tests pin EXCEPT the single TERMINAL CHECK |
| Audit never blocks arming | setupLoop returns ok with warnings; agent.test.ts asserts a grep-shaped script still arms |
| Script read confined to the workdir | readOracleScript escape tests in loop-template-io.adapter.test.ts |
| Warnings surface in the tool reply and only when non-empty | kanna-mcp.test.ts Oracle audit: presence/absence tests |

## Alternatives Considered

| Alternative | Why not |
| --- | --- |
| Orchestrator step 1 always reads more sections (Chunks, Plan, …) | Non-canonical section names are unbounded; reading a fixed extra list still misses the next name, and reading them every iteration re-introduces O(file) context growth the section discipline exists to prevent |
| Refuse to arm on a weak-oracle verdict | The heuristic misfires (an opaque ./ci/gate is uninspectable; a marker-gated real suite can be fine); a false refusal costs more trust than a false warning |
| Adversarial probe subagent at arm time | Full subagent run added to arm latency + a permit consumed; deferred until the static audit's precision is known |
| Persist the audit verdict on loop_armed / LoopState | The warning is advice to the operator at arm time; carrying it as state implies enforcement that does not exist |

## Risks

| Risk | Mitigation |
| --- | --- |
| The terminal check gives the model license to read the whole file at other times | The carve-out names step 3(a) exactly; the ban text stays otherwise intact and pinned by tests |
| Weak/strong pattern tables drift from real oracles (false positives/negatives) | Warnings are non-fatal; pattern tables live beside auditOracle with unit fixtures per shape, extend with a fixture in the same PR |
| A worker ignores the pre-DONE check and writes DONE anyway | The orchestrator-side terminal check is the second, independent gate — both must fail for a false GOAL MET |
| Quoted script paths with spaces are not resolved | extractOracleScriptPath returns null → audit falls back to the command string; silence, never a wrong read |

## Verification

| Check | How |
| --- | --- |
| Template clauses present + pinned | bun test --conditions production src/server/loop-template.test.ts (renderLoopPrompt structural invariants) |
| Audit heuristics | auditOracle / extractOracleScriptPath describes in loop-template.test.ts |
| Confined script read | loop-template-io.adapter.test.ts readOracleScript describe |
| End-to-end arm with warnings | agent.test.ts: grep-shaped .loop-verify.sh arms with 1 warning; bun run lint arms with none |
| Reply rendering | kanna-mcp.test.ts: Oracle audit: block present iff warnings non-empty |
