---
id: c3-217
c3-version: 4
c3-seal: c30d684e3a1a2c218ef236bd8cebbc01a320f207b0d05fe8f032cd83f5e46515
title: uploads
type: component
category: feature
parent: c3-2
goal: Accept resumable file uploads (drag-drop attachments) over the tus protocol, store them under the project's .kanna/uploads folder, and serve them back with Range support.
uses:
    - ref-local-first-data
---

# uploads

## Goal

Accept resumable file uploads (drag-drop attachments) over the tus protocol, store them under the project's .kanna/uploads folder, and serve them back with Range support.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Accept attachment uploads and persist them under the local data dir" |
| Category | feature |
| Lifecycle | HTTP routes bound at server boot; one tus server per project built on first use |
| Replaceability | Replaceable provided upload endpoint + event contract preserved |

## Purpose

Hosts the resumable upload endpoint (the tus protocol), stores finished files under the project's .kanna/uploads folder, and returns the attachment record that downstream chat features reference. Content routes serve the stored files with explicit Range support. Non-goals: chat composition, agent-side file consumption — those happen elsewhere.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | HTTP server bound | c3-202 |
| Input — paths | Uploads dir under data dir | c3-204 |
| Input — event store | Writes upload events | c3-206 |
| Initialization | The dispatcher routes /api/projects/:projectId/uploads/tus to a per-project tus server created on first use, with its partial store at .kanna/uploads/.partial | c3-202 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User attaches file → chat references stored asset | c3-115 |
| Primary path | tus create then 8 MiB PATCH chunks → finish hook hard-links the partial into .kanna/uploads and answers with the attachment record → partial removed | c3-202 |
| Alternate — resume | After a cut connection, a restart or a reload the client asks HEAD for the offset and continues; partials expire after 24 hours | c3-217 |
| Alternate — same bytes again | An existing same-named file with identical bytes is reused and the attachment carries reused true | c3-217 |
| Failure — over the limit | Creation answers 413 with a JSON error naming the limit before any bytes are sent | c3-202 |
| Failure — disk error | Finish answers 500 with a JSON error; the partial stays until it expires | c3-202 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | All uploads under ~/.kanna/data | must follow | No remote upload service |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| /api/projects/:projectId/uploads/tus | IN | tus 1.0.0 creation, HEAD, PATCH and DELETE; metadata filename required; size capped by uploads.maxFileSizeMb read live | c3-202 | src/server/tus-uploads.adapter.ts |
| Finish response | OUT | JSON with an attachments array holding one UploadedAttachment | c3-115 | src/server/uploads.adapter.ts |
| GET and HEAD on the content routes | OUT | Accept-Ranges, a weak ETag, Last-Modified, 206 with Content-Range, 416, 304 and an If-Range guard | c3-202 | src/server/http-file-response.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Path traversal | Filename not sanitized | Files written outside the uploads folder | bun run test src/server/uploads.test.ts |
| Chunk larger than a proxy cap | chunkSize raised above 100 MB in uploadFile.adapter.ts | Uploads fail only behind a proxy such as Cloudflare | bun run test src/client/lib/uploadFile.adapter.test.ts |
| Reuse lost | finalizeUploadFromFile stops comparing bytes on a name clash | A second attachment deleted on cleanup removes a file the first one owns | bun run test src/server/uploads.test.ts |
| Partial on another filesystem | The partial store moves out of the project folder | The hard link fails and every finish copies the whole file | bun run test src/server/uploads.test.ts |
| Orphaned partials | The client disappears mid-upload | Files stay in .kanna/uploads/.partial until the 24 hour sweep | bun run test src/server/uploads.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/uploads.ts | c3-217 Contract | Upload detail | src/server/uploads.ts |
| src/server/tus-uploads.adapter.ts | c3-217 Contract | Hook detail | src/server/tus-uploads.adapter.ts |
| src/server/http-file-response.ts | c3-217 Contract | Header detail | src/server/http-file-response.ts |
