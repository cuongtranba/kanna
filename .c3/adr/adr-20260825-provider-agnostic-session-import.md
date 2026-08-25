---
id: adr-20260825-provider-agnostic-session-import
c3-seal: c88f83aa876895b7f0556c2c1b1ef5a70936f7961f9dc7db3611bdea86c86444
title: provider-agnostic-session-import
type: adr
goal: Make Kanna's session import provider-agnostic behind a single port so a Codex rollout imports on exactly the path a Claude JSONL session already imports on, and record the cross-component dependency that made it possible. Before this decision the importer named "claude" in three places, discovery's fact described only project scanning for the local-projects page, and the codex mapper's dependency on c3-211's transcript translator existed in code with no fact recording it. This ADR introduces the SessionSource port in src/server/session-source.ts, replaces the parse-failure null with a reason-carrying union, and records c3-214 depending on c3-211's now-exported pure translation surface.
status: accepted
date: "2026-08-25"
---

## Goal

Make Kanna's session import provider-agnostic behind a single port so a Codex rollout imports on exactly the path a Claude JSONL session already imports on, and record the cross-component dependency that made it possible. Before this decision the importer named "claude" in three places, discovery's fact described only project scanning for the local-projects page, and the codex mapper's dependency on c3-211's transcript translator existed in code with no fact recording it. This ADR introduces the SessionSource port in src/server/session-source.ts, replaces the parse-failure null with a reason-carrying union, and records c3-214 depending on c3-211's now-exported pure translation surface.

## Context

Session import was written for one provider. importOneSession hard-coded the literal "claude" in three places, the scanner and parser were claude-shaped modules the importer imported by name, and the only failure channel a parser had was returning null. Discovery's fact (c3-214) described the component as a scanner that surfaces candidate projects for the local-projects page — true, but a strict subset of what the component now owns.

Codex rollouts are the pressure. On the reference machine there are 534 rollouts under ~/.codex/sessions, and the user's expectation is that they appear in the same chat list as Claude sessions. Three things about that corpus decided the design and none of them are cosmetic.

First, the record types are genuinely different. A heterogeneous list of sources typed SessionSource<TRecord>[] cannot be written in TypeScript without an existential, and the only encodings TypeScript offers for one are any and unknown — both banned repo-wide by TYPE_STRICT_SYNTAX in eslint.config.js and by rule-strong-typing.

Second, null cannot say why. The largest rollout on that machine is 91 MB and parsing it costs a measured half-gigabyte of RSS, so it must be refused deliberately. Reported through a null-returning parser it surfaced to the user as parse_failed, which reads as corruption and invites an infinite retry, when the actionable truth is "raise KANNA_IMPORT_MAX_ROLLOUT_BYTES". The same collapse hid the 99 subagent/forked rollouts, whose refusal is permanent and deliberate.

Third, record identity is not available where a reader would expect it. payload.id is present on roughly 39 percent of records in the real corpus and ordinal on roughly 23 percent. Partial presence is strictly worse than absence: an id-keyed implementation looks correct on recent sessions and silently append-storms on older ones, re-appending the whole transcript on every live-tail tick with no error anywhere.

The rendering constraint is the fourth force, and it is what creates the new coupling. Codex tool cards already have one renderer — codex-transcript-translator.ts, bound to c3-211 (codex-app-server) — which derives toolKind and toolName from a ThreadItem for the live path. A hand-rolled import-side tool mapper would re-derive those and drift from the live path silently, so an imported session would render differently from the same session watched live.

## Decision

Introduce SessionSource as a port in src/server/session-source.ts and erase the record type at the registry boundary.

A source hands back an ImportableSession — the parsed data with its provider's pure behaviour already bound — rather than a ParsedSession<TRecord> plus a codec. TRecord stays inside the implementation, the importer never names it, and no cast is required anywhere. That is what buys a heterogeneous source list without any or unknown. createImportableSession performs the binding and is pure. importOneSession's control flow is unchanged; the three "claude" literals became session.provider.

SessionSource.parse answers a union — parsed, tooLarge with the size and cap, or rejected with a SessionParseRejection — rather than ImportableSession or null. SessionParseRejection is a superset of every provider's own rejection vocabulary so a provider-local union is assignable without a cast, and the vocabulary reaches the user: SingleImportResultRow.error in src/shared/protocol.ts gains too_large, subagent, unreadable, no_cwd, no_records, transcript_mismatch and source_shrunk.

