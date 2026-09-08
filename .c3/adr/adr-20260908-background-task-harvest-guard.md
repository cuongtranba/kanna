---
id: adr-20260908-background-task-harvest-guard
c3-seal: 5cc3da096a9eb91ded5e39113e9d5c118842c9d7e921ca29e0dcce12d5aac366
title: background-task-harvest-guard
type: adr
goal: |-
    Make a Claude-Code background task that outlives its turn observable and
    recoverable: surface the shell command and the output-file path in the chat
    footer panel, stop reporting an empty output file as an indefinite
    `Waiting for output…`, and have the model retrieve a task it left running
    instead of the chat going idle with the task pinned open forever.
status: proposed
date: "2026-09-08"
---

## Goal

Make a Claude-Code background task that outlives its turn observable and
recoverable: surface the shell command and the output-file path in the chat
footer panel, stop reporting an empty output file as an indefinite
`Waiting for output…`, and have the model retrieve a task it left running
instead of the chat going idle with the task pinned open forever.

## Context

Chat `6fe3e20c-3c64-4787-8a79-c16b015cb619` is the reproduction. An SDK turn
launched two CI watches — `until gh pr checks 594 …; do sleep 20; done` and
`while gh pr checks 594 …; do sleep 30; done`. Both print nothing until they
exit, so both `.output` files stayed at **0 bytes**. The model's
`TaskOutput({block: true, timeout: 600000})` returned
`<retrieval_status>timeout</retrieval_status>` ten minutes later; the turn ended
at 12:59 with both tasks live, and nothing woke the model again. The user saw
two rows reading `Waiting for output…` and could not tell a working stream with
nothing to show from a broken one.

Three separate gaps produced that:

1. `ChatBackgroundTask` carried only the Bash tool's `description`. The
`background_tasks_changed` snapshot carries `{task_id, task_type,
description}` and no command, so the rows read "Wait for CI to finish" —
the one fact that explains an empty output file, that the command is a
silent `sleep` loop, was nowhere in the UI.
2. `BackgroundTaskOutputRegistry.addWatcher` scheduled its first read one poll
interval out, so `Waiting for output…` was also shown for a full second on a
task with megabytes of output. With no way to distinguish "no snapshot yet"
from "snapshot arrived, file is empty", the message could not be made honest.
3. `escalateExpiredBackgroundTaskGuard` → `buildBackgroundTaskWakePrompt`
(adr-20260801-background-task-wake-escalation) already wakes the model about
a pending task — but `ClaudeSessionState.guardExpired()` returns `false`
whenever `backgroundTasksLevelSourced` is set, which
adr-20260808-background-task-level-signal-authoritative made authoritative
for the SDK driver. So on the SDK the wake ladder is unreachable, and 6fe3e20c
is exactly what that costs.

## Decision

**Carry the command.** `SessionBackgroundTask` gains `command`, captured at the
launching `tool_call` by a new `toolCallCommand` beside the existing
`toolCallDescription`, and capped at `MAX_BACKGROUND_TASK_COMMAND_CHARS` (2000)
because it rides `deriveChatSnapshot` on every chat broadcast.
`mergeBackgroundTaskSnapshot` preserves it as `prev?.command ?? null`, exactly
as it preserves `outputPath`: the level snapshot carries no command and, per
issue #811, can arrive before the launch `tool_result`, so the preservation is
load-bearing rather than defensive. The session's `recentToolDescriptions` map
widens to `recentToolCalls: Map<string, RecentToolCall>` so one map and one
eviction path hold both fields, and its whole bookkeeping moves out of
`runClaudeSession` into `ClaudeSessionState.noteToolCall` — where that state
lives, and which drops the function's cyclomatic complexity 131 → 125.

**Expose the path.** `ChatBackgroundTask` gains `outputPath`, reversing
adr-20260820-background-task-output-streaming's "Expose outputPath on the
client — unnecessary". That reasoning was about whether `hasOutput` suffices to
decide the expand affordance; it still does. The new reason is different: when
the panel is empty the user needs to be able to `tail` the file themselves.

**Make the empty state honest.** `addWatcher` polls once before scheduling its
interval, so the first pushed snapshot already carries whatever the file holds.
Empty content then means an empty file, and the pure `outputBodyText` renders
three distinct states: `Waiting for output…` only before the first snapshot,
`No output yet — nothing has been written to this file.` for an empty file, and
`This task writes no output file.` for a task with no path at all. The expand
affordance widens from `hasOutput` to `hasOutput || command !== null`, and the
WS subscription is gated on `hasOutput` alone so a command-only row does not
subscribe to a stream that cannot exist.

