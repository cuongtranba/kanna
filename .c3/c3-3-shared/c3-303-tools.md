---
id: c3-303
c3-version: 4
c3-seal: d365be9211ad9391fdaffb59e520a70e1cabf14ffae486e6a29cfbd96e506f14
title: tools
type: component
category: foundation
parent: c3-3
goal: Normalize tool-call inputs from Claude and Codex into unified transcript tool entries (read, edit, write_file, delete_file, bash, plan, diff, ...).
uses:
    - ref-colocated-bun-test
    - ref-strong-typing
    - ref-tool-hydration
    - rule-colocated-bun-test
    - rule-strong-typing
---

# tools

## Goal

Normalize tool-call inputs from Claude and Codex into unified transcript tool entries (read, edit, write_file, delete_file, bash, plan, diff, ...).

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 (shared) |
| Parent Goal Slice | "Provide the canonical tool-entry hydration pipeline used everywhere" |
| Category | foundation |
| Lifecycle | Pure functions imported by client and server |
| Replaceability | Replaceable provided hydrated entry shape preserved |

## Purpose

Hosts the hydration pipeline that turns raw provider tool-call inputs into a single typed `ToolEntry` discriminated union consumed by renderer and coordinator. Non-goals: rendering, persistence, transport.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Provider raw shapes typed | c3-301 |
| Input — shared types | Domain types embedded in entries | c3-301 |
| Internal state | None — pure functions | c3-303 |
| Initialization | Imported by hydrators per-entry | c3-114 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Renderer and coordinator share one tool vocabulary | c3-114 |
| Primary path | Raw tool input → hydrate → typed entry | c3-210 |
| Alternate — diff | Diff-store consumes hydrated write/delete entries | c3-215 |
| Alternate — renderer | Per-kind renderer reads hydrated entry | c3-113 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-tool-hydration | ref | This module is the hydration pipeline | must follow | One pipeline, one source |
| ref-strong-typing | ref | Discriminated tool-entry union | must follow | No any in handlers |
| ref-colocated-bun-test | ref | Tests next to source | must follow | tools.test.ts |
| rule-strong-typing | rule | All tool-entry boundary types must be named exports | rule wins on conflict | Enforces ref-strong-typing for the tools union |
| rule-colocated-bun-test | rule | tools.test.ts must remain in src/shared next to tools.ts | rule wins on conflict | Enforces ref-colocated-bun-test for shared tests |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| hydrateToolInput(raw) | OUT | Returns typed ToolEntry | c3-114 | src/shared/tools.ts |
| ToolEntry union | OUT | Consumed by renderer + coordinator | c3-210 | src/shared/tools.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Missing kind handler | New tool added without hydrator | Fallback shows in renderer | bun run test src/shared/tools.test.ts |
| Hydration drift | Provider shape change without update | Decode errors at runtime | bun run check plus replay tool fixtures from src/shared/tools.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/tools.ts | c3-303 Contract | Hydration detail | src/shared/tools.ts |
| src/shared/tools.test.ts | c3-303 Contract | Test cases per kind | src/shared/tools.test.ts |
