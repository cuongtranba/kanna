---
id: c3-249
c3-seal: 6e72bdeecdd28400384379f63329bb011089883500f24caa3fe75aa8a656e443
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
| Boundary | Owns delivery rules, guardrails, idle subscriptions, waits and mid-turn delivery. It does not own queue or transcript state: it enqueues through AgentCoordinator, lets the normal queue start an idle chat's turn, and releases a queued message only when the provider confirms it consumed it. |

## Purpose

Owns cross-chat messaging: list_peer_chats, send_chat_message and wait_for_chat_message for Claude and Codex, the peer_chat origin that the server stamps on the queued message (with the sending subagent run and the message it answers, when present), the escaped prompt wrapper the target model sees, the inbound setting (global peerMessagesInbound and per-chat chat_peer_inbound_set), mid-turn delivery into a running turn, and the guardrails: valid target, inbound enabled, 100000 character cap, identical-content drop within 60 seconds, 6 per minute and 60 per hour per sender and target pair, 20 queued peer messages per target, and at most 5 messages injected into one turn. Notify-when-idle subscriptions and message waits are in memory, so they are lost on restart; a subscription fires once and expires after 12 hours, a wait ends after at most 600 seconds. A main chat and a Claude subagent can send; Codex subagents and inbox triage turns cannot. A peer message never runs as a builtin or slash command. Non-goals: no approval step, no persistence of subscriptions or waits, no messaging across machines.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | PeerMessenger takes every collaborator as a port and does no IO; tests use an in-memory world | Mandatory | node:crypto is used only for ids and digests. |
| ref-strong-typing | ref | Tool arguments are parsed with the shared zod schema, results are plain JSON, and no cast is used | Mandatory | The Codex dynamic tool schema is rendered from the same zod schema the Claude tool uses. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| list_peer_chats, send_chat_message and wait_for_chat_message | IN | Defined once in tool-specs.schema.ts; Claude registers them through kanna-mcp for the main chat and for Claude subagents, Codex receives them as dynamicTools on thread/start only | A Codex chat started before a tool existed keeps its thread without it because thread/resume and thread/fork carry no dynamicTools of their own; Codex subagents get none | src/shared/peer-messaging/tool-specs.schema.ts |
| PeerMessenger.send | IN/OUT | Refusals in fixed order: unknown chat, self, archived, inbound refused, too large, duplicate, rate limited, queue full; otherwise hand it to a matching wait, or to the addressed running subagent run, or enqueue with a peer_chat origin, start the next queued message and, when the chat is still busy, inject it into the running turn; the result status is delivered, injected or queued | The origin is server-stamped, command-origin-stamp strips any origin a client sends, and a peer message is delivered as plain text, never parsed as a builtin or slash command | src/server/peer-messaging/peer-messenger.ts |
| Peer prompt | OUT | renderPeerPrompt wraps the raw text in peer-chat-message with escaped attributes, including the sending run and the message it answers, and a footer saying it is not from the user and how to reply | Applied when the text reaches the model, at turn start or at injection, so the queue and the transcript keep the raw text; a closing tag inside the text is neutralised | src/shared/peer-messaging/render-prompt.ts |
| Inbound setting | IN/OUT | peerMessagesInbound accept or refuse, default accept, overridden per chat by chat_peer_inbound_set and the chat.setPeerInbound command | A per-chat value equal to the global one is cleared by the client | src/shared/peer-messaging/inbound.ts |
| Idle notice | OUT | onChatSettled runs right after the turn-end queue drain and delivers one peer notice to each unexpired subscriber | Errors are logged and never reach the turn runner | src/server/peer-messaging/peer-messenger.ts |
| Mid-turn delivery | OUT | Claude: pushed with the queued id as SDK uuid; the replay echo records the user_prompt entry and releases the message, adopts a CLI-started turn, and an unechoed message returns to the queue 15 seconds after the turn ends. Codex: turn/steer, recorded and released on success | A chat holding an unechoed injection is busy; Stop closes a Claude session that holds one so the CLI cannot run it after Stop | src/server/peer-messaging/mid-turn-delivery.ts |

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
| An injected message is recorded twice, lost, or leaves a chat busy forever | Releasing a queued message before the provider's consumption signal, or dropping the undelivered release | The mid-turn delivery tests | bun run test src/server/peer-messaging/mid-turn-delivery.test.ts |
