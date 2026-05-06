---
id: c3-211
c3-version: 4
c3-seal: 1ead535df8ef33693b191c77ffc7345329db9b54870e39b075e7a50c5cd62f3d
title: codex-app-server
type: component
category: feature
parent: c3-2
goal: 'Drive the Codex App Server over JSON-RPC: boot, run turns, translate Codex events into coordinator-friendly shapes.'
uses:
    - ref-provider-adapter
    - ref-strong-typing
---

# codex-app-server

## Goal

Drive the Codex App Server over JSON-RPC: boot, run turns, translate Codex events into coordinator-friendly shapes.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Provide a Codex provider implementation behind the adapter" |
| Category | feature |
| Lifecycle | Child process spawned on first Codex turn, reused per chat |
| Replaceability | Replaceable provided JSON-RPC + adapter contract preserved |

## Purpose

Spawns the Codex App Server child process, speaks JSON-RPC, maps its event stream onto the provider-adapter shape consumed by the coordinator. Non-goals: turn orchestration, transcript persistence — those live in c3-210.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Codex CLI installed and resolvable | c3-2 |
| Input — process utils | Spawn + signal helpers | c3-209 |
| Input — protocol | Typed JSON-RPC envelopes | c3-301 |
| Initialization | Lazy spawn on first Codex turn | c3-211 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Codex turns flow through the same coordinator path as Claude | c3-210 |
| Primary path | RPC runTurn → stream events → translate to adapter | c3-210 |
| Alternate — fallback | Quick-response uses Codex when Claude Haiku fails | c3-213 |
| Alternate — cancel | RPC cancel propagates to running turn | c3-210 |
| Failure — child crash | Restart child; surface error event | c3-209 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-provider-adapter | ref | Adapter sits behind coordinator | must follow | No direct UI imports |
| ref-strong-typing | ref | Typed JSON-RPC envelopes | must follow | No any in protocol |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| runTurn(spec) | OUT | Streams adapter-shaped events | c3-210 | src/server/codex-app-server.ts |
| cancel(turnId) | OUT | Aborts running turn | c3-210 | src/server/codex-app-server.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| RPC envelope drift | Codex CLI upgrade | Decode errors at runtime | bun run check against src/server/codex-app-server.ts |
| Child leak | Cancel skips kill path | Codex children accumulate | Long-session smoke + child-count assertion against src/server/codex-app-server.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/codex-app-server.ts | c3-211 Contract | RPC detail | src/server/codex-app-server.ts |
