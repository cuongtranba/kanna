---
id: adr-20261020-webhook-payload-filter
c3-seal: 449d343ddd582c4c33b322fc9e6a89660e8d35b293f35c9538785f24aea4c0a9
title: webhook-payload-filter
type: adr
goal: 'Record the decision to give each inbound webhook an optional payload filter: a YAML document with an on block (event names from X-GitHub-Event, optional types matched against body.action) and an if block holding a CEL condition over body, event and headers. A delivery that does not match is answered 200 with filtered true and creates nothing. The filter is checked after authentication and before the delivery-id claim and the rate-limit token, a stored filter that no longer compiles fails closed, and the four hook-field whitelists now carry threadKeyPath, senderPath, replyHint and filter.'
status: done
date: "2026-10-20"
---

## Goal

Record the decision to give each inbound webhook an optional payload filter: a YAML document with an on block (event names from X-GitHub-Event, optional types matched against body.action) and an if block holding a CEL condition over body, event and headers. A delivery that does not match is answered 200 with filtered true and creates nothing. The filter is checked after authentication and before the delivery-id claim and the rate-limit token, a stored filter that no longer compiles fails closed, and the four hook-field whitelists now carry threadKeyPath, senderPath, replyHint and filter.

## Context

A hook delivered every authenticated POST. GitHub lets a repository webhook choose event types but not actions or assignees, so a hook subscribed to issues received every opened, labeled, assigned, edited and closed event. One spawn-mode hook created 55 chats in a day and 38 in one minute when thirteen issues were filed, and nearly every chat concluded there was nothing to do. The hook fields threadKeyPath, senderPath and replyHint were declared, validated and read at delivery, but parseStoredWebhook, the registry's configOf, create and applyPatch, and the WS sanitizers all dropped them, so none reached disk or the client and one-chat-per-issue threading could not be configured. The shared validator also runs in the browser, so it cannot depend on a server-only expression engine.

## Decision

Add filter as an optional string on the hook. webhook-filter.ts compiles it once: the yaml package parses it with unique keys and rejects anchors, aliases and tags; zod checks that only on and if exist and that no event or types list is empty; @bufbuild/cel parses and plans the if expression and a dry run rejects identifiers other than body, event and headers. The registry compiles on create, update and boot and keeps the compiled filter in memory; a stored filter that no longer compiles is replaced by a rejecting filter so every delivery is filtered with filter invalid and a warning is logged, instead of the hook silently delivering everything. handleWebhookRequest parses the body once and evaluates the filter after verifyWebhookRequest and before claimDelivery and takeToken, records the outcome with filtered true and the reason, and answers 200 with ok true and filtered true. A CEL evaluation error such as a missing key counts as no match. The headers passed to CEL are lowercased and exclude authorization, cookie and the signature headers. The same change carries threadKeyPath, senderPath, replyHint and filter through parseStoredWebhook, configOf, create, applyPatch, sanitizeInput and sanitizePatch, and a null patch clears each of them. The shared validator checks only the filter length.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-243 | component | Owns the new filter compiler, the registry compile cache, the route check order and the field whitelists | c3-243#n15290@v1:sha256:e162910c1f53887dcfca7bff06c33cc3d706527a5ffcb5e87b706696475006fb | webhook-filter.ts is pure and imports no IO (ref-side-effect-adapter); bodies stay JsonValue and are passed to CEL without a cast (ref-strong-typing) |
| c3-125 | component | The editor gains the filter, thread key path, sender path and reply hint fields, and the hook row renders a filtered last delivery | c3-125#n11591@v1:sha256:42a32c08680ac52e592fd1fb620d1c33556d7343ce1748607a912035c2ddb4ea | The draft stays in the scoped store with named setters; submit keeps runPendingAction |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| A GitHub Actions workflow in each sending repository that filters and then calls the hook | Every sender would need its own workflow and copied secret, and senders other than GitHub get nothing |
| GitHub Actions expression syntax through @actions/expressions | Keys are case-insensitive and payload keys named like object builtins read as missing; CEL is the language Tekton, Argo and Kubernetes use for this job |
| @marcbachmann/cel-js | Its matches function uses the native RegExp engine, which is open to catastrophic backtracking on an attacker-supplied body, and evaluate returns any |
| A declarative match-only pattern with no expression engine | It cannot express or across fields or a condition over a list such as labels |
| Bun.YAML.parse | It has no alias-expansion limit, keeps duplicate keys silently and reports no error position |
| Evaluate the filter before authentication or after the claim and token | Before auth tells a stranger what the filter accepts; after the claim a filtered delivery burns its id so Redeliver answers duplicate; after the token filtered noise drains the bucket matching events need |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A filtered delivery consumes its delivery id or a rate-limit token | The filter runs before claimDelivery and takeToken | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
| A stored filter that stops compiling makes the hook deliver everything | The registry installs a rejecting filter at boot | bun test --conditions production src/server/webhooks/webhook-registry.test.ts |
| A condition on a missing field answers 500 | A CEL error is a non-match | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
| A hook field is dropped on reload or on the wire | The store round-trip test covers all four fields | bun test --conditions production src/server/webhooks/webhook-store.adapter.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/webhooks src/shared/webhooks | Passes |
| bun run check:arch | Passes with no pin changed |
| c3x check | Exits ok with no new issues |
