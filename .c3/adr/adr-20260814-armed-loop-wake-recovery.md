---
id: adr-20260814-armed-loop-wake-recovery
c3-seal: f2ab0c691097459fb4c02684a3f3ef1a4104144cd0920339d790a8d84404b2e6
title: armed-loop-wake-recovery
type: adr
goal: 'Stop an ARMED autonomous loop from stalling silently forever when its wake dies with the server — either the background subagent run was still in flight when the process was killed, or the run finished but its delivery in `deliverSubagentToMain` (four non-atomic writes: `loop_run_outcome` → session-token wipe → `context_cleared` → `auto_continue_accepted`) was cut mid-write. Add `recoverArmedLoopWakes(deps)` (`src/server/claude-loop-commands.ts`), run once at boot immediately after `recoverQueuedMessages`: for every chat with an armed `LoopState` that is neither busy nor holding a queued message, re-emit the loop wake from the durable `LoopState.prompt` instead of leaving the loop waiting for a trigger that will never arrive.'
status: proposed
date: "2026-08-14"
---

# armed-loop-wake-recovery

## Goal

Stop an ARMED autonomous loop from stalling silently forever when its wake dies with the server — either the background subagent run was still in flight when the process was killed, or the run finished but its delivery in `deliverSubagentToMain` (four non-atomic writes: `loop_run_outcome` → session-token wipe → `context_cleared` → `auto_continue_accepted`) was cut mid-write. Add `recoverArmedLoopWakes(deps)` (`src/server/claude-loop-commands.ts`), run once at boot immediately after `recoverQueuedMessages`: for every chat with an armed `LoopState` that is neither busy nor holding a queued message, re-emit the loop wake from the durable `LoopState.prompt` instead of leaving the loop waiting for a trigger that will never arrive.

## Context

`adr-20260813-queued-message-dequeue-on-commit` (merged) recovers a wake that reached the queued-message queue: `recoverQueuedMessages` restarts any chat whose queued message survives a crash. It does not cover a wake that dies EARLIER — before `fireAutoContinue`/`enqueueMessage` ever wrote a queued-message record — because at that point the loop's only pending trigger is a background subagent process, and no subagent survives the server process that spawned it.

Two real incidents, both forensically confirmed from `~/.kanna/data` + `~/.pm2/pm2.log`:

- Chat `c87ab0ad`, 2026-08-13 09:31 — pm2's 1 GB memory cap killed the server while background run `fc17bee6` was seven minutes into its work. No `loop_run_outcome` was ever written, so no wake was ever attempted. The loop stayed armed and silent until the user manually typed "resume".
- Chat `5cea83a7`, 2026-08-14 18:40:13 — pm2's 2 GB cap (RAM at 2.43 GB) killed the server 118 ms after `loop_run_outcome` was appended and before `auto_continue_accepted` was emitted. The transcript snapshot at 18:40:15.563 proves the event sequence for that delivery stops at `loop_run_outcome` — `deliverSubagentToMain`'s four writes are not transactional, so a kill anywhere inside them leaves the loop mid-delivery with the same silent-stall outcome as incident 1.

