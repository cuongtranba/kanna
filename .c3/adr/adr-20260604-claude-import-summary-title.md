---
id: adr-20260604-claude-import-summary-title
c3-seal: 727d0945bd9767f90361018846f3edf07fad24e563c860311ef851dfef6d8f7e
title: claude-import-summary-title
type: adr
goal: Change Claude session import title derivation so imported Kanna chats prefer a Claude JSONL summary record when present, while preserving the existing fallback to the first user prompt and finally "Imported session" when no useful text exists.
status: implemented
date: "2026-06-04"
---

## Goal

Change Claude session import title derivation so imported Kanna chats prefer a Claude JSONL summary record when present, while preserving the existing fallback to the first user prompt and finally "Imported session" when no useful text exists.

## Context

The sidebar already renders the persisted chat title from the server read model, and import already renames new chats after creating them. The current `deriveTitle()` in `src/server/claude-session-importer.adapter.ts` ignores `summary` records even though `ClaudeSessionSummaryRecord` is modeled, so imported sessions can show a prompt snippet instead of Claude's session name/summary. The changed adapter file is currently a C3 codemap gap, but its colocated test and neighboring Claude session parser/mapper/scanner files are owned by c3-214 discovery. Parent Delta: c3-2 needs no container responsibility change because this stays inside the existing local-history import responsibility.

## Decision

Update `deriveTitle()` to scan Claude records for non-empty `summary` text before inspecting user messages. Use the latest non-empty summary by iterating records from newest to oldest, because a later summary is the most current session name after conversation evolution. If no summary is available, keep the existing first-user-text fallback and then the literal "Imported session" fallback. This keeps the title at the import boundary where chat persistence already happens and avoids adding sidebar-only derived naming logic.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-214 | component | Claude session import belongs with discovery/local history ingestion even though the adapter file is currently uncharted; tests and neighboring Claude session modules map here. | Comply with discovery's local-history scanning purpose and local-first data ref. |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-local-first-data | The title is derived only from local Claude JSONL history already on disk and persisted to Kanna's local event store. | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | The behavior is covered by a colocated Bun test beside the importer. | comply |
| rule-strong-typing | The importer consumes typed Claude session records and must not introduce untyped boundary shapes. | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/server/claude-session-importer.adapter.ts | Add summary extraction and make deriveTitle() prefer the latest non-empty summary before user text. | Targeted diff and passing importer test. |
| src/server/claude-session-importer.test.ts | Add coverage proving summary title wins over first user prompt and blank summaries are ignored. | bun test src/server/claude-session-importer.test.ts. |
| c3-2 parent delta | No parent doc update needed because the server already owns local discovery/import, persistence, and read-model broadcast. | c3-2 Responsibilities already include discovering local projects and owning derived read models. |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI underlay changed | The change affects Kanna runtime import behavior only, not C3 commands, schemas, validators, hints, or templates. | c3 check --include-adr --only adr-20260604-claude-import-summary-title remains clean. |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| Importer unit test | Fails if imported chat title does not prefer a non-empty summary over first user text. | bun test src/server/claude-session-importer.test.ts. |
| C3 structural check | Confirms documentation structure remains valid after the ADR is added. | c3 check --include-adr --only adr-20260604-claude-import-summary-title. |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Add sidebar fallback logic for imported sessions | The sidebar already renders chat.title; duplicating title derivation in the client would violate the existing server-derived truth flow. |
| Keep first user prompt as the title | This ignores available Claude summary records and does not satisfy the requested session-name behavior. |
| Prefer the first summary record | Older summary records can be stale after later compaction/renaming; latest non-empty summary better represents current session state. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A blank or whitespace-only summary would hide a useful user prompt title. | Trim summary text and only accept non-empty values. | Unit test includes an empty summary before the real one. |
| Existing imported sessions with unchanged source hashes do not get backfilled. | Scope this ADR to new import title derivation only; backfill can be a separate explicit change if needed. | Existing skip/update behavior remains untouched by targeted tests. |
| Summary text could be longer than the existing prompt-derived title. | Apply the same 60-character cap to summary-derived titles. | Existing truncation path is applied to summary and user prompt titles. |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-session-importer.test.ts | Passed: 7 tests, 0 failed. |
| c3 check --include-adr --only adr-20260604-claude-import-summary-title | Passed: 102 total, 0 issues. |
