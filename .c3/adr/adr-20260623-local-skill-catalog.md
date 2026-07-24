---
id: adr-20260623-local-skill-catalog
c3-seal: 4e6be9b89d15125128a8a15a14a354a883bf0dca2f2265ae0307b704268db85e
title: local-skill-catalog
type: adr
goal: Surface every locally invocable Claude Code slash entry — user `~/.claude/{skills,commands}`, project `<cwd>/.claude/{skills,commands}`, and plugin-installed skills/commands under `~/.claude/plugins/**` — in Kanna's composer `/` picker, by merging a disk-scanned catalog into the existing `ChatSnapshot.slashCommands` list.
status: superseded
date: "2026-06-23"
---

# adr-20260623-local-skill-catalog

## Goal

Surface every locally invocable Claude Code slash entry — user `~/.claude/{skills,commands}`, project `<cwd>/.claude/{skills,commands}`, and plugin-installed skills/commands under `~/.claude/plugins/**` — in Kanna's composer `/` picker, by merging a disk-scanned catalog into the existing `ChatSnapshot.slashCommands` list.

## Context

Kanna's composer `/` picker (`src/client/components/chat-ui/SlashCommandPicker.tsx`, wired in `src/client/components/chat-ui/ChatInput.tsx`) lists only what the spawned `claude` CLI advertises via `system_init`. On CLI ≥ 2.1.x the transcript carries no `system` rows, so `getSupportedCommands()` falls back to `STATIC_SUPPORTED_COMMANDS` in `src/server/claude-pty/driver.ts:37-42` — four entries (`model`, `exit`, `clear`, `help`). Per Anthropic docs (https://code.claude.com/docs/en/slash-commands), custom commands are now merged into skills: `.claude/commands/<x>.md` and `.claude/skills/<x>/SKILL.md` both produce `/<x>`. Plugin entries namespace as `/<plugin>:<x>`. The pain is that everything the developer authored locally is invisible to the picker even though Claude Code itself shows it.

## Decision

