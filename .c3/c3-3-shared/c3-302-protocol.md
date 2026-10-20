---
id: c3-302
c3-version: 4
c3-seal: 78499216e737c7f0b3b755f6c10443792a115eaf01e2812431081153175ec86a
title: protocol
type: component
category: foundation
parent: c3-3
goal: Define WebSocket wire envelopes (WsInbound, WsOutbound, subscribe/command kinds, correlation ids).
uses:
    - ref-strong-typing
    - ref-ws-subscription
    - rule-strong-typing
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
| Command registry | src/shared/commands holds one defineCommand entry per command with its zod params, summary, risk and remote policy; ClientCommand is derived from it and parseClientCommand validates a command at the WS router and at remote MCP | c3-208 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Protocol is the contract for WS pattern | must follow | One vocabulary, both sides |
| ref-strong-typing | ref | Discriminated unions over envelope kinds | must follow | No any in payload type |
| rule-strong-typing | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| WsInbound union | OUT | Client-to-server envelope kinds | c3-208 | src/shared/protocol.ts |
| WsOutbound union | OUT | Server-to-client envelope kinds | c3-101 | src/shared/protocol.ts |
| HTTP route inventory | OUT | HTTP_ROUTES lists every route the web client calls with its methods, path pattern, purpose and remote policy: an MCP tool, a registry command or an exclusion with a reason; the client and the server build those paths with buildRoutePath and matchRoutePath instead of spelling them, so a route renamed in the inventory moves with its callers | c3-242 | src/shared/http-routes.ts |
| Beacon pairing link | OUT | kanna-beacon://pair with url and code; the parser also accepts the pasted CLI command and owns the pairing code alphabet | c3-241 | src/shared/beacon-pair-link.ts |
| Beacon frames | IN/OUT | Protocol 2: ready carries the server's protocol version; refused, scope, set-scope and unpair frames; a beacon sends set-scope or unpair only to a server at SCOPE_SYNC_PROTOCOL or later. Protocol 3 adds file transfer. Protocol 4 adds the field-less update frame, the update_status frame and an optional serverVersion on ready and incompatible; a beacon sends update_status only to a server at UPDATE_PROTOCOL or later, because an older server closes the socket on a frame it cannot parse | c3-241 | src/shared/beacon-protocol.ts |
| Beacon alias and mention handle | OUT | BeaconConfig.alias is an optional slug (lowercase letters, digits, hyphen and underscore, at most 40 characters) that is unique across beacons and is the display name; the hostname label stays the identity. buildBeaconMentionIndex maps handle to beacon id with aliases claiming first and a hostname slug for a beacon without one, suffixing a collision with a number in id order, so the composer and the server resolve the same handle | c3-241 | src/shared/beacon-alias.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Backward-incompat bump | New kind added without bump version | Old client breaks at runtime | bun run check against src/shared/protocol.ts |
| Web route without an MCP path | A client file spells a route path itself, an inventory entry has no caller, or the dispatcher stops serving an inventory route | The inventory scan, the unused-entry check and the dispatcher conformance test fail | bun run test src/ops/parity src/shared/http-routes.test.ts src/server/http-route-inventory.test.ts |
| Type drift | Payload shape change without consumer update | tsc fails on either side | bun run check plus replay envelope fixtures from src/client/app/socket.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/protocol.ts | c3-302 Contract | Envelope detail | src/shared/protocol.ts |

## Chat ops delta events

`src/shared/chat-ops.ts` defines `ChatOp`
(`entries.append` / `runtime.set` / `sections.set` / `pending.set`),
`ChatOpsEvent` (added to `WsEvent`), and the pure `applyChatOps` reducer the
client folds deltas with. The chat topic gained `since?: number` and
`ChatSnapshot` gained optional `seq` (absent = producer has no op-log, e.g.
share page). Contract: fail-safe is always a full snapshot — a seq gap on
either side degrades to the snapshot path, never silent divergence.