The codex pipeline splits pure from IO on the repo's existing seam: codex-session-types.ts, codex-rollout-line.ts (the classifier), codex-rollout-to-thread-item.ts and codex-session-mapper.ts are pure; codex-session-parser.adapter.ts and codex-session-scanner.adapter.ts do the file IO; session-source-registry.ts is the composition root that wires them and holds the domain policy (provider precedence, the default size cap, the claude parser's null-to-parse_failed mapping).

codex-session-mapper.ts imports buildResultEntry, codexSystemInitEntry, normalizeCodexTokenUsage, todoToolCall, translateItemToToolCalls, translateItemToToolResults and withEntryIdentity from codex-transcript-translator.ts. That is a deliberate dependency from c3-214 on c3-211's translation surface, taken for rendering parity: an imported codex tool card is produced by the same functions that render the live one, so the two cannot drift. The surface changed to accommodate it — parseUnifiedDiff and isUnifiedDiff went from private to exported, and withEntryIdentity was added. The translator stays pure and IO-free, so the dependency does not drag process spawning into the import path.

Codex record identity is the PHYSICAL LINE INDEX, codex#<n>, because it is the only fact present on 100 percent of records. Its inverse is anchored, /^(codex#\d+)-/, so it is independent of whatever suffix vocabulary an entry id grows. Every entry is keyed on the line that produced it: a tool_result is keyed on its output record's line, never on the call's, because the two sit on different lines and routinely arrive in different live-tail ticks.

newEntriesSince maps ALL records and then filters ENTRIES by recordKeyFromEntryId. It previously filtered records and mapped the subset, which is the same function on paper and not in practice — it forces every mapper to be correct under subsetting, an invariant codex does not hold, and it degraded a multi-file apply_patch result to an orphaned generic card whose bare call_id matched none of the ids the call minted. Because toEntries and newEntriesSince are now literally the same map call differing only in a filter, SessionRecordCodec.recordKey was deleted: the store side and the delta side use one function, so inverse drift is unrepresentable rather than merely tested.

Three scope limits are decisions, not omissions. Subagent and forked rollouts are refused in v1 and reported as subagent. Files over KANNA_IMPORT_MAX_ROLLOUT_BYTES (default 32 MiB) are refused as too_large. assistant_thinking is unrecoverable for codex because reasoning.summary is empty in every record on disk.

