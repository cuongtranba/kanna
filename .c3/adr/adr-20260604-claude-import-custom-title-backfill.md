---
id: adr-20260604-claude-import-custom-title-backfill
c3-seal: 53db8d7638f049183d03ef90bf90cb48c955dd43b8bf9f8194db93676d20ab1f
title: claude-import-custom-title-backfill
type: adr
goal: Extend Claude session import naming so Kanna derives imported chat titles from Claude `custom-title` records and backfills already-imported Claude chats when their stored title still matches Kanna's legacy importer-derived title.
status: implemented
date: "2026-06-04"
---

## Goal

Extend Claude session import naming so Kanna derives imported chat titles from Claude `custom-title` records and backfills already-imported Claude chats when their stored title still matches Kanna's legacy importer-derived title.

## Context

A real imported chat (`a1ff98cc-1856-4a63-bf1d-ce7ad190c15a`) shows the first user prompt in the sidebar even though the source Claude JSONL has repeated `type: "custom-title"` records with `customTitle: "pvs-no-change"`. The previous title derivation change only handled `summary` records, but this source file has zero `summary` records. Existing imports are also skipped before any rename happens when the source hash matches, so restarting or re-importing cannot update old titles. The importer adapter remains a C3 codemap gap, but its tests and neighboring Claude session types/mapper/scanner files are owned by c3-214 discovery. Parent Delta: c3-2 needs no container responsibility change because local history import and persistence are already server responsibilities.

## Decision

Add a typed Claude `custom-title` record shape and make `deriveTitle()` prefer the latest non-empty `customTitle`, then latest non-empty `summary`, then the first user text, then `"Imported session"`. For existing imported chats, compute both the new title and the legacy title that would have been produced without `custom-title`. Rename an existing chat only when the new title differs and the current title looks importer-owned: equal to the legacy title, `"Imported session"`, or `"New Chat"`. Run this title backfill before the unchanged-hash skip so a title-only update counts as `updated`; preserve normal message delta handling for changed hashes.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-214 | component | Claude session import and session record typing are local-history discovery/import behavior. | Comply with local-first data handling and keep projection shape unchanged. |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-local-first-data | The new title source is read from local Claude JSONL files and persisted to the local Kanna event log only. | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | The import behavior is enforced by src/server/claude-session-importer.test.ts beside the importer. | comply |
| rule-strong-typing | custom-title is a boundary shape from Claude JSONL into the importer and must be named/narrowed. | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/server/claude-session-types.ts | Add a named ClaudeSessionCustomTitleRecord to the ClaudeSessionRecord union. | Type diff and importer test compilation. |
| src/server/claude-session-importer.adapter.ts | Prefer latest non-empty customTitle, keep summary/user fallbacks, and backfill importer-owned existing titles before source-hash skip. | Targeted Bun tests pass. |
| src/server/claude-session-importer.test.ts | Add tests for custom-title precedence and unchanged-hash title-only backfill. | bun test src/server/claude-session-importer.test.ts. |
| c3-2 parent delta | No parent doc update needed; server already owns local discovery/import, persistence, and read-model broadcast. | c3-2 Responsibilities already cover local project discovery and event/read-model ownership. |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI underlay changed | The change affects Kanna runtime import behavior only, not C3 commands, validators, schemas, hints, templates, or tests. | c3 check --include-adr --only adr-20260604-claude-import-custom-title-backfill remains clean. |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| Importer unit tests | Fail if customTitle does not beat summary/user fallback or if unchanged-hash existing imports cannot backfill importer-owned titles. | bun test src/server/claude-session-importer.test.ts. |
| C3 structural check | Confirms ADR compliance and parent-delta evidence. | c3 check --include-adr --only adr-20260604-claude-import-custom-title-backfill. |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Rename every existing imported chat whenever Claude has a custom title | This could overwrite a user’s manual Kanna rename; importer-owned-title detection gives the requested backfill without broad clobbering. |
| Only apply custom-title to new imports | It would not fix the actual reported chat because unchanged-hash existing imports are skipped. |
| Put customTitle below summary in priority | The reported source uses custom-title as the explicit session name and has no summary; when both exist, explicit custom title should win over generated summary text. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Backfill could overwrite a manually renamed Kanna chat. | Rename only if current title equals the legacy importer title, Imported session, or New Chat. | Backfill test exercises title-only rename; existing manual rename behavior is preserved by predicate. |
| custom-title records have no timestamp and may repeat. | Iterate records from newest to oldest and accept the latest non-empty customTitle; repeated identical titles are idempotent. | Custom-title precedence test includes multiple title sources. |
| Title-only updates might be invisible in import result counts. | Count a title-only rename as updated so UI feedback reports work done. | Unchanged-hash backfill test expects updated and not skipped. |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-session-importer.test.ts | Passed: 10 tests, 0 failed. |
| bunx tsc --noEmit | Passed. |
| c3 check --include-adr --only adr-20260604-claude-import-custom-title-backfill | Passed: 103 total, 0 issues. |
