---
id: adr-20260620-openrouter-stream-first-entry-watchdog
c3-seal: e2dc8cd2801a9d1802c4c46a9a9dde3d3615a9af3f5275f2eb1958326f54126f
title: openrouter-stream-first-entry-watchdog
type: adr
goal: 'Add a first-entry watchdog to `runClaudeSession` that fail-closes an OpenRouter turn whose SDK stream emits no transcript `entry` (no `system_init`) within a bounded timeout. Today an OpenRouter turn whose upstream stalls after the session-token handshake leaves the `for await` suspended forever: no terminal `result`, no thrown error, so neither the `catch` nor the `finally` fail-close path runs and the chat shows "running" until process restart.'
status: accepted
date: "2026-06-20"
---

## Goal

Add a first-entry watchdog to `runClaudeSession` that fail-closes an OpenRouter turn whose SDK stream emits no transcript `entry` (no `system_init`) within a bounded timeout. Today an OpenRouter turn whose upstream stalls after the session-token handshake leaves the `for await` suspended forever: no terminal `result`, no thrown error, so neither the `catch` nor the `finally` fail-close path runs and the chat shows "running" until process restart.

## Context

OpenRouter turns route through the Claude Agent SDK with `ANTHROPIC_BASE_URL=https://openrouter.ai/api` and `ANTHROPIC_AUTH_TOKEN` = the OpenRouter key (`buildClaudeEnv`). Session `a71516d4-7505-4ba7-b74b-2c620722b130` (model `qwen/qwen3.7-plus`) reproduced the failure: transcript stopped at `account_info`, `turns.jsonl` recorded `session_token_set` then nothing — no `system_init`, no `result`, no `turn_failed`. The stream emitted the `session_token` event then stalled before any `event.entry`. `runClaudeSession`'s existing fail-close in `finally` only fires when the stream ENDS (iterator returns or throws); an open-but-silent stream never ends, so the turn hangs. Affected topology: c3-210 agent-coordinator (turn lifecycle / failure path). Constraint: must not touch the healthy Claude OAuth/PTY paths.

## Decision

Arm a per-session `setTimeout` watchdog inside `runClaudeSession`, enabled only when the session is OpenRouter (`session.openrouterModel !== null`). The timer is cleared on the first `event.entry` (system_init/result/etc — the `session_token` control event does NOT count). If it fires before any entry arrives, it logs, calls `session.session.interrupt()` then `session.session.close()`, which ends the async iterator and lets the EXISTING `finally` fail-close record `recordTurnFailed("openrouter stream produced no response")`. Reusing the existing fail-close path (rather than writing a new error entry inline) keeps a single finalize path and avoids double-finalize races. Scope is first-entry only and OpenRouter only, per the chosen design: it targets the exact reproduced hang signature without risking the Claude SDK/PTY turn machinery or cutting off legitimately long Claude turns (workflows, background tasks). Timeout is configurable via `KANNA_OPENROUTER_FIRST_ENTRY_TIMEOUT_MS` (default 120000), wired as an `AgentCoordinator` constructor arg from `server.ts`.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | runClaudeSession gains the watchdog; failure path now also fires on first-entry stall | Confirm typed failure event still surfaces to client via existing fail-close |
| c3-2 | container | Server container hosts the coordinator + env wiring in server.ts | No new boundary; env arg threaded through existing constructor |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | Fail-close must append the failure as a transcript event before broadcast | comply |
| ref-provider-adapter | Failure must surface through the provider-agnostic turn/result shape, not an OpenRouter-specific branch in the UI | comply |
| ref-strong-typing | Watchdog code adds typed timer handle + constructor arg with no any/interface{} escape types | comply |
| ref-colocated-bun-test | New test sits next to agent.ts as agent.openrouter-watchdog.test.ts | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Coordinator test suite for this change must be colocated agent.*.test.ts under bun test | comply |
| rule-strong-typing | New timer handle, constructor arg, and watchdog callback use concrete types — no weak/escape types | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Watchdog impl | Arm/clear timer in runClaudeSession; OpenRouter-gated; interrupt+close on fire | src/server/agent.ts |
| Constructor arg | Add openrouterFirstEntryTimeoutMs? to AgentCoordinatorArgs + field + default | src/server/agent.ts |
| Env wiring | Parse KANNA_OPENROUTER_FIRST_ENTRY_TIMEOUT_MS and pass to AgentCoordinator | src/server/server.ts |
| Test | Stream emits session_token then hangs; assert turn_failed recorded + close called | src/server/agent.openrouter-watchdog.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema change | This is a runtime code change in src/server only; no c3x command, validator, hint, or template is modified | c3x check passes unchanged |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| agent.openrouter-watchdog.test.ts | Fails if a stalled OpenRouter stream does not record a turn failure | bun test src/server/agent.openrouter-watchdog.test.ts |
| runClaudeSession finally fail-close | Records recordTurnFailed when stream ends without final result | src/server/agent.ts |
| bun run lint | Side-effect seal + no-any still hold for the new code | bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Idle/silence timeout between any two entries | Broader than the reproduced bug; resets per entry and risks cutting healthy long Claude turns; user chose first-entry scope |
| Hard total turn cap | Would truncate legitimately long turns (workflows, background bash tasks) the codebase deliberately keeps alive |
| Apply to all SDK providers (Claude too) | Claude OAuth/PTY paths are healthy; adding a watchdog there risks regressions in the heavily-used path for no observed benefit |
| Validate model id before spawn instead | Does not fix the silent-hang class (a valid id can still stall); watchdog is the durable fail-close |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Watchdog cuts a slow-but-healthy OpenRouter first response | system_init is the SDK init echo and arrives before model inference; default 120s is generous and env-tunable | bun test (stall case) + manual run with a valid OpenRouter model |
| Timer leak across turns/sessions | Cleared on first entry AND in finally; one-shot per session start | code review + test asserts close() invoked once |
| Double-finalize with a late real result | Watchdog only acts while no entry seen; close() ends stream so no further entries processed | existing seq-accounting + test |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.openrouter-watchdog.test.ts | pass |
| bun test src/server/agent.openrouter-model.test.ts | pass (no regression) |
| bun run lint | 0 errors, warnings under cap |
