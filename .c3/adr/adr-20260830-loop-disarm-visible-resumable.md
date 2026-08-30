---
id: adr-20260830-loop-disarm-visible-resumable
c3-seal: c6ad36d9d9bae865f699618e3048292c5faffad6d61822686775dffc8d34896d
title: loop-disarm-visible-resumable
type: adr
goal: 'Make disarming an autonomous loop observable and undoable. A real user `chat.send` disarms any armed loop as a takeover, and that happened with no transcript entry, no UI signal, and no way back: compaction then erased the `loop_armed` event carrying the loop''s spec, so re-arming meant restating goal, oracle, workdir and tracking file to `setup_loop` from scratch. Retain the arm/disarm pair as a tombstone, append a `loop_disarmed` transcript card, add a `resume_loop` MCP tool that re-arms from the tombstone, and stop gating the rate-limit resume affordance on the loop still being armed.'
status: proposed
date: "2026-08-30"
---

## Goal

Make disarming an autonomous loop observable and undoable. A real user `chat.send` disarms any armed loop as a takeover, and that happened with no transcript entry, no UI signal, and no way back: compaction then erased the `loop_armed` event carrying the loop's spec, so re-arming meant restating goal, oracle, workdir and tracking file to `setup_loop` from scratch. Retain the arm/disarm pair as a tombstone, append a `loop_disarmed` transcript card, add a `resume_loop` MCP tool that re-arms from the tombstone, and stop gating the rate-limit resume affordance on the loop still being armed.

## Context

`claude-send-command.ts` calls `stopLoop(chatId, "user_send")` unconditionally on every user send, before the chat-exists check and before the busy/queue branch. The intent is right — a user message is a takeover — but the execution was invisible and irreversible.

Invisible: `stopLoop` appended the `loop_disarmed` auto-continue event and nothing else. There is no `loop_disarmed` transcript entry and no client surface mentioning loops outside `LoopProgressSection`, so the only signal was the pulsing "Loop running" pill disappearing while the Progress panel stayed put — which reads as the loop being between chunks. Contrast `disarmFailingLoop`, which deliberately appends `context_cleared` and fires a wake carrying the failure reason precisely "so the failure surfaces in the transcript rather than the chat simply going quiet".

Irreversible: `compactLoopWakeEvents` runs on every auto-continue append, and its disarmed branch dropped every `loop_armed` / `loop_disarmed` / `loop_run_outcome` for the chat. `loop_armed` is the sole carrier of `subagentId`, the rendered `prompt`, `verifyCommand`, `workdirAbs` and `trackingFileRel`. Because the loop design deliberately keeps main stateless-in-context (`/clear` on every wake), neither the host nor the model could reconstruct the spec after that. There is no `resume_loop`, no paused state, and no analogue of cron's first-class `cron_paused` / `cron_resumed`.

Compounding both: `deriveChatSnapshot` gated `rateLimit` on `loopState &&`. A loop parked on a usage limit is the single most likely moment for a user to type "resume" — and that send nulled `loopState`, which nulled `rateLimit`, which un-rendered the "Resume now" button in `LoopProgressSection`. The attempt to resume destroyed the resume affordance.

Observed in chat `108b8a13`: after a transport error stalled the loop (see adr-20260830-loop-runtime-wake-rearm), the user typed "resume", the loop disarmed silently, the spec was erased, and every subsequent background delivery fell into the un-armed branch.

## Decision

Four changes, each closing one half of the trap.

**Retain the arm/disarm PAIR as a tombstone.** `compactLoopWakeEvents`'s disarmed branch now skips `lastArmIndex` and `lastDisarmIndex`. Both halves or neither: keeping the arm alone replays through `deriveLoopState` as a still-ARMED loop, silently re-arming a loop the user stopped — an existing test ("deriveLoopState returns null after disarmed-loop compaction") caught exactly that during implementation. Retaining two events per chat is bounded; the waste this module exists to reclaim is the same multi-KB prompt re-embedded on every WAKE, not one tombstone.

**Read the tombstone through a second, explicitly-named projection.** `deriveLastLoopSpec(events, chatId)` returns the arm-time facts of the chat's most recent loop, armed or not, as `LoopSpec = Omit<LoopState, "consecutiveFailures">`. `deriveLoopState` keeps answering "is a loop running right now" and keeps returning null after a disarm; this answers the different question "what loop did this chat last run". A chat with no tombstone yields null and callers degrade rather than guess.

**Append a `loop_disarmed` transcript entry.** New `LoopDisarmedEntry` carrying `reason`, `resumable`, and the optional `trackingFileRel` / `workdirAbs`, rendered by `LoopDisarmedMessage`. `stopLoop` writes it for `goal_met` and `user_send`; `disarmFailingLoop` writes it for `repeated_failures`. `chat_deleted` is skipped — there is no transcript left to read it in. The append is wrapped: the durable disarm has already landed, so losing the card costs visibility, while throwing would fail the user's send.

