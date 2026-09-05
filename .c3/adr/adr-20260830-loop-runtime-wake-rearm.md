---
id: adr-20260830-loop-runtime-wake-rearm
c3-seal: afaf1b71668f964695ffa4c25846ea4bc1db9d6cbf21614ae17212bb1acbe48b
title: loop-runtime-wake-rearm
type: adr
goal: Stop an ARMED autonomous loop from stalling silently when its own orchestrator turn dies before it can delegate. `recoverArmedLoopWakes` (adr-20260814) already restores a wake lost WITH the server, but nothing restores a wake lost while the server keeps running, so a single transient transport error ends the loop with no observer and no record. Add `handleFailedLoopTurn`, called from the store's turn-terminal observer, and move it plus the boot pass into one module (`src/server/loop-wake-recovery.ts`) so both halves of the wake invariant re-arm through exactly one code path.
status: proposed
date: "2026-08-30"
---

## Goal

Stop an ARMED autonomous loop from stalling silently when its own orchestrator turn dies before it can delegate. `recoverArmedLoopWakes` (adr-20260814) already restores a wake lost WITH the server, but nothing restores a wake lost while the server keeps running, so a single transient transport error ends the loop with no observer and no record. Add `handleFailedLoopTurn`, called from the store's turn-terminal observer, and move it plus the boot pass into one module (`src/server/loop-wake-recovery.ts`) so both halves of the wake invariant re-arm through exactly one code path.

## Context