`isLoopArmed`/`LoopState` (armed-loop state), `deliverSubagentToMain` (the delivery this ADR's incidents interrupt), and `emitAutoContinueEvent` (the single append path for auto-continue events, which also reconciles the loop-tracking watch via `syncLoopTracking`) are all owned by c3-210 (agent-coordinator) — confirmed by its Contract table. `src/server/claude-loop-commands.ts`, `src/server/claude-turn-starter.ts`, `src/server/claude-autocontinue-commands.ts`, and `src/server/agent-deps-builders.ts` sit outside the `code-map.yaml` globs that literally list c3-210's files, but the predecessor ADR (`adr-20260813-queued-message-dequeue-on-commit`) already established the same judgment for the sibling files `claude-turn-starter.ts` and `claude-send-command.ts`: they are dispatch modules for the turn-lifecycle component c3-210 already owns per its Foundational/Business Flow, not independent components. This ADR follows that precedent for the same reason — `claude-loop-commands.ts` implements `AgentCoordinator`'s loop methods and is invoked only through `AgentCoordinator`.

c3-227 (auto-continue) was checked because the recovery emits an `auto_continue_accepted` event. It is NOT structurally affected: c3-227's Contract table scopes its owned event kinds to `auto_continue_scheduled` / `auto_continue_triggered` / `auto_continue_cancelled` (the provider rate-limit/auth-error retry family), and its file ownership in `code-map.yaml` is `src/server/auto-continue/**/*.ts` only. The `auto_continue_accepted` variant this ADR reuses (`source: "subagent_background"`) is the notification-driven loop-wake variant already owned by c3-210's `emitAutoContinueEvent`, established by `adr-20260711-notification-driven-loop-orchestration` and `adr-20260712-loop-orchestration-hardening`. This ADR adds no new event kind and touches no file under `src/server/auto-continue/**`.

## Decision

`recoverArmedLoopWakes(deps: LoopCommandDeps)` iterates `deps.store.listAutoContinueChats()` (every chat that has ever recorded an auto-continue event — the armed-loop candidate set) and, per chat: skip unless `isLoopArmed(chatId)` returns a `LoopState`; skip if `isChatBusy(chatId)` is true; skip if `getQueuedMessages(chatId)` is non-empty. A chat that clears all three checks is provably stuck — armed, not currently doing anything, and with no queued trigger — because at boot no subagent process survives the dead server. For that chat the function replays the same re-entry sequence `deliverSubagentToMain` uses on a normal wake: `clearClaudeSessionContext`, append `context_cleared`, then `emitAutoContinueEvent` with `kind: "auto_continue_accepted"`, `source: "subagent_background"`, and a prompt that is a one-paragraph restart notice prepended to the durable `LoopState.prompt`. Recovery is idempotent by construction — the re-emitted prompt drives the orchestrator to re-read the tracking file and re-delegate whatever the plan still lists, so a partially-completed prior run costs at most a redundant read, never a redundant write. Each chat is wrapped in its own try/catch (mirrors `recoverQueuedMessages`): one chat's failure is logged and skipped, never fatal to boot.

`LoopCommandStore` gains `listAutoContinueChats()` and `getQueuedMessages()`. `LoopCommandDeps` gains a REQUIRED `isChatBusy(chatId): boolean`, wired in `agent-deps-builders.ts` to the existing single-source `isChatBusy` predicate from `claude-session-state-queries.ts` — never re-derived from raw turn/slot maps, per the discipline CLAUDE.md's pending-tool section already documents for that predicate. `AgentCoordinator.recoverArmedLoopWakes()` is a one-line delegation through `buildLoopCommandDeps()`, matching the existing `deliverSubagentToMain` wrapper shape. `server.ts`'s boot sequence calls it inside the SAME detached `.then()` as `recoverQueuedMessages`, immediately AFTER the queue drain completes — a chat whose wake survived to the queue is busy (mid-turn) or still queued by the time the armed-loop pass runs, so the two recovery passes cannot double-fire the same chat. `kanna.loop.wake.recovered` (a counter from the sibling observability ADR) is incremented per recovered chat so a recurring OOM shows up as a metric, not only a log line.

This wins over the alternatives below because it reuses the exact invariant the notification-driven loop design already relies on — an armed loop always holds exactly one pending wake (running subagent, queued message, or active turn) — and closes the gap with a boot-time read of existing state, no new persisted shape and no change to `deliverSubagentToMain`'s event contract.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns `LoopState`/`isLoopArmed`, `deliverSubagentToMain`, and `emitAutoContinueEvent` — the exact mechanisms `recoverArmedLoopWakes` reuses to re-emit a lost wake; the new function and its `AgentCoordinator` wrapper live in files this component's own predecessor ADR already treats as its dispatch modules | c3-210#n9248@v1:sha256:4357f6d650059aba4f1624273b4114b7fad8925535deed9952140c789d48e5f8 | Confirm `recoverArmedLoopWakes` never bypasses `emitAutoContinueEvent` (the single append path) and never re-derives busy state from raw maps |
| c3-227 | N.A - checked, not modified | Checked because the recovery emits an `auto_continue_accepted` event; verified this variant (`source: "subagent_background"`) is owned by c3-210's `emitAutoContinueEvent`, not by c3-227's contract, which scopes to `auto_continue_scheduled`/`triggered`/`cancelled` only. No file under `src/server/auto-continue/**` changed | c3-227#n10135@v1:sha256:f7affc2f6d825317e70bae8aa9faf9b19807849a5a39d911e467d871264b9fdd | None required now; if a future change makes recovery interact with rate-limit/auth-error scheduling, re-open this row |
| c3-202 | component | `server.ts`'s boot sequence (already the site of `recoverQueuedMessages`) gains the chained `agent.recoverArmedLoopWakes()` call inside the same detached promise, after the existing recovered-count log | c3-202#n8814@v1:sha256:a3750b4ea10f5bf4a6b08aced506a309d6cfe4e64d128321787fa59a34fa7172 | Confirm the call stays detached and sequenced AFTER the queue drain, never blocking `/health` |
| c3-2 | container | Server container holds all three components above; no responsibility crosses the container boundary | c3-2#n8682@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce | Verify no-delta at container level |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | The recovered wake is released through the same append-first path (`emitAutoContinueEvent`) every other wake source uses; recovery reads only already-replayed in-memory state (`listAutoContinueChats`, `isLoopArmed`, `getQueuedMessages`) and adds no new persisted shape | ref-event-sourcing#n10965@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | 5 new cases added to the existing colocated `claude-loop-commands.test.ts` (re-arm, disarmed skip, queued-survivor skip, busy skip, per-chat failure isolation); no new module, so no new test file is owed | rule-colocated-bun-test#n11234@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Recovery function | New `recoverArmedLoopWakes(deps)`: per-chat armed+idle+empty-queue check, re-entry via `clearClaudeSessionContext` + `context_cleared` + `emitAutoContinueEvent`, try/catch per chat | src/server/claude-loop-commands.ts |
| Store surface | `LoopCommandStore.listAutoContinueChats()` + `getQueuedMessages()` | src/server/claude-loop-commands.ts |
| Deps surface | `LoopCommandDeps.isChatBusy(chatId)` (required) | src/server/claude-loop-commands.ts |
| Wiring | `isChatBusy` wired to the single `isChatBusy` predicate from claude-session-state-queries, never re-derived | src/server/agent-deps-builders.ts |
| Coordinator wrapper | `AgentCoordinator.recoverArmedLoopWakes()` delegates via `buildLoopCommandDeps()` | src/server/agent-coordinator.ts |
| Boot wiring | Chained after `recoverQueuedMessages` inside the same detached `.then()` | src/server/server.ts |
| Tests | 5 new cases + module-surface pin updated | src/server/claude-loop-commands.test.ts |
| Docs | CLAUDE.md's "Queued messages are released on commit, not on dequeue" section extended with the recovery's invariant and boot-ordering rationale, and now cites this ADR | CLAUDE.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| claude-loop-commands.test.ts | `describe("recoverArmedLoopWakes")`: "re-emits the wake for an armed chat left with nothing to wake it"; "does nothing for a chat with no armed loop"; "leaves a chat whose queued message survived to the queue recovery"; "leaves a chat that is already busy"; plus a per-chat failure-isolation case | bun test --conditions production src/server/claude-loop-commands.test.ts |
| module surface pin | The `describe("module surface")` exported-names list was updated to include `recoverArmedLoopWakes`, so an export dropped by a future refactor fails this test immediately | src/server/claude-loop-commands.test.ts |
| Full suite + typecheck + lint | Whole-repo regression gate before any push, per this repo's CLAUDE.md | bun run test; bun run typecheck; bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Persist the wake BEFORE the run completes (a durable pending-wake record written at delegation time) | Requires a new event/schema shape and a second source of truth for "this loop has pending work" — the existing armed-state (`LoopState`) + queue (`QueuedMessage`) + busy (`isChatBusy`) triple already encodes exactly that fact from data already replayed at boot |
| Make `deliverSubagentToMain`'s four writes atomic (combine into a single event) | Would change the `AutoContinueEvent` shape every existing install's event log already contains, and every consumer that folds these events (`deriveLoopState`, `deriveChatSchedules`) would need to handle both the old and new shape during replay — a much larger blast radius than a boot-time idempotent re-emit |
| Detect via "a trailing `loop_run_outcome` with no following `auto_continue_accepted`" | Covers incident 2 (mid-delivery kill) but NOT incident 1 (the run died before any `loop_run_outcome` was ever written — there is no trailing event to detect). The armed+idle+empty-queue check covers both incidents with one condition because it does not depend on how far the failed delivery got |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Recovery double-fires a wake that is still legitimately in flight (race with a subagent that resumes after restart) | No subagent process survives the server that spawned it, so "in flight" cannot outlive the crash; the `isChatBusy`/empty-queue checks additionally cover the case where a NEW turn or queued wake already exists by the time recovery runs (sequenced after `recoverQueuedMessages`) | claude-loop-commands.test.ts: "leaves a chat that is already busy"; "leaves a chat whose queued message survived to the queue recovery" |
| Re-injecting the loop prompt re-does work a partially-finished subagent run already completed but never recorded | Recovery does not resend the original delegation — it hands the orchestrator a restart notice plus the durable `LoopState.prompt`, which re-reads the tracking file; only work the plan still lists gets re-delegated (same idempotency the notification-driven loop design already relies on for every ordinary wake) | claude-loop-commands.test.ts: prompt assertion `expect(event.prompt).toContain("restart")` plus the existing `## Next chunk` re-read discipline documented in CLAUDE.md's loop-oracle sections |
| A chat that repeatedly fails to recover blocks recovery for chats after it in the boot loop | Per-chat try/catch logs and continues, mirroring `recoverQueuedMessages`'s existing isolation | Code inspection of the per-chat `try`/`catch` in `recoverArmedLoopWakes`; no dedicated test was required beyond the existing pattern this mirrors |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/claude-loop-commands.test.ts | 18 pass, 0 fail |
| bun run test | 5818 pass, 2 skip, 0 fail across 477 files (two consecutive clean runs; one earlier run had a single unreproduced flake, noted honestly rather than hidden) |
| bun run typecheck | clean |
| bun run lint | clean at --max-warnings=0 |
