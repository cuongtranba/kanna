---
id: c3-102
c3-version: 4
c3-seal: 5e661d21719b3fb4d50032fa771998f3882bade8f6849b8a034d616c25f91dc8
title: state-stores
type: component
category: foundation
parent: c3-1
goal: Hold UI-local state (chat input, terminal layout, sidebar, preferences) in small Zustand stores, persisting only what must survive reload.
uses:
    - ref-colocated-bun-test
    - ref-strong-typing
    - ref-zustand-store
    - rule-colocated-bun-test
    - rule-strong-typing
    - rule-zustand-store
---

# state-stores

## Goal

Hold UI-local state (chat input, terminal layout, sidebar, preferences) in small Zustand stores, persisting only what must survive reload.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Own the browser-side state surface (Zustand stores, React context, URL routing)" |
| Category | foundation |
| Lifecycle | Module-singleton stores instantiated at app boot |
| Replaceability | Stores can be swapped per-concern as long as typed selector contract holds |

## Purpose

Owns the browser-side ephemeral state split into per-concern Zustand stores (chat input, sidebar order, terminal layout, preferences) with selective `persist` middleware so reloads only restore what users expect. Non-goals: server state, transcript content, route state — those live elsewhere.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Browser has localStorage available for persisted slices | c3-102 |
| Input — types | Domain types and ports for selector typing | c3-301 |
| Internal state | Per-store slices kept in memory; subset persisted via zustand persist | c3-102 |
| Initialization | Store factories invoked on first hook call | c3-110 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Features read/write UI state without prop-drilling or context refactors | c3-110 |
| Primary path | Component calls hook → selector returns slice → setter mutates store | ref-zustand-store |
| Alternate — persistence | Persisted slices rehydrate on next load via zustand persist | ref-zustand-store |
| Failure — corruption | Persisted JSON parse failure resets to initial state | c3-102 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-zustand-store | ref | Per-concern store pattern, persist usage | must follow | Each store is one concern |
| ref-strong-typing | ref | Typed selectors and setters | must follow | No any in slice types |
| ref-colocated-bun-test | ref | *.test.ts next to source | must follow | Store tests live alongside |
| rule-strong-typing | rule | All boundary state must be named-type, never any | rule wins on conflict | Enforces ref-strong-typing for store slices |
| rule-colocated-bun-test | rule | Each store file must have a colocated <name>.test.ts | rule wins on conflict | Enforces ref-colocated-bun-test for store tests |
| rule-zustand-store | rule | All stores must use create() + zustand/middleware persist, never custom localStorage | rule wins on conflict | Enforces ref-zustand-store at store-file shape |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| useChatInputStore | OUT | Pending text + send actions | c3-115 | src/client/stores |
| useSidebarStore | OUT | Project order, drag state, persistence | c3-111 | src/client/stores |
| useTerminalStore | OUT | Layout sizes, visibility, persistence | c3-118 | src/client/stores |
| usePreferencesStore | OUT | Theme, notifications, provider keys | c3-116 | src/client/stores |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Persisted-shape break on schema change | Slice field renamed without migration | Users see reset to defaults after upgrade | Add version/migrate to persist in src/client/stores/; bun run check |
| Store coupling drift | Component imports from another store directly | grep cross-imports | bun run check + audit src/client/stores/ |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/stores/**/*.ts | c3-102 Contract | One store per concern; setters/selectors typed | src/client/stores |
