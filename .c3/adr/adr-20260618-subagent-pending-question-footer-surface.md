---
id: adr-20260618-subagent-pending-question-footer-surface
c3-seal: 160356851a531b1d9ff1d1a2e65c52a486c07d5b5b323d21eb472a1e6eba9ec2
title: subagent-pending-question-footer-surface
type: adr
goal: |-
    Surface a delegated subagent's pending `AskUserQuestion` / `ExitPlanMode`
    request at the bottom of the chat transcript (the footer surface directly
    above the composer), instead of only rendering it inline anchored to the
    historical `user_prompt` row that spawned the delegation. The actionable
    answer card moves to the footer; the inline subagent run shows a non-actionable
    "waiting for input..." status so there is exactly one place to answer.
status: accepted
date: "2026-06-18"
---

## Goal

Surface a delegated subagent's pending `AskUserQuestion` / `ExitPlanMode`
request at the bottom of the chat transcript (the footer surface directly
above the composer), instead of only rendering it inline anchored to the
historical `user_prompt` row that spawned the delegation. The actionable
answer card moves to the footer; the inline subagent run shows a non-actionable
"waiting for input..." status so there is exactly one place to answer.

## Context

A top-level subagent run is placed in `ChatTranscriptViewport` under the
`user_prompt` row whose id equals `run.parentUserMessageId`
(`runsByUserMessageId` map). When a long autonomous session scrolls past that
spawning message, a subagent that calls `AskUserQuestion` renders its
`SubagentPendingToolCard` buried mid-transcript, far above where the user is
reading. The server side is fully wired (`subagent_tool_pending` event →
`SubagentRunSnapshot.pendingTool` → card), and `notifySubagentToolPending`
pauses the run timeout, so the delegation waits indefinitely for an answer the
user cannot find. Observed in session 2c7d88cc: the user could not see the
question, manually cancelled the run (USER_CANCELLED after ~10 min), and told
the agent to continue without delegating. The main agent's own
`AskUserQuestion` does not have this problem because it is naturally the last
transcript entry. Affected topology is the client: the chat-page viewport
(c3-112) owns placement; the messages-renderer (c3-114) owns
`SubagentMessage` / `SubagentPendingToolCard`.

## Decision

Render the actionable pending-question card in the existing
`ChatTranscriptViewport` footer (`listFooter`, the same surface that already
hosts queued messages / processing / workflows, pinned above the composer by
`maintainScrollAtEnd`), iterating every run in `subagentRuns` whose
`pendingTool` is non-null. Add a `suppressPendingTool` prop to `SubagentMessage`
so the inline run rendered in the transcript body shows only its
"waiting for input..." activity label and does NOT render a second actionable
card. This reuses the existing `SubagentPendingToolCard` and the already-wired
`onSubagentAskUserQuestionSubmit` / `onSubagentExitPlanModeSubmit` handlers — no
server, protocol, or read-model change. Chosen over moving the run's anchor to
the latest user message (breaks delegate-call attribution and the
`parentUserMessageId` contract) and over a separate composer overlay (new
focus-policy surface, larger blast radius).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-112 | component | chat-page viewport owns transcript placement + footer; the new pending surface lives in its listFooter | Confirm footer addition consumes the read-model snapshot only (no write path) |
| c3-114 | component | messages-renderer owns SubagentMessage / SubagentPendingToolCard; new suppressPendingTool prop changes inline render | Confirm prop is additive and default-false (legacy callers unchanged) |
| c3-1 | container | client container holds both components | No container responsibility change; verify no-delta |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-cqrs-read-models | New footer surface must read the SubagentRunSnapshot push (read path), never trigger a write/replay | comply |
| ref-strong-typing | New prop + pending-run selection must use named types (SubagentRunSnapshot, SubagentPendingTool), no any/untyped literals | comply |
| ref-tool-hydration | Pending card already hydrates via SubagentPendingToolCard; footer reuse must not introduce a provider-specific shape | comply |
| ref-ws-subscription | subagentRuns snapshot arrives over the typed WS subscription consumed by c3-112; footer only reads it | review |
| ref-zustand-store | subagentRuns is sourced from the client store; the footer selector must read it without mutating | review |
| ref-colocated-bun-test | New behavior ships colocated *.test.tsx next to changed files (cited by sibling client components) | comply |
| ref-local-first-data | Pending-run state is the event-sourced local-first snapshot; footer is a pure consumer | N.A - no new persisted state introduced |
| ref-provider-adapter | Pending card is provider-agnostic already; footer reuse adds no provider branch | N.A - no provider-specific code added |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Client values (props, selectors) crossing component boundaries need named TS types; the new prop + pending-run list must comply | comply |
| rule-colocated-bun-test | New behavior ships colocated *.test.tsx next to the changed files | comply |
| rule-zustand-store | The pending-run derivation reads the client store snapshot; must follow stable-selector store rules (no fresh ?? [] ref) | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| SubagentMessage | Add suppressPendingTool?: boolean; gate inline SubagentPendingToolCard on !suppressPendingTool | src/client/components/messages/SubagentMessage.tsx |
| ChatTranscriptViewport | Pass suppressPendingTool to renderRunTree's SubagentMessage; compute pending-question runs from subagentRuns; render actionable cards in listFooter | src/client/app/ChatPage/ChatTranscriptViewport.tsx |
| Tests | SubagentMessage suppress prop test; footer pending-surface test | SubagentMessage.test.tsx, ChatTranscriptViewport.test.tsx |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI / validator / schema surface changes; this is a client-only render fix | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| SubagentMessage.test.tsx | Asserts inline pending card hidden + status kept when suppressPendingTool true; shown when false | bun test src/client/components/messages/SubagentMessage.test.tsx |
| ChatTranscriptViewport.test.tsx | Asserts collectPendingQuestionRuns selects only runs with a pendingTool, oldest request first, deterministic tie-break, and narrows pendingTool non-null | bun test src/client/app/ChatPage/ChatTranscriptViewport.test.tsx |
| bun run lint | Strong-typing + no-any guard on the new prop, exported helper, and footer selector | bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Re-anchor pending run to the latest user_prompt row | Breaks parentUserMessageId attribution contract used by run placement and analytics; reorders history |
| Separate composer-level modal/overlay for subagent questions | Adds a new focus-policy surface and larger blast radius than reusing the existing footer + card |
| Leave inline card, also render in footer (duplicate) | Two actionable cards for one question is confusing; suppress inline keeps a single answer surface |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Double-render of the answer card (inline + footer) | suppressPendingTool makes inline status-only; footer is the sole actionable card | ChatTranscriptViewport.test.tsx asserts single actionable card |
| Render-loop from inline ?? [] selector over subagentRuns | Use a memoized derivation with stable empty handling per project render-loop rule | bun run lint + existing renderForLoopCheck patterns |
| Legacy SubagentMessage callers regress | New prop defaults false → unchanged inline behavior for KannaTranscript path | SubagentMessage.test.tsx default-false case |

## Verification

| Check | Result |
| --- | --- |
| bun test src/client/components/messages/SubagentMessage.test.tsx | pass (33 tests) |
| bun test src/client/app/ChatPage/ChatTranscriptViewport.test.tsx | pass (5 tests) |
| bun run lint | clean (0 errors, within warning cap) |
