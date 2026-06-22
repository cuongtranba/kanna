---
id: c3-231
c3-seal: 5b9bcc8d1ffa8619a16cbc247ac9ba35f4f03e58556185203b8ee7c88bb5bb74
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
| Input — chat cwd | Provided by AgentCoordinator from project.localPath | c3-210 |
| Internal state | cwd → SlashCommand[] map with TTL expiry (30 s default) | c3-231 |
| Initialization | Lazy: first list(cwd) triggers scan + cache fill | c3-231 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User sees all local skills + commands when typing / | c3-115 |
| Primary path | AgentCoordinator merges local list into ChatSnapshot.slashCommands | c3-210 |
| Alternate — cache hit | Same cwd within TTL returns cached list without rescanning | c3-231 |
| Alternate — invalidate | invalidate(cwd?) drops cache row(s) | c3-231 |
| Failure — scan throws | Error logged; merge falls back to CLI list only | c3-210 |

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
| Cache TTL | OUT | 30s default; configurable per service instance | c3-231 | src/server/local-catalog.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Frontmatter parser drift | Anthropic changes SKILL.md frontmatter | Wrong description / hidden entries | bun test src/server/local-catalog-io.adapter.test.ts |
| Precedence inversion | Scope ordering bug | Personal skill shadows project skill | bun test src/server/local-catalog.test.ts |
| Stale cache after edit | TTL too long for dev loop | Edit not reflected within 30s | LocalCatalogService.invalidate(cwd) in src/server/local-catalog.ts; bun test src/server/local-catalog.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/local-catalog.ts | c3-231 Contract | Cache detail | src/server/local-catalog.ts |
| src/server/local-catalog-io.adapter.ts | c3-231 Contract | Scan glob detail | src/server/local-catalog-io.adapter.ts |
| src/server/local-catalog.test.ts | c3-231 Contract | Test cases per surface | src/server/local-catalog.test.ts |
| src/server/local-catalog-io.adapter.test.ts | c3-231 Contract | Fixture coverage | src/server/local-catalog-io.adapter.test.ts |
