---
id: adr-20260603-agent-self-scheduled-wake
c3-seal: 48c8b60f3c09780eeaa2f3de8d158fbeffb280d3ab44f36b5f8cdef461045959
title: agent-self-scheduled-wake
type: adr
goal: |-
    Make Kanna re-enter an idle chat turn on two agent-driven signals that the
    spawned `claude` CLI emits but Kanna currently never acts on: (1) the model
    calling `ScheduleWakeup({delaySeconds, prompt})` to resume later, and (2) a
    turn ending while a background `Workflow` is still running
    (`pendingWorkflowCount > 0`). Kanna will OWN the wake timer by routing both
    signals into the existing `auto-continue` `ScheduleManager` (event-sourced,
    restart-survivable), rather than relying on the CLI's in-process cron
    scheduler — which dead-letters our spawn and whose fires Kanna's auto-wake
    filter deliberately drops.
status: superseded
date: "2026-06-03"
---

# Agent self-scheduled wake + background-workflow harvest

## Goal

Make Kanna re-enter an idle chat turn on two agent-driven signals that the
spawned `claude` CLI emits but Kanna currently never acts on: (1) the model
calling `ScheduleWakeup({delaySeconds, prompt})` to resume later, and (2) a
turn ending while a background `Workflow` is still running
(`pendingWorkflowCount > 0`). Kanna will OWN the wake timer by routing both
signals into the existing `auto-continue` `ScheduleManager` (event-sourced,
restart-survivable), rather than relying on the CLI's in-process cron
scheduler — which dead-letters our spawn and whose fires Kanna's auto-wake
filter deliberately drops.

## Context

A PTY chat (`de4c6a76-919a-4f2e-8004-ec1328f5820c`) running a Workflow called
`ScheduleWakeup` +1515s, ended its turn cleanly (`turn_finished`,
`pendingWorkflowCount: 1`), and then sat idle forever — no `turn_started` ever
followed. Spike findings against the claude-code source proved two independent
blockers: (a) the only native re-fire engine is the cron tick in
`useScheduledTasks.ts:40-127` armed by `/loop`→`CronCreate`; `ScheduleWakeup`
is unbacked under Kanna's spawn (no Kanna-registered tool, native fire is
in-memory and dies on restart); (b) even a legit cron/`/loop` fire enters the
on-disk transcript as an `isMeta:true` user line (`useScheduledTasks.ts:71-82`),
which `src/server/claude-pty/jsonl-to-event.ts:106` intentionally drops as a
background auto-wake. `<task-notification>` bg-completion wakes share that same
`isMeta:true` queue. Affected topology: c3-227 (auto-continue scheduler),
c3-210 (agent-coordinator turn lifecycle + fire path), c3-226 (kanna-mcp shim
registration), c3-225 (claude-pty driver disallow-tools + filter). Constraint:
fix must survive server restart (matches c3-227's existing rate-limit resume
guarantee) and must not reintroduce the noise wakes the filter was added to
suppress.

## Decision

