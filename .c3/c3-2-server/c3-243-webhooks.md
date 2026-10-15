---
id: c3-243
c3-seal: 53d83968bcece09477a1305f8c233df962f4efa67d386a78b86096ac0136cded
title: webhooks
type: component
category: feature
parent: c3-2
goal: Accept inbound webhooks from external systems and turn each authenticated delivery into a card, a queued prompt, or a new chat, without widening the session-cookie boundary or leaking the hook secrets.
uses:
    - ref-local-first-data
    - ref-side-effect-adapter
    - ref-strong-typing
---

## Goal

Accept inbound webhooks from external systems and turn each authenticated delivery into a card, a queued prompt, or a new chat, without widening the session-cookie boundary or leaking the hook secrets.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | In-process. The registry and service are built once in createApplicationServices; the only IO is webhook-store.adapter.ts writing webhooks.json under the data dir. |
| Consumers | c3-202 http-ws-server routes /hooks/id to handleWebhookRequest before the auth gate; c3-208 ws-router serves the webhooks topic and the four webhooks commands; c3-125 webhooks-ui renders and edits the hooks. |
| Boundary | Owns hook configs, secrets, request authentication, dedupe, rate limiting and delivery. It does not own chat or queue state; it calls EventStore and AgentCoordinator through narrow Pick types. |

## Purpose

Owns the inbound webhook feature: the hook registry with its 0600 secret file, bearer and HMAC verification, the capped body read, per-hook dedupe and token-bucket rate limit, and the three delivery modes notify, inline and spawn. Every delivery leaves a webhook_delivery transcript card in the chat it lands in, so the audit trail rides the existing transcript. Non-goals: it does not authenticate users, does not retry failed deliveries, and does not push notifications.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | The one filesystem write path, webhook-store.adapter.ts, which is the only file in the feature allowed to touch node:fs | Mandatory | The registry depends on the WebhookStorePort interface so tests use an in-memory port. |
| ref-strong-typing | ref | Parsed webhook bodies are JsonValue and are narrowed with isJsonObject, never cast | Mandatory | webhooks.json is parsed field by field in parseStoredWebhook. |
| ref-local-first-data | ref | Secrets stay on the machine in a file readable only by the owner | Mandatory | Raw secrets are required for HMAC, so they cannot be stored hashed. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| POST /hooks/id | IN | Bearer secret or X-Hub-Signature-256 HMAC over the raw body; answers 202 with the delivery id, 200 duplicate, 401, 404, 405, 409, 413, 429 | Unknown, disabled and globally disabled hooks all answer 404 so the response does not reveal which hooks exist. The body cap is 256 KiB. | src/server/webhooks/webhook-http-routes.ts |
| webhooks.json | IN/OUT | Hook configs with their raw secrets, written to a temp file with mode 0600, chmod, then renamed over the target | writeFile mode applies only at creation, so the chmod on every write is load-bearing. Secrets never appear in a snapshot, a log line or a transcript. | src/server/webhooks/webhook-store.adapter.ts |
| webhooks topic and commands | OUT | WebhooksSnapshot carries summaries with a four-character secretHint; create and rotateSecret return the secret once in the ack | The four webhooks commands are classified unavailable in the remote MCP command catalog so a remote client cannot mint or read a credential. | src/server/ws-router-webhooks.ts |
| webhook_delivery transcript entry | OUT | One card per delivery with hook id, hook name, mode, delivery id and, for notify, the rendered message | Excluded from shareableEntries, so it stays private by default. | src/shared/transcript-types.ts |
| Queued prompt | OUT | inline and spawn enqueue the rendered prompt with autoContinue scheduleId webhook-hookId-deliveryId | The body is appended in a fenced block capped at 16000 characters under a line that marks it as untrusted external data. | src/shared/webhooks/template.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| wiki/src/content/docs/guides/user/webhooks.md | c3-243 Contract | Wording and examples are free; the auth schemes, the status codes and the exposure warning must survive | wiki/src/content/docs/guides/user/webhooks.md |
| CLAUDE.md Inbound Webhooks section | c3-243 Contract | Wording is free; the invariants on secret storage, route position and the private card kind must survive | CLAUDE.md |

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | KANNA_WEBHOOKS is not disabled and the hook exists, is enabled, and the caller presents a valid credential | N.A - no governing entity |
| Input | A POST with a raw body of at most 256 KiB and either an Authorization bearer header or an X-Hub-Signature-256 header | N.A - no governing entity |
| State | Hook configs and secrets in webhooks.json; last delivery, recent delivery ids and rate-limit buckets in memory only | N.A - no governing entity |
| Shared dependency | EventStore for chats, projects and transcript appends; AgentCoordinator for enqueueMessage, maybeStartNextQueuedMessage and emitStateChange | N.A - no governing entity |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | An external event becomes a visible card and, where the hook asks for it, a prompt that runs when the chat is idle | N.A - no governing entity |
| Primary path | Authenticate, claim the delivery id, take a rate-limit token, deliver in the hook mode, record the outcome and answer 202 | N.A - no governing entity |
| Alternate path | A repeated delivery id answers 200 duplicate without delivering again; a busy chat simply queues the prompt | N.A - no governing entity |
| Failure behavior | A missing target chat or project answers 409 and releases the delivery id so a retry can succeed; a rate-limited caller gets 429 with Retry-After | N.A - no governing entity |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| The route moves after the session auth gate and external callers get 401 from the cookie check | Reordering handlers in createHttpDispatcher | webhook-http-routes tests pass while a real caller fails, so the dispatcher order is the only guard | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
| Secrets reach a snapshot, log or transcript | Adding a field to WebhookSummary or logging a request | Review of the summarize function; the snapshot type has only secretHint | bun test --conditions production src/server/webhooks/webhook-store.adapter.test.ts |
| webhooks.json is created world-readable | Replacing the temp-file and chmod write with a plain writeFile | The mode assertion after a rewrite over a looser file | bun test --conditions production src/server/webhooks/webhook-store.adapter.test.ts |
| A looping caller spawns unbounded chats | Raising or removing the per-hook token bucket | The twenty-first delivery inside a minute stops answering 429 | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
