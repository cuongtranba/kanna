---
id: adr-20260805-loop-oracle-hardening
c3-seal: d65f5c59c9a19310e3177b2e6382597c8f725b618092d31e0a1722d72de9952c
title: loop-oracle-hardening
type: adr
goal: 'Stop the autonomous loop from terminating early on a weak oracle, from wasting iterations on setups it could have refused at arm time, and from paying for the same verification twice. Concretely: gate "GOAL MET" on the plan as well as the verify exit code; reject a loop whose worker is manual-trigger or whose oracle already passes; refuse to silently rewrite a git-tracked tracking file recording a different goal; give the worker a `replace` write op and an explicit `file:` on every tracking-file call; let a loop run in a sibling git worktree; memoize the oracle on a workspace fingerprint; and let the host disarm a loop that fails repeatedly instead of relying on the model to stop.'
status: proposed
date: "2026-08-05"
---

## Goal

Stop the autonomous loop from terminating early on a weak oracle, from wasting iterations on setups it could have refused at arm time, and from paying for the same verification twice. Concretely: gate "GOAL MET" on the plan as well as the verify exit code; reject a loop whose worker is manual-trigger or whose oracle already passes; refuse to silently rewrite a git-tracked tracking file recording a different goal; give the worker a `replace` write op and an explicit `file:` on every tracking-file call; let a loop run in a sibling git worktree; memoize the oracle on a workspace fingerprint; and let the host disarm a loop that fails repeatedly instead of relying on the model to stop.

## Context

Session `df3b55b4` armed a loop to finish a split-pane rewrite. Over 45 minutes it fired 6 orchestrator turns, delegated 2 successfully, completed 1 chunk of work, and needed 3 human interventions. It then declared **GOAL MET at stage 4 of a 12-stage plan** — its own `## Next chunk` section still listed stages 8-12 at the moment it stopped.

Nine distinct defects, all reproduced from that transcript:

