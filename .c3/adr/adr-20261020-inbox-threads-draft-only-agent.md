---
id: adr-20261020-inbox-threads-draft-only-agent
c3-seal: c6e98122022b0036feb45944bf347cddab695b9aa63470cc7a8597a435b5f9ed
title: inbox-threads-draft-only-agent
type: adr
goal: Record the decision to turn every inbound message into an inbox thread handled by one chat per thread, where the agent only drafts and the user approves, and to route webhook delivery through the same deliverInbound path so the new inbox component (c3-247) owns delivery for every inbound source.
status: done
date: "2026-10-20"
---

## Goal

Record the decision to turn every inbound message into an inbox thread handled by one chat per thread, where the agent only drafts and the user approves, and to route webhook delivery through the same deliverInbound path so the new inbox component (c3-247) owns delivery for every inbound source.

## Context

Webhooks were the only inbound source and each delivery left a card in a chat with no unread flag, no push and no badge; the user saw it only by opening the chat. The planned MCP sources (Zalo and other MCP servers) need the same delivery, plus threads, because a conversation partner sends many messages. The user decided that an agent should pre-read each message in its own chat and report a verdict and a draft, that nothing is sent to the sender until the user presses Send, that threads leave the Inbox when replied or archived, and that every bus event stays browsable as activity. The service bus (c3-246) exists so one subscriber can see every durable fact.

## Decision

Add the inbox component: an InboxRegistry projection over an append-only inbox.jsonl log holding threads keyed by source and thread key plus activity items derived from every internal bus envelope; deliverInbound as the single delivery path (publish the inbound envelope, upsert the thread, resolve one handler chat per thread for spawn, append the card, queue the handler prompt, mark the thread pending); the mcp__kanna__inbox_report tool for main chats through which the bound chat records a verdict and a draft; a turn-end fallback that escalates a pending thread to needs_you; the inbox topic and six commands on the ws-router; and reply and instruct prompts that go through the thread chat. deliverWebhook becomes a thin caller so the webhook_delivery card and its schedule id are unchanged. This wins over a per-source delivery path and over a direct tool call from Kanna, which would need a per-source argument mapping before any reply could be sent.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-247 | component | New owner of threads, activity, the report tool, the fallback and the reply prompts | c3-247#n14991@v1:sha256:7216e95c95193f462165e65cf97c72bced42aae6f2641db8ee87473f37a41fc4 | inbox-log.adapter.ts is the only IO; events and bodies are JsonValue narrowed field by field |
| c3-243 | component | Delivery now goes through deliverInbound; hooks gain optional threadKeyPath, senderPath and replyHint | c3-243#n15126@v1:sha256:73b92e16d3e61537482be8e0d2c86fd4d3e91f3c2870a5153c2b9b84fea5483e | The card kind, the schedule id and the 0600 secret file are untouched; webhook-delivery.test.ts stays green |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared contracts | inbox types, events with parseInboxEvent, describe and policy; inbound handler, template and reply prompts; inbound_delivery transcript entry | src/shared/inbox/, src/shared/inbound/, src/shared/transcript-types.ts |
| Registry | InboxRegistry over InboxLogPort with a pure projection, cap and boot compaction | src/server/inbox/ |
| Delivery and reply | deliverInbound, replyToInboxThread, instructInboxThread; deliverWebhook as a thin caller | src/server/inbound/, src/server/webhooks/webhook-delivery.ts |
| Tool and router | inbox_report tool for main chats; inbox topic and commands | src/server/kanna-mcp-inbox.ts, src/server/ws-router-inbox.ts |
| Boot | createInboxServices wires the log, registry, webhook service, router and spawner | src/server/inbox/inbox-boot.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Kanna calls the source tool directly to send a reply | Needs a per-source argument mapping before any reply can be sent; the agent already has the source tools in the thread chat |
| One handler chat per source | Context from different people mixes in one chat and grows forever |
| A StoreEvent log for inbox records | Five files must agree and chat-tasks.jsonl already shows they drift; event-store.ts is at its line budget |
| Approve drafts in the chat transcript | Two places to decide; the Inbox item is the one the user opens for the thread |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A chat reports on a thread it does not handle | report accepts only the bound chat | bun test --conditions production src/server/inbox/inbox-registry.test.ts |
| A handler never reports and the thread stays silent | Turn-end fallback escalates a pending thread | bun test --conditions production src/server/inbox/inbox-registry.test.ts |
| The fallback fires early when a second message lands mid-turn | pendingSince ignores turn ends older than the mark; a later report corrects the state; recorded as a known gap | bun test --conditions production src/server/inbox/inbox-registry.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck, lint, lint:comments, lint:usestate, check:arch | clean, no pin changed |
| bun run test | passes |
| bun run build:client and check:bundle | entry under the 350000 gzip budget |
