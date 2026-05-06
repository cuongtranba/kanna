---
id: c3-301
c3-version: 4
c3-seal: b325f703b395fe33b9ea9ced23217932311ec8850e1e817b34133d362796a86a
title: types
type: component
category: foundation
parent: c3-3
goal: Declare core domain types (projects, chats, turns, transcript entries, provider catalog shape) shared by client and server.
uses:
    - ref-strong-typing
---

# types

## Goal

Declare core domain types (projects, chats, turns, transcript entries, provider catalog shape) shared by client and server.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 (shared) |
| Parent Goal Slice | "Define the typed surface shared between client and server" |
| Category | foundation |
| Lifecycle | Pure type module |
| Replaceability | Replaceable provided exported type names + shapes preserved |

## Purpose

Defines the discriminated unions and structural types that cross the wire: project records, chat snapshots, transcript entries, provider catalog entries. Non-goals: I/O, validators, runtime helpers.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | TypeScript strict mode | c3-3 |
| Input — provider catalog | Re-exports catalog types | c3-212 |
| Internal state | None — pure types | c3-301 |
| Initialization | Imported by both containers on demand | c3-301 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Client and server agree on shape of every entity | c3-101 |
| Primary path | Server emits typed projection → client decodes typed | c3-208 |
| Alternate — picker | Client uses re-exported catalog types in pickers | c3-115 |
| Alternate — write | Server constructs typed events using these types | c3-205 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | All shared types are explicit | must follow | No any/unknown exports |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Domain type exports | OUT | Project/chat/turn/transcript types | c3-1 | src/shared/types.ts |
| Catalog re-exports | OUT | Provider catalog types via shared module | c3-115 | src/shared/types.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Cross-wire drift | Type renamed only on one side | tsc fails on consumer | bun run check against src/shared/types.ts |
| Re-export break | Catalog re-export missing | tsc fails on UI picker | bun run check plus grep src/client/ for missing catalog imports |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/types.ts | c3-301 Contract | Type detail | src/shared/types.ts |
