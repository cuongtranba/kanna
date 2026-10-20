---
id: c3-208
c3-version: 4
c3-seal: 6e249af7a58c8b389b7856346959935ee21fc7eaa32b16168b7837fbb712f8b1
title: ws-router
type: component
category: foundation
parent: c3-2
goal: 'Multiplex WS traffic: route subscribe/unsubscribe/command envelopes, push projections on every state change.'
uses:
    - ref-colocated-bun-test
    - ref-cqrs-read-models
    - ref-ws-subscription
    - rule-colocated-bun-test
---

# ws-router

## Goal

Multiplex WS traffic: route subscribe/unsubscribe/command envelopes, push projections on every state change.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Multiplex WS subscriptions and commands across the single socket" |
| Category | foundation |
| Lifecycle | One router instance per server, one connection per client |
| Replaceability | Replaceable provided envelope contract preserved |

## Purpose

Accepts upgraded WS sockets, decodes typed `ClientEnvelope` payloads, dispatches subscribe/unsubscribe/command, forwards push payloads from read-models, and relays command results. Non-goals: HTTP routing, persistence, business decisions.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | HTTP server upgraded the socket and auth check passed | c3-202 |
| Input — read-models | Snapshots and push streams | c3-207 |
| Input — agent-coordinator | Command handlers for chat/turn ops | c3-210 |
| Input — protocol envelopes | Shared discriminated unions | c3-302 |
| Initialization | Bound by http-ws-server on upgrade | c3-202 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Every connected client mirrors the latest server state | c3-101 |
| Primary path | subscribe → snapshot push → diff stream | c3-207 |
| Alternate — command | command envelope → handler → commandResult push | c3-210 |
| Alternate — terminal | PTY bytes piped over the same socket | c3-216 |
| Failure — envelope decode | Reject with typed error envelope | c3-302 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Single-WS, typed envelopes | must follow | No additional sockets |
| ref-cqrs-read-models | ref | Only projections cross the wire | must follow | Raw events stay server-side |
| ref-colocated-bun-test | ref | Tests next to router | must follow | ws-router.test.ts |
| rule-colocated-bun-test | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |
| c3-228 | ref | Session-share envelopes (share.mint, share.revoke, share.list) dispatched through ws-router | must follow | Wired for session-share coupling |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Envelope dispatch | IN | Decodes ClientEnvelope, validates the command with parseClientCommand before origin stamping and answers an error envelope for the same id when it fails, then routes to a handler | c3-101 | src/server/ws-router.ts |
| Snapshot push | OUT | Pushes typed ServerEnvelope to subscribers | c3-101 | src/server/ws-router.ts |
| Command result | OUT | Correlates result envelope to client command; a handler of a command with a result schema in the registry answers through ackResult, whose result parameter is that schema output type | c3-101 | src/server/ws-router.ts |
| Reply guarantee | OUT | routeCommand reports unclaimed, answered or silent by watching the envelopes a handler sends through the send utility for the command id; a command no handler claims, and a command a handler claims without replying, are both answered with an error envelope on the browser socket and from dispatchCommand, so a handler bug cannot hang the browser promise or become a fabricated ack for a remote client | c3-242 | src/server/ws-router.ts, src/server/ws-router-utils.ts |
| Command coverage gate | IN | Every registry command is named by a ws-router handler literal and every command literal or prefix a handler claims is a registry command, checked from the syntax tree rather than from text | c3-302 | src/server/ws-router-coverage.test.ts |
| Project files and plugins | IN | project.listPaths and upload.delete answer the path autocomplete and abandoned-upload cleanup that used to be HTTP routes; plugins.list and plugins.reload drive the plugin service and answer an empty list or an error while plugins are switched off | c3-238 | src/server/ws-router-project-files.ts, src/server/ws-router-plugins.ts |
| Command origin stamp | IN | routeCommand is the only place a chat.send or message.enqueue origin is set: it copies the connection's commandOrigin onto the command and deletes any origin the sender wrote, so a browser socket can never claim an MCP origin | c3-242 | src/server/ws-router.ts, src/server/command-origin-stamp.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Envelope drift | Protocol bump without router update | Decode errors at runtime | bun run test src/server/ws-router.test.ts |
| Command without a reply | A handler returns true without sending an ack, snapshot or error for the command id, or a registry command has no handler | The caller receives an error envelope naming the command; the coverage test fails for an unnamed registry command | bun run test src/server/ws-router-coverage.test.ts src/server/ws-router.test.ts |
| Subscription leak | Listener not pruned on disconnect | Memory growth across long sessions | Long-session smoke + listener count assertion in src/server/ws-router.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/ws-router.ts | c3-208 Contract | Routing detail | src/server/ws-router.ts |
| src/server/ws-router.test.ts | c3-208 Contract | Test cases per surface | src/server/ws-router.test.ts |

## chat.ops delta broadcast

During live turns, chat-topic subscribers with a tracked per-subscription seq
(`ClientState.chatOpSeqBySubId`) receive `{type:"event", event:{type:"chat.ops",
fromSeq, toSeq, ops}}` envelopes instead of full snapshots (`pushSnapshots`
in `ws-router-broadcast.ts`). Meta changes (runtime/sections/pending) are
diffed once per chat per pass by `recordMetaOps` → `diffChatMeta`
(`src/server/chat-ops-diff.ts`, pure) and recorded into the op-log so the
ring stays the single ordering authority. Ring gap ⇒ tracking + snapshot
signature dropped ⇒ full snapshot re-arms the delta path. Full-snapshot sends
stamp `data.seq` and initialize tracking.
