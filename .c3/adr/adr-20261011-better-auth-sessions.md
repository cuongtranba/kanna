---
id: adr-20261011-better-auth-sessions
c3-seal: d27e421e9fcaf3d6980d1fffb052a44f34102fad3716caa14c7e6585cbb4eafd
title: better-auth-sessions
type: adr
goal: Replace the hand-rolled launch-password session layer of c3-203 (a JSON `sessions.json` of SHA-256 token hashes plus a timing-safe password compare) with Better Auth, keeping `--password` as the only switch and the only secret and keeping the `/auth/*` HTTP contract the client already speaks.
status: done
date: "2026-10-11"
---

# better-auth-sessions

## Goal

Replace the hand-rolled launch-password session layer of c3-203 (a JSON `sessions.json` of SHA-256 token hashes plus a timing-safe password compare) with Better Auth, keeping `--password` as the only switch and the only secret and keeping the `/auth/*` HTTP contract the client already speaks.

## Context

`--password` turned on `src/server/auth.ts` plus `src/server/auth-session-store.adapter.ts`: an opaque `kanna_session` cookie validated against hashes in `<dataDir>/sessions.json`, written by a debounced JSON writer without a 0600 mode. There was no brute-force protection on `/auth/login`, so a server exposed through `--remote`, `--share` or `--cloudflared` accepted unlimited password guesses. Kanna is single-user and has no account model; the client contract is `GET /auth/status`, `POST /auth/login {password,next}`, `POST /auth/logout`, consumed by `src/client/api/auth.ts`. The gate sits in `src/server/http-dispatcher.ts` in front of `/ws` and `/api/*`, and share paths stay public.

## Decision

Better Auth 1.7 owns credential hashing, session storage, cookie signing and sign-in rate limiting; Kanna keeps the routes, the origin check and the Secure decision. `src/server/better-auth.adapter.ts` is the only module that imports `better-auth`, `bun:sqlite` and `node:fs` for this: it opens `<dataDir>/auth.db` and `<dataDir>/auth-secret` (both 0600), runs migrations, and seeds a hidden owner user `owner@kanna.local` whose credential is the CLI password. Starting with a different `--password` rotates that credential and deletes every session. Sign-up is disabled and Better Auth's handler is never mounted on a public route: `/auth/login` synthesizes a sign-in request to the handler with the owner email, so the handler's rate limiter applies (enabled explicitly, because it defaults to `NODE_ENV=production`, which Kanna never sets, and stored in the database, because the in-memory store is shared by every instance in one process). The client IP rides a Kanna-set header; forwarded IP headers are trusted only with `trustProxy` and only from a loopback socket, which is the local cloudflared process. Better Auth decides `Secure` once per instance, while one Kanna process serves http (localhost, LAN) and https (tunnel), so the adapter disables it and `src/server/auth.ts` appends `Secure` per request exactly as before. The cookie keeps its name `kanna_session`, SameSite=Strict and HttpOnly. `auth.sessionMaxAgeDays` rebuilds the instance on change. Existing `sessions.json` sessions are not migrated; the file is deleted and the user signs in once.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-203 | component | Session and credential mechanism replaced by Better Auth; contract and change-safety rows updated | c3-203#n11128@v1:sha256:688e30f3d4051de77c76e85694a0602bc7136d1ae6846a9a4d579a08c79a570a "Issues and validates a launch-password session cookie" | Comply with ref-local-first-data; cookie plus 401 contract preserved |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Visible single-owner email account with a first-run sign-up screen | The user chose to keep `--password` as the only secret; a sign-up screen is a user-visible change with no gain for one user |
| Mount Better Auth's handler at /api/auth/* and use its React client | Exposes sign-up, reset and session-list endpoints Kanna does not need, and the client would have to know the hidden owner email |
| Call auth.api.signInEmail directly | Server-side api calls bypass Better Auth's rate limiter, which was the main security gain |
| Two Better Auth instances, one per Secure setting | Doubles state for a single attribute that Kanna already decides per request |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Rate limit evaded by spoofed forwarded IP headers | Headers trusted only with trustProxy and a loopback socket peer | Code review of resolveClientIp in src/server/auth.ts |
| Users signed out once on upgrade | Expected one re-login; legacy sessions.json removed so nothing stale lingers | Live boot with a seeded sessions.json shows it removed |
| Better Auth upgrade changes cookie or handler behaviour | Existing auth tests assert cookie name, attributes, Max-Age, restart survival and 401 contract | bun run test src/server/auth.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/auth.test.ts src/server/http-dispatcher.test.ts | all pass, including 429 throttling and password-rotation tests |
| bun run test | full suite passes |
| bun run check | typecheck, lint, comments, client build and bundle budget pass; better-auth absent from the client bundle |
| Live boot with --password test | wrong password 401, correct login sets kanna_session HttpOnly SameSite=Strict, /api with cookie passes, logout clears; auth.db and auth-secret are 0600 |
