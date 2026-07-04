---
id: c3-230
c3-seal: 318f962d49132d75fc5dd0d5f3eeae27792967a41e9d1a972feacd8e99c2d860
title: openrouter-models
type: component
category: feature
parent: c3-2
goal: |-
    Fetch the live OpenRouter model catalog, filter to tool-capable entries, and
    serve the result to the WS layer via a TTL-cached read-model so the chat
    composer's openrouter model picker populates dynamically.
uses:
    - ref-cqrs-read-models
    - ref-side-effect-adapter
    - ref-strong-typing
    - rule-colocated-bun-test
---

## Goal

Fetch the live OpenRouter model catalog, filter to tool-capable entries, and
serve the result to the WS layer via a TTL-cached read-model so the chat
composer's openrouter model picker populates dynamically.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 server — read-model alongside other server adapters. |
| Slot | Feature component (foundation slots 01-09 full). |
| Why this container | Lives next to other server-side adapters and the ws-router that exposes its RPC. |
| Membership rule | Server-only module. Imports allowed from ws-router (c3-208); never imported by client. |

## Purpose

Owns: HTTP fetch of OpenRouter `/api/v1/models`, parse into `OpenRouterModel`,
filter to entries where `supported_parameters` includes `tools`, TTL cache
(default 1h) keyed off injected `now()`, stale-on-failure within TTL, throw on
first-ever failure.

Non-goals: Does NOT authenticate the request (the OpenRouter `/models` endpoint
is unauthenticated). Does NOT participate in event sourcing. Does NOT cache
model metadata to disk — in-memory only, repopulated on server restart.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Preconditions | None — endpoint is public. | N.A - public endpoint |
| Inputs | Injected fetchRaw() (the IO leaf), ttlMs, now(). | c3-2 |
| State | In-memory { models, fetchedAt }. | c3-2 |
| Shared deps | fetch() via the *-io.adapter.ts leaf only. | ref-side-effect-adapter |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Business outcome | Composer lists every tool-capable OpenRouter model and lets the user pick one for the chat. | c3-115 |
| Primary path | list() → cache hit if fresh → return cached. Miss → fetchRaw() → parseOpenRouterModels → cache → return. | c3-2 |
| Alternate path | fetchRaw rejects within TTL → return last cached list (stale-on-failure). | c3-2 |
| Failure behavior | First-ever fetch failure → throw; WS RPC surfaces error; client renders empty/loading state. | c3-208 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | The single fetch() lives only in openrouter-models-io.adapter.ts. | mandatory | Lint side-effect seal enforces. |
| ref-cqrs-read-models | ref | Cache is a derived read view, distinct from event-sourced state. | mandatory | No event-store interaction. |
| ref-strong-typing | ref | OpenRouterModel is concretely typed (no any). | mandatory | Filter discards malformed rows. |
| rule-colocated-bun-test | rule | Sibling openrouter-models.test.ts ships with the module. | mandatory | Bun test asserts parse + TTL + stale-on-failure. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| OpenRouterModelCache.list() | OUT | Returns Promise<OpenRouterModel[]> — fresh or cached. | Server-only API; consumed by ws-router. | c3-208 |
| parseOpenRouterModels(raw) | IN | Accepts unknown (raw fetch payload). Filters to tool-capable entries. Returns OpenRouterModel[]. | Pure function. | c3-2 |
| fetchOpenRouterModelsRaw() | OUT | Single fetch() to OPENROUTER_MODELS_URL. Returns parsed JSON or throws. | Side-effect adapter leaf. | ref-side-effect-adapter |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| OpenRouter schema change breaks parse | Upstream API edit. | parseOpenRouterModels defensively filters malformed rows; downstream picker shows empty state. | bun test src/server/openrouter-models.test.ts |
| TTL too short / too long | Hand-tuning the constant in server.ts. | Review at PR time. | bun test src/server/openrouter-models.test.ts |
| Stale list after key rotation | OpenRouter changes catalog visibility per key. | Cache is unauthenticated, shared. | bun test src/server/openrouter-models.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| settings.listOpenRouterModels RPC handler | Contract | RPC may add request/response logging. | c3-208 |
| Client picker UX | Contract | UI may filter/search locally. | c3-115 |
