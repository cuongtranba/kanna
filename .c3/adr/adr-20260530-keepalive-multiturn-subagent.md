---
id: adr-20260530-keepalive-multiturn-subagent
c3-seal: f0f320d8bc4347ceef92a9f5eb6799e22e3c240608dffbcf51c708aef70c8cc5
title: keepalive-multiturn-subagent
type: adr
goal: |-
    Let the main agent hold a Claude-PTY subagent session warm across multiple
    turns. `delegate_subagent({ keep_alive: true })` runs turn 1 and leaves the
    PTY REPL open instead of sending `/exit`; the main agent then drives further
    turns into the SAME warm process via `send_subagent_message({ run_id,
    prompt })` and tears it down with `close_subagent({ run_id })`. This changes
    the subagent run lifecycle from strictly single-turn (spawn → drain → exit)
    to optionally multi-turn (spawn → drain → register live session → N follow-up
    turns → close), while preserving the existing one-shot path as the default.
status: implemented
date: "2026-05-30"
---

## Goal

Let the main agent hold a Claude-PTY subagent session warm across multiple
turns. `delegate_subagent({ keep_alive: true })` runs turn 1 and leaves the
PTY REPL open instead of sending `/exit`; the main agent then drives further
turns into the SAME warm process via `send_subagent_message({ run_id,
prompt })` and tears it down with `close_subagent({ run_id })`. This changes
the subagent run lifecycle from strictly single-turn (spawn → drain → exit)
to optionally multi-turn (spawn → drain → register live session → N follow-up
turns → close), while preserving the existing one-shot path as the default.

## Context

Today every subagent run is one-shot: `runClaudeSubagent` spawns the PTY,
drains one turn, and the driver sends `/exit` on the first `result`. A new
turn means a full re-spawn — trust dialog, smoke gate, MCP reconnect, TUI
boot — which is prohibitively expensive for multi-turn orchestration (a
5-turn conversation pays that cold-start cost 5×). PR #333 shipped channel
prompt delivery (`pushChannelPrompt`, an MCP `notifications/claude/channel`
push) which proved a prompt can be delivered into a live session without TUI
paste collapse. The R-multi spike then proved a SECOND channel push into an
already-used idle REPL starts a fresh turn, and that interactive TUI claude
emits `system/turn_duration` (not `type:"result"`) per turn, which
`normalizeClaudeStreamMessage` already synthesizes into one `kind:"result"`
HarnessEvent per turn — so a per-turn drain returns once per turn over a
persistent iterator. Affected topology: c3-225 (claude-pty-driver) owns the
spawn + channel push, c3-210 (agent-coordinator) owns the orchestrator run
lifecycle, c3-226 (kanna-mcp-host) owns the delegate tool surface. Constraint:
keep-alive is Claude-PTY only (codex out of scope); the side-effect seal bars
`process.env` inside the orchestrator; strong-typing rule bars `any` at the
new boundaries.

## Decision

