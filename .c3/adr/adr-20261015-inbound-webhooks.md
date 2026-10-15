---
id: adr-20261015-inbound-webhooks
c3-seal: f842da6509b7fb13824933d8d7b5af958ef4e608b7ba71eb5b24b42761a3c5ee
title: inbound-webhooks
type: adr
goal: 'Record the decision to accept inbound webhooks at POST /hooks/id: each hook authenticates its caller with its own random secret, via a bearer token or a GitHub-style HMAC signature, and reacts in one of three modes (notify, inline, spawn). The route sits before the session gate, answers 404 uniformly, and keeps raw secrets in a 0600 file outside settings.json.'
status: done
date: "2026-10-15"
---

## Goal

Record the decision to accept inbound webhooks at POST /hooks/id: each hook authenticates its caller with its own random secret, via a bearer token or a GitHub-style HMAC signature, and reacts in one of three modes (notify, inline, spawn). The route sits before the session gate, answers 404 uniformly, and keeps raw secrets in a 0600 file outside settings.json.

## Context

External systems such as CI, GitHub and monitoring had no way to tell Kanna that something happened. The server authenticates every API and WebSocket request with a session cookie, which a machine caller does not have, so a new write path that bypasses the cookie needs its own credential. HMAC verification needs the raw secret on the server, which rules out storing secrets hashed. settings.json is written with no file mode, so it cannot hold them. A looping caller could also spawn unbounded chats, and the request body of an unauthenticated route is attacker-controlled text that ends up in a model prompt.

## Decision

Add /hooks/id to createHttpDispatcher next to /api/share/, before the auth gate, handled by handleWebhookRequest. Each hook has a kwh_ secret of 32 random bytes. A caller proves it with Authorization: Bearer secret (SHA-256 digests compared with timingSafeEqual) or X-Hub-Signature-256 sha256=hex (HMAC-SHA256 of the raw bytes, constant-time compare). Secrets live in webhooks.json under the data dir, written through a temp file with mode 0600, a chmod and an atomic rename, and never in a snapshot, log or transcript. Unknown, disabled and globally disabled (KANNA_WEBHOOKS=disabled) hooks all answer 404. The body is capped at 256 KiB with a 413 before any parsing, a delivery id (X-GitHub-Delivery, then Idempotency-Key, then X-Request-Id) dedupes retries, and a token bucket of 20 deliveries a minute per hook answers 429. The template supports path substitution and the JSON body follows in a fenced block capped at 16000 characters under a line that marks it as untrusted external data. Every delivery leaves a private webhook_delivery card in the chat it lands in, so the audit trail rides the existing transcript. The four webhooks commands are classified unavailable for the remote MCP so a remote client can neither mint nor read a credential.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-243 | component | New owner of the registry, secret file, authentication, dedupe, rate limit and delivery | c3-243#n13540@v1:sha256:5847f925d22f0b01e11742131d73ad20bd049bd5356bd5571587438bc72aca06 "POST /hooks/id" | The only IO is webhook-store.adapter.ts (ref-side-effect-adapter); bodies are JsonValue narrowed with isJsonObject (ref-strong-typing) |
| c3-202 | component | The dispatcher gains a webhooks field and one call before the auth gate; server.ts builds the service | c3-202#n11382@v1:sha256:a3750b4ea10f5bf4a6b08aced506a309d6cfe4e64d128321787fa59a34fa7172 "HTTP listener" | The route order is the security boundary and is covered by the route tests |
| c3-208 | component | The ws-router serves the webhooks topic and routes four commands through a new handler | c3-208#n11707@v1:sha256:ee71ca3bf3f92cfb4d429923ce52473ad2f88d8bb348541fe142aaee8dfc56ff "Envelope dispatch" | Commands follow the handler-array contract with no case arms in ws-router.ts |
| c3-302 | component | The protocol gains the webhooks topic, snapshot and four commands | c3-302#n13682@v1:sha256:18df2cce3d5da782a2f726f49907832043b65687adc8e43a7f3f06e26de19f9d "WsInbound union" | ws-router-coverage.test.ts checks every command is claimed by a handler |
| c3-242 | component | The remote MCP command catalog classifies the four commands unavailable | c3-242#n13495@v1:sha256:bdb9b7f932040445e3781586522139219ebc79feaa300010175fe7d8e0cc25cb "/mcp endpoint" | A remote client must not reach a credential-minting command |
| c3-125 | component | New Webhooks page, secret dialog and sidebar entry | c3-125#n14663@v1:sha256:ff1573ddd9fae33a796f89bd39d503ac1573f3a213f3193e7ef316046fc91b57 "webhooks topic" | Every trigger renders pending state; the form draft lives in a scoped store |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Store secrets hashed like share tokens | HMAC verification needs the raw secret; hashing would force bearer-only auth and break GitHub, which signs with X-Hub-Signature-256 |
| Put the secrets in settings.json | settings.json is written with no file mode, so it would hold credentials in a world-readable file |
| Require the session cookie on /hooks | External systems have no cookie and cannot log in, which defeats the feature |
| Return 401 or 403 for an unknown hook | It would reveal which hook ids exist; one uniform 404 gives a scanner nothing to enumerate |
| One global webhook secret | A leaked secret could not be rotated per integration and every caller would share a rate limit |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Hook urls become public when Kanna is exposed with --share, --remote or a tunnel | The Webhooks page and the wiki page state that urls are reachable wherever Kanna is; the secret is the credential | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
| A prompt-injection payload in the body steers the model | The body is fenced, capped and introduced as untrusted data; the template is written by the owner | bun test --conditions production src/shared/webhooks/template.test.ts |
| A looping caller floods chats | Per-hook token bucket of 20 a minute and per-delivery dedupe | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
| Secrets are readable by other local users | 0600 file mode enforced on every write | bun test --conditions production src/server/webhooks/webhook-store.adapter.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/webhooks src/shared/webhooks | Passes |
| bun run check:arch | Passes with no pin changed |
| c3x check | Exits ok with no new issues |
