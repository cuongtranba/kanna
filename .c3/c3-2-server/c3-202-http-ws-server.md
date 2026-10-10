---
id: c3-202
c3-version: 4
c3-seal: ce3e3c461921b23e83db767c853bf21ce9c0f8a0a3e5b874b5c8bd8fbeb958ac
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
| Alternate — API | /api/* routes serve JSON endpoints and the tus upload endpoint under /api/projects/:projectId/uploads/tus | c3-217 |
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
| WS upgrade hookup | OUT | Hands socket to ws-router | c3-208 | src/server/http.ts |
| /health | OUT | Liveness probe | c3-2 | src/server/http.ts |
| /share/:token | OUT | Public read-only snapshot endpoint dispatched BEFORE the auth gate; serves frozen chat snapshot JSON | c3-228 | src/server/http.ts |
| /assets/share-view/* | OUT | Reserved static path for the share viewer bundle, also pre-auth | c3-228 | src/server/http.ts |
| /beacon scope sync | IN/OUT | Persists a validated set-scope, deletes the beacon on unpair, refuses unknown or disabled beacons before the challenge, and pushes the stored scope to connected protocol-2 beacons on every settings change | c3-241 | src/server/beacon-connection.ts |
| /beacon update | IN/OUT | Sends the server version in ready and incompatible, keeps each beacon's last update_status until it reconnects, and answers beacons.update with a field-less update frame, refusing a beacon that is offline or below protocol 4; it never sends a URL or a version | c3-241 | src/server/beacon-registry.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Auth bypass | Middleware order regression | Unauthenticated requests succeed | bun run check + smoke src/server/http.ts with --password |
| Static asset 404 | Build path drift, or a tab left open across a deploy requesting a deleted hashed chunk | Asset request answers 200 text/html instead of 404, so the browser reports "Failed to fetch dynamically imported module" | bun test --conditions production src/server/static-serve.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/http.ts | c3-202 Contract | Listener detail | src/server/http.ts |