The notification-driven loop rests on one invariant: an ARMED loop always holds exactly one pending wake — a running subagent, a queued message, or an active turn. Today that invariant is enforced at two moments only: when a background subagent run reaches terminal (`deliverSubagentToMain`, `claude-loop-commands.ts`), and at boot (`recoverArmedLoopWakes`, called once from `server.ts`'s `rehydrateScheduledWork`). It is enforced at no point in the main-orchestrator turn lifecycle.

That gap is reachable and was hit twice in one session. Chat `108b8a13`, forensically confirmed from `~/.kanna/data`: on 2026-08-28 19:04:10 the loop's wake turn ended with `api_error: Unable to connect to API (ENOTFOUND)` and a `result` entry of `subtype: "error"`. The orchestrator never reached `delegate_subagent`, so no subagent existed to deliver, the queue was empty, and the turn was over — the loop sat armed and silent for 16 hours, released only because the server happened to restart and the boot pass fired. On 2026-08-29 11:37:55 the identical failure recurred; with no restart it stalled 55 minutes until the user typed "resume", which disarmed the loop instead of resuming it.

Nothing in the existing machinery covers this. `handleLimitDetection` (`claude-session-error-handler.ts`) is the only path that re-arms a loop from a failed main turn, and it requires a rate-limit or auth detector match; a transport `ENOTFOUND` matches neither and falls through to a bare `recordTurnFailed`. `onTurnTerminal`'s only consumer (`agent-coordinator.ts`) records turn telemetry, then returns early unless the turn carried a `CronRunTag` — it has no loop awareness at all. The host failure backstop cannot see the stall either: `deriveLoopState.consecutiveFailures` is incremented only by `loop_run_outcome`, whose sole emitter is the subagent-delivery path, so `MAX_CONSECUTIVE_LOOP_FAILURES` never trips and the chat goes fully dark rather than reporting a failure. No periodic sweep exists; the armed-idle-empty predicate is evaluated exactly once per process lifetime.

## Decision

Extract the per-chat re-arm that `recoverArmedLoopWakes` performed inline into `rearmLoopWakeIfLost(deps, chatId, reason)`, and move it together with both entry points into a new leaf module `src/server/loop-wake-recovery.ts`. `recoverArmedLoopWakes` becomes a loop over that function with `reason: "server_restart"`; the new `handleFailedLoopTurn(deps, chatId, schedule?)` is the runtime entry with `reason: "orchestrator_turn_failed"`. One re-arm body means the boot and runtime paths cannot drift in what they consider a lost wake.

`handleFailedLoopTurn` is wired into `AgentCoordinator`'s `onTurnTerminal` assignment on `outcome === "failed"` — the one choke point every provider terminal path already funnels through, so no runner is touched and no second call site can be forgotten. It first records the failed iteration as `loop_run_outcome { ok: false, errorCode: "orchestrator_turn_failed" }` so a repeatedly-crashing orchestrator now feeds the existing `MAX_CONSECUTIVE_LOOP_FAILURES` backstop and is disarmed with a visible reason; without that record this fix would convert a silent stall into a silent hot loop. At the cap it calls the existing `disarmFailingLoop` (now exported) instead of re-arming.

The re-arm is deferred through an injectable `RearmScheduler` (default `setTimeout`, unref'd) because `recordTurnFailed` fires the observer BEFORE the runner deletes the `ActiveTurn` and before it drains the queued-message queue, so an immediate re-arm would read a chat that is still busy. The exact delay is uncritical because every guard is re-evaluated at fire time: armed, not busy, no queued message, no live schedule. The live-schedule guard (`deriveChatSchedules(...).liveScheduleId`) is what keeps this off a rate-limited turn that already armed its own resume via `handleLimitDetection`, and it is the same guard that handler uses.

Two asymmetries are deliberate and load-bearing. First, the runtime path additionally skips when the chat has a `running` subagent run (`store.getSubagentRuns`), because a turn that failed AFTER delegating still has its wake held by that run; the boot path must NOT consult it, since a run killed with the server never wrote a terminal event and replays as `running` forever — honouring it there would re-break the exact incident adr-20260814 exists for. Second, `outcome === "cancelled"` is excluded: a cancel is a deliberate human stop, and re-arming would fight the user.

`handleFailedLoopTurn` swallows every error it can raise. It runs from the terminal observer that all turns pass through, so an escape would break the terminal path of turns having nothing to do with a loop.

The module split is not cosmetic: adding this logic to `claude-loop-commands.ts` pushed it from 619 to 743 lines, past the 700-line `MODULE_LINE_THRESHOLD`, which `check:arch` correctly reports as `module_unlisted`. Adding an allowance would grow the oversized-module set #889 exists to shrink, so the new concern gets the module that owns it and `claude-loop-commands.ts` returns to 569.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns LoopState/isLoopArmed, emitAutoContinueEvent, and the deliverSubagentToMain delivery whose loop_run_outcome/disarmFailingLoop backstop this reuses; the new loop-wake-recovery.ts and the onTurnTerminal wiring are dispatch modules this component already owns per adr-20260814's precedent | c3-210#n9248@v1:sha256:4357f6d650059aba4f1624273b4114b7fad8925535deed9952140c789d48e5f8 | Confirm the re-arm never bypasses emitAutoContinueEvent (the single append path), never re-derives busy state from raw maps, and cannot throw into the turn-terminal observer |
| c3-227 | N.A - checked, not modified | Checked because the re-arm emits auto_continue_accepted and reads deriveChatSchedules/deriveLoopState; both reads are pure and the source: "subagent_background" variant is owned by c3-210's emitAutoContinueEvent, not by c3-227's contract, which scopes to auto_continue_scheduled/triggered/cancelled. No file under src/server/auto-continue/** changed | c3-227#n10135@v1:sha256:f7affc2f6d825317e70bae8aa9faf9b19807849a5a39d911e467d871264b9fdd | None required now; re-open if the re-arm ever writes rate-limit/auth scheduling state |
| c3-2 | container | Server container holds the affected component; no responsibility crosses the container boundary | c3-2#n8682@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce | Verify no-delta at container level |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | A new production module (loop-wake-recovery.ts) owes a colocated suite; loop-wake-recovery.test.ts carries 15 cases covering both entry points, every guard, the boot/runtime subagent-guard asymmetry, and the never-throws contract. Shared LoopCommandDeps fakes moved to src/server/test-helpers/loop-command-fakes.ts so the two suites cannot assert the invariant differently | rule-colocated-bun-test#n11234@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Alternatives Considered

| Alternative | Why rejected |
| --- | --- |
| Widen detectFromResultText so transport errors reach handleLimitDetection | That handler's job is provider rate-limit/auth rotation — it marks tokens limited and schedules at a reset timestamp. An ENOTFOUND has no reset time and no token to blame, so it would fabricate a rotation for a network blip |
| A periodic sweep calling recoverArmedLoopWakes on a timer | Polls every armed chat forever to catch a rare event, and its latency is the poll interval. The terminal observer already knows the exact moment a wake can be lost. Still worth adding later as defence in depth for paths nobody enumerated — it is idempotent — but it is not the primary fix |
| Re-arm directly inside claude-session-runner.ts's failure branches | There are five terminal paths across the SDK, Codex/PTY runners and the turn starter; each would need the call, and a sixth added later would silently miss it. onTurnTerminal is the single choke point they all already funnel through |
| Re-arm synchronously in the observer | recordTurnFailed fires the observer before activeTurns.delete and before the queued-message drain, so isChatBusy still reports busy and the queue still looks empty — the guards would read a state that is about to change |
| Add a MODULE_ALLOWANCES entry for the grown claude-loop-commands.ts | Pins are defect counts; raising one records that the PR made #889 worse. The wake invariant is a cohesive concern and a module of its own is the honest home |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/loop-wake-recovery.test.ts | 15 pass. Includes the RED-first case: an armed loop whose orchestrator turn failed re-arms exactly one auto_continue_accepted carrying the full loop prompt, plus loop_run_outcome {ok:false} |
| bun test --conditions production src/server/claude-loop-commands.test.ts | 13 pass; module-surface test updated to pin disarmFailingLoop as exported and to drop the moved recoverArmedLoopWakes |
| bun test --conditions production src/server/agent.turn-duration-metric.test.ts | 3 pass; the terminal-observer fake gains getAutoContinueEvents so the loop branch is exercised as a real no-op rather than an exception |
| bun run test | 7299 pass / 2 skip / 0 fail across 550 files |
| bun run typecheck && bun run lint && bun run lint:usestate | All clean (lint at --max-warnings=0) |
| bun run check:arch | 44 pass. claude-loop-commands.ts 619 → 569 (under the 700 threshold, still unlisted); agent-coordinator.ts stays exactly at its 1483 allowance |
| bun run build | Exits 0 |
