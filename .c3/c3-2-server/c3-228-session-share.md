---
id: c3-228
c3-seal: 23ec857b059f5a7fb6e320d17b1036fe485dd8b97f3a7a967731ef34d371fc25
title: session-share
type: component
category: feature
parent: c3-2
goal: Mint time-limited read-only share tokens for finished Kanna chat sessions, persist frozen snapshots under ~/.kanna/shares/, serve them at /share/:token without auth, and sweep expired tokens via TTL.
uses:
    - ref-cqrs-read-models
    - ref-event-sourcing
    - ref-local-first-data
    - ref-side-effect-adapter
    - ref-strong-typing
---

## Goal

Mint time-limited read-only share tokens for finished Kanna chat sessions, persist frozen snapshots under ~/.kanna/shares/, serve them at /share/:token without auth, and sweep expired tokens via TTL.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Provide opt-in session sharing without requiring recipient auth" |
| Category | feature |
| Lifecycle | Service started at boot; route registered before HTTP server binds; sweep timer fires on interval |
| Replaceability | Replaceable provided token mint, snapshot GET, and sweep contract preserved |

## Purpose

Owns the complete lifecycle of a read-only session share: receive mint request from ws-router (c3-208), build a frozen JSON snapshot from event-store read-models (c3-207), persist it under ~/.kanna/shares/<token>.json (mode 0600) via snapshot-store adapter, append share.token_minted to the shares JSONL log (c3-206), return the public URL. Serves the snapshot at GET /share/:token exempt from auth (c3-203 path-prefix bypass). Runs a TTL sweep that appends share.token_expired and deletes expired files. Non-goals include live transcript streaming to viewers, per-viewer access logs, multi-tenant user accounts, and hosting snapshots outside ~/.kanna/.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Server running; chat has at least one event. Public reachability is a deployment concern, not a runtime gate. | c3-206 |
| Input — ws-router | share.mint WsEnvelope carrying chatId and requestedTtlHours; mint receives originHost captured at WS upgrade and uses it as the base URL | c3-208 |
| Input — event-store | Replayed event log for the target chat | c3-206 |
| Input — read-models | Chat title, transcript entries, metadata from projection | c3-207 |
| Input — paths-config | ~/.kanna/shares/ directory resolved at boot | c3-204 |
| Internal state | In-memory share projection (token → ShareRecord) rebuilt from shares JSONL on startup | c3-228 |
| Initialization | SessionShareService registered in server bootstrap; HTTP route added to c3-202 | c3-202 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Owner receives a URL they can paste to any browser; recipient sees the frozen transcript rendered by the chat's own row components, and generative views show the data captured at mint | c3-2 |
| Primary path | ws share.mint → build snapshot (allowlisted entries plus frozen dataset rows) → write file (mode 0600) → append share.token_minted → return ${originHost}/share/<token> | c3-208 |
| Alternate — legacy snapshot | A version 1 snapshot minted before the transcript-entry format is upgraded in the viewer; tool results pair with calls by order because v1 kept no tool id | c3-228 |
| Alternate — sweep expiry | TTL cron fires → load share projection → for each expired token: delete file + append share.token_expired | c3-228 |
| Alternate — startup replay | On boot, replay shares JSONL; any token past TTL is expired immediately (fail-closed) | c3-206 |
| Failure — snapshot read error | File missing or corrupt on GET: return 404 | c3-228 |
| Failure — expired token on GET | Token past TTL: return 410 Gone | c3-228 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Snapshots must live under ~/.kanna/shares/ (mode 0600) | must follow | No remote upload |
| ref-event-sourcing | ref | share.token_minted and share.token_expired appended before any mutation | must follow | Shares log is append-only JSONL |
| ref-cqrs-read-models | ref | Share lookup reads from in-memory projection rebuilt from shares log | must follow | No direct disk scan for token lookup |
| ref-side-effect-adapter | ref | All fs reads/writes in snapshot-store.adapter.ts only | must follow | No direct fs calls in service or route |
| ref-strong-typing | ref | ShareSnapshot, ShareToken, share event payloads — no any | must follow | tsc strict enforced |
| adr-20260524-session-share | adr | Original decision record. Tunnel precondition row superseded by adr-20260525-share-decouple-tunnel. | governs this component | Accepted |
| adr-20260525-share-decouple-tunnel | adr | Removes the cloudflared-tunnel precondition: mint accepts a baseUrl argument supplied by the ws-router from the WS upgrade request origin. | governs this component | Implemented |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| mintShare(chatId, ttlHours, baseUrl) | IN | Builds snapshot, persists file, appends event, returns ${baseUrl}/share/<token>. Caller (ws-router) passes the request origin captured at WS upgrade. | c3-208 | src/server/session-share/index.ts |
| buildChatSnapshot | IN | Version 2 snapshot: TranscriptEntry list restricted by shareableEntries (prompts, assistant text and thinking, tool calls and results, results, errors, compaction and interrupt markers; no account info, system init, attachments, hidden entries, or debugRaw beyond the tool_use_result sidecar) plus datasets keyed by datasetFreezeKey | c3-306 | src/server/session-share/snapshot-builder.ts |
| freezeDataset | OUT | GenUIDatasetService.freeze loads each non-inline dataset a kanna-ui view declares under the chat's own authorization and keeps only the columns the declaration reads; an unapproved MCP tool or an oversized result is recorded as unavailable, never called or truncated | c3-208 | src/server/genui/dataset-service.ts |
| GET /share/:token | IN | Returns frozen ShareSnapshot JSON if valid; 404 if unknown; 410 if expired | c3-202 | src/server/session-share/http-routes.ts |
| sweepExpired() | IN | Appends share.token_expired and deletes file for each token past TTL | internal timer | src/server/session-share/sweep.ts |
| snapshot-store adapter | IN/OUT | readSnapshot(token), writeSnapshot(token, data), deleteSnapshot(token) | c3-204 | src/server/session-share/snapshot-store.adapter.ts |
| share projection | IN | Projects share events into Map<token, ShareRecord>; rebuilt on startup replay | c3-206 | src/server/session-share/share-projection.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Auth bypass widened | /share/ prefix extended or middleware ordering changed | Unauthenticated requests reach protected routes | bun test share-route.test.ts: non-share paths still return 401 |
| Snapshot disk leak | sweep timer stopped or share.token_expired not appended on expiry | ~/.kanna/shares/ grows unbounded | bun test src/server/session-share/snapshot-sweep.test.ts: asserts file deleted after TTL |
| Stale snapshot served | GET route reads file without checking projection expiry | Expired token returns 200 instead of 410 | bun test src/server/session-share/share-route.test.ts: expired fixture returns 410 |
| Event schema drift | New share event kind added without projection handler | Replay corrupts in-memory map | bun test share-projection.test.ts covers all event kinds |
| Token collision | PRNG weakness produces duplicate 256-bit token | Two chats share same file | Token uniqueness assertion in token.ts unit test |
| Private data published | An entry kind or field added to the snapshot without review | A public link shows an email, attachment path, or raw provider payload | bun run test src/server/session-share/snapshot-builder.test.ts |
| Viewer diverges from chat | Share view gets its own renderer again | Tool calls render as raw JSON | bun run test src/client/app/share-view/ShareViewPage.test.tsx |
| Dataset columns leak | Frozen rows keep columns the view never reads | A shared report carries unrelated columns | bun run test src/server/genui/dataset-service.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/session-share/index.ts | c3-228 Contract: mintShare | Orchestration detail | src/server/session-share/index.ts |
| src/server/session-share/snapshot-builder.ts | c3-228 Contract: buildChatSnapshot | Snapshot assembly detail | src/server/session-share/snapshot-builder.ts |
| src/server/session-share/shareable-entries.ts | c3-228 Contract: buildChatSnapshot | Allowlist detail | src/server/session-share/shareable-entries.ts |
| src/server/session-share/http-routes.ts | c3-228 Contract: GET /share/:token | HTTP framework detail | src/server/session-share/http-routes.ts |
| src/server/session-share/snapshot-store.adapter.ts | c3-228 Contract: snapshot-store adapter | fs implementation detail | src/server/session-share/snapshot-store.adapter.ts |
| src/server/session-share/share-projection.ts | c3-228 Contract: share projection | Projection implementation | src/server/session-share/share-projection.ts |
| src/server/session-share/sweep.ts | c3-228 Contract: sweepExpired | Cron wiring detail | src/server/session-share/sweep.ts |
| src/server/session-share/http-routes.test.ts | c3-228 Contract: GET /share/:token | Test fixture detail | src/server/session-share/http-routes.test.ts |
