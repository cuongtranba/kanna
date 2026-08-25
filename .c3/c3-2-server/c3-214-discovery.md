---
id: c3-214
c3-version: 4
c3-seal: 241edb57118dcadf4b1d61716c2c90de2ab94d1c1d56c051bdc08713b80f6b16
title: discovery
type: component
category: feature
parent: c3-2
goal: Import Claude Code and Codex sessions from local history behind one provider-agnostic SessionSource port, and scan those same history directories to surface candidate projects for the local-projects page.
uses:
    - ref-local-first-data
---

# discovery

## Goal

Import Claude Code and Codex sessions from local history behind one provider-agnostic SessionSource port, and scan those same history directories to surface candidate projects for the local-projects page.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Surface existing local Claude/Codex projects with zero config" |
| Category | feature |
| Lifecycle | Background scanner started at server boot |
| Replaceability | Replaceable provided projection shape preserved |

## Purpose

Owns session import end to end: the SessionSource port that erases each provider's record type at the registry boundary, the claude and codex scanner/parser/mapper pipelines behind it, the codex line-index entry-id scheme with its anchored inverse, and the delta filter that decides which entries are new. Also walks those same history directories to emit a typed project projection for the local-projects page. Non-goals: cloud lookup, repo cloning, persistent project state, running turns, and deriving codex tool cards — those come from c3-211's translator and are never re-derived here.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Data dir + history paths resolvable | c3-204 |
| Input — paths | Per-tool history locations | c3-204 |
| Internal state | Cached scan results with mtime | c3-214 |
| Initialization | Initial scan on server boot | c3-214 |
| Input — codex tool rendering | codex-session-mapper imports buildResultEntry, codexSystemInitEntry, normalizeCodexTokenUsage, todoToolCall, translateItemToToolCalls, translateItemToToolResults and withEntryIdentity from the live codex translator. The dependency is deliberate: an imported tool card is produced by the same functions that render the live one, so toolKind and toolName cannot drift between the two paths | c3-211 |

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
| Discovery projection | OUT | DiscoveredProject[] with localPath, title, modifiedAt, discoveredByProviders (AgentProvider[] of all adapters that found the path) | c3-207 | src/server/discovery.adapter.ts |
| Rescan trigger | IN | Manual full rescan on user request (no filesystem watch exists) | c3-214 | src/server/discovery.adapter.ts |
| SessionSource.scan(homeDir) | OUT | Every importable session under homeDir as ImportableSession[]; a file the source refuses is simply absent, so callers that must report refusals go through scanAllSessions instead | c3-214 | src/server/session-source-registry.ts |
| SessionSource.locate(homeDir, sessionId) | OUT | Path of the file holding sessionId, or null when this provider has none. Sources are probed in registry order with claude first, so an id present under both providers resolves to the claude session | c3-214 | src/server/session-source-registry.ts |
| SessionSource.parse(filePath) | OUT | A union of parsed, tooLarge carrying size and cap, or rejected carrying a SessionParseRejection. Never throws and never answers null, because null cannot say why a 91 MB rollout or a subagent rollout was refused | c3-214 | src/server/session-source.ts |
| ImportableSession | OUT | A parsed session with its provider's pure behaviour bound and the record type erased: toEntries, newEntriesSince, recordKeyFromEntryId, title, legacyTitleCandidates. newEntriesSince maps ALL records and filters the resulting ENTRIES, so it and toEntries are the same map call | c3-214 | src/server/session-source.ts |
| Codex entry identity | OUT | The physical line index is the record key, because it is the only fact present on every record; payload.id is on roughly 39 percent and ordinal on roughly 23 percent of the real corpus. The inverse is anchored on the codex line-index prefix and nothing else, so it is independent of entry-id suffix vocabulary | c3-214 | src/server/codex-session-mapper.ts |
| Import result error vocabulary | OUT | SingleImportResultRow.error carries too_large, subagent, unreadable, no_cwd, no_records, transcript_mismatch and source_shrunk so a refusal is actionable. The wire commands keep their sessions.importClaude names — renaming breaks the protocol for no gain | c3-302 | src/shared/protocol.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Scan stalls | Walker error not surfaced | Discovery list empty | bun run check against src/server/discovery.adapter.ts |
| Stale entries | User does not manually re-trigger a rescan | UI lists outdated/deleted projects until the user re-imports | Manual rescan smoke; grep -rn "fs.watch\|chokidar" src/server/discovery.adapter.ts confirms no filesystem watch exists |
| Translation surface drift | c3-211 changes how toolKind or toolName is derived, or un-exports parseUnifiedDiff, isUnifiedDiff or withEntryIdentity | The codex mapper stops compiling, or imported codex tool cards silently render differently from the live ones | bun run check; bun test src/server/codex-session-mapper.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/discovery.ts | c3-214 Contract | Scan detail | src/server/discovery.ts |
