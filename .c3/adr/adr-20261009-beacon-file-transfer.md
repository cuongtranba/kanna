---
id: adr-20261009-beacon-file-transfer
c3-seal: d421d7a425d8a0e009350001d1b001307e8d058b40804fed7996db1081d7b59f
title: beacon-file-transfer
type: adr
goal: Let the agent copy one file between a chat's project and a paired beacon machine through two MCP tools, beacon_pull and beacon_push, with the bytes streamed over HTTP from disk to disk, verified by SHA-256 on both ends, never placed in the model's context and never carried over the beacon WebSocket. The transfer is authorized by a one-file short-lived ticket instead of the Kanna session cookie, and it is bounded by an idle timeout rather than by the fixed 600 second beacon request deadline.
status: accepted
date: "2026-10-09"
---

## Goal

Let the agent copy one file between a chat's project and a paired beacon machine through two MCP tools, beacon_pull and beacon_push, with the bytes streamed over HTTP from disk to disk, verified by SHA-256 on both ends, never placed in the model's context and never carried over the beacon WebSocket. The transfer is authorized by a one-file short-lived ticket instead of the Kanna session cookie, and it is bounded by an idle timeout rather than by the fixed 600 second beacon request deadline.

## Context

Moving a file between Kanna and a beacon had no supported path. beacon_fetch returns 256 KiB of base64 per call straight into the model's context, so a 56.8 MB workbook takes about 228 calls, and nothing writes a file onto the beacon. In chat da6b9ca1 the agent improvised: it read the Kanna login password out of the server's process arguments, logged in, and planted the full-access session cookie in scripts on the remote machine to use the cookie-gated tus and file routes. That cost about 25 minutes and leaked a credential. The existing seams are sound and are reused: the beacon registry already fails pending requests on disconnect, the permission gate already judges beacon ops against scope, http-file-response.ts already serves byte ranges, and beacon-pairing.ts is the precedent for a pure in-memory token store with an injected clock.

## Decision

Bump the beacon protocol to 3 and add two request ops: upload (the beacon sends a file to Kanna, tool beacon_pull) and download (the beacon fetches a file from Kanna, tool beacon_push). Each request carries a ticket minted by a pure in-memory ticket store (beacon-transfer-tickets.ts) bound to one beacon, chat, direction and file. The beacon moves the bytes with plain HTTP against its stored kannaUrl: PUT of 8 MiB chunks with an offset and a resume point for upload, ranged GET for download, authorized only by the bearer ticket. The server streams request bodies into a sibling .kanna-part file, stream-hashes it, and renames it over the destination only after size and SHA-256 verify; the beacon does the same on its side. Every byte moved touches the ticket, and a ticket that idles for 120 seconds, whose beacon disconnects, or whose tool call is cancelled is revoked, so the beacon's next request gets 401 and aborts. Download is judged against writeRoots, which stay outside the set-scope frame, so a beacon can never grant itself write access. A registry gate fails a transfer op immediately for a beacon below protocol 3. The Bun daemon and the Go 1.20 Windows 7 port implement the identical behaviour and are held together by the shared conformance fixtures.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - named only to complete the top-down descent; the system is unchanged | N.A - ancestor only | N.A - ancestor only |
| c3-2 | container | N.A - named only to complete the top-down descent; the server container is unchanged | N.A - ancestor only | N.A - ancestor only |
| c3-241 | component | Gains a transfer port and adapter that stream a file to or from Kanna over HTTP, and routes the two new ops through the session without the exec timeout or output cap | c3-241#n13055@v1:sha256:a6ef62e3bb756806b9a0b944a25f4ec51a5ddf8be06021f7310044af41fc2469 | ref-side-effect-adapter: all new IO lives in transfer.adapter.ts behind BeaconTransferPort |
| c3-202 | component | Gains the ticket store, the /beacon/transfer HTTP route and its streaming adapter, and the protocol-version gate in the beacon registry | c3-202#n11006@v1:sha256:a6ef62e3bb756806b9a0b944a25f4ec51a5ddf8be06021f7310044af41fc2469 | ref-side-effect-adapter: file and HTTP streaming IO lives in dot-adapter files |
| c3-226 | component | Gains the beacon_pull and beacon_push tools, which wait without a fixed deadline and revoke their ticket on idle, disconnect or cancel | c3-226#n12191@v1:sha256:a6ef62e3bb756806b9a0b944a25f4ec51a5ddf8be06021f7310044af41fc2469 | ref-side-effect-adapter: the tool module touches no filesystem itself and goes through a files port |
| c3-302 | component | Owns the new protocol 3 ops and parsers, the transfer constants, and the write-root scope verdict | c3-302#n13178@v1:sha256:a6ef62e3bb756806b9a0b944a25f4ec51a5ddf8be06021f7310044af41fc2469 | N.A - shared contracts have no governing ref beyond the conformance fixtures this ADR extends |
| c3-116 | component | Beacon settings gain a list of folders the agent may write to | c3-116#n10548@v1:sha256:a6ef62e3bb756806b9a0b944a25f4ec51a5ddf8be06021f7310044af41fc2469 | N.A - one additional list in the existing scope editor |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-side-effect-adapter | The ticket HTTP handler streams to disk, hashes and renames files, and the daemon streams files over fetch; both are IO that the seal confines to dot-adapter files | ref-side-effect-adapter#n13844@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee | comply: beacon-transfer-http.adapter.ts, beacon-transfer-files.adapter.ts and src/beacon/transfer.adapter.ts own the IO; the ticket store and the tool module stay pure |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Carry the bytes in WebSocket frames | The beacon socket is the control channel for every tool; megabytes of base64 frames would block pings and other requests and would still need chunk accounting on both sides |
| Reuse the cookie-gated tus and file routes with a session cookie on the beacon | It is the credential leak this feature removes: a beacon holding a full-access cookie can do anything the user can do in Kanna |
| Raise the beacon_fetch chunk and keep it model-mediated | Every chunk still lands in the model's context and the 600 second deadline still applies |
| Give the ticket a total-duration timeout | A 3 GB file over a slow link legitimately takes longer than any fixed bound; idleness is the right signal and every moved byte resets it |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The Go port drifts from the new ops | New valid and invalid request fixtures in apps/beacon-win7/testdata/conformance/frames.json are asserted by both suites | bun run test src/shared/beacon-conformance.test.ts and go test ./... in apps/beacon-win7 |
| A stolen ticket is replayed | A ticket is bound to one beacon, chat, direction and file, is random 32 bytes, and dies on completion, failure, idle or disconnect | src/server/beacon-transfer-http.test.ts asserts a revoked ticket gets 401 on every route |
| A failed transfer leaves a truncated destination | The destination is only ever replaced by renaming a verified part file, and a failed or cancelled transfer deletes its part file | src/server/kanna-mcp-beacon-transfer.test.ts asserts a refused push leaves the destination untouched and no part file behind |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/beacon-transfer-http.test.ts src/server/kanna-mcp-beacon-transfer.test.ts src/shared/beacon-conformance.test.ts | pass |
| bun run typecheck, bun run lint, bun run lint:usestate, bun run check:arch, bunx ast-grep test | pass |
| c3x check | no new errors or warnings |