**Add `resume_loop`.** It re-arms from the tombstone rather than re-validating, because the spec already passed `setup_loop`'s gates when first armed and re-running them would refuse a loop whose oracle now passes — the very state a resume is for. `consecutiveFailures` resets, matching `deriveLoopState`'s own reset at every `loop_armed`: a resume is a deliberate decision to try again, so the previous streak is spent. It then calls the shared `rearmLoopWakeIfLost`, since arming alone starts nothing. Idempotent: an already-armed chat is refused, not double-armed. Registered under the same main-chat gating as `setup_loop` / `stop_loop` (`depth === 0`) — a subagent must not leave a loop armed behind it.

**Ungate `rateLimit` from `loopState`**, and keep the Progress panel mounted while a rate-limit is live even with no rows, so the "Resume now" action outlives the disarm.

Rejected: making `user_send` pause instead of disarm. The tool-blocking semantics (`LOOP_BLOCKED_NATIVE_TOOLS` filtered at spawn) are binary and respawn on the armed flip; a third state would have to answer whether a paused loop blocks Edit/Write, and every consumer of `isLoopArmed` would need auditing. Retaining the spec buys the same reversibility without a new state in the event model.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns `stopLoop` / `disarmFailingLoop` / `isLoopArmed` and the loop MCP surface; gains the disarm card append, `resumeLoop`, and the `resume_loop` threading through both drivers' spawn args | c3-210#n9248@v1:sha256:4357f6d650059aba4f1624273b4114b7fad8925535deed9952140c789d48e5f8 | Confirm the card append cannot fail a user send, and that `resume_loop` stays gated to depth 0 like `setup_loop` |
| c3-227 | component | `compactLoopWakeEvents` retention widened to keep the arm/disarm tombstone, and `deriveLastLoopSpec` added beside `deriveLoopState` — both files under `src/server/auto-continue/**`, which this component owns | c3-227#n10135@v1:sha256:f7affc2f6d825317e70bae8aa9faf9b19807849a5a39d911e467d871264b9fdd | Confirm both tombstone halves are retained together, and that `deriveLoopState` still returns null after a disarm |
| c3-207 | component | `deriveChatSnapshot` stops gating `rateLimit` on `loopState`, so a live usage-limit schedule reaches the client after a disarm | c3-207#n6530@v1:sha256:fcde78a59ac52af675e32b8beffd96f801400deee2a39a336bba00bef3382138 | Confirm read-model purity and that no other consumer relied on the loop-armed coupling |
| c3-112 | component | Chat transcript renders the new `loop_disarmed` card, and the Progress panel stays mounted for a live rate-limit with no rows | c3-112#n9385@v1:sha256:c7c8905039eb5b78ce4fe192f422d7dfe3ab9cda3da6799881f0549a3af1facb | Confirm design-token compliance (no hex, no native `title`) and no render-loop regression |
| c3-2 | container | Server container holds the affected server components; no responsibility crosses the container boundary | c3-2#n8682@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce | Verify no-delta at container level |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | New client component gets `LoopDisarmedMessage.test.tsx` (10 cases, `renderToStaticMarkup` so no React root is mounted); the new `resumeLoop` and the disarm card are covered in the existing colocated `loop-wake-recovery.test.ts` and `claude-loop-commands.test.ts`; the retention change rewrites the compaction test that pinned the old erase-everything behaviour | rule-colocated-bun-test#n11234@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Alternatives Considered

| Alternative | Why rejected |
| --- | --- |
| Stop disarming on user send | The takeover is correct: an armed loop blocks Edit/Write/Task at spawn, so a user asking for a manual change while armed would silently get a crippled agent |
| Keep erasing the spec; have the user re-run `setup_loop` | That is the current behaviour and it is what failed. It requires the user to remember four values the host already had, and `setup_loop` then refuses a passing oracle or a git-tracked plan without `force` |
| Add a paused loop state (`loop_paused` / `loop_resumed`, mirroring cron) | Larger event-model change whose only extra benefit over a retained tombstone is naming; tool-blocking is binary, so a paused state forces a policy decision on every `isLoopArmed` consumer |
| Render the disarm as a `status` entry instead of a new kind | `status` is the background-task activity line; overloading it would make the disarm unstyleable and unsearchable, and the cron precedent (`cron_job_change`) is a dedicated kind |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/auto-continue/ | 88 pass. Tombstone retained as a PAIR; the pre-existing "deriveLoopState returns null after disarmed-loop compaction" still passes, which is what proves the arm alone is never kept |
| bun test --conditions production src/server/loop-wake-recovery.test.ts | 18 pass, incl. 3 new `resumeLoop` cases asserting the spec round-trips verbatim (subagent, oracle, workdir, tracking file) and both refusals |
| bun test --conditions production src/server/claude-loop-commands.test.ts | 16 pass, incl. the card naming plan + worktree, no card without an armed loop, and no card on `chat_deleted` |
| bun test --conditions production src/client/components/messages/ src/client/lib/ | 782 pass |
| bun run test | 7316 pass / 2 skip / 0 fail across 551 files |
| bun run typecheck && bun run lint && bun run lint:usestate && bunx ast-grep test | All clean (lint at --max-warnings=0; 19 ast-grep rules pass) |
| bun run check:arch | 44 pass. `agent-coordinator.ts` 1483 → 1480 and `claude-pty/driver.ts` 1104 → 1103, both under their allowances |
