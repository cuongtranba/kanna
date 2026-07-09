---
id: c3-233
c3-seal: f4ae2eabcc9d064c96b9900b6fa92b50b8a0b9293c252474d343dc5e1d7d3e84
title: turn-recovery
type: component
category: feature
parent: c3-2
goal: Detect turns left unfinished by a server crash or graceful deploy and auto-resume them on the next boot via the event-sourced auto-continue wake machinery.
uses:
    - ref-event-sourcing
    - ref-strong-typing
    - rule-colocated-bun-test
---

## Goal

Detect turns left unfinished by a server crash or graceful deploy and auto-resume them on the next boot via the event-sourced auto-continue wake machinery.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Keep in-flight work alive across server stops" |
| Category | feature |
| Lifecycle | Runs once at boot (after event-store replay) and exits; no background loop |
| Replaceability | Replaceable while the interrupted_resume event shape and scheduleAgentWakeup contract are preserved |

## Purpose

Scans every chat after boot to find turns that did not finish before the server stopped — either a hard crash (transcript ends on user_prompt with no terminal result/interrupted) or a graceful deploy (turn_cancelled with reason:"shutdown"). Arms an interrupted_resume auto-continue wake for each eligible chat so the turn resumes without user action. Explicit user cancels (reason:"user") are never resumed. A per-turn resumeAttemptsSinceProgress counter caps retries at maxResumeAttempts to prevent an always-crashing turn from looping across boots. Non-goals: turn transport (c3-225/c3-211), session spawning (c3-210), shutdown signaling (c3-220).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Event store has replayed; chat records and transcripts are queryable | c3-206 |
| Input — crash signature | isTurnDangling: last user_prompt has no terminal entry after it | N.A - pure internal function in this component |
| Input — shutdown signature | lastTurnOutcome:"cancelled" + lastTurnCancelReason:"shutdown" on ChatRecord | c3-206 |
| Input — attempt counter | resumeAttemptsSinceProgress on ChatRecord; persisted via turn_resume_attempted event | c3-206 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Every non-user-cancelled unfinished turn resumes on the next boot without user intervention | c3-227 |
| Primary path | Boot → detectResumableTurns → scheduleAgentWakeup(source=interrupted_resume) → fireAutoContinue → startTurnForChat | c3-210 |
| Alternate — crash | Dangling transcript detected; --resume token reuses prior session so committed tool calls are not re-run | c3-225 |
| Alternate — deploy | turn_cancelled reason=shutdown detected; --resume token resumes session context | c3-225 |
| Failure — cap hit | resumeAttemptsSinceProgress >= maxResumeAttempts (default 3); chat skipped and logged | N.A - internal guard in this component |
| Failure — user cancel | lastTurnCancelReason:"user" (or undefined/legacy) → detectResumableTurns excludes the chat | N.A - internal guard in this component |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-event-sourcing | ref | All resume state (attempt counter, cancel reason) captured as events before acting | must follow | appends only; never rewrites JSONL |
| ref-strong-typing | ref | ResumableTurn, TurnCancelReason, and all exported types are named | must follow | No any at module boundaries |
| rule-colocated-bun-test | rule | detect.test.ts and reconcile.test.ts colocated | must follow | src/server/turn-recovery/ |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| detectResumableTurns(chats, getMessages) | OUT | Pure; returns ResumableTurn[] for crash+shutdown chats, excluding user-cancel | c3-210 | src/server/turn-recovery/detect.ts |
| buildResumePrompt(turn) | OUT | Returns continuation nudge when session token present; replays original prompt otherwise; null if nothing to replay | c3-210 | src/server/turn-recovery/detect.ts |
| reconcileInterruptedTurns() | OUT | Calls detectResumableTurns + scheduleAgentWakeup; returns armed count; never throws | c3-210 | src/server/agent.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Double side-effect on resume | resume sends original prompt with committed tool calls | wall 1 assertion in detect.test.ts | src/server/turn-recovery/detect.test.ts |
| User-cancel resumed | user cancel treated as shutdown | wall 3 assertion in reconcile.test.ts | src/server/turn-recovery/reconcile.test.ts |
| Resume crash loop | crashing turn rearmed on every boot | resumeAttemptsSinceProgress reaches cap; log warning | src/server/turn-recovery/reconcile.test.ts |
| Event-log corruption | reconciler rewrites transcript JSONL | No rewrite paths in detect.ts | src/server/turn-recovery/detect.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/turn-recovery/detect.ts | Contract (detectResumableTurns, buildResumePrompt) | Pure function bodies | src/server/turn-recovery/detect.ts |
| src/server/turn-recovery/detect.test.ts | Change Safety (all four walls) | Test detail | src/server/turn-recovery/detect.test.ts |
| src/server/turn-recovery/reconcile.test.ts | Contract (reconcileInterruptedTurns) + Change Safety | Test detail | src/server/turn-recovery/reconcile.test.ts |
