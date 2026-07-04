---
id: adr-20260617-subagent-id-or-name-resolution
c3-seal: ce2edc1ae19d7c9235fb2048912e024cb23d4c887b0dcf18e6750e54d2c86c46
title: subagent-id-or-name-resolution
type: adr
goal: |-
    Make `SubagentOrchestrator` resolve the `delegate_subagent` / `findSubagent`
    `subagent_id` argument by **either the subagent's UUID `id` or its exact
    `name`**, instead of UUID `id` only. Today the main model frequently passes the
    human-readable roster name (e.g. `4-golden-rules`) where the code requires the
    UUID, producing a spurious `UNKNOWN_SUBAGENT` failure even though the subagent
    exists.
status: implemented
date: "2026-06-17"
uses:
    - c3-210
---

## Goal

Make `SubagentOrchestrator` resolve the `delegate_subagent` / `findSubagent`
`subagent_id` argument by **either the subagent's UUID `id` or its exact
`name`**, instead of UUID `id` only. Today the main model frequently passes the
human-readable roster name (e.g. `4-golden-rules`) where the code requires the
UUID, producing a spurious `UNKNOWN_SUBAGENT` failure even though the subagent
exists.

## Context

The roster injected into the system prompt
(`buildKannaSystemPromptAppend`) lists each subagent's `name`, `id`, and
`description`. The MCP tool `mcp__kanna__delegate_subagent` takes a
`subagent_id`. Resolution in `subagent-orchestrator.ts` is strict id-equality
(`subagents.find((s) => s.id === args.subagentId)` at delegateRun, and the same
in `findSubagent`). When the model passes the readable name the lookup misses
and `delegateRun` fails with `UNKNOWN_SUBAGENT "Subagent <name> not found"`.

Observed in chat session `9a17fefa-f9d1-4091-ad95-4c9b6b0c011d`: model called
`delegate_subagent({subagent_id:"4-golden-rules"})`, got `UNKNOWN_SUBAGENT`,
then fell back to the native `Agent` tool — one wasted round-trip. This is a
recurring model-ergonomics gap, not a one-off. Affected topology: c3-210
agent-coordinator (the orchestrator owns delegation resolution).

## Decision

Add a single private resolver `resolveSubagent(idOrName)` on the orchestrator:
try exact `id` match first; if none, fall back to an **unambiguous** exact
`name` match (exactly one subagent with that name). Ambiguous names (>1 match)
and misses return `undefined`, preserving the existing `UNKNOWN_SUBAGENT`
behavior. Route both `findSubagent` and `delegateRun`'s lookup through it.
Id-first ordering means a name that collides with another agent's id can never
shadow the id owner. This is the smallest change that fixes the ergonomics
without widening the public contract or touching the mention-parse path
(`@agent/<name>` already resolves names to ids upstream via `parseMentions`).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | Owns delegateRun / findSubagent; resolution rule changes here | Confirm Contract row for delegateRun still holds (id OR name now accepted); no surface signature change |
| c3-2 | container | Parent of c3-210 | No-delta: container goal slice unchanged, only internal resolution widened |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-colocated-bun-test | New test cases for name-resolution sit next to the orchestrator | comply |
| ref-event-sourcing | Failure path still appends subagent_run_started + fail event before returning | comply |
| c3-210 | Added by c3x wire; fill why this target must be reviewed or complied with. | review-and-refine |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | The added tests must be colocated in subagent-orchestrator.test.ts | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Resolver | Add private resolveSubagent(idOrName): Subagent | undefined (id-exact, then unambiguous name) |
| findSubagent | Delegate to resolveSubagent | src/server/subagent-orchestrator.ts:286 |
| delegateRun | Replace inline subagents.find((s) => s.id === ...) with resolveSubagent | src/server/subagent-orchestrator.ts:530 |
| Tests | Add cases: resolve by name; id wins over name; ambiguous name → UNKNOWN_SUBAGENT | src/server/subagent-orchestrator.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-210 Contract | Reword delegateRun IN row: subagent resolved by id OR unambiguous name | c3x read c3-210 --section Contract |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| subagent-orchestrator.test.ts | Asserts name resolution, id precedence, ambiguous-name failure | bun test src/server/subagent-orchestrator.test.ts |
| bun run lint | Side-effect seal + types stay clean | bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Fix only the model prompt (tell it to pass UUID) | Prompt guidance is already present and routinely ignored; server hardening is deterministic |
| Resolve by name in the MCP tool layer before calling delegateRun | Two lookup sites (findSubagent + delegateRun) would still diverge; centralizing on the orchestrator keeps one source of truth |
| Accept any (even ambiguous) name match | Could silently delegate to the wrong subagent; ambiguity must fail closed |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Wrong-agent delegation on duplicate names | Id-first ordering + ambiguous-name returns undefined (fails as UNKNOWN_SUBAGENT) | Unit test: two agents same name → UNKNOWN_SUBAGENT |
| Name shadows another agent's id | Id match checked first, always wins | Unit test: id precedence |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/subagent-orchestrator.test.ts | pass (incl. new name-resolution cases) |
| bun run lint | 0 errors, 0 warnings |
| c3x check | no drift on c3-210 |
