---
id: adr-20260730-import-single-claude-session
c3-seal: e19531ebf778434135c3c56cdf7cf0caacbc64cdb7b947a7b214a577ba16dcd7
title: import-single-claude-session
type: adr
goal: |-
    Add a single-session-by-uuid Claude transcript import path,
    `sessions.importClaudeSession { sessionIds: string[] }`, alongside Kanna's
    existing all-or-nothing `sessions.importClaude` command. This ADR is the
    work order for **PR A (Foundation)** of a multi-PR project: extract
    `importOneSession(store, session): ImportOutcome` from the bulk import
    loop (byte-identical bulk behavior preserved), add a pure UUID extractor
    (`extractSessionId`/`extractSessionIds`) plus an `O(#project-dirs)` file
    locator (`locateClaudeSessionFile`), and wire one new WS command
    (`importSessionsByIds`) that composes locate → parse → `importOneSession`
    per id, exposing an optional `onSessionImported` callback seam consumed by
    a later live-tailing PR. UI, live-tail, and subagent drill-in are
    explicitly out of scope for this ADR/PR — they are follow-up PRs (B, C, D)
    on top of this foundation.
status: proposed
date: "2026-07-30"
---

## Goal

Add a single-session-by-uuid Claude transcript import path,
`sessions.importClaudeSession { sessionIds: string[] }`, alongside Kanna's
existing all-or-nothing `sessions.importClaude` command. This ADR is the
work order for **PR A (Foundation)** of a multi-PR project: extract
`importOneSession(store, session): ImportOutcome` from the bulk import
loop (byte-identical bulk behavior preserved), add a pure UUID extractor
(`extractSessionId`/`extractSessionIds`) plus an `O(#project-dirs)` file
locator (`locateClaudeSessionFile`), and wire one new WS command
(`importSessionsByIds`) that composes locate → parse → `importOneSession`
per id, exposing an optional `onSessionImported` callback seam consumed by
a later live-tailing PR. UI, live-tail, and subagent drill-in are
explicitly out of scope for this ADR/PR — they are follow-up PRs (B, C, D)
on top of this foundation.

## Context

Kanna's only import gesture today is all-or-nothing:
`sessions.importClaude` (no args, `src/shared/protocol.ts:99`, union
member `{ type: "sessions.importClaude" }`) is handled at
`src/server/ws-router.ts:434` (`case "sessions.importClaude"`), which calls
`importClaudeSessions({ store })` in
`src/server/claude-session-importer.adapter.ts:187-278`. That function
walks every `~/.claude/projects/*/*.jsonl` via `scanClaudeSessions`
(`src/server/claude-session-scanner.adapter.ts`), MD5-hashes each file's
raw content via `createHash("md5")` in
`src/server/claude-session-parser.adapter.ts:28` (`sourceHash`, used for
change detection at `claude-session-importer.adapter.ts:218,234`), and
imports every discovered session unconditionally. Import is snapshot-only:
grep for `fs.watch`/`chokidar` across
`src/server/discovery.adapter.ts`,
`src/server/claude-session-importer.adapter.ts`,
`src/server/claude-session-scanner.adapter.ts`,
`src/server/claude-session-parser.adapter.ts`, and
`src/server/claude-session-mapper.ts` returns zero matches — no watcher
exists anywhere in the import/discovery path; refresh today is a manual
re-click that re-runs the full O(all local sessions) scan.

This lack of a targeted, cheap, single-session import is the concrete pain
this ADR addresses: the Tribe plugin's Campaign Orchestration Runner
(`/Users/home/repos/todd-skills/plugins/tribe/scripts/runner/`) spawns
headless Claude Agent-SDK sessions that persist to
`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` and records each
session's uuid in campaign state — a human watching a Tribe campaign wants
to paste one (or a handful of) known session uuid(s) into Kanna and see
just those chats, without triggering a full-history rescan and without
Kanna needing any Tribe-specific code (Kanna must stay transport/caller
agnostic).

Affected topology for this ADR: `c3-214` (discovery/import component,
`.c3/c3-2-server/c3-214-discovery.md`, container `c3-2`) owns the current
bulk import path and is the component this ADR's foundation work extends;
`c3-3`/`c3-302` (shared protocol container/component,
`.c3/c3-2-server`-sibling `protocol` component) owns the `ClientCommand`
union that gains the new `sessions.importClaudeSession` member; `c3-117`
(local-projects-page, client UI) is affected only by a **later** PR (the
import dialog) and is out of scope here — no UI files are touched by this
ADR or by PR A.

