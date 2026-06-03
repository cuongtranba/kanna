---
id: adr-20260603-workflow-disk-watch-read-model
c3-seal: 309cca6ee3d3413cc7055e5b4979c1ae3660b489907db7e633ef422ce1d61e7a
title: workflow-disk-watch-read-model
type: adr
goal: Introduce a PTY-only, read-only "Workflow Status Panel" that surfaces Claude Code workflow runs (list, live progress, and drill-in detail) in the Kanna web UI. The system will watch `wf_<runId>.json` sidecar files written by Claude Code under `~/.claude/projects/<encoded-cwd>/<session-uuid>/workflows/` via a dedicated disk-watching adapter, feed them into a per-chat `WorkflowRegistry` read-model, and broadcast snapshots to subscribing clients over the `workflows` WebSocket topic. A `workflow` tool-call kind is also added to normalize the Workflow tool_use transcript entry into a hydrated inline card on launch.
status: accepted
date: "2026-06-03"
---

# Workflow Status: Disk-Watch Sidecar as Independent Read-Model

## Goal

Introduce a PTY-only, read-only "Workflow Status Panel" that surfaces Claude Code workflow runs (list, live progress, and drill-in detail) in the Kanna web UI. The system will watch `wf_<runId>.json` sidecar files written by Claude Code under `~/.claude/projects/<encoded-cwd>/<session-uuid>/workflows/` via a dedicated disk-watching adapter, feed them into a per-chat `WorkflowRegistry` read-model, and broadcast snapshots to subscribing clients over the `workflows` WebSocket topic. A `workflow` tool-call kind is also added to normalize the Workflow tool_use transcript entry into a hydrated inline card on launch.

## Context

The PTY transcript JSONL (component c3-225, sole event source) carries the `Workflow` tool_use invocation but does NOT contain `task_started`, `task_updated`, or `tool_progress` lifecycle events — those exist only in the on-disk `wf_<runId>.json` sidecar. Polling the transcript cannot surface live progress under PTY. The existing server read-model layer (c3-207) is event-sourced from Kanna's own JSONL event log (c3-206) and cannot ingest external filesystem events without violating the pure-projection contract. The WS subscription pattern (ref-ws-subscription) and CQRS read-model pattern (ref-cqrs-read-models) both apply, but the workflow read-model must be disk-fed rather than event-sourced — a deliberate, scoped override of ref-event-sourcing, documented here.

## Decision

Add `WorkflowRegistry` as an independent, disk-fed sibling read-model (not wired through c3-206) that:

1. Registers and deregisters per-chat workflow directory paths via `claude-pty-driver` (c3-225) — the driver calls `registry.watch(chatId, dir)` when a PTY session starts and `registry.unwatch(chatId)` on close.
2. Uses `workflow-watch-io.adapter.ts` (the sole IO adapter, compliant with ref-side-effect-adapter) to list, read, and watch sidecar files with debounce + parent directory re-arm.
3. Maintains per-chat in-memory snapshots (`WorkflowsSnapshot`) and supports subscribe-by-chatId for WS push.
4. Exposes a `workflows` topic in `src/shared/protocol.ts` with a `WorkflowsSnapshot` push type and a `workflows.getRun` command for detail drill-in.
5. Adds `workflow` to the `ToolKind` union in `src/shared/tools.ts` and wires `taskId` hydration in `src/shared/types.ts`.
6. Delivers the panel (`WorkflowsSection.tsx`) and inline transcript card (`WorkflowMessage.tsx`) on the client, backed by `workflowsStore.ts` (a Zustand store, compliant with ref-zustand-store).

