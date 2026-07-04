---
id: c3-217
c3-version: 4
c3-seal: 75851a8c6cd130dfed11649b1aaae1cfd0ffa92685e2828d1ae6d0b17a5f9348
title: uploads
type: component
category: feature
parent: c3-2
goal: Accept file uploads (drag-drop attachments), store under data dir, emit events referencing the stored assets.
uses:
    - ref-local-first-data
---

# uploads

## Goal

Accept file uploads (drag-drop attachments), store under data dir, emit events referencing the stored assets.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Accept attachment uploads and persist them under the local data dir" |
| Category | feature |
| Lifecycle | HTTP route bound at server boot |
| Replaceability | Replaceable provided upload endpoint + event contract preserved |

## Purpose

Hosts the upload HTTP endpoint, persists files under the data dir, emits typed upload events that downstream chat features reference. Non-goals: chat composition, agent-side file consumption — those happen elsewhere.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | HTTP server bound | c3-202 |
| Input — paths | Uploads dir under data dir | c3-204 |
| Input — event store | Writes upload events | c3-206 |
| Initialization | Bound to /api/projects/:projectId/uploads on boot | c3-202 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User attaches file → chat references stored asset | c3-115 |
| Primary path | POST /api/projects/:projectId/uploads → write file → emit event | c3-206 |
| Alternate — large file | Streamed write; event emitted on complete | c3-217 |
| Failure — disk error | Surface 500; no event emitted | c3-202 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | All uploads under ~/.kanna/data | must follow | No remote upload service |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| POST /api/projects/:projectId/uploads | IN | Accepts multipart form data | c3-202 | src/server/server.ts |
| Upload event | OUT | Typed event referencing stored path | c3-206 | src/server/uploads.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Path traversal | Filename not sanitized | Files written outside data dir | bun run check against src/server/uploads.ts |
| Orphaned files | Event write fails after disk write | Files exist without events | bun run check plus orphan-scan smoke against src/server/event-store.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/uploads.ts | c3-217 Contract | Upload detail | src/server/uploads.ts |
