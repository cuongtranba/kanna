---
id: c3-210
c3-version: 4
c3-seal: fc11439bf3d135bd84e06010467fb739fd11ad8586f59d57cf00689cc8625402
title: agent-coordinator
type: component
category: feature
parent: c3-2
goal: 'Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events.'
uses:
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
| Alternate — cancel | chat.cancel propagates to provider; reaches a turn at any lifecycle point (booting / active / self-wake) | c3-211 |
| Alternate — resume | Resume reuses live session if available | c3-211 |
| Alternate — background self-wake | Task-notification wake turns stream with no ActiveTurn; ClaudeSessionState.selfWakeActive overlays status "running" via getActiveStatuses, getBackgroundTasksByChatId feeds ChatRuntime.backgroundTasks, and cancel interrupts the warm session (adr-20260802-background-selfwake-status-ui) | c3-207 |
| Failure — provider error | Emits typed failure event; surfaces to client | c3-205 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-provider-adapter | ref | Provider-agnostic turn shape | must follow | All providers via adapter |
| ref-event-sourcing | ref | Events written before broadcast | must follow | Log is source of truth |
| ref-tool-hydration | ref | Tool calls normalized before persistence | must follow | Single hydration path |
| ref-colocated-bun-test | ref | Tests live next to coordinator | must follow | agent-coordinator.test.ts |
| rule-colocated-bun-test | rule | Coordinator test suites enforce colocated-bun-test rule | must follow | agent.*.test.ts colocated with agent.ts |
| c3-229 | ref | Workflow runs surfaced into ChatSnapshot via the coordinator | wired compliance target beats uncited local prose | workflow status panel wiring |
| c3-231 | ref | Coordinator holds the LocalCatalogService instance but owns no slash-command load path; the catalog is served by the project-commands topic | wired compliance target beats uncited local prose | Local-skill catalog is project-scoped, not chat state |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| runTurn(command) | IN | Drives a single turn from chat.send | c3-208 | src/server/agent-coordinator.ts |
| Transcript events | OUT | Append-only typed events | c3-206 | src/server/agent-coordinator.ts |
| Cancel callback | IN | Propagates cancel to provider. Falls back through the states that render busy without an ActiveTurn: a startingTurns entry (provider session still booting) is marked cancelRequested + dropped and the interrupted/turn_cancelled pair written immediately, then the booting turn tears itself down silently on resolve; else a selfWakeActive session is interrupted directly. Never starts a queued message — Stop parks the queue. See adr-20260804-cancel-during-turn-boot | c3-211 | src/server/claude-cancel-handler.ts, src/server/claude-turn-starter.ts |
| startingTurns | OUT | Per-chat marker registered synchronously by startTurnForChat before its first await and removed in an identity-guarded finally, covering the window before an ActiveTurn exists. Read by cancelChat, by sendCommand/maybeStartNextQueuedMessage (busy check — prevents a concurrent turn on a second send mid-boot), and by getActiveStatuses (surfaces as starting) | c3-207 | src/server/claude-session-state.ts, src/server/agent-coordinator.ts |
| delegateRun({keepAlive?}) | IN | subagent_id resolved by exact id, else unambiguous exact name (id wins on collision, ambiguous name → UNKNOWN_SUBAGENT); a target with triggerMode==="manual" whose id is NOT in args.mentionedSubagentIds fails MANUAL_ONLY (the user must @-mention it); runs subagent turn 1; on keepAlive completion registers a live session (no /exit) and returns runId; over KANNA_SUBAGENT_MAX_LIVE per chat fails CAP_EXCEEDED | c3-226 | src/server/subagent-orchestrator.ts |
| delegateRun({background?}) | IN | Launches the run detached and returns {status:"async_launched", runId} immediately; the run still flows through spawnRun (permit, RunState, timeout, abort, events); on terminal fires onBackgroundRunComplete. Mutually exclusive with keepAlive | c3-226 | src/server/subagent-orchestrator.ts |
| getMentionedSubagentIds() | IN | Per-turn getter on KannaMcpDelegationContext supplying the subagent ids the user @-mentioned in the message that started the turn; threaded from agent.ts (mentionedSubagentIdsByChat, sourced from parseMentions) and consumed by delegateRun's MANUAL_ONLY gate; subagent sub-spawn contexts pass an empty set so a subagent cannot drive a manual subagent | c3-226 | src/server/agent.ts, src/server/kanna-mcp.ts, src/server/kanna-mcp-tools/delegate-subagent.ts |
| onBackgroundRunComplete(chatId, runId, outcome) | OUT | Dep fired when a background run reaches terminal; AgentCoordinator delivers the BackgroundRunOutcome back into the main chat as a fresh turn via scheduleAgentWakeup(source:"subagent_background") | c3-227 | src/server/subagent-orchestrator.ts, src/server/agent.ts |
| sendToLiveRun(runId, prompt) | IN | Drives a follow-up turn into a warm keep-alive session via channel push; acquires a permit for the turn only; NO_LIVE_SESSION if unknown | c3-226 | src/server/subagent-orchestrator.ts |
| closeLiveRun(chatId, runId, reason) | IN | Tears down a live session (close REPL, cleanup RunState, onRunTerminal); also driven by idle timeout + cancel cascade | c3-226 | src/server/subagent-orchestrator.ts |
| LiveTurnSource | OUT | Provider-run handle returned after keep-alive turn 1 — runTurn (push + drain one turn) + close; keeps the persistent HarnessEvent iterator open | c3-225 | src/server/subagent-provider-run.ts |
| findSubagent(id) | IN | Snapshot lookup (by exact id, else unambiguous exact name) used by the MCP host to reject keep_alive for non-claude subagents, and by the delegate tool to reject an unresolvable subagent_id BEFORE delegateRun so no ghost failed-run record is persisted for a guessed id | c3-226 | src/server/subagent-orchestrator.ts, src/server/kanna-mcp-tools/delegate-subagent.ts |
| Subagent restriction threading | IN | buildSubagentProviderRunForChat resolves Subagent.workingDir + allowedPaths via c3-204 resolveSubagentRoots (with realpathAdapter), overrides spawn cwd, and passes restrictedAllowedPaths into BuildSubagentProviderRunArgs → startClaudeSession; both PTY (c3-225) and SDK paths forward the same list into c3-226 kanna-mcp host for per-run path-deny + into the driver for shim-only tool gating | c3-225 | src/server/agent.ts, src/server/subagent-provider-run.ts |
| describeUnknownSubagent(requested) | IN | Builds the UNKNOWN_SUBAGENT error text from the LIVE settings snapshot (each subagent as "name [id=...]", manual-trigger entries annotated, empty roster points at Settings) so the model self-corrects on retry even when the spawn-time system-prompt roster is stale; consumed by delegateRun's UNKNOWN_SUBAGENT failRun and the delegate tool's pre-delegation rejection | c3-226 | src/server/subagent-orchestrator.ts, src/server/kanna-mcp-tools/delegate-subagent.ts |
| emitAutoContinueEvent(event) | IN | Appends the auto-continue event, then reconciles the chat's loop-tracking watch via syncLoopTracking. It is the single append path for loop_armed / loop_disarmed, so arm, stop_loop, user takeover, chat delete and the repeated-failure disarm all reconcile through one hook; the reconcile is total and idempotent and the coordinator gains no IO of its own (the registry owns it) | c3-227 | src/server/agent-coordinator.ts, src/server/loop-tracking-sync.ts |

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