The wire command names sessions.importClaude and sessions.importClaudeSession were deliberately NOT renamed. The names are stale, but renaming them breaks the protocol for no behavioural gain.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-214 | component | Owns the whole import pipeline. Its Goal and Purpose described only history-directory scanning for the local-projects page, which is now a strict subset: the component also owns the SessionSource port, both provider pipelines, the entry-id scheme and the delta filter. Contract gains the port's methods, Foundational Flow gains the c3-211 dependency, Change Safety gains the drift risks the port introduces | c3-214#n10483@v1:sha256:f0264d75010762a387b13f60a38550d95b2c99a83938f68388251c9ff3aa29b9 "Walks Claude Code and Codex history directories on disk, identifies candidate projects, and emits a typed projection for the local-projects page." | Confirm the port stays IO-only at the source boundary and that the pure mappers keep importing no node:fs, no process.env and no Bun global |
| c3-211 | component | codex-transcript-translator.ts is bound here and is now consumed by c3-214's codex mapper, so its pure translation functions are a published surface rather than a private one. parseUnifiedDiff and isUnifiedDiff moved from private to exported and withEntryIdentity was added, specifically to serve the import path | c3-211#n10343@v1:sha256:fc475b2a6d9f54558b307381696796cf68b868de219e51d22d494f3c22147450 "Spawns the Codex App Server child process, speaks JSON-RPC, maps its event stream onto the provider-adapter shape consumed by the coordinator. Non-goals: turn orchestration, transcript persistence — those live in c3-210." | Confirm the translator remains pure and IO-free now that a second component depends on it, and that a change to toolKind or toolName derivation is understood to move both the live and the imported card |
| c3-302 | component | SingleImportResultRow.error gained seven members — too_large, subagent, unreadable, no_cwd, no_records, transcript_mismatch and source_shrunk. The change is additive on a field the client already renders as free text, and the two wire command names were deliberately left alone, so no envelope shape moves and no existing client breaks | c3-302#n11748@v1:sha256:7b3e2010dde1628e847efb8329ea2f92a4d7328fe8a175ebe8066c07351ce38d "Holds the WS envelope discriminated unions: subscribe/unsubscribe/command kinds, correlation ids, and snapshot/diff payload wrappers. Non-goals: transport itself, business handlers." | Confirm the enlarged error union stays a named union in src/shared/protocol.ts under rule-strong-typing, and that no wire command was renamed |
| c3-2 | container | Its Discover local projects responsibility is the goal slice c3-214 serves, and that slice now covers importing sessions from two providers rather than scanning history directories for one. The framing still holds as written, so this row records a deliberate Parent Delta of none: membership is unchanged, c3-214 stays a child of c3-2, and no responsibility line is re-authored | c3-2#n9752@v1:sha256:8ce6294a502503f930d1118abfb660d9a4a96c63a717b8a6c690a0159f91302a "Discover local projects, manage terminals and uploads, operate share tunnels." | Confirm no sibling component under c3-2 also claims session import, so the port has exactly one owner |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-local-first-data | The whole pipeline reads only local history paths — ~/.claude/projects and ~/.codex/sessions — and makes no network call. Adding a second provider doubles the on-disk surface read, so the no-network guarantee has to hold for the new scanner and parser too | ref-local-first-data#n12221@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 "All persistent state sits under ~/.kanna/data; the server binds to 127.0.0.1 by default and only exposes wider surfaces (LAN, tunnel) when the user opts in." | comply |
| ref-provider-adapter | c3-214 now has a provider seam of its own. It is a different seam from the coordinator's turn-running adapter, but it is the same shape — the importer must not name a provider, exactly as the coordinator must not, and the codex mapper reuses the very translator that normalizes the live path | ref-provider-adapter#n12254@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 "Normalize Claude Agent SDK and Codex App Server into one transcript + tool-call model so the UI never branches on provider." | review |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | This decision is largely a typing decision. The record-type erasure exists precisely because any and unknown are banned, SessionParseResult and SessionParseRejection are named exported unions, and SingleImportResultRow.error is a boundary union in src/shared/protocol.ts | rule-strong-typing#n12520@v1:sha256:ab9d03265e99a9527350c213d779cbb270675fd943f331a80652bf0b80e692f8 "All boundary types must be named exports (interface or discriminated union) declared in " | comply |
| rule-colocated-bun-test | Every new module in the codex pipeline ships a colocated test beside it, and the entry-id round trip in particular is only protected by a colocated assertion over every entry the fixture produces | rule-colocated-bun-test#n12459@v1:sha256:6c733a6bc908ab2c89a563a0429d06eb34d56731aaa4a18067213c18dbdf6c8f "All test files must live in the same directory as the file under test and be named " | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Port | Declare SessionSource, ImportableSession, SessionRecordCodec, ParsedSession, SessionParseResult, SessionParseRejection and createImportableSession | src/server/session-source.ts |
| Registry | Compose the claude and codex sources, hold provider precedence (claude first on an id collision), the default 32 MiB cap and the claude null-to-parse_failed mapping | src/server/session-source-registry.ts |
| Codex pure half | Record types, rollout-line classifier, rollout-to-ThreadItem bridge, and the codec that maps records to entries | src/server/codex-session-types.ts, src/server/codex-rollout-line.ts, src/server/codex-rollout-to-thread-item.ts, src/server/codex-session-mapper.ts |
| Codex IO half | Parse one rollout file and scan the rollout tree; both are leaves that never import the classifier | src/server/codex-session-parser.adapter.ts, src/server/codex-session-scanner.adapter.ts |
| Importer | Replace the three "claude" literals with session.provider; control flow otherwise unchanged | src/server/claude-session-importer.adapter.ts |
| Protocol | Widen SingleImportResultRow.error by seven members; leave sessions.importClaude and sessions.importClaudeSession named as they are | src/shared/protocol.ts |
| Translator surface | Export parseUnifiedDiff and isUnifiedDiff, add withEntryIdentity, keep the module pure | src/server/codex-transcript-translator.ts |
| Docs | Update c3-214 Goal, Purpose, Contract, Foundational Flow and Change Safety; add the c3-211 Contract row for the shared translation surface and widen its Derived Materials variance note | .c3/changes/adr-20260825-provider-agnostic-session-import/ |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| TYPE_STRICT_SYNTAX in eslint.config.js | Fails the build on any or unnarrowed unknown, which is what forces the record-type erasure instead of an existential cast | bun run lint |
| Side-effect lint (ports-and-adapters seal) | Fails if a non-.adapter module reaches for node:fs, process.env or the Bun global, keeping codex-session-mapper.ts and codex-rollout-line.ts pure | bun run lint |
| toParserSkipReason exhaustive switch in session-source-registry.ts | Has no default clause, so a new skip reason on either the classifier or the parser side is a compile error at the seam rather than a silently mistranslated diagnostic | bun run check |
| Colocated entry-id round-trip test | Asserts recordKeyFromEntryId recovers a key for every entry the codex fixture produces, which is the only thing standing between a suffix-vocabulary change and a silent append-storm | bun test src/server/codex-session-mapper.test.ts |
| c3x eval c3-214 | Checks the fact's claim against its code globs in .c3/eval/c3-214.yaml, which now cover both provider pipelines and the port | c3x eval c3-214 |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep SessionSource<TRecord> generic and hold a heterogeneous array | Needs an existential type; TypeScript offers only any or unknown for one, and both are banned by TYPE_STRICT_SYNTAX in eslint.config.js and by rule-strong-typing |
| Keep parse returning ImportableSession or null | null cannot say why. The 91 MB rollout and the 99 subagent rollouts on the reference machine both surfaced as parse_failed, which reads as corruption and invites an unbounded retry of something that is a deliberate, permanent refusal |
| Key codex records on payload.id, falling back to ordinal | Present on roughly 39 percent and 23 percent of records respectively. Partial presence is worse than absence: the implementation looks correct on recent sessions and silently append-storms on older ones |
| Write a dedicated import-side tool mapper instead of importing from codex-transcript-translator.ts | It would re-derive toolKind and toolName and drift from the live codex path silently, so the same session would render one way when watched live and another when imported |
| Keep SessionRecordCodec.recordKey alongside recordKeyFromEntryId | Two keying functions are two things to keep in sync, and every append-storm bug in this pipeline was the two drifting. One function makes the drift unrepresentable rather than merely tested |
| Rename sessions.importClaude to a provider-neutral wire command | Breaks the protocol for no behavioural gain. The name is stale; the envelope is fine |
| Filter records then map the subset in newEntriesSince | Requires every mapper to be correct under subsetting, which codex is not. It degraded a multi-file apply_patch result to an orphaned generic card while leaving the Edit cards stuck in progress, with nothing failing |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| c3-211 translation surface drifts under c3-214 | The dependency is recorded on both facts — a Foundational Flow row on c3-214 and a Contract row on c3-211 — so a change to the translator is visibly a change to two components. The translator's purity is what keeps the coupling cheap | bun run check, plus c3x graph c3-214 --depth 1 shows the recorded dependency |
| Silent append-storm from an entry-id scheme change | The inverse is anchored on codex#<digits> and nothing else, so it survives suffix changes, and the colocated round-trip test asserts recovery over every entry the fixture produces | bun test src/server/codex-session-mapper.test.ts |
| A user cannot tell why a rollout was skipped | The refusal reason travels all the way to SingleImportResultRow.error, and scanAllSessions keeps the refusals that SessionSource.scan has to drop, so an import-all run can report the count and reason | bun test src/server/codex-session-parser.test.ts, bun test src/server/codex-session-scanner.test.ts |
| Memory blowup on a very large rollout | KANNA_IMPORT_MAX_ROLLOUT_BYTES caps a single file at 32 MiB by default; the cap is a parameter threaded from server.ts, so the registry itself reads no environment | bun test src/server/codex-session-parser.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run check | Clean; the erased record type compiles with no cast and the toParserSkipReason switch stays exhaustive |
| bun run lint | Clean; no any, no unnarrowed unknown, and no side-effect import in a pure codex module |
| bun test src/server/codex-session-mapper.test.ts | Passes, including the entry-id round trip over every entry the fixture produces |
| bun test src/server/codex-session-parser.test.ts src/server/codex-session-scanner.test.ts src/server/codex-rollout-line.test.ts | Passes, including the too_large and subagent refusals and the unparseable-line counter |
| c3x check | ok, total 228 or more, with c3-214 and c3-211 valid against the component canvas |
| c3x lookup src/server/session-source.ts and c3x lookup src/server/codex-session-mapper.ts | Both resolve to c3-214 |
| git status .c3/ | Shows only the ADR, its change folder, c3-214 and c3-211 — nothing c3x rewrote incidentally |