**Known C3 doc drift found during this ADR's research (fixed as change-unit
patches, NOT yet applied — see Underlay C3 Changes):** `c3-214`'s Contract
and Change Safety rows cite `src/server/discovery.ts`; the real file on
disk is `src/server/discovery.adapter.ts` (`ls src/server/discovery.adapter.ts`
succeeds, `src/server/discovery.ts` does not exist). `c3-214`'s Business
Flow ("Alternate — rescan") and Contract ("Rescan trigger") rows claim
"Filesystem watch triggers incremental rescan" / "Filesystem watch invokes
rescan" — no such watch exists anywhere in the discovery/import path
(verified above by direct grep). Additionally, `c3-214`'s codemap
(`.c3/code-map.yaml:131-142`) lists `src/server/claude-session-importer.ts`,
`src/server/claude-session-parser.ts`, and `src/server/claude-session-scanner.ts`
(pre-rename, no `.adapter` suffix) and `src/server/discovery.ts` — `c3
lookup src/server/claude-session-importer.adapter.ts` /
`...-parser.adapter.ts` / `...-scanner.adapter.ts` /
`src/server/discovery.adapter.ts` each return an empty `matches:` (coverage
gap: "map or explicitly exclude the surfaced path"). `c3 lookup
src/server/claude-session-mapper.ts` already resolves correctly (that file
was never renamed with an `.adapter` suffix, so its existing codemap entry
is accurate) — it is nonetheless re-declared in the codemap carrier below
so the four adapter/mapper files this ADR's Work Breakdown touches are all
explicitly, consistently bound in one carrier.

## Decision

**D1 — Array command.** The new command takes `sessionIds: string[]`
(one-or-many), not a single scalar id. This keeps Kanna agnostic to the
caller: a future dialog's multi-paste (splitting on whitespace/commas/
newlines) and any external script (e.g. a Tribe-side clipboard bridge) both
send the same shape in one WS round-trip, instead of Kanna needing N
sequential single-id round-trips or caller-specific looping logic.

**D2 — Live by default (a later PR, named here for context only).**
Single-session import will, in a follow-up PR (not this one), auto-arm
live tailing when the source file's mtime is recent; bulk import never
tails. This ADR's foundation work only adds the
`onSessionImported(info: SessionImportedInfo)` callback seam on
`importSessionsByIds` (no-op today) so that follow-up PR can hook in
without another foundation change.

**D6 — Outcome type.** `importOneSession(store, session): Promise<ImportOutcome>`
returns a discriminated union:

```ts
export type ImportOutcome =
  | { status: "created"; chatId: string; newProject: boolean }
  | { status: "updated"; chatId: string }
  | { status: "skipped"; chatId?: string }
  | { status: "failed"; reason: "cwd_missing" | "store_error" }
```

The existing bulk loop in `importClaudeSessions` is rewritten to call
`importOneSession` per session and map each outcome onto its existing
`imported`/`updated`/`skipped`/`failed`/`newProjects` counters, so
`ImportClaudeSessionsResult` (the bulk return shape) and every existing
test in `src/server/claude-session-{importer,scanner,parser,mapper}.test.ts`
stay byte-identical (verified per-task by `git diff --stat` on those four
files showing zero change, and by rerunning those suites unmodified-green).
This is the smallest change that gives single-session import a typed,
per-session result without touching the bulk contract at all.

