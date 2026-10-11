---
id: c3-203
c3-version: 4
c3-seal: 7848bb5e8227aa562d43105ed2ee6cccfd5a77d2d539e227dae9e99f57580ec5
title: auth
type: component
category: foundation
parent: c3-2
goal: Gate HTTP, WebSocket, and API routes behind a launch-password session cookie when `--password` is set.
uses:
    - ref-local-first-data
---

# auth

## Goal

Gate HTTP, WebSocket, and API routes behind a launch-password session cookie when `--password` is set.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Protect remote/shared servers behind launch-password" |
| Category | foundation |
| Lifecycle | Middleware module bound at HTTP server boot |
| Replaceability | Replaceable provided cookie + 401 contract preserved |

## Purpose

Issues and validates a launch-password session cookie, blocks unauthenticated HTTP/WS/API requests, and surfaces a login form when `--password` is set. Better Auth owns credential hashing, session storage, cookie signing and sign-in rate limiting behind a hidden owner user whose credential is the CLI password; Kanna owns the `/auth/*` routes, the origin check and the per-request Secure attribute. Non-goals: per-user accounts, OAuth, multi-tenant auth — single launch password only.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | CLI flag --password provided when sharing | c3-201 |
| Input — paths | Reads auth-secret and auth.db (both 0600) from the data dir | c3-204 |
| Internal state | Sessions, owner credential and rate-limit counters in the Better Auth SQLite database | c3-203 |
| Initialization | Bound by http-ws-server before route registration | c3-202 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Public/shared servers stay safe behind a password | c3-218 |
| Primary path | POST /auth/login → rate-limited Better Auth sign-in for the owner → kanna_session cookie attached to subsequent reqs | c3-202 |
| Alternate — local-only | No password set: middleware passthrough | c3-203 |
| Failure — 401 | Closes WS upgrade with auth-required signal | c3-101 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Wider surfaces require password | must follow | Local-only bind is unauthenticated |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| attachAuth(server) | OUT | Wraps HTTP server, gates routes | c3-202 | src/server/auth.ts |
| Login endpoint | IN | Accepts password form, sets session cookie | c3-202 | src/server/auth.ts |
| WS auth check | OUT | Rejects upgrade without valid cookie | c3-208 | src/server/auth.ts |
| isPublicSharePath(url) | OUT | Exempts /share/* and /assets/share-view/* from owner auth; called at the top of the middleware before any cookie check | c3-228 | src/server/auth.ts |
| AuthBackend port | OUT | signIn, getSession, signOut over Better Auth; the only importer of better-auth and the auth database; changing --password rotates the owner credential and deletes every session | c3-203 | src/server/better-auth.adapter.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Cookie leakage | Wrong cookie attributes | Token shows up in non-secure context | bun run check + smoke src/server/auth.ts with --password |
| Bypass on WS upgrade | Middleware skipped for upgrade | Unauthorized clients connect | bun run check + manual upgrade smoke against src/server/auth.ts |
| Password brute force | Sign-in bypasses the Better Auth handler, or forwarded IP headers trusted from a non-loopback peer | Repeated wrong passwords never return 429 | bun run test src/server/auth.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/auth.ts | c3-203 Contract | Middleware detail | src/server/auth.ts |
| src/server/better-auth.adapter.ts | c3-203 Contract | Better Auth configuration detail | src/server/better-auth.adapter.ts |
