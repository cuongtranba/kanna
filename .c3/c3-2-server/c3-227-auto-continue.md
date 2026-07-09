---
id: c3-227
c3-seal: ad8fcf1ec4be5d9c52fd523f0ac8b7a0676ab549b5ff8b42a360bc7b26c69e3c
title: auto-continue
type: component
category: feature
parent: c3-2
goal: |-
    Detect provider rate-limit and auth-error endings on a Kanna chat,
    schedule a retry at the right wake-up moment, replay the queued user
    prompt automatically, and expose the current schedule as a derived view
    the UI can render.
uses:
    - ref-cqrs-read-models
    - ref-event-sourcing
    - ref-strong-typing
    - rule-colocated-bun-test
    - rule-strong-typing
---

# auto-continue

## Goal

Detect provider rate-limit and auth-error endings on a Kanna chat,
schedule a retry at the right wake-up moment, replay the queued user
prompt automatically, and expose the current schedule as a derived view
the UI can render.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Drive multi-provider agent turns" — adds the unattended retry layer above the agent coordinator |
| Category | feature |
| Lifecycle | Long-lived background scheduler holding pending wake-up timers per chat |
| Replaceability | Replaceable while the auto_continue_* event shapes and the schedule read-model contract are preserved |

## Purpose

Owns the Kanna auto-continue feature: classifies a turn-ending `result`
event as `rate-limited` or `auth-error`, picks a retry time (provider
hint when present, fallback backoff otherwise), records an
`auto_continue_scheduled` event, sleeps until the wake-up, then replays
the queued user prompt by triggering a new turn on the same chat.
Non-goals: turn orchestration itself (c3-210), OAuth token rotation
(c3-224), Claude/Codex transport (c3-225/c3-211). The scheduler never
mutates account state — token rotation stays in c3-224 — and never
writes a UI envelope directly; it pushes events that read-models
subscribe to and the WS router fans out.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | A Claude or Codex turn emits a result event with subtype: error and a recognised error body | c3-205 |
| Input — limit detection | limit-detector.ts parses Anthropic rate-limit signatures + retry-after hints | N.A - internal classifier within this component |
| Input — auth-error detection | auth-error-detector.ts matches "Please run /login", 401, OAuth refusal payloads | N.A - internal classifier within this component |
| State — schedule | schedule-manager.ts keeps an in-memory map of chatId → wakeAt; persistence is via the event log | c3-206 |
| Shared dep — events | Records auto_continue_scheduled / auto_continue_triggered / auto_continue_cancelled events | c3-205 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A chat that hit a soft failure resumes itself when the provider's rate window reopens, without user intervention | c3-210 |
| Primary path | result(error) → classifier → schedule → wake → start new turn with the queued prompt | c3-210 |
| Alternate — auth-error | Trigger OAuth-pool rotation through c3-224 and reschedule once a healthy token exists | c3-224 |
| Alternate — user cancels | UI emits auto_continue_cancel; scheduler appends auto_continue_cancelled and clears the timer | c3-208 |
| Failure — unknown error shape | Classifier returns null; no schedule recorded; original result propagates unchanged | N.A - internal fallback path |
| Failure — server restart mid-wait | Event-store replay re-creates the pending schedule on boot | c3-206 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-event-sourcing | ref | All schedule mutations land as events first | must follow | the schedule is replayable from JSONL |
| ref-cqrs-read-models | ref | UI consumes the derived schedule view, never the event log directly | must follow | read-model.ts projects the events |
| ref-strong-typing | ref | Detector outputs and schedule records are named types crossing WS + JSONL boundaries | must follow | wired rule below enforces |
| rule-strong-typing | rule | No any/unknown on detector returns or schedule envelopes | wired compliance target | typed at module boundary |
| rule-colocated-bun-test | rule | Every detector and schedule module sits next to its .test.ts | wired compliance target | enforced for auto-continue/** |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Auto-continue events | OUT | auto_continue_scheduled, auto_continue_triggered, auto_continue_cancelled typed events on the JSONL log | c3-205 | src/server/auto-continue/events.ts |
| Schedule read-model | OUT | {chatId, wakeAt, reason} snapshots projected from the event log | c3-207 | src/server/auto-continue/read-model.ts |
| Trigger new turn | OUT | On wake, call the agent coordinator's "start turn"; replay the schedule prompt for agent wakes or the queued user prompt for provider-failure resume | c3-210 | src/server/auto-continue/schedule-manager.ts |
| Arm agent wake | IN | AgentCoordinator.scheduleAgentWakeup arms an agent_wakeup or pending_workflow schedule and returns null past the per-chat runaway cap | c3-210 | src/server/agent.ts |
| Cancel signal | IN | UI cancels via auto_continue_cancel command on the WS router | c3-208 | src/server/auto-continue/schedule-manager.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Wrong classifier verdict triggers a busy loop | New error string introduced upstream | Detector unit test must include every recognised pattern | bun test src/server/auto-continue/limit-detector.test.ts |
| Schedule lost across restart | Event recording moved out of the event-store path | Read-model replay test fails | bun test src/server/auto-continue/read-model.test.ts |
| Auth-error retry hammers the same broken token | OAuth-pool rotation skipped on auth-error trigger | Detector test asserts rotation hook called | bun test src/server/auto-continue/auth-error-detector.test.ts |
| Cancel does not stop a pending timer | Timer reference held outside schedule-manager | Schedule-manager test asserts cancel clears the timer | bun test src/server/auto-continue/schedule-manager.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/auto-continue/events.ts | Contract (auto-continue events) | Event payload field names | src/server/auto-continue/events.ts |
| src/server/auto-continue/limit-detector.ts | Contract | Pattern detail | src/server/auto-continue/limit-detector.ts |
| src/server/auto-continue/auth-error-detector.ts | Contract | Pattern detail | src/server/auto-continue/auth-error-detector.ts |
| src/server/auto-continue/schedule-manager.ts | Contract (schedule + trigger surface) | Timer backend | src/server/auto-continue/schedule-manager.ts |
| src/server/auto-continue/read-model.ts | Contract (schedule read-model) | Projection detail | src/server/auto-continue/read-model.ts |
| src/server/auto-continue/e2e.test.ts | Contract | Test framing | src/server/auto-continue/e2e.test.ts |
