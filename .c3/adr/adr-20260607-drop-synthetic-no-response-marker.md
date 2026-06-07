---
id: adr-20260607-drop-synthetic-no-response-marker
c3-seal: f10212cdc1e18b15891df5fbe197c79f0ca54a8811e89063ddca1d9d508081a5
title: drop-synthetic-no-response-marker
type: adr
goal: |-
    Change `normalizeClaudeStreamMessage` (c3-210 agent-coordinator) so the Claude
    CLI's benign synthetic turn-end markers (`model:"<synthetic>"`,
    `isApiErrorMessage:false`, text in the CVH-family set "No response requested." /
    "No action needed." / "Nothing needed from you.") are **dropped entirely**
    (`return []`) instead of being normalized into an `assistant_text` transcript
    entry. They must still never become a red `api_error` card, and a genuine
    `isApiErrorMessage:true` message with the same text must still become an
    `api_error`.
status: implemented
date: "2026-06-07"
---

## Goal

Change `normalizeClaudeStreamMessage` (c3-210 agent-coordinator) so the Claude
CLI's benign synthetic turn-end markers (`model:"<synthetic>"`,
`isApiErrorMessage:false`, text in the CVH-family set "No response requested." /
"No action needed." / "Nothing needed from you.") are **dropped entirely**
(`return []`) instead of being normalized into an `assistant_text` transcript
entry. They must still never become a red `api_error` card, and a genuine
`isApiErrorMessage:true` message with the same text must still become an
`api_error`.

## Context

PTY-driver sessions deliver each follow-up prompt over the kanna channel
(`notifications/claude/channel`). The Claude CLI answers a channel/notification
message that does not request a response by writing a synthetic placeholder
assistant message ("No response requested.") at the very start of the turn,
before the real model reply streams. Session
`ca33a30b-012e-485a-abd5-c045828e4db1` shows this on every turn from #2 on:
each turn opens with a `<synthetic>` "No response requested." line, then the
real `claude-opus-4-8` reply lands 10-40s later. Today
`normalizeClaudeStreamMessage` (agent.ts:560-650) correctly suppresses the red
api_error card for these markers but then falls through and emits them as a
normal `assistant_text`. Consequences observed in the transcript: (1) the
junk placeholder renders as an assistant bubble — the user even copy-pasted it
back as if it were the reply; (2) the early assistant bubble flips the chat UI
out of its waiting/thinking state, so the spinner vanishes and the chat looks
idle while the real reply is still pending; (3) on turns where the real reply
is empty or an api_error follows, the user is left with only "No response
requested." and a dead spinner. Affected topology: c3-210 agent-coordinator,
which owns the provider→transcript normalization choke point shared by the SDK
and PTY drivers.

## Decision

In `normalizeClaudeStreamMessage`, after the existing api_error branch, add a
guard: if the message is a benign synthetic placeholder (synthetic model + text
in `SYNTHETIC_NON_ERROR_PLACEHOLDERS` + not an api-error message), return `[]`.
Dropping at this single shared choke point fixes both the SDK and PTY drivers in
one place and keeps the provider-agnostic transcript model clean
(ref-provider-adapter). The placeholder always arrives as a lone text block
(never alongside `tool_use`), so dropping it loses no tool call or real content.
The api_error branch stays first, so a genuine `isApiErrorMessage:true` message
carrying the same text still classifies as `api_error` (precedence preserved).
The turn lifecycle is unaffected: turn termination is driven by the separate
`system/turn_duration` → `result` message, not by this placeholder.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | normalizeClaudeStreamMessage lives here; its transcript-event output contract changes (benign synthetic markers no longer emitted) | Confirm Contract "Transcript events OUT" still holds; benign markers are non-events |
| c3-225 | component | Consumes the same normalization for PTY channel-delivered turns; the fix removes the per-turn placeholder bubble it surfaced | Confirm no PTY parser change needed — drop happens upstream in agent.ts normalizer |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | The normalizer is the provider→unified-transcript adapter; dropping a CLI-specific artifact keeps the UI from branching on provider noise | comply |
| ref-event-sourcing | Transcript entries are appended events; removing a meaningless event must not break turn replay/finalization (driven by the separate result event) | comply |
| ref-tool-hydration | This change drops a lone synthetic text marker and touches no tool_call/tool_use entries, so the single tool-hydration path is unaffected | N.A - no tool entry touched; hydration path unchanged |
| ref-colocated-bun-test | The behavior change is covered by agent.test.ts next to agent.ts | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Updated/added cases live in src/server/agent.test.ts colocated with agent.ts | comply |
| rule-strong-typing | The edited branch returns the existing TranscriptEntry[] type; no any/untyped values introduced | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/server/agent.ts | Add if (isBenignSyntheticPlaceholder) return [] after the api_error branch in normalizeClaudeStreamMessage; update the SYNTHETIC_NON_ERROR_PLACEHOLDERS comment to say the markers are dropped | src/server/agent.ts:560-635 |
| src/server/agent.test.ts | Change the benign-placeholder test.each to assert entries is empty (was assistant_text); keep the api_error-wins test | src/server/agent.test.ts:273-303 |
| CLAUDE.md | Update the comment-level intent: benign synthetic markers are dropped, not rendered as assistant text | repo CLAUDE.md (no dedicated section; code comment is canonical) |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema change | This ADR changes product code under c3-210 only; it does not touch the c3x CLI, validators, templates, or schemas | git diff shows no changes under the c3x tool tree |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/agent.test.ts | Asserts benign synthetic placeholders normalize to zero entries; asserts api_error precedence still holds | bun test src/server/agent.test.ts |
| bun run lint | Strong-typing + side-effect seal stay green on the edited branch | bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep emitting as assistant_text (status quo) | This is the bug: it pollutes the chat and drops the spinner before the real reply streams |
| Filter only in the PTY parser (jsonl-to-event.ts) | The synthetic marker also reaches the SDK stream; fixing at the shared normalizer covers both drivers in one place and avoids duplicate logic |
| Suppress the channel-delivery placeholder at the CLI/transport layer | Kanna does not control the Claude CLI's synthetic-message emission; the normalizer is the only surface Kanna owns |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A real assistant reply that legitimately equals "No response requested." gets dropped | Guard requires model:"<synthetic>"; real replies carry a real model id (e.g. claude-opus-4-8) and are untouched | "regular assistant text is unaffected" test in agent.test.ts |
| A synthetic placeholder carrying a tool_use block would lose the tool call | These markers are always a lone text block; api_error precedence and the existing content loop are unchanged for any non-benign synthetic message | agent.test.ts api_error + regular-text cases stay green |
| Turn never finalizes because the dropped entry was load-bearing | Turn end is driven by the separate system/turn_duration→result message, not the placeholder | bun test src/server/agent.test.ts (turn lifecycle suites) |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.test.ts | PASS — benign placeholders yield 0 entries; api_error precedence preserved |
| bun run lint | PASS — no new warnings/errors on edited files |
| C3X_MODE=agent c3x check | PASS — no doc/code drift for c3-210 |
