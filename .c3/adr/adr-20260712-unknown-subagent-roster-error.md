---
id: adr-20260712-unknown-subagent-roster-error
c3-seal: 0df0a1fe161c9244c7090b0891f2b0feed141e7261bf150fd5f4867691596431
title: unknown-subagent-roster-error
type: adr
goal: |-
    Make an unresolvable `delegate_subagent` target self-correcting: the
    `UNKNOWN_SUBAGENT` error must carry the LIVE subagent roster (read from
    settings at error time), and the MCP tool must reject an unresolvable
    `subagent_id` BEFORE `delegateRun` so no ghost failed-run record (and no
    failed-run card in the UI) is persisted for a guessed id.
status: accepted
date: "2026-07-12"
---

# unknown-subagent-roster-error

## Goal

Make an unresolvable `delegate_subagent` target self-correcting: the
`UNKNOWN_SUBAGENT` error must carry the LIVE subagent roster (read from
settings at error time), and the MCP tool must reject an unresolvable
`subagent_id` BEFORE `delegateRun` so no ghost failed-run record (and no
failed-run card in the UI) is persisted for a guessed id.

## Context

The roster in the system prompt (`buildKannaSystemPromptAppend`) is rendered
once at spawn time. Subagents created mid-session are invisible to the running
session; the model then guesses a plausible id (observed: `"claude"` in chat
session `4adf8a62-67ae-4a23-a24c-e66f88e7052d`-adjacent turns). The failure
path persisted a synthetic run (`subagentName` = the guessed string,
`provider: "claude"`, `model: ""`) — rendered by the UI as the confusing
"claudeclaude / Unknown subagent / Subagent claude not found" card — and
returned an error containing no roster, so the model repeated the same guess.
Affected topology: c3-210 agent-coordinator (orchestrator owns resolution and
the failure path; the delegate MCP tool consumes its lookup).

## Decision

Two-layer fix, one source of truth. (1) New public
`describeUnknownSubagent(requested)` on `SubagentOrchestrator` builds the
error text from the CURRENT settings snapshot: each subagent as
`- <name> [id=<id>]` with manual-trigger entries annotated
"(manual — requires user @-mention)", plus a retry instruction; empty roster
points at Settings → Subagents. `delegateRun`'s UNKNOWN_SUBAGENT failure uses
it. (2) The `delegate_subagent` tool handler calls the existing
`findSubagent` before `delegateRun` and returns the same roster text as
`isError` when unresolvable — no run record is created. Resolution semantics
(exact id, else unambiguous exact name — adr-20260617) are unchanged.

## Affected Topology

| Entity | Type | Why affected | Governance review | Evidence |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns delegateRun failure path + findSubagent; gains describeUnknownSubagent surface; delegate tool adds pre-delegation rejection | Contract rows updated: findSubagent row reworded, describeUnknownSubagent row added | c3-210#n6547@v1:sha256:edfe71da9a694d6d1d05a6caba881976a3ed576c1e0244ae63253eda90947eab |
| c3-2 | container | Parent of c3-210 | No-delta: container goal slice unchanged, only error ergonomics hardened | c3-2#n6003@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce |

## Compliance Refs

| Ref | Why required | Action | Evidence |
| --- | --- | --- | --- |
| ref-colocated-bun-test | New roster-in-error tests sit next to the orchestrator and the tool | comply | ref-colocated-bun-test#n8135@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." |
| ref-event-sourcing | delegateRun failure path still appends subagent_run_started + fail event; the tool-level rejection intentionally appends nothing (no run exists) | comply | ref-event-sourcing#n8201@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa "Every state mutation is first captured as an immutable event appended to a JSONL log; system state is derived by replay + periodic snapshot compaction." |

## Compliance Rules

| Rule | Why required | Action | Evidence |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Tests colocated in subagent-orchestrator.test.ts and delegate-subagent.test.ts | comply | rule-colocated-bun-test#n8470@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f "Every Kanna test must sit next to the file under test, share its basename, and run under bun test. No __tests__/ directories, no separate test packages, no " |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Roster describer | Add public describeUnknownSubagent(requested) reading the live settings snapshot | src/server/subagent-orchestrator.ts |
| delegateRun | UNKNOWN_SUBAGENT failRun message = describeUnknownSubagent(args.subagentId) | src/server/subagent-orchestrator.ts |
| MCP tool | Reject unresolvable subagent_id via findSubagent before delegateRun; return roster text as isError | src/server/kanna-mcp-tools/delegate-subagent.ts |
| Tests | Roster listed (manual annotated); empty-roster Settings hint; tool rejects with roster and zero delegateRun calls | src/server/subagent-orchestrator.test.ts, src/server/kanna-mcp-tools/delegate-subagent.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-210 Contract | Reword findSubagent row (also used by delegate tool pre-check); add describeUnknownSubagent row | c3x read c3-210 --section Contract |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| subagent-orchestrator.test.ts | Asserts roster content + manual annotation + empty-roster hint in UNKNOWN_SUBAGENT errorMessage | bun test src/server/subagent-orchestrator.test.ts |
| delegate-subagent.test.ts | Asserts early rejection with roster and no delegateRun call | bun test src/server/kanna-mcp-tools/delegate-subagent.test.ts |
| bun run lint | Side-effect seal + types stay clean | bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Push a roster refresh into the live session on settings change (respawn / session_token wipe) | Destroys warm main-session context on every settings edit; the roster-in-error path self-corrects at strictly lower cost |
| Fuzzy / prefix matching on subagent_id | Could silently delegate to the wrong subagent; fail-closed + roster keeps the model in control |
| Keep persisting the synthetic failed run for visibility | The tool call + isError result is already visible in the transcript; the ghost run rendered a misleading "claudeclaude" card with fabricated provider/model |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Roster text leaks into UI unexpectedly | Tool-level rejection returns only to the model; delegateRun path unchanged shape (errorMessage string) | Existing SubagentErrorCard renders errorMessage verbatim as before |
| Fakes drift (tool tests stub findSubagent) | Fakes updated in the same PR; orchestrator tests cover the real resolver | bun test both suites |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/subagent-orchestrator.test.ts | pass (incl. 2 new roster cases) |
| bun test src/server/kanna-mcp-tools/delegate-subagent.test.ts | pass (incl. early-rejection case) |
| bun run test (full suite) | 3134 pass / 0 fail |
| bun run lint | 0 errors, 0 warnings |
| bun run typecheck | clean |
