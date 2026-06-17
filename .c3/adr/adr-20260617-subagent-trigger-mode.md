---
id: adr-20260617-subagent-trigger-mode
c3-seal: 4078cea0807be2df5e3308e17611aabb5a1e52c573fd7e83d53708123bae9c50
title: subagent-trigger-mode
type: adr
goal: |-
    Add a per-subagent `triggerMode` (`"auto" | "manual"`) so the main model may
    auto-delegate only to `auto` subagents, while `manual` subagents run only when
    the user `@agent/<name>`-mentions them in the message that started the turn.
    Enforced server-side as a hard block (`MANUAL_ONLY`), not by prompt suggestion.
status: implemented
date: "2026-06-17"
uses:
    - c3-210
---

## Goal

Add a per-subagent `triggerMode` (`"auto" | "manual"`) so the main model may
auto-delegate only to `auto` subagents, while `manual` subagents run only when
the user `@agent/<name>`-mentions them in the message that started the turn.
Enforced server-side as a hard block (`MANUAL_ONLY`), not by prompt suggestion.

## Context

A subagent's `description` is injected verbatim into the MAIN model's
system-prompt roster (`buildKannaSystemPromptAppend`). Descriptions written as
imperatives aimed at the subagent (e.g. "For every code change request, follow
the four phases") are read by the main model as instructions to itself, so it
auto-delegates unrequested (observed: chat
`9a17fefa-f9d1-4091-ad95-4c9b6b0c011d` delegated to `4-golden-rules` on a plain
"implement this issue" prompt). Users need explicit control over which
subagents are auto-delegatable vs user-gated. Affected: c3-210
(agent-coordinator) which owns delegation resolution + the delegation context.

## Decision

Add `triggerMode` to `Subagent` (default `auto`, read-side coercion, no on-disk
migration). The system-prompt roster splits into "## Available subagents"
(auto, delegatable) and a gated "## Manual subagents" section. The hard gate
lives in `delegateRun`: a `manual` target whose id is not in the turn's
`mentionedSubagentIds` set fails `MANUAL_ONLY`. The mention set is threaded from
`agent.ts` (the user-prompt `parseMentions` result) through
`KannaMcpDelegationContext.getMentionedSubagentIds` into the delegate tool.
Sub-spawn contexts pass an empty set — a subagent cannot drive a manual one.
Centralising the gate in `delegateRun` keeps one enforcement point for both the
MCP tool and tests.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | Owns delegateRun/findSubagent + builds the delegation context; gate + new input land here | Update Contract rows for delegateRun (mention gate) + the new getMentionedSubagentIds input + MANUAL_ONLY outcome |
| c3-2 | container | Parent of c3-210 | No-delta: container goal slice unchanged; internal delegation rule widened only |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | The MANUAL_ONLY failure appends subagent_run_started + fail event before returning, like UNKNOWN_SUBAGENT | comply |
| ref-colocated-bun-test | New tests sit next to each touched module | comply |
| c3-210 | Added by c3x wire; fill why this target must be reviewed or complied with. | review-and-refine |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Orchestrator + system-prompt + UI tests colocated with their modules | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Type | SubagentTriggerMode + field on Subagent/Input/Patch; MANUAL_ONLY code | src/shared/types.ts |
| Persistence | normalize default auto + create/patch mapping + ws-router fallback | src/server/app-settings.ts, src/server/ws-router.ts |
| Roster | split auto/manual sections | src/shared/kanna-system-prompt.ts |
| Gate | mentionedSubagentIds arg + MANUAL_ONLY block | src/server/subagent-orchestrator.ts |
| Context | getMentionedSubagentIds on delegate context + kanna-mcp | src/server/kanna-mcp-tools/delegate-subagent.ts, src/server/kanna-mcp.ts |
| Wiring | mentionedSubagentIdsByChat map + both delegationContext sites | src/server/agent.ts |
| UI | Trigger SegmentedControl + draft/dirty/default | src/client/app/SubagentsSection.tsx |
| Error UI | MANUAL_ONLY badge | src/client/components/messages/SubagentErrorCard.tsx |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-210 Contract | delegateRun rows note the manual gate; add getMentionedSubagentIds IN row + MANUAL_ONLY note on findSubagent path | c3x read c3-210 --section Contract |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| subagent-orchestrator.test.ts | Asserts MANUAL_ONLY without mention, runs with mention, auto ignores set | bun test src/server/subagent-orchestrator.test.ts |
| kanna-system-prompt.test.ts | Asserts roster split | bun test src/shared/kanna-system-prompt.test.ts |
| bun run lint | Side-effect seal + types clean | bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Prompt-only (tell model to gate manual) | Prompt guidance already ignored; server enforcement is deterministic |
| Gate in the MCP tool layer | Two lookup/gate sites would diverge; orchestrator is the single source |
| Hide manual subagents from the prompt entirely | Needs per-turn prompt rebuild — breaks PTY (system prompt set once at spawn) |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Manual subagent driven by a sub-spawn | Sub-spawn context passes empty mention set | Code review of agent.ts subagent delegationContext |
| Legacy entries break on required field | Read-side default auto, no migration write | app-settings.test legacy-default test |

## Verification

| Check | Result |
| --- | --- |
| bun test | 2520 pass, 0 fail |
| bun run lint | 0 errors, 0 warnings |
| Manual browser check | Trigger control renders, toggles, persists across reload |
| c3x check --only c3-210 | no drift |
