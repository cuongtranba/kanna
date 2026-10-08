---
id: adr-20261008-tus-resumable-uploads
c3-seal: 03a2aa673444d90ef4faf414740a6772ac306322d6270d7f71b8739af9c0e662
title: tus-resumable-uploads
type: adr
goal: Replace the single-request multipart upload with the tus resumable upload protocol, so a file larger than a proxy's per-request body cap (Cloudflare refuses any body over 100 MB) can reach Kanna, an interrupted upload continues from the server's offset instead of restarting, and the per-file limit rises to a default of 2048 MB with a maximum of 51200 MB. Downloads gain explicit Range support and validators so they resume the same way.
status: accepted
date: "2026-10-08"
---

## Goal

Replace the single-request multipart upload with the tus resumable upload protocol, so a file larger than a proxy's per-request body cap (Cloudflare refuses any body over 100 MB) can reach Kanna, an interrupted upload continues from the server's offset instead of restarting, and the per-file limit rises to a default of 2048 MB with a maximum of 51200 MB. Downloads gain explicit Range support and validators so they resume the same way.

## Context

Behind a Cloudflare tunnel a file over 100 MB failed with a non-JSON error page that the client showed as "Upload failed". The multipart route also buffered the whole body twice with `req.formData()` and `arrayBuffer()` inside a 2 GiB pm2 ceiling, nothing resumed, and the `uploads.maxFileSizeMb` setting defaulted to 100 and capped at 2048. `MAX_REQUEST_BODY_BYTES` was derived from that cap, so raising the cap would have raised the body limit of every route. Downloads had no `Accept-Ranges`, `ETag` or `Last-Modified`, and Bun answers a Range request for a file-backed Response by itself, ignoring `If-Range`.

## Decision

Use `@tus/server` with `@tus/file-store` on the server and `tus-js-client` in the browser, lazily imported. One tus `Server` per project is created on first use under `/api/projects/<id>/uploads/tus`, with its FileStore at `<project>/.kanna/uploads/.partial` so finalizing can hard-link the finished partial into `.kanna/uploads` on the same filesystem instead of copying it. `finalizeUploadFromFile` keeps the reuse rule from the multipart path: an existing same-named file with identical bytes (size first, then a streamed chunked comparison) is reused and reported with `reused: true`, different bytes take the next counter name. The partial and its `.json` are removed on tus `POST_FINISH`, not inside the finish hook, because the zero-length creation path reads the upload again after the hook. The client sends 8 MiB chunks, which must stay under the proxy cap. The multipart route, `handleProjectUpload` and `persistUploadedFiles` are deleted, and `MAX_REQUEST_BODY_BYTES` becomes a fixed 128 MiB. Content routes use the pure `buildFileResponse`, which owns Range, `If-Range`, `If-None-Match` and the validators, and streams the full body through a plain `ReadableStream` whenever a Range header was present so Bun does not range it behind the module's back.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-217 | component | Owns the upload endpoint, naming, reuse and finalize; the contract changes from multipart POST to the tus endpoint | c3-217#n11590@v1:sha256:8b987567bbb0cb8618b002fb5948f838c29ad16945119a6623c6e930cf6b1600 "Hosts the resumable upload endpoint (the tus protocol), stores finished files under the project's .kanna/uploads folder, and returns the attachment record that " | ref-local-first-data still applies: files stay under the project's own folder |
| c3-202 | component | The dispatcher routes the tus path after the auth gate and no longer routes the multipart POST; content handlers use buildFileResponse | c3-202#n10818@v1:sha256:4b6bc38cb5853617238dea8fe1682a26ea2f126b27eacbb9a6d3a482fb3dd4b6 "Hosts the Bun-side HTTP server, serves built client assets, exposes API + upgrade endpoints, gates connections via the auth middleware, and routes upgraded sock" | N.A - routing table only |
| c3-115 | component | The composer's upload pipeline now speaks tus through the unchanged uploadFile API | c3-115#n10296@v1:sha256:55ff85bd7e08123ceb990d355fef4d00d2c8d3638acd072d817d80d3383ef86f "Provide the composer and chat chrome: input dock, provider/model/effort pickers, attachment controls, queued message alignment." | N.A - callers are unchanged |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hand-rolled chunk protocol over plain PATCH requests | tus already specifies offsets, HEAD resume, creation limits and termination, and the spike showed the stock server and client work under Bun; a private protocol would need its own client resume store and conformance tests |
| One shared tus store under the data dir | Finalize could no longer hard-link into a project folder on another filesystem, so every multi-GB upload would be copied once more |
| Raise MAX_REQUEST_BODY_BYTES with the size setting | A 50 GB cap on every route, while tus never sends more than one 8 MiB chunk per request |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/uploads.test.ts src/client/lib/uploadFile.adapter.test.ts src/shared/settings/ | Multi-chunk upload, resume after a cut PATCH, 413 over the limit, reuse, Range and If-Range behaviour pass |
| bun run check | typecheck, lint, comments, client build and bundle budget pass, with tus-js-client in a lazy chunk |
