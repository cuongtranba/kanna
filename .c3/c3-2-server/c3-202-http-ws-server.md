---
id: c3-202
c3-version: 4
c3-seal: 0bb762d6748436a5a0e3800801366edd79e6d209f9f57d26059338ab41426c60
title: http-ws-server
type: component
category: foundation
parent: c3-2
goal: Serve HTTP (static + API) and upgrade to WebSocket; attach auth gating; expose `/health`.
uses:
    - ref-local-first-data
    - ref-ws-subscription
---

# http-ws-server

## Goal

Serve HTTP (static + API) and upgrade to WebSocket; attach auth gating; expose `/health`.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Expose HTTP + WebSocket endpoints to the local browser" |
| Category | foundation |
| Lifecycle | Singleton listener per server process |
| Replaceability | Replaceable provided HTTP+WS contract and auth hookup preserved |

## Purpose

Hosts the Bun-side HTTP server, serves built client assets, exposes API + upgrade endpoints, gates connections via the auth middleware, and routes upgraded sockets to the WS router. Non-goals: business logic, persistence, projection state.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | CLI parsed and port resolved | c3-201 |
| Input — auth gate | Cookie-based middleware | c3-203 |
| Input — WS router | Receives upgraded sockets | c3-208 |
| Input — port defaults | Shared port constants | c3-304 |
| Initialization | Invoked from CLI after flag parse | c3-201 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Client connects, authenticates, opens single WS | c3-101 |
| Primary path | HTTP serves assets → upgrade → ws-router | c3-208 |
| Alternate — health | /health returns 200 for liveness checks | c3-202 |
| Alternate — API | /api/* routes serve byte transfer only, the tus upload endpoint, file and upload content and the plugin client bundle; actions and small reads are registry commands over the WebSocket, so path autocomplete, upload deletion and plugin list and reload are no longer HTTP routes | c3-217 |
| Failure — auth reject | 401 close on missing/invalid cookie | c3-203 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Single-WS upgrade pattern | must follow | Hand off to ws-router |
| ref-local-first-data | ref | Default bind 127.0.0.1 | must follow | Wider bind requires explicit flag |
| c3-228 | ref | /share/:token and /assets/share-view/* routes are dispatched before the auth gate | must follow | Wired for session-share coupling |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| HTTP listener | IN | Serves static assets + API + upgrade; a request whose last path segment carries a non-.html extension is an asset request and 404s when the file is absent — only extensionless navigation paths fall back to index.html | c3-101 | src/server/server.ts |
| WS upgrade hookup | OUT | Hands socket to ws-router | c3-208 | src/server/http-dispatcher.ts |
| /health | OUT | Liveness probe | c3-2 | src/server/http-dispatcher.ts |
| Shutdown | OUT | Lifetime collects every stop through defer(phase, stop) and disposeAll runs the quiesce, settle and teardown phases in that order, each phase last-registered first; a stop that throws is logged and the rest still run. server.ts defers the event store flush and snapshotAndTruncateLogs first in teardown so it runs last | c3-206 | src/server/lifetime.ts, src/server/server.ts |
| /share/:token | OUT | Public read-only snapshot endpoint dispatched BEFORE the auth gate; serves frozen chat snapshot JSON | c3-228 | src/server/http-dispatcher.ts |
| /assets/share-view/* | OUT | Reserved static path for the share viewer bundle, also pre-auth | c3-228 | src/server/http-dispatcher.ts |
| /beacon scope sync | IN/OUT | Persists a validated set-scope, deletes the beacon on unpair, refuses unknown or disabled beacons before the challenge, and pushes the stored scope to connected protocol-2 beacons on every settings change | c3-241 | src/server/beacon-connection.ts |
| /beacon update | IN/OUT | Sends the server version in ready and incompatible, keeps each beacon's last update_status until it reconnects, and answers beacons.update with a field-less update frame, refusing a beacon that is offline or below protocol 4; it never sends a URL or a version | c3-241 | src/server/beacon-registry.ts |
| HTTP route inventory | IN | Every route and method listed in HTTP_ROUTES is answered by the dispatcher itself rather than falling through to the client bundle, proven against a real server with a signed-in session | c3-302 | src/server/http-route-inventory.test.ts, src/shared/http-routes.ts |
| /api/inbox/proposals/approve | IN | POST of threadId and proposalId runs the same approveProposal as the inbox.approveProposal command and answers outboundId, 409 when the proposal is not open, 400 for a bad body | Behind the /api session gate (401 without a session when a password is set) and the request origin guard, which answers 403 for a cross-origin write; the service worker's same-origin fetch satisfies both (c3-247) | src/server/inbox/proposal-approve-http.ts, src/server/http-dispatcher.ts |
| Request origin guard | IN | createRequestOriginGuard runs once at the top of the dispatcher in both modes and answers 403: with no password on a loopback bind and no trust proxy the Host hostname must be 127.0.0.1, localhost or [::1] (DNS rebinding); /ws and /beacon refuse a present Origin that is not the request's own origin (validateOrigin semantics, trust proxy honoured); POST, PUT, PATCH and DELETE on /api refuse a Sec-Fetch-Site other than same-origin or none, else a cross-origin Origin, else a session cookie that carries neither; webhooks, /mcp with its OAuth paths, beacon transfer and /auth/\* skip it because they hold their own secret, bearer or origin check; a no-password server that is reachable beyond loopback logs unprotectedExposureWarning at boot and still starts | c3-203 | src/server/request-origin-guard.ts, src/server/request-origin-guard.test.ts |
| /mcp | IN | Remote MCP Streamable HTTP endpoint, dispatched BEFORE the cookie gate because it authenticates with a bearer; answers 404 without --password or when remoteMcp.enabled is off | c3-242 | src/server/http-dispatcher.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Auth bypass | Middleware order regression | Unauthenticated requests succeed | bun run check + smoke src/server/http-dispatcher.ts with --password |
| Cross-site drive-by | The origin guard call removed from the dispatcher, or its exempt list widened | A page on another origin opens /ws or writes to /api without a password | bun run test src/server/request-origin-guard.test.ts |
| Static asset 404 | Build path drift, or a tab left open across a deploy requesting a deleted hashed chunk | Asset request answers 200 text/html instead of 404, so the browser reports "Failed to fetch dynamically imported module" | bun test --conditions production src/server/static-serve.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/http-dispatcher.ts | c3-202 Contract | Listener detail | src/server/http-dispatcher.ts |
