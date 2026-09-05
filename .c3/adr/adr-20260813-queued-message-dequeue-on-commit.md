---
id: adr-20260813-queued-message-dequeue-on-commit
c3-seal: 850245c7e6bde8f3ebde8da0dccc4a4b45c6a4fd56569c6b8afeb2096a943cc9
title: queued-message-dequeue-on-commit
type: adr
goal: Stop a queued message — a chat's only durable "start this once idle" trigger, and for an autonomous loop its ONLY wake trigger — from being lost when the Kanna server dies between dequeuing the message and the turn it starts becoming durable. Move the removal of a queued message from `dequeueAndStartQueuedMessage`'s first statement to a callback (`StartTurnForChatArgs.onTurnRecorded`) fired the instant `recordTurnStarted` makes the turn replayable from the event log; add a boot-time recovery pass (`recoverQueuedMessages`) that restarts any chat still holding a queued message after a crash, since nothing previously drained the queue on boot; and make the restart idempotent (`isPromptAlreadyAppended`) so a turn that appended its prompt and then died is not double-appended on replay.
status: accepted
date: "2026-08-13"
---

# queued-message-dequeue-on-commit

## Goal

Stop a queued message — a chat's only durable "start this once idle" trigger, and for an autonomous loop its ONLY wake trigger — from being lost when the Kanna server dies between dequeuing the message and the turn it starts becoming durable. Move the removal of a queued message from `dequeueAndStartQueuedMessage`'s first statement to a callback (`StartTurnForChatArgs.onTurnRecorded`) fired the instant `recordTurnStarted` makes the turn replayable from the event log; add a boot-time recovery pass (`recoverQueuedMessages`) that restarts any chat still holding a queued message after a crash, since nothing previously drained the queue on boot; and make the restart idempotent (`isPromptAlreadyAppended`) so a turn that appended its prompt and then died is not double-appended on replay.

## Context

Chat `c87ab0ad-0691-4605-a854-59d2eb1f4b3a` ran an autonomous loop that died silently; the user had to type "Resume" 2.5 hours later. Forensics from `~/.kanna/data`: at 17:55:23.9 a background subagent completed — `deliverSubagentToMain` emitted `loop_run_outcome ok=true`, wiped the session token, appended `context_cleared`, then `auto_continue_accepted` and `auto_continue_fired` (17:55:23.925). `fireAutoContinue` → `enqueueMessage` (writes only a queued-message record, no transcript entry) → `maybeStartNextQueuedMessage` → chat not busy → `dequeueAndStartQueuedMessage`, which removed the queued message as its FIRST statement and then called `startTurnForChat`, which appended the orchestrator `user_prompt` at 17:55:24.035 — 110 ms later. pm2 restarted the kanna process at 17:55:23.882 (`pm2 describe kanna`: `created at: 2026-08-13T10:55:23.882Z`, `restarts: 10`, `max memory restart: 1 GB`), confirmed process-wide — all four live chats froze in the same ~600 ms window, one never resumed at all. The turn died before `recordTurnStarted`: no `turn_started` in `turns.jsonl`, no `account_info`, no `system_init` in the transcript. On boot, the loop was still ARMED (no `loop_disarmed` event anywhere), the queued message was already gone (removed before the crash), `scheduleManager.rehydrate` only re-arms schedules in state `"scheduled"` (this one was already `"fired"`), and nothing on boot drained the queued-message queue — so the loop had no trigger left and stalled silently until manual intervention.

The affected surface is the generic turn-start / message-queue path that every provider and every wake source shares (`src/server/claude-turn-starter.ts`, `src/server/claude-send-command.ts`) — owned by c3-210 (agent-coordinator), which per its Foundational/Business Flow already routes builtin dispatch, background-run delivery, and armed-loop wakes through this exact `dequeueAndStartQueuedMessage` entry point. The queued-message index needed for boot recovery had to be read from the event-store's replayed in-memory state (c3-206), and the recovery pass had to run at process boot (c3-202's `server.ts`) without delaying the HTTP/WS listener.

## Decision

