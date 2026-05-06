---
id: c3-222
c3-version: 4
c3-seal: 42302f9ff7f5b7f18334b430c4bea8cc86fb5953e5de3e7eb6c956536866dfc5
title: keybindings
type: component
category: feature
parent: c3-2
goal: Persist per-user keybindings to the local data dir and sync them with the client.
uses:
    - ref-local-first-data
---

# keybindings

## Goal

Persist per-user keybindings to the local data dir and sync them with the client.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Persist user keybindings under the data dir and broadcast them" |
| Category | feature |
| Lifecycle | Singleton store with on-disk persistence |
| Replaceability | Replaceable provided projection + setter contract preserved |

## Purpose

Stores keybinding overrides on disk, exposes a typed projection, and accepts `keybindings.set` commands from the client. Non-goals: rendering shortcuts, conflict resolution UI.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Data dir + paths resolved | c3-204 |
| Input — paths | Settings file path | c3-204 |
| Input — read-models | Pushes projection over WS | c3-207 |
| Initialization | Loads keybindings on boot | c3-222 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Shortcut prefs survive restart and sync across tabs | c3-116 |
| Primary path | UI sets binding → store writes → projection push | c3-208 |
| Alternate — boot | Replays persisted file into projection | c3-222 |
| Failure — write error | Surfaces typed error envelope | c3-208 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Persisted under ~/.kanna/data | must follow | No remote sync |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Keybinding projection | OUT | Typed map of action → key combo | c3-207 | src/server/keybindings.ts |
| keybindings.set handler | IN | Persists override and broadcasts | c3-208 | src/server/keybindings.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Lost prefs on schema bump | Field rename without migration | Settings reset after upgrade | bun run check against src/server/keybindings.ts |
| Push regression | Setter skips broadcast | Other tabs out of sync | Manual two-tab smoke + grep src/server/ws-router.ts for keybinding push |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/keybindings.ts | c3-222 Contract | Persistence detail | src/server/keybindings.ts |