This design does NOT route workflow state through the Kanna event log (c3-206) or through the main transcript/turn pipeline — it is a purely additive sibling read-model, so the c3-225 "transcript is the sole event source" invariant is preserved for turn/transcript concerns.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | Must call registry.watch/unwatch on PTY spawn/close; registers the chat's workflows directory path | Review ref-event-sourcing override scope: disk-watch is additive, not a transcript substitute |
| c3-210 | component | Constructs WorkflowRegistry and threads it through server startup; passes it to the PTY driver via spawn args | Review ref-provider-adapter: registry is PTY-only; SDK driver must not receive it |
| c3-208 | component | Must serve the new workflows topic: snapshot on subscribe, push on registry update, handle workflows.getRun command | Review ref-ws-subscription compliance: topic shape must follow shared envelope contract |
| c3-302 | component | New workflows topic, WorkflowsSnapshot type, and workflows.getRun command must be added to the shared wire protocol | Review rule-strong-typing: all boundary types must be named exports |
| c3-303 | component | New workflow ToolKind must be added and hydration logic implemented | Review ref-tool-hydration: workflow tool_use normalizes to a hydrated card |
| c3-301 | component | taskId field must be added to the relevant transcript entry type for workflow hydration | Review rule-strong-typing |
| c3-113 | component | Dispatch WorkflowMessage card for workflow tool kind in KannaTranscript.tsx | Review ref-tool-hydration: rendering dispatches on kind |
| c3-114 | component | Add WorkflowMessage.tsx renderer; update ToolCallMessage.tsx dispatch | Review ref-tool-hydration compliance |
| c3-112 | component | Thread chatId through ChatTranscriptViewport.tsx for the workflows panel | Review ref-ws-subscription: panel subscribes on mount |
| N.A - new component workflow-status to be added | N.A - <reason> | New component for disk-watch read-model does not yet have a c3 id; wired after add | ref-cqrs-read-models, ref-side-effect-adapter, ref-ws-subscription, ref-event-sourcing override |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-cqrs-read-models | WorkflowRegistry is a read-model; must separate write path (disk sidecar) from read path (in-memory snapshot + WS push) | comply |
| ref-ws-subscription | New workflows topic follows the single-socket subscribe/command/push envelope defined in protocol.ts | comply |
| ref-event-sourcing | Governs all server state derivation; this ADR explicitly overrides it for WorkflowRegistry: state is derived from disk sidecars, not from the Kanna event log. Override scope is limited to WorkflowRegistry only. | update-ref (add scoped override note referencing this ADR) |
| ref-side-effect-adapter | workflow-watch-io.adapter.ts is the sole IO file for all fs.watch/read/list calls; domain modules stay pure | comply |
| ref-provider-adapter | WorkflowRegistry is PTY-only; SDK driver must not wire it; provider-agnostic agent-coordinator must conditionally thread it | comply |
| ref-tool-hydration | workflow ToolKind added to tools.ts normalizes the Workflow tool_use into a hydrated inline card | comply |
| ref-strong-typing | All new shared boundary types (WorkflowsSnapshot, WorkflowRunSummary, WorkflowRunFile) are named exports in shared/ | comply |
| ref-zustand-store | workflowsStore.ts stores client-local WS snapshot state per the Zustand store pattern | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New boundary types across WS topic and protocol must be named typed exports; no any at boundaries | comply |
| rule-colocated-bun-test | workflow-types.test.ts, workflow-watch-io.adapter.test.ts, and workflow-registry.test.ts must sit next to their implementation files | comply |
| rule-zustand-store | workflowsStore.ts must follow one-concern-per-store and never cache server-derived truth independently of WS subscription | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/shared/workflow-types.ts | Pure types: WorkflowRunFile, WorkflowRunSummary, WorkflowsSnapshot; parseWorkflowRunFile; toRunSummary | bun test src/shared/workflow-types.test.ts |
| src/shared/workflow-types.test.ts | Unit tests for parseWorkflowRunFile and toRunSummary | bun test src/shared/workflow-types.test.ts |
| src/server/workflow-watch-io.adapter.ts | Only IO file: fs list/read/watch with debounce + parent dir re-arm; suffix .adapter.ts for ESLint seal | bun test src/server/workflow-watch-io.adapter.test.ts |
| src/server/workflow-watch-io.adapter.test.ts | Tests for debounce, re-arm, error handling | bun test src/server/workflow-watch-io.adapter.test.ts |
| src/server/workflow-registry.ts | Per-chat watch + snapshot/getRun/subscribe; mirrors PtyInstanceRegistry pattern | bun test src/server/workflow-registry.test.ts |
| src/server/workflow-registry.test.ts | Tests for watch/unwatch, snapshot delivery, subscribe/push | bun test src/server/workflow-registry.test.ts |
| src/shared/protocol.ts | Add workflows topic, WorkflowsSnapshot push type, workflows.getRun command | bunx tsc --noEmit |
| src/server/ws-router.ts | Serve + push the workflows topic; handle getRun command | bunx tsc --noEmit |
| src/server/claude-pty/driver.ts | Register/unregister chat's workflows dir on spawn/close | bunx tsc --noEmit |
| src/server/agent.ts | Construct WorkflowRegistry; pass to PTY driver | bunx tsc --noEmit |
| src/server/server.ts | Thread WorkflowRegistry through server startup | bunx tsc --noEmit |
| src/shared/tools.ts | Add workflow ToolKind | bun run lint |
| src/shared/types.ts | Add taskId field to hydrated tool entry | bunx tsc --noEmit |
| src/client/stores/workflowsStore.ts | Zustand store: subscribe to workflows topic, hold WorkflowsSnapshot | bun run lint |
| src/client/app/WorkflowsSection.tsx | Panel: list + live progress + drill-in UI | bun run lint |
| src/client/components/messages/WorkflowMessage.tsx | Inline transcript card on Workflow tool launch | bun run lint |
| src/client/components/messages/ToolCallMessage.tsx | Dispatch to WorkflowMessage for workflow kind | bun run lint |
| src/client/app/KannaTranscript.tsx | Dispatch WorkflowMessage card for workflow tool kind | bun run lint |
| src/client/app/ChatPage/ChatTranscriptViewport.tsx | Thread chatId for workflows panel subscription | bun run lint |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| New component: workflow-status | c3x add component workflow-status --container c3-2 with codemap patterns covering workflow-types.ts, workflow-watch-io.adapter.ts, workflow-registry.ts, workflowsStore.ts, WorkflowsSection.tsx, WorkflowMessage.tsx | c3x check passes 0 errors |
| ADR record | This ADR (workflow-disk-watch-read-model) created under c3x add adr | c3x read <adr-id> returns all required sections |
| Wiring: workflow-status refs | c3x wire <id> ref-cqrs-read-models ref-ws-subscription ref-side-effect-adapter ref-provider-adapter ref-tool-hydration ref-strong-typing ref-zustand-store rule-strong-typing rule-colocated-bun-test rule-zustand-store | c3x check passes 0 errors |
| Affected components: c3-225, c3-210, c3-208 | No body edits required at ADR creation; Parent Delta recorded as no-delta (bodies unchanged, behavior additions are additive) | c3x check --only c3-225; c3x check --only c3-210 |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| ESLint side-effect seal | workflow-watch-io.adapter.ts is the only file allowed to call fs.watch/readFile; any non-.adapter.ts file calling node:fs in src/server/ fails lint | bun run lint exits 0 |
| TypeScript strict | All WorkflowsSnapshot, WorkflowRunSummary, WorkflowRunFile boundary types are named exports; bunx tsc --noEmit must exit 0 | bunx tsc --noEmit |
| Bun test suite | workflow-types.test.ts, workflow-watch-io.adapter.test.ts, workflow-registry.test.ts all pass | bun test src/shared/workflow-types.test.ts && bun test src/server/workflow-watch-io.adapter.test.ts && bun test src/server/workflow-registry.test.ts |
| c3x check | 0 errors after wiring all components and refs for this ADR | c3x check |
| WS protocol compliance | WorkflowsSnapshot pushed as typed envelope; getRun returns typed response; no untyped payloads | bunx tsc --noEmit |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Parse task_started/task_updated/tool_progress lifecycle events from the PTY transcript JSONL | These events are NOT present in the on-disk transcript JSONL that c3-225 tails. Verified: Claude Code writes workflow progress only to the wf_<runId>.json sidecar, not to the session JSONL. Sourcing from the transcript is structurally impossible under PTY. |
| Read workflow state from the SDK event stream | Out of scope: the Workflow Status Panel is PTY-only because the wf_<runId>.json sidecar is only written when the Claude CLI runs interactively under a PTY. The SDK driver does not produce these files. Adding SDK-driver support would require Anthropic build-gated access to task lifecycle events, which is not available. |
| Route workflow updates through the Kanna event log (c3-206) | Would require emitting synthetic Kanna events for external disk state changes, polluting the event log with non-Kanna-originated mutations and violating the append-only JSONL model semantics. The disk sidecar is the authoritative source; Kanna should not duplicate it. |
| Extend the existing c3-207 read-models component | c3-207 projects from the Kanna event log (pure derivation, no IO). Extending it to perform disk IO would break the pure-projection contract, violate ref-side-effect-adapter, and couple the event-sourced pipeline to an external filesystem source with different lifecycle and error semantics. A dedicated sibling read-model keeps each concern isolated. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Violating c3-225 sole-event-source invariant | WorkflowRegistry is a SIBLING read-model feeding UI only; it does not affect the HarnessEvent stream or turn lifecycle. The PTY transcript JSONL remains the sole event source for turn/transcript concerns. | bun test src/server/workflow-registry.test.ts confirms no HarnessEvent coupling; c3x check confirms c3-225 body unchanged |
| fs.watch missing file creation events (race on dir creation) | workflow-watch-io.adapter.ts arms a parent-directory watcher before the workflows/ subdir exists; on subdir creation, re-arms the file-level watcher. Debounce (50 ms) prevents event storms on rapid writes. | bun test src/server/workflow-watch-io.adapter.test.ts covers race and debounce scenarios |
| Memory leak: stale per-chat watchers | WorkflowRegistry.unwatch(chatId) tears down all fs.watch handles for the chat; called by c3-225 on PTY session close. | bun test src/server/workflow-registry.test.ts includes unwatch/cleanup assertions |
| Strong-typing drift at WS boundary | All types are named exports in src/shared/; bunx tsc --noEmit is a required check before done | bunx tsc --noEmit |
| ESLint side-effect seal regression | Only workflow-watch-io.adapter.ts (matching *.adapter.ts glob) may import node:fs; any accidental IO in workflow-registry.ts fails lint | bun run lint exits 0 |

## Verification

| Check | Result |
| --- | --- |
| bun test src/shared/workflow-types.test.ts | All tests pass |
| bun test src/server/workflow-watch-io.adapter.test.ts | All tests pass |
| bun test src/server/workflow-registry.test.ts | All tests pass |
| bunx tsc --noEmit | Exit 0 — no type errors |
| bun run lint | Exit 0 — 0 warnings, 0 errors |
| c3x check | 0 errors |