`StartTurnForChatArgs` gains an optional `onTurnRecorded?: () => Promise<void>`, awaited in `claude-turn-starter.ts` immediately after `recordTurnStarted` — the exact point the turn becomes replayable from the event log (`ref-event-sourcing`: state mutations are events first, everything else follows). `dequeueAndStartQueuedMessage` (`claude-send-command.ts`) no longer removes the queued message up front; it builds a `release` closure over `store.removeQueuedMessage` and passes it as `onTurnRecorded`. `runBuiltinCommand` gained a matching optional `onCommitted` parameter so `/clear` releases right after the context wipe (which has no `turn_started` event of its own) and `/compact` releases at its own turn record, keeping both builtin and normal-turn paths on the same commit-triggered release. `isPromptAlreadyAppended(messages, queuedMessage)` — a new pure export — returns true only when the TRAILING transcript entry is the exact `user_prompt` this queued message would append (identity = the durable `autoContinue.scheduleId` when present, else exact content); `dequeueAndStartQueuedMessage` passes `appendUserPrompt: false` when it returns true, so a crashed-then-recovered turn does not double-append. `EventStore.listChatsWithQueuedMessages()` is a new read of already-replayed in-memory state — no new event kind, no JSONL shape change. `queued-message-recovery.ts` (`recoverQueuedMessages`) sequentially drains every chat that query returns through the SAME `maybeStartNextQueuedMessage` → `dequeueAndStartQueuedMessage` path a live wake uses, swallowing and logging a per-chat failure so one bad chat can never abort boot; `server.ts` calls it detached (`void … .then(...)`) immediately after `rehydrateLoopTracking`, so recovery never blocks the HTTP/WS listener from coming up.

