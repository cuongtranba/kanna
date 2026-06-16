---
id: adr-20260616-subagent-run-in-background
c3-seal: 3b626b65189158013675025ff71f9c7cc7c92f5014c42186c4707fa6f04f61c6
title: subagent-run-in-background
type: adr
goal: |-
    Make `mcp__kanna__delegate_subagent` support a `run_in_background: true` mode
    that returns immediately with `{status:"async_launched", run_id}` instead of
    blocking the main turn, then delivers the subagent's final reply back into the
    main chat as a fresh turn when the run terminates. Re-entry is driver-aware:
    the SDK driver pushes a follow-up turn natively via the live session's
    `sendPrompt`; the PTY driver uses the existing auto-continue wake. Kanna's
    orchestrator stays the single owner of subagent runs (no adoption of the SDK's
    native `agents`/`AgentDefinition.background` path). Implements the
    `run_in_background` gap dispositioned "pursue" in
    adr-20260616-subagent-delegation-parity-gaps.
status: implemented
date: "2026-06-16"
---

## Goal

Make `mcp__kanna__delegate_subagent` support a `run_in_background: true` mode
that returns immediately with `{status:"async_launched", run_id}` instead of
blocking the main turn, then delivers the subagent's final reply back into the
main chat as a fresh turn when the run terminates. Re-entry is driver-aware:
the SDK driver pushes a follow-up turn natively via the live session's
`sendPrompt`; the PTY driver uses the existing auto-continue wake. Kanna's
orchestrator stays the single owner of subagent runs (no adoption of the SDK's
native `agents`/`AgentDefinition.background` path). Implements the
`run_in_background` gap dispositioned "pursue" in
adr-20260616-subagent-delegation-parity-gaps.

## Context

`delegateRun` (`subagent-orchestrator.ts:474`) is blocking-only: the MCP tool
awaits the terminal `DelegationOutcome` and the main agent's turn is pinned for
the whole subagent run (default 600s timeout). Native claude-code instead
returns `{status:'async_launched', agentId, outputFile}` immediately and
re-enters via a `<task_notification>` (claude-code `AgentTool.tsx:754-763`,
`query.ts:1570-1577`).

Kanna runs each subagent as a fresh full `startClaudeSession`/`query()` via the
orchestrator (`subagent-provider-run.ts:82`) — provider-agnostic (Claude or
Codex), event-sourced, surfaced in the UI subagent panel, guarded by
depth/loop/permit limits. Adopting the SDK's native `agents` option would gut
all of that, so it is rejected (see Alternatives).

Re-entry mechanism differs by driver:

- **SDK driver** keeps the main chat session alive with a streaming input queue;
`ClaudeSessionHandle.sendPrompt(content)` (`agent.ts:170`, pushes into
`promptQueue` at `agent.ts:1104`) already delivers follow-up turns natively.
This is the SDK-native re-entry the Anthropic SDK exposes — no hack.
- **PTY driver** cannot inject an `isMeta` line (it is dropped by
`jsonl-to-event.ts`), so re-entry must route through the Kanna-owned
auto-continue `ScheduleManager` via `scheduleAgentWakeup`
(`agent.ts:3543`), the same mechanism used for agent self-wake and
pending-workflow harvest (adr-20260603-agent-self-scheduled-wake).

Affected topology: the agent-coordinator orchestrator (c3-210) gains a
non-blocking spawn path + a terminal-completion delivery hook; the kanna-mcp
host (c3-226) gains the `run_in_background` tool param; auto-continue (c3-227)
gains a new wake `source` for PTY delivery.

## Decision

Keep the orchestrator; add a non-blocking background path with driver-aware
delivery.

1. **Orchestrator non-blocking spawn.** `delegateRun` gains `background?: boolean`.
When set, the orchestrator starts the run via the existing `spawnRun`
plumbing (permit, RunState, timeout, abort, event-sourcing) but does NOT
await it — it returns `{status:"async_launched", runId}` synchronously after
the `subagent_run_started` event is appended, and on terminal invokes a new
dep `onBackgroundRunComplete(chatId, runId, outcome)` carrying the final
`DelegationOutcome` (text or error). The active background run still holds a
permit while in flight (it is an active turn), bounding concurrency by the
existing permit pool; no new live-session registry is needed (background runs
are one-shot, not keep-alive).
2. **Driver-aware delivery in agent.ts.** `onBackgroundRunComplete` builds a
notification prompt ("Background subagent <name> finished. Reply: <text>" /
"...failed: <error>") and delivers it:
SDK: if the main chat has a live SDK `ClaudeSessionHandle`, call
`session.sendPrompt(notification)`.

PTY: call `scheduleAgentWakeup({source:"subagent_background", delayMs:0,
prompt:notification})`. The new `source` is **exempt from the
`maxAgentWakes` runaway cap** — it is bounded result delivery, not a
self-poll; exhausting the cap would silently drop genuine subagent
results. Concurrency is already bounded by the permit pool + run timeout.

