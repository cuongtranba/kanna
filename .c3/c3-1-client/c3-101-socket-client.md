---
id: c3-101
c3-version: 4
c3-seal: e9a53029c25f973ae7698f57b038206355278c83ddda31ff712db2c2066de1f3
title: socket-client
type: component
category: foundation
parent: c3-1
goal: Maintain the single WebSocket to the backend, decode typed envelopes, and dispatch commands + subscription push messages.
uses:
    - ref-strong-typing
    - ref-ws-subscription
---

# socket-client

## Goal

Maintain the single WebSocket to the backend, decode typed envelopes, and dispatch commands + subscription push messages.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "stay synchronized with server state via WebSocket subscriptions" |
| Category | foundation |
| Lifecycle | Singleton — one socket lives for the lifetime of the page session |
| Replaceability | Replaceable provided new transport satisfies Contract; consumers depend only on the typed envelope shape |

## Purpose

Owns the browser-side WebSocket: opens it, reconnects with backoff, decodes inbound `ServerEnvelope` payloads, and exposes a typed dispatch surface to the rest of the client. Non-goals: rendering, persistence, cross-tab coordination, or business decisions about when to re-subscribe.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Tab loaded with auth cookie present (or socket open will be rejected) | c3-203 |
| Input — protocol envelopes | Typed ClientEnvelope / ServerEnvelope discriminated unions | c3-302 |
| Input — port + dev-port helpers | Resolve target ws:// URL during dev/prod | c3-304 |
| Internal state | Pending subscription map, command id sequence, reconnect timer | c3-101 |
| Initialization | Called once from app-shell during mount | c3-110 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Client always sees fresh server snapshots and can issue commands without per-feature transport code | c3-110 |
| Primary path | Open WS → send subscribe → receive snapshot push → forward to listener | ref-ws-subscription |
| Alternate — command | command envelopes round-trip with correlation id; result pushed as commandResult | c3-302 |
| Failure — drop | Reconnect with exponential backoff; pending commands rejected with transport.disconnected | c3-101 |
| Failure — auth | 401 close → emit auth.required event so app-shell can show login | c3-203 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Single-WS, typed envelope, snapshot-push pattern | must follow | Pattern is the contract for this component |
| ref-strong-typing | ref | No any on decoded envelopes | must follow | Decode through typed parser, not JSON.parse as any |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| connect(url) | IN | Caller provides WS URL; transport opens and retries | c3-110 | src/client/app/socket.ts |
| subscribe(topic, listener) | OUT | Listener receives typed snapshot pushes until unsubscribed | c3-110 | src/client/app/socket.ts |
| command(envelope) | OUT | Returns Promise<CommandResult> keyed by correlation id | c3-110 | src/client/app/socket.ts |
| auth.required event | OUT | Fires when server rejects with 401 | c3-110 | src/client/app/socket.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Snapshot loss on reconnect | Backoff logic regression | Stale UI after intermittent disconnect | Manual reconnect test + bun run test src/client/app/socket.test.ts |
| Type drift between envelope and server | c3-302 protocol bump without client update | tsc fails or runtime decode error | bun run check and replay socket.test.ts fixtures |
| Memory leak from listeners | Subscription map not pruned | Heap snapshot growth over session | Long-session smoke + listener-count assertion in socket.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/socket.ts | c3-101 Contract | Implementation detail (timer values, decode helpers) | src/client/app/socket.ts |
| src/client/app/socket.test.ts | c3-101 Contract | Test cases per Contract surface | src/client/app/socket.test.ts |
