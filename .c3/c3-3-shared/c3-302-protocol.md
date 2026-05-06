---
id: c3-302
c3-version: 4
c3-seal: 5376ee07f9b80b581cab039a45f5aa9e7fa3dec0bfb915676ae911d4a19cccab
title: protocol
type: component
category: foundation
parent: c3-3
goal: Define WebSocket wire envelopes (WsInbound, WsOutbound, subscribe/command kinds, correlation ids).
uses:
    - ref-strong-typing
    - ref-ws-subscription
---

# protocol

## Goal

Define WebSocket wire envelopes (WsInbound, WsOutbound, subscribe/command kinds, correlation ids).

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 (shared) |
| Parent Goal Slice | "Define the WebSocket envelope vocabulary shared by client and server" |
| Category | foundation |
| Lifecycle | Pure type module |
| Replaceability | Replaceable provided discriminated envelope contract preserved |

## Purpose

Holds the WS envelope discriminated unions: subscribe/unsubscribe/command kinds, correlation ids, and snapshot/diff payload wrappers. Non-goals: transport itself, business handlers.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | TypeScript strict mode | c3-3 |
| Input — shared types | Domain types embedded in envelopes | c3-301 |
| Internal state | None | c3-302 |
| Initialization | Imported by socket and ws-router | c3-101 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Both sides decode and emit envelopes safely | c3-101 |
| Primary path | Client encodes → server decodes → reply encoded | c3-208 |
| Alternate — push | Server pushes typed snapshot envelope without correlation | c3-208 |
| Alternate — error | Both sides handle typed error envelope | c3-101 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Protocol is the contract for WS pattern | must follow | One vocabulary, both sides |
| ref-strong-typing | ref | Discriminated unions over envelope kinds | must follow | No any in payload type |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| WsInbound union | OUT | Client-to-server envelope kinds | c3-208 | src/shared/protocol.ts |
| WsOutbound union | OUT | Server-to-client envelope kinds | c3-101 | src/shared/protocol.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Backward-incompat bump | New kind added without bump version | Old client breaks at runtime | bun run check against src/shared/protocol.ts |
| Type drift | Payload shape change without consumer update | tsc fails on either side | bun run check plus replay envelope fixtures from src/client/app/socket.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/protocol.ts | c3-302 Contract | Envelope detail | src/shared/protocol.ts |