This wins over the rejected alternatives (below) because it closes the crash window at its actual boundary — durability, not elapsed time or turn completion — while keeping the fix inside the single component (c3-210) that already owns every queued-message dispatch path, and needs no new event schema. The accepted residual: a crash between `recordTurnStarted` and the provider spawn still loses the wake — two adjacent store writes, down from the entire spawn (which can run seconds on a slow MCP boot).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns the turn-start/dequeue path this ADR changes: StartTurnForChatArgs.onTurnRecorded (claude-turn-starter.ts) fires the instant turn_started is durable; dequeueAndStartQueuedMessage and runBuiltinCommand (claude-send-command.ts) release the queued message there instead of up front; isPromptAlreadyAppended makes replay idempotent; the new queued-message-recovery.ts restarts turns for chats that crashed mid-spawn through this same component's maybeStartNextQueuedMessage entry point | c3-210#n8973@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | Confirm every caller of startTurnForChat that holds a queued message threads onTurnRecorded, and that dequeueAndStartQueuedMessage remains the ONLY place a queued message is removed |
| c3-206 | component | EventStore.listChatsWithQueuedMessages() is the new query boot recovery reads to find every chat whose queued-message trigger survived the crash; it is a read over already-replayed in-memory state (state.queuedMessagesByChatId), no new event kind or JSONL shape | c3-206#n8758@v1:sha256:e04d56e73404382bba111d31d12fd30ce75cd0fa5acbb6ba5811a68709533460 | Confirm the query adds no new persisted shape and stays consistent with replay-then-derive |
| c3-202 | component | server.ts's boot sequence calls recoverQueuedMessages detached, right after rehydrateLoopTracking, so a queued message that survived the crash (loop or user) restarts without delaying the HTTP/WS listener | c3-202#n8562@v1:sha256:2e868029505a294cb79ac3750f443e489fdca9fb37d30d865fbfc0e47ac582e0 | Confirm the call stays detached (void … .then) and a per-chat recovery failure can neither block nor crash boot |
| c3-2 | container | Server container holds all three components above; no responsibility moves across the container boundary, every change is internal to c3-210/c3-206/c3-202's own modules | c3-2#n8467@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce | Verify no-delta at container level |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | The whole fix is choosing the event-sourcing boundary — recordTurnStarted's append — as the release point, instead of an arbitrary earlier or later moment; onTurnRecorded fires exactly where the mutation becomes the durable fact derivations replay from | ref-event-sourcing#n10626@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | New module queued-message-recovery.ts ships queued-message-recovery.test.ts beside it (4 tests); the touched module's existing colocated suite (claude-send-command.test.ts) gained the commit-ordering, replay-idempotency, and throw-keeps-queued cases | rule-colocated-bun-test#n10895@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Commit hook | StartTurnForChatArgs.onTurnRecorded?: () => Promise<void>, awaited immediately after recordTurnStarted | src/server/claude-turn-starter.ts |
| Dequeue-on-commit | dequeueAndStartQueuedMessage builds a release closure over store.removeQueuedMessage instead of calling it up front; passes it as onTurnRecorded | src/server/claude-send-command.ts |
| Builtin release parity | runBuiltinCommand gained onCommitted?: () => Promise<void>; /clear releases after deps.clearChatContext, /compact releases via the normal onTurnRecorded wiring | src/server/claude-send-command.ts |
| Replay idempotency | New exported pure fn isPromptAlreadyAppended(messages, queuedMessage); dequeueAndStartQueuedMessage passes appendUserPrompt: !isRateLimitFallback && !alreadyAppended, skipped for steered messages | src/server/claude-send-command.ts |
| Boot-recovery index | EventStore.listChatsWithQueuedMessages() | src/server/event-store.ts |
| Boot-recovery module | New recoverQueuedMessages(deps): sequential drain, per-chat catch + log, never fatal to boot | src/server/queued-message-recovery.ts |
| Boot wiring | startKannaServer calls recoverQueuedMessages detached, right after rehydrateLoopTracking | src/server/server.ts |
| Docs | New CLAUDE.md section "Queued messages are released on commit, not on dequeue" naming this ADR | CLAUDE.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| claude-send-command.test.ts | "removes the message once the turn reaches its durable commit point"; "keeps the message queued when the turn dies before recording"; "does not re-append a prompt a crashed turn already wrote"; "appends the prompt when the trailing entry is not that prompt"; "keeps the message queued when starting the turn throws" | bun test --conditions production src/server/claude-send-command.test.ts |
| queued-message-recovery.test.ts | "restarts every chat left holding a queued message"; "does nothing when no chat has a queued message"; "reports only chats that actually started"; "one failing chat does not abort the rest of boot" | bun test --conditions production src/server/queued-message-recovery.test.ts |
| Full suite + typecheck + lint | Whole-repo regression gate before any push, per this repo's CLAUDE.md | bun run test; bun run typecheck; bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the eager dequeue and add a boot heuristic that re-enqueues any chat whose last transcript entry is an unanswered user_prompt | A heuristic, not a durability guarantee — it infers intent from transcript shape instead of the event that actually recorded the turn, and it would re-fire turns for ordinary chats a user deliberately abandoned mid-prompt, which is indistinguishable from a crash under that heuristic |
| Release the queued message only after the whole turn finishes | A crash mid-turn (after recordTurnStarted, before the result) would then re-run work the turn already completed on restart — trades the narrow pre-commit crash window for a much wider mid-turn one |
| Persist the appended entry id onto the queued-message record for idempotency | Needs a new event/schema field for a case isPromptAlreadyAppended's trailing-entry check already decides exactly, from data already in the transcript — no new persisted shape earns its keep here |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A crash between recordTurnStarted and the provider spawn still loses the wake (accepted residual) | Narrowed from the entire spawn (seconds on a slow MCP boot) to two adjacent store writes; not closed further because closing it needs the spawn itself to become transactional with the event append, out of scope for this fix | Documented in CLAUDE.md and this ADR's Decision section as an explicit accepted residual, not a silent gap |
| Boot-time recovery spawning provider sessions for every surviving chat delays server startup | recoverQueuedMessages runs detached (void … .then) after the listener-critical boot steps, and drains sequentially rather than fanning out, so it can never block /health coming up | src/server/server.ts (detached call site); queued-message-recovery.test.ts sequential-drain coverage |
| A chat that repeatedly fails to start (bad provider config, deleted project) blocks recovery for every chat after it in the boot loop | recoverQueuedMessages catches and logs per-chat, continuing the loop — never propagates | queued-message-recovery.test.ts: "one failing chat does not abort the rest of boot" |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/claude-send-command.test.ts | 47 pass, 0 fail |
| bun test --conditions production src/server/queued-message-recovery.test.ts | 4 pass, 0 fail |
| bun run test | 5791 pass, 2 skip, 0 fail across 475 files |
| bun run typecheck | clean |
| bun run lint | clean at --max-warnings=0 |
