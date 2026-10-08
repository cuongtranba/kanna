---
id: adr-20261008-unarmed-delivery-keeps-context
c3-seal: 0d828127ec768a00f1b1c63667ad56910b83411e3eda650f9cb43052900523e3
title: unarmed-delivery-keeps-context
type: adr
goal: Stop an un-armed background-subagent delivery from wiping the main agent's conversation. `deliverSubagentToMain` now clears main only when a loop is armed; with no loop armed it keeps the session token and warm session and wakes main with the task notification alone.
status: accepted
date: "2026-10-08"
---

## Goal

Stop an un-armed background-subagent delivery from wiping the main agent's conversation. `deliverSubagentToMain` now clears main only when a loop is armed; with no loop armed it keeps the session token and warm session and wakes main with the task notification alone.

## Context

Every background-subagent completion used to run `clearClaudeSessionContext` and append `context_cleared` before emitting `auto_continue_accepted`. For an armed loop that is correct: main is stateless-in-context by design and the task list is the plan. For an ordinary chat it is destructive.

Observed in chat `83f260f8`: the user brainstormed a feature with main, main launched two background researchers, and each completion cleared main. Main forgot the user's design answers and had to grep its own transcript to recover them, and the second completion cleared it again.

Un-armed deliveries already carry the subagent's `<result>` (capped at 4k chars) in the notification, so the clear bought nothing there: the result no longer needed a fresh prompt to ride alone.

## Decision

In `deliverSubagentToMainInner`, run `clearClaudeSessionContext` and append `context_cleared` only when `armed`. The un-armed branch emits `auto_continue_accepted` with the prompt and leaves the session token and warm session alone. `includeResult: !armed` and the 4k result cap are unchanged.

The un-armed prompt no longer claims the context was cleared. It is the notification, a blank line, then `describeLastPlan` (when a loop tombstone recorded a plan) followed by `Then decide the next action.` or `Then decide whether to retry, try another approach, or stop.` `describeLastPlan` stays because the next turn can still be a fresh spawn after a restart or an idle reap.

The armed path is untouched: clear, `context_cleared`, then `composeLoopWakePrompt`.

Accepted cost: an un-armed chat's main context grows with each delivery; the Claude CLI's own auto-compaction bounds it.

Known residual: `stopLoop` never clears, so a delivery after a disarm resumes the last orchestrator session. A user message after a disarm already behaves that way.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns deliverSubagentToMain; its un-armed branch no longer clears main or says the context was cleared | c3-210#n11223@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | Confirm the armed branch still clears and appends context_cleared |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/agent.test.ts src/server/agent.notification-loop-scenario.test.ts src/server/claude-loop-commands.test.ts | Un-armed deliveries keep the session token and append no context_cleared; the armed delivery still nulls the token, closes the warm session and appends one context_cleared |