Add an opt-in `keepAlive` flag threaded from the MCP tool down through the
orchestrator and provider run into the PTY driver. The driver suppresses
`oneShotClose()` on the first result when `keepAlive` and exposes
`pushChannelPrompt` on the handle. The provider run (`runClaudeSubagent`)
drains turn 1 over a persistent async iterator, then returns a
`LiveTurnSource` (`runTurn` pushes a channel prompt + drains the next turn;
`close` shuts the REPL) instead of closing. The orchestrator keeps a
`liveSessions` registry keyed by `runId`: turn 1 runs through the existing
`spawnRun` plumbing (permit, RunState, timeout, abort, events) but on
completion registers a `LiveSession` rather than cleaning up; `sendToLiveRun`
drives follow-up turns (acquiring a permit only for the turn's drain);
`closeLiveRun` tears down. Two orthogonal limits: a permit bounds concurrent
ACTIVE turns (idle live sessions hold no permit), and `KANNA_SUBAGENT_MAX_LIVE`
bounds live PROCESSES per chat (over cap → `CAP_EXCEEDED`). Idle sessions are
auto-closed after `KANNA_SUBAGENT_IDLE_TIMEOUT_MS`. This fits the repo because
it reuses the proven channel transport and the existing per-turn `result`
synthesis, keeps the star topology (main agent always calls the tools), and
leaves the default one-shot path byte-identical (default `keep_alive:false`).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | New public API on SubagentOrchestrator: sendToLiveRun, closeLiveRun, findSubagent, LiveTurnSource type, keepAlive on delegateRun/spawnRun, liveSessions registry, CAP_EXCEEDED/NO_LIVE_SESSION error codes, env wiring at AgentCoordinator construction | Code References + Goal must reflect multi-turn lifecycle; confirm event-sourcing + colocated-test refs still hold |
| c3-225 | component | StartClaudeSessionPtyArgs.keepAlive, suppressed /exit on result, pushChannelPrompt on handle, buildChannelPromptFraming(keepAlive) plural framing | Contract surface (prompt-delivery) gains keep-alive multi-turn push; confirm transcript-as-sole-event-source unchanged |
| c3-226 | component | New MCP tools send_subagent_message + close_subagent, keep_alive param on delegate_subagent, non-claude rejection | Tool roster + delegation contract update; strong-typing on new tool inputs |
| c3-3 | container | New SubagentErrorCode members CAP_EXCEEDED/NO_LIVE_SESSION | Named-type boundary; no untyped shapes |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | Follow-up turns persist subagent_message_delta + subagent_entry_appended events identically to turn 1; live-session state is derived from the same event log | comply |
| ref-provider-adapter | Keep-alive must stay within the normalized HarnessEvent model — per-turn result is synthesized by the adapter, not special-cased in the orchestrator | comply |
| ref-tool-hydration | New MCP tools return the same unified transcript/tool-result content shape; no provider branching introduced | comply |
| ref-colocated-bun-test | New tests sit next to each changed file (*.test.ts) | comply |
| ref-strong-typing | New boundary types (LiveTurnSource, keepAlive, tool inputs, error codes) are named TS types, no any | comply |
| ref-local-first-data | No new persistent surface or network exposure; live sessions are in-process only | review — confirmed N.A for new IO |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Every changed module gained colocated *.test.ts coverage (driver, provider-run, orchestrator, kanna-mcp) | comply |
| rule-strong-typing | LiveTurnSource, keepAlive, sendToLiveRun/closeLiveRun signatures, CAP_EXCEEDED/NO_LIVE_SESSION, and MCP tool zod inputs are all named/typed with no any at boundaries | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Driver | keepAlive arg; suppress oneShotClose on result; expose pushChannelPrompt; buildChannelPromptFraming(keepAlive) | commit e3b55d9, 971f7e1, 1a541eb; src/server/claude-pty/driver.ts |
| Provider run | drainOneTurn extraction; keep-alive runClaudeSubagent returns LiveTurnSource; widen ProviderRunStart.start | commit 78f50b6, c87e56a, cc5d2d7; src/server/subagent-provider-run.ts |
| Orchestrator | liveSessions registry; keepAlive delegateRun + CAP_EXCEEDED; sendToLiveRun + closeLiveRun; cancel cascade; findSubagent | commit ba64cb0, b9a01d0, 4dfba28, 37e28d3; src/server/subagent-orchestrator.ts |
| MCP host | keep_alive param + send_subagent_message + close_subagent; non-claude rejection | commit 37e28d3; src/server/kanna-mcp.ts, kanna-mcp-tools/delegate-subagent.ts |
| Shared types | CAP_EXCEEDED + NO_LIVE_SESSION error codes | commit ba64cb0, b9a01d0; src/shared/types.ts |
| Env wiring | KANNA_SUBAGENT_MAX_LIVE / KANNA_SUBAGENT_IDLE_TIMEOUT_MS into orchestrator deps at AgentCoordinator | commit 37e28d3; src/server/agent.ts |
| Docs | CLAUDE.md keep-alive multi-turn subsection + env vars | this PR; CLAUDE.md |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-210 component doc | Update Goal/Code References to add multi-turn lifecycle + new public API surfaces | c3x read c3-210 --full after c3x write; c3x check clear |
| c3-225 component doc | Add keep-alive multi-turn channel push + plural framing to prompt-delivery contract | c3x read c3-225 --full; c3x check clear |
| c3-226 component doc | Add send_subagent_message + close_subagent + keep_alive to tool roster | c3x read c3-226 --full; c3x check clear |
| ADR record | This ADR adr-20260530-keepalive-multiturn-subagent authored to schema, transitioned proposed→accepted→implemented | c3x check --include-adr clear |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/subagent-orchestrator.test.ts | Asserts keep_alive registers live session, CAP_EXCEEDED, sendToLiveRun, closeLiveRun, cancel cascade | 73 pass in suite |
| bun test src/server/subagent-provider-run.test.ts | Asserts keep-alive run returns LiveTurnSource driving turn 2; drainOneTurn leaves iterator open | pass |
| bun test src/server/claude-pty/driver.test.ts | Asserts no /exit on keepAlive result + pushChannelPrompt exposed; multiturn framing | pass |
| bun test src/server/kanna-mcp.test.ts | Asserts the three tools registered + keep_alive routed | pass |
| bun run lint | Side-effect seal: orchestrator reads no process.env; strong-typing enforced | clean (0 warnings) |
| c3x check | Docs match code | 90 docs clear |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Resume-from-transcript per turn (claude --resume) | Re-spawn cost per turn (trust/smoke/MCP/TUI boot) defeats the purpose for back-and-forth orchestration; only wins for turns minutes/hours apart |
| Mesh topology (subagent A pushes channel directly into B) | Breaks the "main agent always in the loop" invariant that makes Kanna debuggable/auditable/cancellable; Claude Code itself uses star + SendMessage, not mesh |
| LRU eviction when over MAX_LIVE | An LRU live session may be mid-conversation; silently killing it corrupts the orchestration — fail-fast CAP_EXCEEDED is safer and explicit |
| Idle session holds a parallel permit | Would let idle subagents starve fresh one-shot delegations; permit is for active turns only |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Leaked PTY processes if main forgets to close | Idle timeout (KANNA_SUBAGENT_IDLE_TIMEOUT_MS, default 300s) auto-closes; cancelChat/cancelRun cascade-close | orchestrator test "cancelChat closes live sessions"; idle-timer arm/reset code |
| Process bomb via unbounded live sessions | KANNA_SUBAGENT_MAX_LIVE (default 5) per chat, fail-fast CAP_EXCEEDED | orchestrator test "keep_alive past cap fails CAP_EXCEEDED" |
| Keep-alive silently degrades to dead one-turn session if no channel | Fail closed: runClaudeSubagent throws when pushChannelPrompt missing | provider-run keep-alive test path |
| Turn 2+ treated as suspicious interrupt by model | Plural channel framing via buildChannelPromptFraming(true) | driver framing test asserts "multiple" language |
| One-shot regression from shared drain refactor | drainOneTurn stops at first result; one-shot driver closes stream right after result anyway | full subagent suites green; default path byte-identical |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/subagent-orchestrator.test.ts src/server/subagent-provider-run.test.ts src/server/claude-pty/driver.test.ts src/server/kanna-mcp.test.ts | all pass (0 fail) |
| bunx tsc --noEmit | exit 0 |
| bun run lint | clean, 0 warnings |
| c3x check | 90 docs clear |
| bun test (full) | 2235 pass / 1 pre-existing flake (auth.test.ts HTTP-bind timeout under load; passes in isolation) |
