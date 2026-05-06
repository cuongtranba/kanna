---
id: c3-210
c3-version: 4
c3-seal: 40effef66520308b8363da0b805fdefea2952c4c92c3a27ada87f595b2b06aca
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

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | UI streams a coherent turn from any supported provider | c3-101 |
| Primary path | chat.send → start session → stream events → finalize turn | c3-208 |
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

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| runTurn(command) | IN | Drives a single turn from chat.send | c3-208 | src/server/agent-coordinator.ts |
| Transcript events | OUT | Append-only typed events | c3-206 | src/server/agent-coordinator.ts |
| Cancel callback | IN | Propagates cancel to provider | c3-211 | src/server/agent-coordinator.ts |

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