1. **MCP tool param.** `delegate-subagent.ts` gains
`run_in_background?: boolean`. When true it calls the background path and
returns `{status:"async_launched", run_id}`. `keep_alive` and
`run_in_background` are mutually exclusive (keep-alive is the warm multi-turn
path; background is fire-and-deliver) — both set → `isError` with guidance.
2. **No SDK `agents` adoption.** Background runs remain Kanna-orchestrated.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | Adds delegateRun({background}) non-blocking path + onBackgroundRunComplete dep on the orchestrator contract | Review Contract table; add the two new surfaces |
| c3-226 | component | kanna-mcp host adds run_in_background tool param + async_launched response shape | Review tool registration + mutual-exclusion guard |
| c3-227 | component | auto-continue gains subagent_background wake source (PTY delivery) exempt from runaway cap | Review wake-source enum + cap-exemption |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Background path must stay provider-agnostic; delivery hook fires for Claude and Codex subagents alike without branching transcript shape | comply |
| ref-event-sourcing | Background run lifecycle (started/completed/failed) stays event-sourced so restart recovery (recoverInterruptedRuns) fails orphaned background runs identically to blocking ones | comply |
| ref-tool-hydration | async_launched MCP result hydrates into a unified transcript entry, not a provider-specific shape | review |
| ref-colocated-bun-test | New orchestrator/MCP/agent code ships colocated *.test.ts | comply |
| ref-strong-typing | New DelegationOutcome variant + onBackgroundRunComplete signature use concrete types, no any/untyped maps | comply |
| ref-local-first-data | Background run state is event-sourced local-first like every other run; cited by c3-226 | comply |
| ref-cqrs-read-models | The subagent_background wake routes through the auto-continue read-model (c3-227); delivery is a command, the schedule is derived state | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Each touched file (subagent-orchestrator.ts, delegate-subagent.ts, agent.ts) ships its colocated test additions | comply |
| rule-strong-typing | background/async_launched/subagent_background surfaces follow the strong-typing golden pattern | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Orchestrator | Add background? to delegateRun; non-blocking spawnRun invocation; onBackgroundRunComplete dep; return {status:"async_launched", runId} | src/server/subagent-orchestrator.ts |
| Orchestrator test | Background spawn returns immediately; terminal fires onBackgroundRunComplete with completed + failed outcomes; permit released on terminal; cancel cascade closes a background run | src/server/subagent-orchestrator.test.ts |
| MCP tool | run_in_background? param; mutual-exclusion with keep_alive; async_launched response | src/server/kanna-mcp-tools/delegate-subagent.ts(+test) |
| agent.ts wiring | onBackgroundRunComplete builds notification; SDK sendPrompt vs PTY scheduleAgentWakeup({source:"subagent_background"}); main-session lookup | src/server/agent.ts |
| Wake source | Add "subagent_background" to scheduleAgentWakeup source union; exempt from maxAgentWakes increment | src/server/agent.ts |
| System prompt | Document run_in_background in the delegate tool description + roster framing | src/server/kanna-mcp-tools/delegate-subagent.ts DESCRIPTION; src/shared/kanna-system-prompt.ts if framing changes |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI / validator / schema / template change; only ADR entities + component doc updates via c3x set/write | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/subagent-orchestrator.test.ts | Background spawn non-blocking + terminal-hook + permit/cancel behavior covered | src/server/subagent-orchestrator.test.ts |
| bun test src/server/kanna-mcp-tools/delegate-subagent.test.ts | run_in_background → async_launched; keep_alive mutual-exclusion error | src/server/kanna-mcp-tools/delegate-subagent.test.ts |
| bun test src/server/agent.test.ts | Driver-aware delivery: SDK sendPrompt called; PTY wake armed with subagent_background source exempt from cap | src/server/agent.test.ts |
| bun run lint | Side-effect seal + strong-typing hold on touched files | eslint.config.js |
| c3x check | c3-210/c3-226/c3-227 contracts match code after edits | c3x check output |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Adopt SDK-native ClaudeAgentOptions.agents + AgentDefinition.background | Replaces Kanna's orchestrator, event-sourced run records, UI subagent panel, depth/loop guards, OAuth-pool-per-run, and Codex parity; makes agent selection model-driven, breaking the "main agent always in loop" star topology (c3-210/c3-225/c3-226). Disproportionate rearchitecture for one param |
| Use the auto-continue wake for re-entry on BOTH drivers | The SDK driver already delivers follow-up turns natively via sendPrompt (the SDK's streaming-input multi-turn); routing it through the PTY-only wake hack would be strictly worse and couple SDK to a PTY-shaped mechanism |
| Count background-completion wakes against maxAgentWakes | Many parallel background subagents could exhaust the 25-wake budget and silently drop later completions; delivery is a real result, not a self-poll |
| Block until done but stream partial progress (no true background) | Does not solve the gap — the main turn is still pinned; partial progress already exists via onRunProgress |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Background run leaks a permit if delivery hook throws | onBackgroundRunComplete invocation wrapped in try/catch like onRunTerminal; permit released in spawnRun finally before delivery | bun test src/server/subagent-orchestrator.test.ts |
| SDK main session already closed when subagent finishes | Delivery checks for a live ClaudeSessionHandle; absent → fall back to PTY-style wake or drop with a logged warning (no throw) | bun test src/server/agent.test.ts |
| Restart loses an in-flight background run | recoverInterruptedRuns already fails orphaned running runs on boot; background runs use the same event path so they recover identically | bun test src/server/subagent-orchestrator.test.ts |
| Notification turn floods the chat under many parallel background runs | Permit pool (default 4) bounds concurrent background runs; each delivers one turn | permit accounting test in subagent-orchestrator.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/subagent-orchestrator.test.ts | Background path + permit/cancel/terminal-hook green |
| bun test src/server/kanna-mcp-tools/delegate-subagent.test.ts | async_launched + mutual-exclusion green |
| bun test src/server/agent.test.ts | Driver-aware delivery green |
| bun run lint | 0 errors, warnings at/under cap |
| c3x check | c3-210/c3-226/c3-227 no FAIL after doc sync |