**Harvest what the ladder cannot reach.** `createBackgroundTaskGuard` runs at
the runner's success finalize, after the mermaid guard and before
`maybeStartNextQueuedMessage` so the existing drain picks it up. It offers one
prompt per task id over the existing `createModelEscalation`, naming the id,
description, command and output path. It fires **only** when
`backgroundTasksLevelSourced` is true — precisely the case the deadline ladder
refuses — so no session is ever nudged twice, and PTY keeps the behaviour
adr-20260801 gave it. A matching rule in `KANNA_SYSTEM_PROMPT_BASE` states the
obligation deterministically, so the guard stays a backstop rather than the
mechanism.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - ancestor named only to complete the top-down descent | c3-0#n3@v1:sha256:c9f10a833b3e499d1329f9637c65ac8e7c7b9f78b6210e91ff3f44b8d31e38bc | N.A - ancestor named only to complete the top-down descent |
| c3-1 | container | N.A - ancestor named only to complete the top-down descent | c3-1#n9319@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 | N.A - ancestor named only to complete the top-down descent |
| c3-2 | container | N.A - ancestor named only to complete the top-down descent | c3-2#n10211@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce | N.A - ancestor named only to complete the top-down descent |
| c3-3 | container | N.A - ancestor named only to complete the top-down descent | c3-3#n12417@v1:sha256:14758c535c5f7fc755f25004ead7b6d64058321bc3599252e111f640e63dc53e | N.A - ancestor named only to complete the top-down descent |
| c3-210 | component | Owns the session state and the turn runner. `SessionBackgroundTask` gains `command`, `recentToolDescriptions` becomes `recentToolCalls`, `noteToolCall` moves the tool_call bookkeeping into `ClaudeSessionState`, and the new `background-task-guard.ts` is wired through `RunClaudeSessionDeps.backgroundTaskGuard` and built in `agent-coordinator.ts`. The duplicate private `mergeBackgroundTaskSnapshot` in `claude-session-state.ts` is deleted in favour of the exported one, so production and its test finally exercise the same function | c3-210#n10729@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | Confirm the new guard stays a leaf over `ModelEscalation` with no IO, that it never fires where the deadline wake ladder already runs, and that `.c3/eval/c3-210.yaml` gains the new module |
| c3-112 | component | Owns `BackgroundTasksSection`. The expanded row now renders the command and the output path above the streamed tail, the expand affordance widens to command-only rows, and `outputBodyText` replaces the single `?? "Waiting for output…"` fallback with three distinct states | c3-112#n9685@v1:sha256:c7c8905039eb5b78ce4fe192f422d7dfe3ab9cda3da6799881f0549a3af1facb | Confirm token classes only, no native `title`, and that the WS subscription remains gated on `hasOutput` so a command-only row cannot subscribe |
| c3-301 | component | Owns `ChatBackgroundTask`, the server→client contract for the footer panel. It gains `command` and `outputPath`, both non-optional, so every producer is a compile error until updated | c3-301#n12442@v1:sha256:f052cf0299d7d5dbfada18fbbf1a7e952442b4016787c6c30723382112309b38 | Confirm both fields are required rather than optional — an optional field would let a producer silently omit the command and leave the panel back where it started |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-colocated-bun-test | The new `background-task-guard.ts` and every changed module gain colocated `*.test.ts` siblings rather than a separate test tree | ref-colocated-bun-test#n12986@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 | comply |
| ref-event-sourcing | The guard reads live session state at the turn's terminal and enqueues a message; it appends no event and derives no read model, so the event log stays the single write path | ref-event-sourcing#n13052@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa | comply |
| ref-provider-adapter | `toolCallCommand` reads the normalized `NormalizedToolCall`, not a provider-shaped payload, so the command capture works for any driver that normalizes a bash tool call | ref-provider-adapter#n13118@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 | comply |
| ref-tool-hydration | The command is taken from the hydrated tool call at `tool_call` time and cached on the session, which is what lets the launch `tool_result` — arriving later, and after the level snapshot per #811 — still resolve it | ref-tool-hydration#n13222@v1:sha256:376e5fee261bd3b463633f19523020439854d9bd11ddc28ff5cffe12d8ed485e | comply |
| ref-cqrs-read-models | `ChatBackgroundTask` is derived per broadcast by `getBackgroundTasksByChatId`; the two new fields are read-model projections of session state and are never written back | ref-cqrs-read-models#n13019@v1:sha256:768802027896fc8c9ebd415cf63483f64e0c5f2f4bc10f21079a8f7d51c38dcd | comply |
| ref-ws-subscription | The panel keeps one `background-task-output` subscription per expanded row, now gated on `hasOutput` so a command-only row cannot subscribe to a stream that has no file behind it | ref-ws-subscription#n13255@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc | comply |
| ref-strong-typing | `ChatBackgroundTask.command` and `.outputPath` are `string \| null`, required rather than optional, so a producer that forgets one fails to compile instead of silently emitting an empty panel | ref-strong-typing#n13189@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | `background-task-guard.test.ts` sits beside its module and runs under `bun test --conditions production`; the guard's bounds and the runner wiring are covered there and in `claude-session-runner.test.ts` | rule-colocated-bun-test#n13321@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |
| rule-strong-typing | No `any`, no `unknown`, no cast is introduced. `BackgroundTaskGuardSession` is a structural view `ClaudeSessionState` already satisfies, so the guard depends on three members rather than the whole class | rule-strong-typing#n13382@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Make the existing deadline wake ladder run for level-sourced sessions | adr-20260808 removed the deadline for level-sourced sessions deliberately — silence is not death, and a `vite dev` server that prints its banner and goes quiet for hours would be reaped. Reinstating a timer there re-opens exactly that |
| Re-nudge on every turn end while a task stays live | A 25-minute CI watch would drive a nudge turn after every turn. Once per task id bounds the cost at one extra turn per task and still covers the reported failure |
| Prompt rule in `KANNA_SYSTEM_PROMPT_BASE` only, no guard | Nothing would enforce it; a model that forgets leaves the panel exactly as reported. The prompt is the deterministic layer, the guard the backstop — the same two-layer shape as the mermaid gate |
| Let the guard also fire on PTY / non-level-sourced sessions | Duplicates `buildBackgroundTaskWakePrompt`, so one task would get two different nudges from two mechanisms with independent budgets |
| Keep `Waiting for output…` and add a byte count | The count answers the same question the wording should answer directly, and it still leaves the pre-first-snapshot and no-output-file cases indistinguishable |
| Reshape `createBackgroundTaskGuard` to avoid a `*Deps` bundle | The cheapest way to satisfy the `deps-bundles` ratchet would have been a spelling change, which is the evasion #914 made and `budget.ts` names. The pin was raised 84 → 85 instead, with both fields required so a missing wiring is a compile error |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The nudge costs an extra turn for every background task that outlives its turn | Once per task id per chat, success branch only, stands aside on a queued user message, skipped while a loop is armed, and `KANNA_BACKGROUND_TASK_GUARD=disabled` turns it off | `background-task-guard.test.ts` covers each bound; the live run logged exactly two escalations across three turns, one per task id |
| The guard's enqueue could race a loop's own wake | It returns early when `isLoopArmed(chatId)`, and `ModelEscalation.offer` independently stands aside when a message is already queued | `background-task-guard.test.ts` "stands down while a loop is armed" and "stands aside when a user message is already queued" |
| A long command inflates every chat-state broadcast | `MAX_BACKGROUND_TASK_COMMAND_CHARS` truncates at 2000 with an ellipsis | `claude-prompt-helpers.test.ts` "a command longer than the cap is truncated with an ellipsis" |
| The expanded row grew ~60px, so on a transcript pinned to the bottom the command sits above the fold until the user scrolls | Accepted; the panel is inline transcript content and scrolls normally. Recorded here so a later report is recognised rather than re-diagnosed | Observed in the live run at 1280x577; the command is reachable by scrolling the transcript |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 8187 pass, 2 fail — both (`http 401 surfaces unauthorized`, `settings.testMcpServer > injects a fresh oauth bearer`) reproduced on a clean origin/main baseline before any of this work |
| bun run check | clean (typecheck, eslint --max-warnings=0, lint:comments, build:client, check:bundle) |
| bun run check:arch | clean — `deps-bundles` pin raised 84 → 85 for `BackgroundTaskGuardDeps`, `complexity` pin lowered 131 → 125 after `noteToolCall` was extracted |
| bun run lint:limits | All 4 ESLint ceilings are tight |
| bun run lint:usestate / bunx ast-grep test | clean; 19 rule tests pass |
| Live run, `bun run dev` | Silent `until [ -f STOP ]; do sleep 5; done` task: guard fired once with the command in the prompt, panel showed the command, the `.output` path and `No output yet — nothing has been written to this file.` against a verified 0-byte file. A second turn while the task ran produced no second nudge. A `for i in $(seq 1 40); do echo "tick $i"; …` task streamed `tick 1…15` immediately on expand and `…17` eight seconds later. Server log shows exactly two `[kanna/background-task] escalating to model` lines, keys `bgtask-bo9lmvwo1` and `bgtask-b7gmgghqf` |
