---
id: adr-20261111-cross-chat-peer-messaging
c3-seal: 013382027614438b46664e81de62744fd8290ef75e5021af1198c5e594ad9c36
title: cross-chat-peer-messaging
type: adr
goal: Let agents in different Kanna chats, in any project on one server, message each other through Kanna-native tools that deliver automatically, and record the guardrails that make automatic delivery safe.
status: proposed
date: "2026-11-11"
---

## Goal

Let agents in different Kanna chats, in any project on one server, message each other through Kanna-native tools that deliver automatically, and record the guardrails that make automatic delivery safe.

## Context

Before this change only an external MCP client could message a chat, through the remote `/mcp` send_message command. Agents that Kanna runs had no tool for it, so work that spans chats, such as an API chat telling a client chat that a schema changed, needed the user to carry the message. adr-20260904-cross-project-orchestration sequences cross-project work through boards and the user's own gestures; it deliberately gives no agent a way to initiate work in another chat. This ADR is an agent-initiated exception to that stance, so it must be bounded and visible.

Claude Code has native cross-session messaging (SendMessage and a crossSessionInbound setting). It is not used here: it reaches terminal sessions outside Kanna, its delivery bypasses Kanna's queue and transcript, it has no equivalent for Codex, and Kanna could not stamp or rate limit it. Codex gained a route in its app-server: thread/start accepts dynamicTools and sends item/tool/call back to the client, which Kanna already handles. A probe against codex-cli 0.157.0 showed a thread started with dynamicTools keeps them across thread/resume and thread/fork in a new process, so only thread/start needs to carry them; chats started before this change keep a thread without the tools.

## Decision

Add a PeerMessenger (c3-249) that exposes list_peer_chats and send_chat_message to Claude through kanna-mcp and to Codex as dynamicTools, main chat scope only. A message is accepted automatically, with no approval card: it is enqueued on the target with a server-stamped peer_chat origin and the normal queue starts the turn when the chat is idle. The default is accept, controlled by the global peerMessagesInbound setting and a per-chat override event.

Guardrails apply in a fixed order: the target exists and is not the sender, deleted or archived; inbound is enabled; the message is at most 100000 characters; identical content to the same target within 60 seconds is dropped; the sender and target pair is limited to 6 messages a minute and 60 an hour; and a target holds at most 20 queued peer messages. The model sees the text wrapped in a peer-chat-message element with escaped attributes and a footer stating it is not from the user, applied at turn start so the queue and transcript keep the raw text. A peer message never runs as a builtin or slash command, and inbox triage turns cannot send. Notify-when-idle subscriptions are one-shot, in memory and expire after 12 hours.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-249 | component | New component that owns delivery, guardrails and idle subscriptions | c3-249#n14722@v1:sha256:98b1a73d20c5d45fa5127a36ed544a1649da50bd348b3c3a2ce32b323300561f "Owns cross-chat messaging: list_peer_chats and send_chat_message for Claude and Codex, the peer_chat origin that the server stamps on the queued message, the es" | Reviewed against ref-side-effect-adapter and ref-strong-typing |
| c3-211 | component | thread/start carries dynamicTools and item/tool/call dispatches to the Kanna tool handler for the main scope only | c3-211#n12770@v1:sha256:fc475b2a6d9f54558b307381696796cf68b868de219e51d22d494f3c22147450 "Spawns the Codex App Server child process, speaks JSON-RPC, maps its event stream onto the provider-adapter shape consumed by the coordinator. Non-goals: turn o" | The dynamic tool answer moved to codex-dynamic-tool-call.ts to keep codex-app-server.ts under its size pin |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-provider-adapter | The Codex tool route stays inside the Codex adapter files | ref-provider-adapter#n15496@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 "Normalize Claude Agent SDK and Codex App Server into one transcript + tool-call model so the UI never branches on provider." | comply |
| ref-side-effect-adapter | PeerMessenger takes every collaborator as a port | ref-side-effect-adapter#n15528@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee "Keep every `node:fs`, `node:child_process`, `node:http`/`https`, `bun:sqlite`/`better-sqlite3`/`pg`, and `Bun.spawn`/`Bun.$`/`Bun.file`/`Bun.serve`/`Bun.Termina" | comply |
| ref-strong-typing | Tool arguments and the origin union are typed, never cast | ref-strong-typing#n15567@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af "No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or the owni" | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | The peer_chat origin and dynamic tool types cross the shared and Codex boundaries | rule-strong-typing#n15761@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 "All values crossing a Kanna boundary (client↔server WebSocket envelopes, JSONL events↔read-models, provider adapter↔agent coordinator, shared module exports) mu" | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared contract | PeerChatOrigin union, escaped prompt renderer, tool specs, limits, inbound mode | src/shared/peer-messaging |
| Server | PeerMessenger, kanna-mcp tools, Codex dynamicTools, turn-end onChatSettled, chat_peer_inbound_set | src/server/peer-messaging |
| Client | Origin chip, General settings row, per-chat sidebar toggle | src/client/components/messages/OriginChip.tsx |
| Docs | Wiki guide peer-messaging | wiki/src/content/docs/guides/user/peer-messaging.md |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Claude native SendMessage and crossSessionInbound | Not available to Codex, bypasses the Kanna queue and transcript, and cannot be stamped or rate limited |
| An approval card before delivery | Defeats unattended cooperation between agents; left as a follow-up mode |
| Persist notify subscriptions | Adds a store for a convenience feature; the loss on restart is documented |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A message injects instructions into the target | Wrapper with escaped attributes and a not-from-the-user footer, an origin clients cannot forge, no slash or builtin parsing | src/shared/peer-messaging/render-prompt.test.ts |
| Two chats reply to each other forever | Duplicate drop, per-pair rate limits, queue cap and prompt guidance not to acknowledge | src/server/peer-messaging/peer-messenger.test.ts |
| Codex inbox triage turns can still call the tool | Only the Claude inbox guard denies it; Codex handler turns are a follow-up | N.A - known gap |

## Verification

| Check | Result |
| --- | --- |
| bun run test | passes |
| bun run check:arch | passes |
