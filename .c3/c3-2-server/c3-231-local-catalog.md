---
id: c3-231
c3-seal: 59efb8754bd6d800bfc9e2347d24532977f30b26580e441914b3eda81da6dc53
title: local-catalog
type: component
category: feature
parent: c3-2
goal: Scan local Claude Code skills and slash commands (project, personal, plugin) on disk so the composer `/` picker surfaces every locally invocable entry, not only what the CLI's `system_init` happens to emit.
uses:
    - ref-colocated-bun-test
    - ref-local-first-data
    - ref-side-effect-adapter
---

# local-catalog

## Goal

Scan local Claude Code skills and slash commands (project, personal, plugin) on disk so the composer `/` picker surfaces every locally invocable entry, not only what the CLI's `system_init` happens to emit.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Run the local Bun backend: serve HTTP/WS, run agents, expose local data" |
| Category | feature |
| Lifecycle | Constructed once at server boot; pure logic + cache, IO via injected adapter |
| Replaceability | Replaceable provided the LocalCatalogService.list(cwd) shape stays stable |

## Purpose

Owns the disk scan + dedupe + cache that turns raw `SKILL.md` and `.md` command files into a typed `SlashCommand[]` projection. Non-goals: drive the picker UI, watch filesystem changes mid-session, route claude CLI commands.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Server boot constructs the service with a scan adapter | c3-201 |
| Input — adapter | scanLocalCatalog({cwd, homeDir}) returns RawCatalogEntry[] | c3-2 |
| Input — project cwd | Resolved by the ws-router envelope from project.localPath for the project-commands topic | c3-208 |
| Internal state | cwd → SlashCommand[] map, revalidated against mtime stamps (scanned roots, gating settings files, every scanned file); TTL is only a backstop ceiling | c3-231 |
| Initialization | Lazy: first list(cwd) triggers scan + cache fill | c3-231 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User sees all local skills + commands when typing / | c3-115 |
| Primary path | The project-commands envelope reads the list synchronously per project; every scope is surfaced, no CLI merge, no async load. Its consumer localCommandsForCwd prepends Kanna's static BUILTIN_SLASH_COMMANDS (/clear, /compact) and drops any disk entry sharing a builtin name, since dispatch intercepts that name before the CLI sees it. LocalCatalogService.list(cwd) is unchanged — it still returns disk entries only | c3-208 |
| Alternate — cache hit | Same cwd with every mtime stamp unchanged returns the cached list without rescanning | c3-231 |
| Alternate — invalidate | invalidate(cwd?) drops cache row(s) | c3-231 |
| Failure — scan throws | Error logged; the picker falls back to the builtins alone rather than an empty list, so /clear and /compact stay reachable when the disk scan fails | c3-208 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | IO confined to local-catalog-io.adapter.ts | must follow | Service layer is pure |
| ref-local-first-data | ref | Only reads ~/.claude + project .claude | must follow | No network |
| ref-colocated-bun-test | ref | Tests next to source | must follow | local-catalog.test.ts + adapter test |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| LocalCatalogService.list | OUT | cwd → SlashCommand[] sorted, deduped, user-invocable only | c3-210 | src/server/local-catalog.ts |
| scanLocalCatalog | OUT | Pure IO; returns RawCatalogEntry[] from disk | c3-231 | src/server/local-catalog-io.adapter.ts |
| Cache freshness | OUT | mtime stamps via the injected statMtimes port; no port ⇒ no caching; TTL ceiling configurable per instance | c3-231 | src/server/local-catalog.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Frontmatter parser drift | Anthropic changes SKILL.md frontmatter | Wrong description / hidden entries | bun test src/server/local-catalog-io.adapter.test.ts |
| Precedence inversion | Scope ordering bug | Personal skill shadows project skill | bun test src/server/local-catalog.test.ts |
| Stale cache after edit | Stamp set misses a path a change touches | Edit not reflected until the TTL ceiling | bun test src/server/local-catalog.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/local-catalog.ts | c3-231 Contract | Cache detail | src/server/local-catalog.ts |
| src/server/local-catalog-io.adapter.ts | c3-231 Contract | Scan glob detail | src/server/local-catalog-io.adapter.ts |
| src/server/local-catalog.test.ts | c3-231 Contract | Test cases per surface | src/server/local-catalog.test.ts |
| src/server/local-catalog-io.adapter.test.ts | c3-231 Contract | Fixture coverage | src/server/local-catalog-io.adapter.test.ts |
