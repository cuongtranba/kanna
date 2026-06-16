---
id: c3-210
c3-version: 4
c3-seal: 4328693a9b455acfdfe213dc1211d9cbbb36321726119a67f0c08d4b8a2971a9
title: agent-coordinator
type: component
category: feature
parent: c3-2
goal: 'Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events.'
uses:
    - c3-229
    - ref-colocated-bun-test
    - ref-event-sourcing
    - ref-provider-adapter
    - ref-tool-hydration
    - rule-colocated-bun-test
---

# agent-coordinator

## Goal

Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Orchestrate provider-agnostic agent turns and persist transcript events" |
| Category | feature |
| Lifecycle | Singleton orchestrator with per-chat session state |
| Replaceability | Replaceable provided turn command + transcript event contract preserved |

## Purpose

Owns the agent turn lifecycle: receives `chat.send` commands, picks the provider via the catalog, drives the Codex/Claude adapter, normalizes streamed events into transcript events, and writes them to the event store. Non-goals: provider transport details, command routing — those live in c3-211 and c3-208.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Provider catalog loaded and event store ready | c3-212 |
| Input — Codex adapter | Routes Codex turns over JSON-RPC | c3-211 |
| Input — event store | Appends transcript events | c3-206 |
| Input — tool hydration | Normalizes tool entries before persistence | c3-303 |
| Input — process utils | Spawns/cancels child processes | c3-209 |
| Input — oauth token pool | Picks per-chat Claude OAuth token; rotates on rate-limit/auth-error; supplies refusal classifier | c3-224 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | UI streams a coherent turn from any supported provider | c3-101 |
| Primary path | chat.send → start session → stream events → finalize turn | c3-208 |
| Subagent live progress | onEntry fires onRunProgress directly (not chained on write chain) so UI updates synchronously with in-memory state; onChunk fires trailing-edge throttled (~100ms) onRunProgress for streaming text visibility. See adr-20260519-subagent-live-progress-decouple. | c3-207 |
| Alternate — cancel | chat.cancel propagates to provider | c3-211 |
| Alternate — resume | Resume reuses live session if available | c3-211 |
| Failure — provider error | Emits typed failure event; surfaces to client | c3-205 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-provider-adapter | ref | Provider-agnostic turn shape | must follow | All providers via adapter |
| ref-event-sourcing | ref | Events written before broadcast | must follow | Log is source of truth |
| ref-tool-hydration | ref | Tool calls normalized before persistence | must follow | Single hydration path |
| ref-colocated-bun-test | ref | Tests live next to coordinator | must follow | agent-coordinator.test.ts |
| rule-colocated-bun-test | rule | Coordinator test suites enforce colocated-bun-test rule | must follow | agent.*.test.ts colocated with agent.ts |
| c3-229 | ref | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| runTurn(command) | IN | Drives a single turn from chat.send | c3-208 | src/server/agent-coordinator.ts |
| Transcript events | OUT | Append-only typed events | c3-206 | src/server/agent-coordinator.ts |
| Cancel callback | IN | Propagates cancel to provider | c3-211 | src/server/agent-coordinator.ts |
| delegateRun({keepAlive?}) | IN | Runs subagent turn 1; on keepAlive completion registers a live session (no /exit) and returns runId; over KANNA_SUBAGENT_MAX_LIVE per chat fails CAP_EXCEEDED | c3-226 | src/server/subagent-orchestrator.ts |
| delegateRun({background?}) | IN | Launches the run detached and returns {status:"async_launched", runId} immediately; the run still flows through spawnRun (permit, RunState, timeout, abort, events); on terminal fires onBackgroundRunComplete. Mutually exclusive with keepAlive | c3-226 | src/server/subagent-orchestrator.ts |
| onBackgroundRunComplete(chatId, runId, outcome) | OUT | Dep fired when a background run reaches terminal; AgentCoordinator delivers the BackgroundRunOutcome back into the main chat as a fresh turn via scheduleAgentWakeup(source:"subagent_background") | c3-227 | src/server/subagent-orchestrator.ts, src/server/agent.ts |
| sendToLiveRun(runId, prompt) | IN | Drives a follow-up turn into a warm keep-alive session via channel push; acquires a permit for the turn only; NO_LIVE_SESSION if unknown | c3-226 | src/server/subagent-orchestrator.ts |
| closeLiveRun(chatId, runId, reason) | IN | Tears down a live session (close REPL, cleanup RunState, onRunTerminal); also driven by idle timeout + cancel cascade | c3-226 | src/server/subagent-orchestrator.ts |
| LiveTurnSource | OUT | Provider-run handle returned after keep-alive turn 1 — runTurn (push + drain one turn) + close; keeps the persistent HarnessEvent iterator open | c3-225 | src/server/subagent-provider-run.ts |
| findSubagent(id) | IN | Snapshot lookup used by the MCP host to reject keep_alive for non-claude subagents | c3-226 | src/server/subagent-orchestrator.ts |
| Subagent restriction threading | IN | buildSubagentProviderRunForChat resolves Subagent.workingDir + allowedPaths via c3-204 resolveSubagentRoots (with realpathAdapter), overrides spawn cwd, and passes restrictedAllowedPaths into BuildSubagentProviderRunArgs → startClaudeSession; both PTY (c3-225) and SDK paths forward the same list into c3-226 kanna-mcp host for per-run path-deny + into the driver for shim-only tool gating | c3-225 | src/server/agent.ts, src/server/subagent-provider-run.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Lost turn on crash | Event written after broadcast | Replay missing turn | bun run test src/server/agent-coordinator.test.ts |
| Provider drift | Provider event shape change | Tool entries malformed | bun run check against src/server/agent-coordinator.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/agent-coordinator.ts | c3-210 Contract | Orchestration detail | src/server/agent-coordinator.ts |
| src/server/agent-coordinator.test.ts | c3-210 Contract | Test cases per surface | src/server/agent-coordinator.test.ts |