1. **The oracle was a proxy for the current stage, not the terminal state.** `renderLoopPrompt` step 3 trusted the exit code alone. The verify script was two greps scoped to one file plus the standing gate; stage 4's refactor incidentally deleted the three function declarations the second grep looked for, so the oracle flipped green six stages early. The script's own failure message named "stage 11 removal" — the author knew, the gate did not.
2. **`Next chunk` accumulated.** It has replace semantics (one next step) but `append_tracking_row` was the only write op, so completed chunks piled up and the next iteration would have re-read a finished chunk.
3. **The rendered worker prompt omitted `file:`** on every `query_tracking_file` / `append_tracking_row` call it prescribed. Those default to `PROGRESS.md`, so a loop tracking `PROGRESS-panes.md` had its worker write a progress row into the *committed* `PROGRESS.md` of a previous, unrelated loop (PR #547).
4. **`setup_loop` armed on a manual-trigger subagent.** `claude-loop-commands.ts` mapped the roster to `{id, name}`, dropping `triggerMode`, so `validateLoopSetup` could only check membership. `MANUAL_ONLY` then surfaced at the first delegation — one iteration later, after the context wipe. Cost 2 iterations and 2 human turns.
5. **`setup_loop` silently clobbered a committed tracking file**, rewriting the `## Goal` and `## Verify command` of a finished loop's record. Recovered only because a human re-read the file and `git checkout`ed it.
6. **No arm-time proof the oracle can fail.** The operator hand-ran the script before arming to confirm exit 1; nothing in the tool did.
7. **The full gate ran twice per productive iteration** — orchestrator, then worker — at 64.8s each on the real run, and also ran on iterations where nothing could have changed.
8. **The tracking file was pinned to the project cwd** while the work lived in a sibling worktree, stranding the plan from the branch. Every chunk prompt had to shout "ALL WORK HAPPENS IN THE WORKTREE".
9. **No failure policy.** A transient `AUTH_REQUIRED` (since fixed by adr-20260805-subagent-spawn-gate-parity) made the model call `stop_loop` and park until a human noticed. `LoopState` carried no counters.

## Decision

Treat the oracle as a **proxy** and the plan as the **authority**, and move every check that can be made at arm time to arm time.

**Plan-vs-oracle gate.** Step 3 of the rendered prompt becomes four cases over two signals. Both green → GOAL MET. Oracle green but plan non-empty → print `ORACLE TOO WEAK`, `stop_loop`, hand back to a human — deliberately *not* "keep going", because a passing oracle with work remaining means the definition of done is broken and only a human can retighten it. Oracle red but plan empty → the orchestrator writes the next chunk itself. Oracle red, plan non-empty → normal delegation.

**Refuse at arm time, not at first delegation.** `validateLoopSetup` now receives `triggerMode` in the roster and rejects a manual worker with a message naming the fix. `setupLoop` additionally runs the verify command once and refuses to arm when it exits 0 — the check the careful operator was already doing by hand. Both are overridable with `force: true`.

**Never clobber committed history.** New pure `assertTrackingFileSafe(existing, {goal, gitTracked, force})` refuses when a git-tracked file records a different goal. Deliberately narrow: untracked file, matching goal (idempotent re-arm), or no `## Goal` yet all pass through.

**A real write op for state sections.** `StructuredDoc` gains `replace`; a new `replace_tracking_section` MCP tool exposes it; the worker prompt uses it for `Next chunk` and keeps `append` for the true logs.

**Memoize the oracle.** New `run_verify` MCP tool keyed on a workspace digest (HEAD + porcelain + size/mtime of dirty paths). Unchanged tree → the previous result, instantly. A null digest (not a git repo) is never cached — serving a remembered pass for an unfingerprintable tree is the exact failure this ADR exists to prevent.

**Worktree-native.** `setup_loop` takes `workdir`; the verify command runs there and the tracking file is rooted there. Bounded by `isWorktreeOfSameRepo` (comparing `--git-common-dir`, which makes worktrees of one repo compare equal while an unrelated repo does not) so this does not become a way to aim a loop anywhere. The tracking-doc tools resolve their base dir from the armed loop per call, not per spawn.

**Host-owned failure backstop.** New `loop_run_outcome` event; `deriveLoopState` folds it into `consecutiveFailures`; three in a row disarms with reason `repeated_failures`. This is what lets the prompt safely tell the model to *retry* infra failures rather than stop.

**`parallelism` (default 1)** renders a fan-out rule, but only for chunks the plan explicitly marks `[parallel]`, each naming its own worktree. Independence is never inferred.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| loop template + validator | N.A - src/server/loop-template.ts has no c3 component mapping (c3x lookup → no component) | Owns the rendered orchestrator prompt and every arm-time rejection; all four accuracy fixes land here | N.A - unmapped file | Side-effect seal: module stays pure; node:path only |
| loop command handlers | N.A - src/server/claude-loop-commands.ts unmapped | Carries triggerMode into validation, runs the arm-time oracle, and owns the repeated-failure disarm | N.A - unmapped file | Side-effect seal: all new IO injected via LoopCommandDeps |
| structured-doc engine | N.A - src/shared/structured-doc/ unmapped | Gains the replace op backing Next chunk replace semantics | N.A - unmapped file | src/shared/** side-effect seal — pure string in/out |
| kanna-mcp tool surface | N.A - src/server/kanna-mcp.ts unmapped | Registers replace_tracking_section + run_verify; setup_loop gains workdir/parallelism/force | N.A - unmapped file | Tool descriptions must state when to prefer each write op |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Prompt accuracy | renderLoopPrompt: four-case step 3, file: on every rendered call, replace_tracking_section for Next chunk, infra-vs-work retry taxonomy, parallelism rule | src/server/loop-template.ts |
| Arm-time gates | triggerMode in LoopSetupContext.roster; assertTrackingFileSafe; workdir + parallelism validation | src/server/loop-template.ts, src/server/claude-loop-commands.ts |
| New IO leaves | inspectTrackingFile, isWorktreeOfSameRepo (extend existing adapter); runVerifyCommand, computeWorkspaceDigest (new adapter, detached process-group kill) | loop-template-io.adapter.ts, loop-verify-io.adapter.ts |
| Oracle memo | Digest-keyed cache, bounded at 64 entries, null digest never stored | src/server/loop-verify-cache.ts |
| Structured doc | replace on the port + markdown adapter | src/shared/structured-doc/ |
| Failure backstop | loop_run_outcome event, consecutiveFailures fold, MAX_CONSECUTIVE_LOOP_FAILURES disarm | auto-continue/events.ts, auto-continue/read-model.ts, claude-loop-commands.ts |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| validateLoopSetup structural invariant | Rendered prompt must contain BOTH, ORACLE TOO WEAK, AUTH_REQUIRED, do NOT call stop_loop, Failed approaches, replace_tracking_section — a future edit dropping any clause fails validation, not review | requiredSubstrings in src/server/loop-template.ts |
| setup_loop arm-time refusals | Manual worker, already-passing oracle, tracked-file goal mismatch, non-worktree workdir, out-of-range parallelism all reject before the context wipe | src/server/agent.test.ts setupLoop suite |
| Host disarm | Three consecutive failed iterations emit loop_disarmed with reason repeated_failures | deriveLoopState tests in auto-continue/read-model.test.ts |
| Cache safety | getCachedVerify returns null for a null digest; timed-out runs are not cached | src/server/loop-verify-cache.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep trusting the verify exit code and just tell operators to write better oracles | This is precisely what failed: the operator DID hand-check the oracle before arming and still shipped one that passed six stages early. Guidance without a gate is not a fix. |
| On "oracle green, plan non-empty", keep delegating instead of stopping | The loop cannot tell whether the plan is stale or the oracle is weak. Continuing on a green oracle risks an unbounded run against a goal already believed met; stopping costs one human turn and surfaces the real defect. |
| Cache the oracle on a timestamp / TTL instead of a content digest | A TTL cannot distinguish "nothing changed" from "changed twice within the window", and the failure mode is a stale green — the exact bug class. The digest is the only signal that is correct by construction. |
| Let parallelism > 1 infer independent chunks from the plan text | Two workers in one checkout corrupt each other's edits, and independence is a semantic judgement the host cannot verify. Requiring an explicit [parallel] marker plus a named worktree keeps the unsafe case unreachable by default. |
| Add run_verify as a plain uncached passthrough | The double-run is half the wasted wall-clock; a passthrough would have shipped the tool without the benefit that justifies it. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A stale cached PASS lets a broken loop declare victory | Digest covers HEAD + porcelain + size/mtime of every dirty path; a null digest is never cached; timed-out runs are never cached | loop-verify-cache.test.ts null-digest + miss cases; loop-verify-io.adapter.test.ts digest-changes-after-edit cases |
| The arm-time oracle run makes setup_loop slow or hangs the arming turn | Bounded by ARM_VERIFY_TIMEOUT_MS (300s); the runner kills the whole detached process group on deadline | loop-verify-io.adapter.test.ts timeout + process-group kill tests |
| workdir becomes a way to point a loop at an arbitrary directory | isWorktreeOfSameRepo compares --git-common-dir; rejects unrelated repos, non-repos and missing paths | loop-template-io.adapter.test.ts worktree suite |
| Refusing an already-passing oracle blocks a legitimately-finished goal | force: true overrides, and the refusal message names it | agent.test.ts "force: true arms anyway" |
| Existing armed loops replay without verifyCommand / workdirAbs | Both optional on the event and null on LoopState; run_verify refuses and asks for a re-arm rather than guessing a command to execute | read-model.test.ts legacy-event cases |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 4593 pass, 2 skip, 0 fail across 382 files |
| bun run lint | clean at --max-warnings=0 |
| node_modules/typescript-7/bin/tsc --noEmit | 0 errors |
| bunx ast-grep test | 14 passed, 0 failed |
| bun test --conditions production src/server/loop-template.test.ts | 52 pass — includes the plan-vs-oracle gate, file:-on-every-call, manual-trigger refusal, workdir/parallelism, and assertTrackingFileSafe cases |
| bun test --conditions production src/server/loop-verify-io.adapter.test.ts | 14 pass — timeout kill, process-group kill, digest stability and change detection |