Kanna owns the wake. Intercept the native `ScheduleWakeup` (add it to the PTY
`--disallowedTools` list and force-register a `mcp__kanna__schedule_wakeup`
shim, exactly mirroring the `AskUserQuestion`/`ExitPlanMode` interception from
issue #215). The shim emits an `auto_continue_accepted` event carrying
`reason: "agent_wakeup"` + the agent-supplied `prompt` + `scheduledAt`. The
existing `ScheduleManager` arms/persists/rehydrates it and `fireAutoContinue`
re-enters the chat replaying that prompt. For background-workflow harvest, when
a turn-end `result` carries `pendingWorkflowCount > 0`, the coordinator arms a
short Kanna-owned poll-wake (`reason: "pending_workflow"`) so the agent
re-enters to collect results — the `jsonl-to-event` filter stays unchanged
(noise stays dropped). This wins over un-filtering native wakes because the
event-sourced scheduler already gives restart survival, cancel-cascade, and a
UI read-model for free; the native cron path gives none of those under our
tail-the-transcript spawn model.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-227 | component | Owns the schedule/timer; gains two new schedule reasons (agent_wakeup, pending_workflow) beyond rate-limit/auth-error; goal statement widens | Parent Delta on c3-2; update goal + Foundational/Business Flow + Contract rows for the new reasons |
| c3-210 | component | fireAutoContinue branches on reason to replay the agent prompt vs queued user prompt; turn-end path arms a pending_workflow schedule when pendingWorkflowCount > 0 | Review Business Flow turn-finalize; confirm event-before-broadcast ordering preserved |
| c3-226 | component | Registers the new mcp__kanna__schedule_wakeup shim under the same spawn-context guard as other forced shims | Review Contract surface list; add the shim row |
| c3-225 | component | Adds ScheduleWakeup to --disallowedTools; force-registers the shim; the auto-wake filter at jsonl-to-event.ts:106 is documented as intentionally retained | Review prompt-delivery + disallowed-tools section; no filter behavior change |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | Every schedule mutation (the new wake reasons) must land as a JSONL event first, so the wake survives restart like rate-limit resume | comply |
| ref-cqrs-read-models | The new schedule reasons must project through the existing schedule read-model the UI consumes, not a side channel | comply |
| ref-strong-typing | The new event payload (reason, prompt, scheduledAt) and the shim input cross JSONL + MCP boundaries — must be named types, no any/untyped literals | comply |
| ref-provider-adapter | The re-entered turn must use the same provider-agnostic turn shape; agent-wake replay must not branch on provider in the coordinator | comply |
| ref-colocated-bun-test | Cited by c3-210 + c3-225; every touched module keeps its colocated *.test.ts with new wake-reason cases | comply |
| ref-tool-hydration | Cited by c3-210 + c3-226; the schedule_wakeup MCP call must hydrate into the unified transcript via src/shared/tools.ts like every other tool, not a bespoke entry | comply |
| ref-local-first-data | Cited by c3-226; the wake schedule persists only in the local ~/.kanna/data event log, opening no new network surface | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Detector/schedule envelopes and the new shim input are boundary types; no any/unknown without narrowing on the wake event or tool input | comply |
| rule-colocated-bun-test | Each touched module (schedule-manager, events, read-model, kanna-mcp, jsonl-to-event, agent) must keep its *.test.ts sibling and add cases for the new reasons | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Event type | Add reason discriminant (agent_wakeup \| pending_workflow alongside existing) + optional prompt to the accepted-schedule event; named type | src/server/auto-continue/events.ts |
| Schedule fire | Branch fireAutoContinue on reason: replay agent prompt for agent_wakeup, re-poll for pending_workflow, existing path for failures; cap consecutive agent-wakes per chat | src/server/agent.ts (fireAutoContinue ~3024-3322) |
| Turn-end arm | On result with pendingWorkflowCount > 0, emit a pending_workflow accepted-schedule with short delay | src/server/agent.ts (turn finalize) |
| MCP shim | Register mcp__kanna__schedule_wakeup under the spawn-context guard; emit the event; return confirmation text | src/server/kanna-mcp.ts |
| PTY disallow + shim | Add ScheduleWakeup to --disallowedTools; force-register shim like ask_user_question | src/server/claude-pty/driver.ts |
| Env caps | KANNA_MAX_AGENT_WAKES (default ~25), reuse existing idle/cancel cascade | src/server/agent.ts deps |
| Docs | Update CLAUDE.md (new env var + wake mechanism), c3-227/210/226/225 bodies | CLAUDE.md, .c3 via c3x write |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema change | This ADR changes product code + component doc bodies only; the c3x tooling, schemas, validators, and help text are untouched | c3x check passes post-change with no schema/validator edits in the diff |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| schedule-manager.test.ts | Asserts an agent_wakeup/pending_workflow schedule arms, fires fireAutoContinue, and cancel clears the timer | src/server/auto-continue/schedule-manager.test.ts |
| read-model.test.ts | Asserts the new reasons replay from JSONL on rehydrate (restart survival) | src/server/auto-continue/read-model.test.ts |
| auto-continue/e2e.test.ts | End-to-end: shim emit → schedule → wake → new turn with the agent prompt | src/server/auto-continue/e2e.test.ts |
| kanna-mcp test | Asserts schedule_wakeup registered only under spawn-context guard and emits the typed event | src/server/kanna-mcp*.test.ts |
| jsonl-to-event.test.ts | Regression: genuine isMeta:true auto-wakes STILL dropped (filter unchanged) | src/server/claude-pty/jsonl-to-event.test.ts |
| Cap guard | Consecutive agent-wakes beyond KANNA_MAX_AGENT_WAKES stop arming | src/server/agent.ts + test |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Un-filter native wakes in jsonl-to-event.ts and rely on the CLI cron timer | Native ScheduleWakeup is unbacked in our spawn (dead-letters); in-memory crons die on Kanna/CLI restart; and un-filtering reintroduces the <task-notification> noise wakes the filter (commit 216392b) was added to suppress |
| Implement a brand-new scheduler component instead of reusing c3-227 | c3-227 already provides event-sourced persist + rehydrate + cancel-cascade + UI read-model; a parallel scheduler duplicates restart-survival logic and splits the wake surface across two components |
| Use claude-code /loop+CronCreate durable cron (.claude/scheduled_tasks.json) | Lives outside Kanna's event log, invisible to Kanna's cancel/archive lifecycle and UI; fires land as filtered isMeta:true lines anyway |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Runaway self-wake loop burns OAuth quota | KANNA_MAX_AGENT_WAKES cap per chat + existing cancel cascade clears timers | schedule-manager.test.ts asserts arming stops past the cap |
| Wake fires on an archived/cancelled chat | Reuse existing cancel/archive → auto_continue_cancelled clear; fire guards chat liveness | e2e.test.ts asserts cancelled schedule does not start a turn |
| pending_workflow poll never resolves (workflow hangs) | Bounded re-poll count + idle timeout, same backoff infra as auth-error | schedule-manager.test.ts asserts bounded re-arm |
| Native wake noise leaks back as a real turn | Filter at jsonl-to-event.ts:106 left intact; harvest goes through Kanna schedule only | jsonl-to-event.test.ts regression keeps dropping non-kanna isMeta wakes |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/auto-continue/ | all pass incl. new agent_wakeup/pending_workflow cases |
| bun test src/server/claude-pty/jsonl-to-event.test.ts | filter regression green (noise still dropped) |
| bun test src/server/kanna-mcp*.test.ts | schedule_wakeup shim registration + emit pass |
| bun run lint | 0 errors, warning cap not exceeded |
| c3x check | passes; c3-227/210/226/225 bodies match code |
| Live PTY smoke | a chat that calls ScheduleWakeup re-enters its turn after the delay (manual, real OAuth) |