These three decisions (D1, D2, D6) are the scope this ADR's Affected
Topology/Compliance/Work Breakdown sections govern. D3–D5 (live-tail
registry, single-writer/takeover semantics, lazy drill-in registration)
belong to the later PRs (C, D) referenced above and are out of scope for
this ADR's patches and verification.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-214 | component | Owns the bulk Claude-session import/discovery path (importClaudeSessions, scanClaudeSessions); this ADR's foundation work (importOneSession extraction, locateClaudeSessionFile, importSessionsByIds) extends it directly, and its Contract/Change Safety/Business Flow rows plus codemap have pre-existing drift this ADR's change-unit patches fix | c3-214#n7088@v1:sha256:f0264d75010762a387b13f60a38550d95b2c99a83938f68388251c9ff3aa29b9 "Walks Claude Code and Codex history directories on disk, identifies candidate projects, and emits a typed projection for the local-projects page. Non-goals: clo" | Contract/Change-Safety row patches + codemap carrier authored in this change-unit (see Underlay C3 Changes); c3 change apply adr-20260730-import-single-claude-session deferred to the final kanna PR of this project |
| c3-3 | container | Owns the shared ClientCommand WS envelope union (component c3-302 "protocol") that gains the new sessions.importClaudeSession member in a later task of this same PR | c3-3#n8165@v1:sha256:2de0e6f995ad3b39f564e49bea3e7a272f0e05656f3ccecebf0f5810c837b041 "Define the WebSocket protocol envelope shared by client + server." | No-delta expected: container Goal/Responsibilities/Components list unchanged — only an internal union member is added by a later task; confirm at that task's own review that c3-302's Contract still holds |
| c3-117 | component | Local-projects-page (client UI) is the eventual consumer of an import-by-id affordance, but no UI file is touched by this ADR or by the PR it opens (PR A is server-only) | c3-117#n6279@v1:sha256:aecc340c903dfbe2ad83291ef4e5abb9703a23b29aebe98eb64c39543178170e "Lists projects auto-discovered from local Claude and Codex history; lets the user open a project into Kanna or create a new one. Non-goals: discovery itself (se" | N.A - out of scope for this ADR/PR; reviewed when the UI dialog PR lands |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-local-first-data | c3-214 already uses: ref-local-first-data; D1/D6's session lookup and import stay confined to local ~/.claude/projects paths under homeDir, no network calls added | ref-local-first-data#n8617@v1:sha256:02f721844f5663d08d9d927c014b461aa6f1fe43b33f36be3392e8b9118127fd "paths.ts centralizes data paths; cli.ts defaults to localhost; --host / --remote / --share are explicit opt-ins; --password gates all surfaces when set." | comply |
| ref-ws-subscription | D1 adds a new command to the single shared WS envelope (ClientCommand union in src/shared/protocol.ts); the ref requires all message shapes live there and commands return correlation ids over the existing socket | ref-ws-subscription#n8787@v1:sha256:12369726b6d0db9d37a010dfbd771e1e89bc8f8b276304de753e53da754b03cc "One WS per client. Server-side ws-router multiplexes subscribe/unsubscribe/command. Client-side socket.ts maintains the connection and dispatches typed envelope" | comply |
| ref-strong-typing | D6's ImportOutcome (and this PR's SingleImportResultRow/ImportSessionsByIdsResult) are boundary values crossing client↔server; the ref requires named exported discriminated unions/interfaces, never inline/any shapes | ref-strong-typing#n8721@v1:sha256:2e46bc7d3b135006d0378a5f1830e9494750682f5a3e1570a696c2bc8d291c82 "TypeScript strict mode; shared types in src/shared/types.ts; protocol envelopes in src/shared/protocol.ts; events in src/server/events.ts." | comply |
| ref-side-effect-adapter | The new locateClaudeSessionFile (filesystem readdirSync/existsSync) and importSessionsByIds additions land in existing *.adapter.ts leaf files (claude-session-scanner.adapter.ts, claude-session-importer.adapter.ts), matching the two-shape adapter convention this ref defines | ref-side-effect-adapter#n8684@v1:sha256:d8b40f28d9ae85dadc612afc771c8aafe6c08e79f161816274c78dd074c89070 "Leaf-IO module — a file whose only responsibility is the side effect itself. Suffix: <name>.adapter.ts. Examples on main: `src/server/storage/fs-storage" | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | Same boundary-typing requirement as ref-strong-typing above, at the rule-enforcement layer (component c3-302 uses: rule-strong-typing) — the new ImportOutcome/SingleImportResultRow/ImportSessionsByIdsResult types and the new ClientCommand union member must be named exports, not any | rule-strong-typing#n8914@v1:sha256:ab9d03265e99a9527350c213d779cbb270675fd943f331a80652bf0b80e692f8 "All boundary types must be named exports (interface or discriminated union) declared in src/shared/** or the owning module — never any, never an untyped i" | comply |
| rule-colocated-bun-test | New test cases for extractSessionId/extractSessionIds, locateClaudeSessionFile, and importSessionsByIds must sit next to (or be appended to) their existing colocated *.test.ts files, never a separate __tests__/ tree | rule-colocated-bun-test#n8853@v1:sha256:6c733a6bc908ab2c89a563a0429d06eb34d56731aaa4a18067213c18dbdf6c8f "All test files must live in the same directory as the file under test and be named <module>.test.ts or <module>.test.tsx; live integration tests must be nam" | comply |
| rule-zustand-store | This ADR's PR A is server-only (no client store touched) | rule-zustand-store#n8946@v1:sha256:eddb1e4ed99a17547a630f5997a2ad234b79ac5be15bc1d151f3e09d9cb9df2c "Client state stores take exactly two forms. (1) Singleton feature stores: create<TState>() from zustand, at src/client/stores/<concern>(Store)?.ts, exposi" | N.A - no client code in scope for this ADR/PR |
| rule-mcp-name-reserved | This ADR does not touch MCP server registration | rule-mcp-name-reserved#n8885@v1:sha256:43f075905d532466b3b381df83682cb06b7a18c7e5df1ef5b0ec403f8bf458db "User MCP server names registered in customMcpServers must never equal" | N.A - unrelated surface |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| ADR + change-unit (this task) | Create adr-20260730-import-single-claude-session; open its change-unit and author (not apply) patches fixing c3-214 doc drift | .c3/adr/adr-20260730-import-single-claude-session.md; .c3/changes/adr-20260730-import-single-claude-session/ |
| extractSessionId/extractSessionIds (later task, same PR) | Pure UUID extractor + splitter, shared module | src/shared/claude-session-id.ts (not created by this ADR task) |
| locateClaudeSessionFile (later task, same PR) | O(#project-dirs) locator appended to the existing scanner adapter | src/server/claude-session-scanner.adapter.ts (append; existing scanClaudeSessions untouched) |
| importOneSession extraction (later task, same PR) | Extract the bulk loop's per-session body into a standalone function returning the D6 ImportOutcome union; rewrite the bulk loop to call it and map outcomes onto its existing counters | src/server/claude-session-importer.adapter.ts:187-278 |
| sessions.importClaudeSession command (later task, same PR) | New ClientCommand union member + ws-router case + importSessionsByIds composing locate→parse→importOneSession per id, with the onSessionImported seam | src/shared/protocol.ts:96-99; src/server/ws-router.ts:434 (sibling case) |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-214 Contract | Row "Discovery projection" (node n7110): Evidence column corrected src/server/discovery.ts → src/server/discovery.adapter.ts. Row "Rescan trigger" (node n7111): rewritten from the fictional "Filesystem watch invokes rescan" to the real "Manual full rescan on user request (no filesystem watch)", Evidence corrected to discovery.adapter.ts | .c3/changes/adr-20260730-import-single-claude-session/01-contract-discovery-path.patch.md, 02-contract-rescan-trigger-reality.patch.md; c3x read c3-214 --section Contract --cite |
| c3-214 Change Safety | Row "Scan stalls" (node n7115): Required-Verification path corrected discovery.ts → discovery.adapter.ts. Row "Stale entries" (node n7116): rewritten from "Watch handler skipped" to the real manual-refresh-only risk, verification updated to a grep proving no fs.watch/chokidar usage | .c3/changes/adr-20260730-import-single-claude-session/03-change-safety-discovery-path.patch.md, 04-change-safety-stale-entries-reality.patch.md; c3x read c3-214 --section "Change Safety" --cite |
| c3-214 Business Flow | Row "Alternate — rescan" (node n7101): rewritten from "Filesystem watch triggers incremental rescan" to "Manual full rescan triggered by user re-click (no filesystem watch exists)" | .c3/changes/adr-20260730-import-single-claude-session/05-business-flow-rescan-reality.patch.md; c3x read c3-214 --section "Business Flow" --cite |
| c3-214 codemap | Codemap carrier declares the real adapter/mapper filenames (claude-session-importer.adapter.ts, claude-session-scanner.adapter.ts, claude-session-parser.adapter.ts, claude-session-mapper.ts, discovery.adapter.ts) replacing the stale pre-rename entries in .c3/code-map.yaml | .c3/changes/adr-20260730-import-single-claude-session/06-codemap-adapter-rename.codemap.md; c3 lookup src/server/claude-session-importer.adapter.ts (empty today, resolves to c3-214 after this unit is applied) |
| Change-unit lifecycle | Patches authored + validated now; c3 change apply adr-20260730-import-single-claude-session intentionally deferred to the final kanna PR of this multi-PR project (per this ADR's Goal) | c3 change status adr-20260730-import-single-claude-session (shows pending, not applied) |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3 check | Validates canonical .c3/ markdown (schema shape, seals, codemap coverage warnings) on every future PR in this project | c3 check |
| c3 lookup <file> | After this change-unit is applied (final PR), resolves the previously-uncharted adapter files to c3-214 instead of reporting a coverage gap | c3 lookup src/server/claude-session-importer.adapter.ts (currently empty matches — expected to resolve post-apply) |
| bun run lint (side-effect seal) | Enforces that any new filesystem IO in later tasks (locateClaudeSessionFile, etc.) stays inside *.adapter.ts, per ref-side-effect-adapter | bun run lint |
| src/server/claude-session-{importer,scanner,parser,mapper}.test.ts | Existing suites are the byte-identical wall D6 depends on — any later task that breaks bulk-import behavior fails these unmodified tests | bun test --conditions production src/server/claude-session-importer.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Single scalar sessionId: string command instead of an array | The Tribe campaign bridge use case needs to import a handful of known session ids in one round-trip; a scalar command forces the caller into N sequential WS round-trips or bespoke client-side looping, and couples Kanna's protocol shape to one caller's cadence instead of staying transport-agnostic |
| Reuse importClaudeSessions's bulk loop unmodified and filter its results client-side to the pasted ids | The bulk loop parses and MD5-hashes every .jsonl file under ~/.claude/projects (scanClaudeSessions + claude-session-parser.adapter.ts:28) even to satisfy a 1-id import — O(all local sessions) cost for O(1) intent, and defeats the whole point of a cheap targeted import for a repo with hundreds of local Claude sessions |
| Mutate ImportClaudeSessionsResult/importClaudeSessions in place to carry a per-session outcome shape usable by both bulk and single-session callers | The later extraction task's WALL requires the four existing importer/scanner/parser/mapper suites stay byte-identical (git diff --stat empty); sharing one mutated return type risks silently changing bulk-import counters those unmodified tests assert on |
| Apply the c3-214 change-unit patches immediately in this task instead of deferring change apply | The patches fix doc drift for code that already exists today, but landing them now would desync the change-unit's declared codemap carrier from the still-in-flight later tasks in this same multi-PR project; bundling accept+apply with the final kanna PR keeps the fact-mutation atomic with the last piece of code it describes |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| c3-214 canonical docs stay stale (wrong discovery.ts path, fictional watch claim, codemap gaps) through the several PRs between this ADR and the deferred change apply | This ADR documents the exact drift and its fix in Context/Underlay C3 Changes so any reader mid-project sees the known-stale state explicitly instead of trusting unverified prose; the change-unit folder itself is the tracked, reviewable TODO | c3 change status adr-20260730-import-single-claude-session (shows pending patches, not silently lost) |
| A later task in this PR (importOneSession extraction, D6) accidentally changes bulk importClaudeSessions behavior, breaking the byte-identical wall this ADR's Decision relies on | Existing importer/scanner/parser/mapper suites are unmodified and must stay green; that task's own commit re-runs them and diffs the test files themselves | bun test --conditions production src/server/claude-session-importer.test.ts; git diff --stat src/server/claude-session-importer.test.ts (expect empty) |
| The change-unit patches drift before the deferred change apply (a later task edits c3-214's Contract again, staling this unit's cited anchors) | c3 change status/c3 change view surface drift explicitly and c3 change rebase re-anchors before apply — apply is gated (drift + canvas) and atomic, so a drifted patch can never land silently | c3 change status adr-20260730-import-single-claude-session (run again immediately before the final apply) |

## Verification

| Check | Result |
| --- | --- |
| c3 schema adr (read before drafting) | ran; body authored to the REJECT IF contract and per-section fill guidance |
| grep -rn "fs.watch\|chokidar" src/server/discovery.adapter.ts src/server/claude-session-importer.adapter.ts src/server/claude-session-scanner.adapter.ts src/server/claude-session-parser.adapter.ts src/server/claude-session-mapper.ts | no matches — confirms the Context/Decision claim that no filesystem watch exists |
| c3 lookup src/server/claude-session-importer.adapter.ts / claude-session-scanner.adapter.ts / claude-session-parser.adapter.ts / discovery.adapter.ts | empty matches today (coverage gap), confirming the codemap drift this ADR's carrier patch fixes |
| c3 add adr import-single-claude-session --file adr-body.md | creates this ADR entity |
| c3 change new adr-20260730-import-single-claude-session; c3 change status adr-20260730-import-single-claude-session | scaffolds and reports per-patch state (pending, not applied) for the 6 authored patches/carrier |
| c3 check | canonical .c3/ markdown validates (pre-existing, unrelated seal drift from other in-flight change-units documented separately in the Hunter's report, not introduced by this ADR) |
