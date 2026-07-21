---
id: adr-20260721-tracking-file-mdast-query
c3-seal: 06c0e87067f82795e24bb2e6361b36ed92dfeab2ac0be0f0ea66ffd0940002c8
title: tracking-file-mdast-query
type: adr
goal: |-
    Stop the notification-driven autonomous loop's per-iteration Claude context
    from scaling with the size of the tracking file (PROGRESS.md). Replace the
    "read the whole file every turn" pattern with section-scoped, mdast-backed
    read/append MCP tools so only the needed slices ever enter context, and remove
    the now-irrelevant `goal` / `chunkHint` length caps in the loop validator.
status: proposed
date: "2026-07-21"
---

# ADR — Structured (mdast) tracking-file access to bound loop context growth

## Goal

Stop the notification-driven autonomous loop's per-iteration Claude context
from scaling with the size of the tracking file (PROGRESS.md). Replace the
"read the whole file every turn" pattern with section-scoped, mdast-backed
read/append MCP tools so only the needed slices ever enter context, and remove
the now-irrelevant `goal` / `chunkHint` length caps in the loop validator.

## Context

In the loop pattern (adr-20260711-notification-driven-loop-orchestration), both
the main orchestrator and each subagent are FRESH Claude spawns every
iteration, so nothing accumulates across iterations. The one durable, growing
artifact is the tracking file. `renderLoopPrompt` told the model to "Read
<file>" (main) and to "append a Progress row" (subagent, which forces a
read-before-edit of the whole file). Nothing caps or trims it —
`ensureTrackingFile` runs only once at setup_loop time. So as the Progress log
grows, every iteration re-reads an ever-larger file: per-turn context becomes
O(file size), reintroducing the window-blowup the per-iteration /clear was
meant to prevent.

The user's directive: do NOT cap/trim the file (history is worth keeping).
Instead query it structurally so the whole file never enters context.

## Decision

Add a general, extension-keyed structured-document engine and expose two
kanna-mcp tools on top of it; rewrite the loop prompt to use them.

- **Pure engine** `src/shared/structured-doc/` — a `StructuredDoc` port
(`sections`/`query`/`append`) plus a registry `resolveStructuredDoc(ext)`
(`.md` -> mdast adapter today; new formats = one adapter + one row). The
markdown adapter uses mdast (`mdast-util-from-markdown` +
`micromark-extension-gfm`) purely as a parser to locate section + list-item
boundaries by source offset; every slice is taken from the original string,
so read/append are byte-faithful. No IO (allowed in `src/shared/**`).
- **IO leaf** `src/server/structured-doc-io.adapter.ts` — `readDoc`/`writeDoc`.
- **MCP tools** `query_tracking_file` + `append_tracking_row`
(`kanna-mcp.ts` `buildTrackingDocToolList`), registered whenever a `chatId`
is present (NO depth gate) so both the main orchestrator and its subagents
get them. Self-contained: confine the path to the chat cwd, dispatch by
extension, call the IO leaf — no coordinator/spawner threading.
- **Loop prompt** `renderLoopPrompt` instructs both roles to use the tools and
forbids whole-file Read/Edit; the two tool names join the structural
invariant asserted in `validateLoopSetup`.
- **Caps removed** — `MAX_GOAL_LEN` / `MAX_CHUNK_HINT_LEN` and their two
validator branches deleted (per user request; no length limit yet).

Chosen over (a) capping/trimming the file (loses history; the user rejected
it) and (b) server-side prompt-inlining of the slice (couples the re-entry
path and moves file writes off the durability contract). Tools keep the model
in control and match the existing kanna-mcp idiom. `reconcileTrackingFile`
stays line-based (byte-exact round-trip contract) and is untouched — the
engine is additive.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| kanna-mcp tool surface | N.A - no component fact (governed by loop ADRs) | Two new tools (query_tracking_file, append_tracking_row) added to the always-on kanna-mcp tool list | adr-20260712-loop-orchestration-hardening#n5240@v1:sha256:e5cb810d9353b1f551cef65bfc3db7ecf100aefa4305da54600d81abc00e6794 | Side-effect seal: tools call the .adapter.ts IO leaf, not raw fs |
| loop-template prompt + validator | N.A - no component fact (governed by loop ADRs) | Prompt rewritten to query/append; structural invariant extended; length caps removed | adr-20260712-loop-orchestration-hardening#n5240@v1:sha256:e5cb810d9353b1f551cef65bfc3db7ecf100aefa4305da54600d81abc00e6794 | Rendered-prompt structural invariant still enforced in validateLoopSetup |
| structured-doc engine (new) | N.A - new pure shared module | New src/shared/structured-doc/ pure engine + structured-doc-io.adapter.ts IO leaf | adr-20260712-loop-orchestration-hardening#n5240@v1:sha256:e5cb810d9353b1f551cef65bfc3db7ecf100aefa4305da54600d81abc00e6794 | Pure layer has zero IO imports (seal); IO isolated to the .adapter.ts |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Pure engine | src/shared/structured-doc/{types,markdown,registry}.ts + tests | 14 tests pass |
| IO leaf | src/server/structured-doc-io.adapter.ts + test | 3 tests pass |
| MCP tools | buildTrackingDocToolList in kanna-mcp.ts + tests | kanna-mcp.test.ts 53 pass |
| Loop prompt + caps | renderLoopPrompt uses tools; caps removed; invariant extended | loop-template.test.ts 29 pass |
| Docs | CLAUDE.md loop section updated | same PR |
| Deps | mdast-util-from-markdown, mdast-util-gfm, micromark-extension-gfm, @types/mdast | package.json |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/shared/structured-doc/ | 14 pass |
| bun test --conditions production src/server/structured-doc-io.adapter.test.ts | 3 pass |
| bun test --conditions production src/server/kanna-mcp.test.ts | 53 pass |
| bun test --conditions production src/server/loop-template.test.ts | 29 pass (caps removed, invariant extended) |
| bun run typecheck | clean (TS7) |
| bun run lint | clean (side-effect seal holds; pure engine has no IO import) |
| bun run test | full suite 4341 pass, 0 fail |
| Manual smoke: arm a loop, let PROGRESS.md accumulate many rows | model calls query_tracking_file/append_tracking_row not Read/Edit; per-turn context flat as file grows; loop still terminates on GOAL MET |
