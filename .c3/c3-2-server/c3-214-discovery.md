---
id: c3-214
c3-version: 4
c3-seal: b5c69902545c67359460c69f8ae09cb81d918fd6a29d8ab82e74e83269e8b919
title: discovery
type: component
category: feature
parent: c3-2
goal: Scan Claude Code and Codex local history directories to surface candidate projects for the local-projects page.
uses:
    - ref-local-first-data
---

# discovery

## Goal

Scan Claude Code and Codex local history directories to surface candidate projects for the local-projects page.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Surface existing local Claude/Codex projects with zero config" |
| Category | feature |
| Lifecycle | Background scanner started at server boot |
| Replaceability | Replaceable provided projection shape preserved |

## Purpose

Walks Claude Code and Codex history directories on disk, identifies candidate projects, and emits a typed projection for the local-projects page. Non-goals: cloud lookup, repo cloning, persistent project state.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Data dir + history paths resolvable | c3-204 |
| Input — paths | Per-tool history locations | c3-204 |
| Internal state | Cached scan results with mtime | c3-214 |
| Initialization | Initial scan on server boot | c3-214 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Users see existing work without manual setup | c3-117 |
| Primary path | Scan → derive projection → push via read-models | c3-207 |
| Alternate — rescan | Manual full rescan triggered by user re-click (no filesystem watch exists) | c3-214 |
| Alternate — open | project.open command consumes projection rows | c3-208 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Reads only local history paths | must follow | No network calls |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Discovery projection | OUT | Typed list of discovered projects | c3-207 | src/server/discovery.adapter.ts |
| Rescan trigger | IN | Manual full rescan on user request (no filesystem watch exists) | c3-214 | src/server/discovery.adapter.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Scan stalls | Walker error not surfaced | Discovery list empty | bun run check against src/server/discovery.adapter.ts |
| Stale entries | User does not manually re-trigger a rescan | UI lists outdated/deleted projects until the user re-imports | Manual rescan smoke; grep -rn "fs.watch\|chokidar" src/server/discovery.adapter.ts confirms no filesystem watch exists |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/discovery.ts | c3-214 Contract | Scan detail | src/server/discovery.ts |