Introduce a server-side `LocalCatalogService` (c3-231) that scans the documented Anthropic source dirs through a sibling `local-catalog-io.adapter.ts` (only IO), parses the YAML frontmatter (hand-rolled per the precedent in `claude-session-parser.adapter.ts` + `discovery.adapter.ts` — no `gray-matter` in repo), dedupes by name with scope precedence (project > personal > plugin) and kind precedence (skill > command), drops entries with `user-invocable: false`, and caches per `cwd` with a 30 s TTL. `AgentCoordinator` (c3-210) calls `localCatalog.list(project.localPath)` at every site that records `slashCommands` (`ensureSlashCommandsLoaded`, fresh-spawn `getSupportedCommands`, and the `system_init` refresh path) and merges via a private `mergeLocalCatalog` helper that drops local entries clashing case-insensitively with CLI built-ins. No new transport, no new client store, no new event type — `ChatSnapshot.slashCommands` already feeds the picker through `slashCommandsStore`.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-231 | component | New component; owns the scan + cache | Component contract + golden tests |
| c3-210 | component | Calls localCatalog.list and merges at the three recordSessionCommandsLoaded sites | Contract unchanged; merge helper added |
| c3-115 | component | SlashCommandPicker renders the optional kind:"skill" badge and scope title | Contract unchanged; visual addition only |
| c3-201 | component | server.ts constructs LocalCatalogService once and injects it into the coordinator | Boot wiring only |
| c3-3 | container | SlashCommand shared type gains optional kind + scope fields | Backwards-compatible additive |
| c3-2 | container | Gains the c3-231 component slot | Components/Responsibilities sweep |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-side-effect-adapter | All disk IO confined to local-catalog-io.adapter.ts; service layer pure | comply |
| ref-local-first-data | Reads only ~/.claude and project .claude — no network | comply |
| ref-colocated-bun-test | Tests sit next to source: local-catalog.test.ts, local-catalog-io.adapter.test.ts | comply |
| ref-cqrs-read-models | slashCommands already flows through recordSessionCommandsLoaded event + deriveChatSnapshot; merge happens before the event write | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | New .test.ts files sit next to source | comply |
| rule-strong-typing | RawCatalogEntry + SlashCommand keep concrete unions (CatalogKind, CatalogScope) — no any | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| New IO adapter | Hand-rolled YAML frontmatter parser; scans six source roots | src/server/local-catalog-io.adapter.ts |
| New service | Cache + dedupe + precedence over RawCatalogEntry | src/server/local-catalog.ts |
| Shared type | SlashCommand gains optional kind?: "command" | "skill" + scope?: "builtin" |
| Agent merge | mergeLocalCatalog helper + call at three sites | src/server/agent.ts (ensureSlashCommandsLoaded, post-spawn getSupportedCommands, system_init event branch) |
| Server bootstrap | Construct LocalCatalogService and inject | src/server/server.ts |
| Picker badge | Render skill chip and scope title; insert unchanged | src/client/components/chat-ui/SlashCommandPicker.tsx |
| Tests | Adapter + service unit tests, fixture-driven | src/server/local-catalog-io.adapter.test.ts, src/server/local-catalog.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| Component | c3x add component local-catalog --container c3-2 --feature | bash .claude/skills/c3/bin/c3x.sh read c3-231 lists Goal, Parent Fit, Contract |
| Wires | c3x wire c3-231 ref-side-effect-adapter / ref-local-first-data / ref-colocated-bun-test; c3x wire c3-210 c3-231; c3x wire c3-115 c3-231 | bash .claude/skills/c3/bin/c3x.sh graph c3-231 --direction reverse lists c3-210 and c3-115 |
| Validation | c3x check passes after add + wires | bash .claude/skills/c3/bin/c3x.sh check exit 0 |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| ESLint side-effect lint | All node:fs calls remain in the .adapter.ts exempt glob | bun run lint exits 0 with --max-warnings=0 |
| Bun unit tests | Adapter + service exercise precedence, dedupe, frontmatter parsing | bun test src/server/local-catalog-io.adapter.test.ts src/server/local-catalog.test.ts |
| Agent regression suite | agent.test.ts runs through the modified ensureSlashCommandsLoaded + spawn paths without regressions | bun test src/server/agent.test.ts |
| TypeScript | SlashCommand optional fields keep callers compatible | bunx tsc --noEmit exits 0 |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Add a new localCatalog field to ChatSnapshot and merge client-side | Doubles transport surface and forces the picker to learn a new shape; the existing slashCommands list already drives the picker and survives event-sourced replay |
| Re-scan on every deriveChatSnapshot call | Couples the read-model to disk IO; violates the side-effect seal that keeps read-models.ts pure |
| Add an fs.watch and push updates mid-session | Live-watch belongs to a follow-up ADR — v1 chooses a 30 s TTL + chat-restart escape hatch, matching Claude Code's own "restart to pick up a new top-level skills dir" caveat |
| Use a third-party YAML parser like gray-matter | Repo precedent is hand-rolled parsing in claude-session-parser.adapter.ts; pulling a parser for two fields is more dependency than the use case justifies |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Frontmatter parser misses fields | Test fixtures cover happy path, missing frontmatter, malformed YAML, user-invocable: false | bun test src/server/local-catalog-io.adapter.test.ts |
| Scope precedence inverts and personal shadows project | reduceCatalog table-driven test cases with SCOPE_PRIORITY constants | bun test src/server/local-catalog.test.ts |
| CLI built-in shadowed by local entry with the same name | mergeLocalCatalog filters case-insensitively; covered by mergeWithCli test | bun test src/server/local-catalog.test.ts |
| Cache holds stale list after editing skill mid-session | 30 s TTL bounds staleness; chat restart invalidates fully | Manual smoke: edit SKILL.md, wait > 30 s, reopen picker |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/local-catalog-io.adapter.test.ts src/server/local-catalog.test.ts | 19/19 pass |
| bun test src/server/agent.test.ts | All existing tests pass |
| bun run lint | exit 0, --max-warnings=0 |
| bunx tsc --noEmit | exit 0 |
| bash .claude/skills/c3/bin/c3x.sh check | exit 0 after wires |
| Manual smoke: project with .claude/skills/foo/SKILL.md shows /foo in picker with skill badge | Captured in PR description |
