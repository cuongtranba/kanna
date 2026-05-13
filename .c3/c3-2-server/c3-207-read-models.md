---
id: c3-207
c3-version: 4
c3-seal: 83a047ba307bc972cde8c504cf431b335c717a2fc4676ffbcc705dfbb7f462af
title: read-models
type: component
category: foundation
parent: c3-2
goal: Project events into derived views (sidebar, chat, projects, discovery) that ws-router broadcasts to clients.
uses:
    - ref-cqrs-read-models
    - ref-strong-typing
    - rule-strong-typing
---

# read-models

## Goal

Project events into derived views (sidebar, chat, projects, discovery) that ws-router broadcasts to clients.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Turn raw events into UI-shaped projections pushed via WS" |
| Category | foundation |
| Lifecycle | In-memory derived state, rebuilt from event log |
| Replaceability | Replaceable provided projection shape preserved |

## Purpose

Subscribes to event-store appends, derives per-feature views (sidebar list, chat snapshot, project list, discovery feed, tunnel state), and exposes them to ws-router for snapshot push. Non-goals: persistence, command handling, raw event shape decisions.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | event-store ready with replayed log | c3-206 |
| Input — events schema | Typed events | c3-205 |
| Input — discovery feed | Discovery emits its own projection | c3-214 |
| Input — keybindings | Keybinding store emits projection | c3-222 |
| Initialization | Subscribes to event-store on boot | c3-207 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | UI gets shape-stable snapshots without replay | c3-101 |
| Primary path | Event appended → projection updated → WS broadcast | c3-208 |
| Alternate — initial sub | New client gets latest snapshot on subscribe | c3-208 |
| Alternate — diff | Diff snapshots projected from diff-store | c3-215 |
| Failure — projection mismatch | Type drift triggers tsc failure | c3-205 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-cqrs-read-models | ref | Project once, broadcast many | must follow | No cross-feature joins |
| ref-strong-typing | ref | Typed view models | must follow | Discriminated by topic |
| rule-strong-typing | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| subscribe(topic) | OUT | Returns latest snapshot + push stream | c3-208 | src/server/read-models.ts |
| Projection map | IN | Event-store appends drive projection update | c3-206 | src/server/read-models.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Stale snapshot on edit | Update path skips projection | UI shows old data | bun run check against src/server/read-models.ts |
| Type drift between projection + client | Shape change without protocol update | tsc fails or runtime decode error | bun run check plus replay protocol fixtures from src/shared/protocol.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/read-models.ts | c3-207 Contract | Projection detail | src/server/read-models.ts |
