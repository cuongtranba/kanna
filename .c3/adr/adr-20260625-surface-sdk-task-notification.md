---
id: adr-20260625-surface-sdk-task-notification
c3-seal: 079b6a326fc97ab50d178c432fb3d7ba7945f814213afd91c6bb5bac6aadf840
title: surface-sdk-task-notification
type: adr
goal: |-
    Surface the Agent SDK's `SDKTaskNotificationMessage` (a `type:system,
    subtype:task_notification` stream message emitted when a
    `Bash(run_in_background)` task settles) into Kanna's transcript/event log.
    `normalizeClaudeStreamMessage` had no case for this subtype, so it returned
    `[]` and the background-task completion was silently dropped — Kanna "could
    not capture the background work." Map it to the existing `status` transcript
    entry kind so the completion is persisted and visible, honoring the SDK's
    `skip_transcript` hint for ambient/housekeeping tasks.
status: accepted
date: "2026-06-25"
---

## Goal

Surface the Agent SDK's `SDKTaskNotificationMessage` (a `type:system,
subtype:task_notification` stream message emitted when a
`Bash(run_in_background)` task settles) into Kanna's transcript/event log.
`normalizeClaudeStreamMessage` had no case for this subtype, so it returned
`[]` and the background-task completion was silently dropped — Kanna "could
not capture the background work." Map it to the existing `status` transcript
entry kind so the completion is persisted and visible, honoring the SDK's
`skip_transcript` hint for ambient/housekeeping tasks.

## Context

Symptom (SDK driver): a turn launches a `Bash(run_in_background)` task (e.g. a
`gh pr checks` CI poll), ends `end_turn`, and the background task later settles.
The Agent SDK (`@anthropic-ai/claude-agent-sdk@0.2.140`) reports this two ways
on the same `query()` stream Kanna already consumes:

1. `SDKTaskNotificationMessage` — `type:system, subtype:task_notification`,
carrying `task_id`, optional `tool_use_id`, `status`
(`completed|failed|stopped`), `output_file`, `summary`, optional
`skip_transcript`.
2. A user-role message whose `origin.kind === "task-notification"`, which
natively re-drives the model (the `canUseTool`-after-`result` self-resume
already observed at the `recreateActiveTurnFromSession` call site).

The model re-drive (2) already works: the always-on `runClaudeSession` consume
loop keeps reading the open main-chat stream and the keep-alive guard
(`backgroundTaskIdsFromToolResult`) holds the session warm past the idle
window. The defect was purely (1): `normalizeClaudeStreamMessage` (c3-210)
dropped the status message, so the background completion never reached the
transcript, the event log, or the UI. The PTY driver has a separate, analogous
drop in `jsonl-to-event.ts` (the `isMeta` auto-wake filter) — out of scope
here; this ADR is the SDK path only.

Constraint: do not add a manual prompt re-entry (`sendPrompt`) — the SDK
already self-resumes, so a manual push would double-drive the turn. Reuse an
existing transcript entry kind to keep the transcript contract unchanged.

## Decision

Add a `subtype:task_notification` branch to `normalizeClaudeStreamMessage`
that emits a single `status` transcript entry:
`"Background task <status>: <summary>"`. Set `hidden: true` when
`skip_transcript === true` (the SDK asks consumers to hide ambient tasks from
the inline transcript while still persisting them). Reuse the existing `status`
kind — no new transcript kind, no client component, no change to the
transcript contract surface — so blast radius stays inside c3-210's
normalizer and the change is a pure additive event mapping. Re-entry is left to
the SDK's native self-resume (surface-only); a manual `sendPrompt` was rejected
to avoid double-driving the turn.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Adds a task_notification branch to normalizeClaudeStreamMessage mapping a previously-dropped SDK stream message to the existing status transcript entry; no new entry kind, transcript contract unchanged | c3-210#n5826@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/res" | Confirm the transcript event contract is preserved (existing status kind reused); covered by colocated agent.test.ts normalizer cases |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | The branch observes an already-streamed SDK message and emits an existing transcript entry; adds no new event kind and writes nothing new to the log shape | ref-event-sourcing#n7397@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa "Every state mutation is first captured as an immutable " | comply |
| ref-provider-adapter | Change is confined to the Claude SDK normalizer; the provider-agnostic transcript entry shape is unchanged | ref-provider-adapter#n7463@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 "Normalize Claude Agent SDK and Codex App Server into on" | comply |
| ref-tool-hydration | c3-210 cites ref-tool-hydration; the new branch emits a non-tool status entry and does not touch tool-call hydration | ref-tool-hydration#n7567@v1:sha256:376e5fee261bd3b463633f19523020439854d9bd11ddc28ff5cffe12d8ed485e "Provider tool calls (Read, Edit, Bash, plan, diff, " | review |
| ref-colocated-bun-test | New behavior covered by colocated agent.test.ts normalizer cases | ref-colocated-bun-test#n7331@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(" | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Tests for the new normalizer branch live in src/server/agent.test.ts next to agent.ts, run under bun test | rule-colocated-bun-test#n7666@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f "Every Kanna test must sit next to the file under test," | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Normalizer | Add subtype:task_notification case in normalizeClaudeStreamMessage; emit a status entry, hidden on skip_transcript | src/server/agent.ts |
| Tests | agent.test.ts: completed → status entry with summary; failed → status surfaced; skip_transcript → hidden:true | src/server/agent.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - runtime-behavior ADR | No C3 CLI / validator / schema / template change; enforced by bun tests, not a c3x underlay surface | c3x check clean post-change |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/agent.test.ts | Fails if a task_notification message stops surfacing a status entry or mishandles skip_transcript | bun test src/server/agent.test.ts |
| bun run lint | Strong-typing + side-effect seal stay green (no new IO) | bun run lint |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.test.ts | pass (3 new task_notification normalizer cases + existing normalizer cases green) |
| bun test src/server/agent.test.ts src/server/agent.background-task-sdk.test.ts | pass (127 tests) |
| bun run lint | pass (no new warnings; side-effect seal + strong-typing clean) |
| c3x check --include-adr --only adr-20260625-surface-sdk-task-notification | ok |
