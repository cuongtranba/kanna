---
id: c3-249
c3-seal: 1f7f4b52eca7dc586a040a27c37564bf7a9e7ea8ec006f7ea64dd90900dc9647
title: peer-messaging
type: component
category: feature
parent: c3-2
goal: Let an agent in one Kanna chat message an agent in another chat, in any project on this server, with the sender stamped by the server and the target protected by fixed guardrails.
uses:
    - ref-side-effect-adapter
    - ref-strong-typing
---

## Goal

Let an agent in one Kanna chat message an agent in another chat, in any project on this server, with the sender stamped by the server and the target protected by fixed guardrails.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | In-process. createPeerMessaging builds one PeerMessenger and the Codex manager in createApplicationServices; there is no IO of its own, only injected ports over EventStore and AgentCoordinator. |
| Consumers | c3-211 codex-app-server offers the tools as thread/start dynamicTools and routes item/tool/call to them; the Claude session spawner exposes them through kanna-mcp; the turn runners call onChatSettled at turn end; c3-114 messages-renderer shows the peer origin chip. |
| Boundary | Owns delivery rules, guardrails and idle subscriptions. It does not own queue or transcript state; it enqueues through AgentCoordinator and lets the normal queue start the turn. |

## Purpose

Owns cross-chat messaging: list_peer_chats and send_chat_message for Claude and Codex, the peer_chat origin that the server stamps on the queued message, the escaped prompt wrapper the target model sees, the inbound setting (global peerMessagesInbound and per-chat chat_peer_inbound_set), and the guardrails: valid target, inbound enabled, 100000 character cap, identical-content drop within 60 seconds, 6 per minute and 60 per hour per sender and target pair, and 20 queued peer messages per target. Notify-when-idle subscriptions are in memory, fire once and expire after 12 hours, so they are lost on restart. Only the main chat scope can send; subagents and inbox triage turns cannot. A peer message never runs as a builtin or slash command. Non-goals: no approval step, no persistence of subscriptions, no messaging across machines.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | PeerMessenger takes every collaborator as a port and does no IO; tests use an in-memory world | Mandatory | node:crypto is used only for ids and digests. |
| ref-strong-typing | ref | Tool arguments are parsed with the shared zod schema, results are plain JSON, and no cast is used | Mandatory | The Codex dynamic tool schema is rendered from the same zod schema the Claude tool uses. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| list_peer_chats and send_chat_message | IN | Defined once in tool-specs.schema.ts; Claude registers them through kanna-mcp, Codex receives them as dynamicTools on thread/start only | A Codex chat started before this feature keeps its thread without the tools because thread/resume and thread/fork carry no dynamicTools of their own, though a thread started with them keeps them across resume and fork | src/shared/peer-messaging/tool-specs.schema.ts |
| PeerMessenger.send | IN/OUT | Refusals in fixed order: unknown chat, self, archived, inbound refused, too large, duplicate, rate limited, queue full; otherwise enqueue with a peer_chat origin and start the next queued message | The origin is server-stamped, command-origin-stamp strips any origin a client sends, and a peer message is delivered as plain text, never parsed as a builtin or slash command | src/server/peer-messaging/peer-messenger.ts |
| Peer prompt | OUT | renderPeerPrompt wraps the raw text in peer-chat-message with escaped attributes and a footer saying it is not from the user | Applied at turn start only, so the queue and the transcript keep the raw text; a closing tag inside the text is neutralised | src/shared/peer-messaging/render-prompt.ts |
| Inbound setting | IN/OUT | peerMessagesInbound accept or refuse, default accept, overridden per chat by chat_peer_inbound_set and the chat.setPeerInbound command | A per-chat value equal to the global one is cleared by the client | src/shared/peer-messaging/inbound.ts |
| Idle notice | OUT | onChatSettled runs right after the turn-end queue drain and delivers one peer notice to each unexpired subscriber | Errors are logged and never reach the turn runner | src/server/peer-messaging/peer-messenger.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| wiki/src/content/docs/guides/user/peer-messaging.md | c3-249 Contract | Wording is free; the auto-accept default, the guardrail numbers, the restart note and the Codex new-thread note must survive | wiki/src/content/docs/guides/user/peer-messaging.md |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| A peer message is parsed as /clear or a slash command in the target | Removing the peer origin check in dequeueAndStartQueuedMessage | The origin is the only guard, so review that function when it changes | bun run test src/server/claude-send-command.test.ts |
| A sender forges a peer origin or breaks out of the wrapper | Weakening stampCommandOrigin or the attribute escaping | The render-prompt injection tests | bun run test src/shared/peer-messaging/render-prompt.test.ts |
| Two chats loop forever | Raising the rate limits or dropping the duplicate window | The rate limit and duplicate tests | bun run test src/server/peer-messaging/peer-messenger.test.ts |
