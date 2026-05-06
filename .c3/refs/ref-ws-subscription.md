---
id: ref-ws-subscription
c3-version: 4
c3-seal: 5134ee6411de502e9a8ea47f69eaee09bd06ce28a7fc89a5684b7ea2371a4d06
title: WebSocket Subscription
type: ref
goal: A single typed WebSocket handles both subscriptions (push) and commands (pull), with a shared envelope defined in src/shared/protocol.ts.
---

# ws-subscription

## Goal

A single typed WebSocket handles both subscriptions (push) and commands (pull), with a shared envelope defined in src/shared/protocol.ts.

## Choice

One WS per client. Server-side ws-router multiplexes subscribe/unsubscribe/command. Client-side socket.ts maintains the connection and dispatches typed envelopes.

## Why

Keeps the wire count flat, reuses the auth cookie, pairs naturally with the reactive read-model broadcast. Avoids REST polling, still supports one-shot commands.

## How

| Guideline | Example |
| --- | --- |
| All message shapes live in src/shared/protocol.ts | WsInbound / WsOutbound unions |
| Commands return correlation IDs | request/response still works over the same socket |
| Subscriptions receive full snapshots, not diffs | simpler reconciliation |

## Not This

| Alternative | Rejected Because |
| --- | --- |
| ... | ... |

## Scope

**Applies to:**

- <!-- containers/components where this ref governs behavior -->

**Does NOT apply to:**

- <!-- explicit exclusions -->

## Override

To override this ref:

1. Document justification in an ADR under "Pattern Overrides"
2. Cite this ref and explain why the override is necessary
3. Specify the scope of the override (which components deviate)

## Cited By

- c3-{N}{NN} ({component name})
