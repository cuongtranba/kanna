---
id: c3-247
c3-seal: e8f50343c7078a10774c578ea88a9f1aa7eee5b4ca7dabb3c9e644aa97e9c77f
title: inbox
type: component
category: feature
parent: c3-2
goal: Turn every inbound message Kanna receives, from a webhook or an MCP source, into a conversation thread the user can read, have pre-handled by an agent in its own chat, and answer from one place, while every other bus event is kept as a browsable activity record.
uses:
    - ref-event-sourcing
    - ref-side-effect-adapter
    - ref-strong-typing
---

## Goal

Turn every inbound message Kanna receives, from a webhook or an MCP source, into a conversation thread the user can read, have pre-handled by an agent in its own chat, and answer from one place, while every other bus event is kept as a browsable activity record.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | In-process. createInboxServices builds the registry over inbox.jsonl after the bus exists; the registry subscribes to the bus and the webhook service, the ws-router and the Kanna MCP server receive it. |
| Consumers | c3-243 webhooks delivers through deliverInbound; c3-208 ws-router serves the inbox topic and the six inbox commands; c3-226 kanna-mcp-host registers the inbox_report tool for main chats; c3-246 service-bus is the feed. |
| Boundary | Owns threads, activity items, verdicts, read state and the reply and instruct prompts. It does not own chat state, the queue or any source credential; it calls EventStore and AgentCoordinator through narrow Pick types. |

## Purpose

Owns the inbox feature: the InboxRegistry projection over an append-only inbox.jsonl log, threads keyed by source and thread key with one handler chat per thread, the activity items derived from every internal bus envelope, the inbox_report MCP tool through which the handler chat records a verdict and a draft, the fallback that marks a thread needs_you when its handler turn ends without a report, and the reply and instruct prompts the user sends from the Inbox. deliverInbound is the one delivery path for every inbound source. Non-goals: it does not call a source tool itself, does not render the page, and does not decide push or toast; it only fires onNeedsYou.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | inbox-log.adapter.ts is the only file in the feature that touches node:fs; the registry takes an InboxLogPort so tests use an in-memory port | Mandatory | The log is rewritten only at boot when it holds more than twice the live records. |
| ref-strong-typing | ref | Inbox events and inbound bodies are JsonValue narrowed with parseInboxEvent and isJsonObject, never cast | Mandatory | The report tool validates its input with zod and the registry re-checks the verdict. |
| ref-event-sourcing | ref | Every thread and item transition is an appended InboxEvent and the in-memory state is a projection replayed at boot | Mandatory | The projection is pure in inbox-projection.ts. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| deliverInbound | IN | Publishes the inbound envelope, upserts the thread, resolves the handler chat (notify none, inline fixed, spawn one chat per thread created on first message and renamed source and sender), appends the card, queues the handler prompt under scheduleId webhook-hookId-deliveryId or mcp-sourceId-deliveryId and marks the thread pending | A webhook delivery keeps its webhook_delivery card and schedule id unchanged; an MCP delivery appends an inbound_delivery card that stays out of share links | src/server/inbound/deliver-inbound.ts |
| inbox_report tool | IN | thread_id, verdict needs_you or fyi or handled, summary up to 600 characters, optional draft_reply up to 4000; accepted only from the thread's bound chat and only for main chats | A report never sends anything to the sender; a report from another chat is refused | src/server/kanna-mcp-inbox.ts |
| inbox topic and commands | OUT | InboxSnapshot with threads, items, unreadCount and total; commands markRead, markAllRead, archive, page, reply and instruct | reply and instruct enqueue a prompt into the thread chat under inbox-reply-threadId-n and inbox-instruct-threadId-ts; text is capped at 8000 characters | src/server/ws-router-inbox.ts |
| inbox.jsonl | IN/OUT | Append-only InboxEvent log under the data dir, replayed at boot, capped at 2000 live records with unread threads younger than seven days always kept | Compaction rewrites the file only at boot and keeps the last inbox_all_read | src/server/inbox/inbox-log.adapter.ts |
| onNeedsYou | OUT | Fires once when a thread enters needs_you, by report, by notify-mode escalation or by the turn-end fallback | The only signal the notification layer consumes | src/server/inbox/inbox-registry.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| CLAUDE.md Inbox section | c3-247 Contract | Wording is free; the one-chat-per-thread, draft-only and fallback invariants must survive | CLAUDE.md |
| Inbox page and notifications | c3-247 Contract | Presentation is free; it must read the inbox topic and send the six commands | src/shared/protocol.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| A webhook delivery changes its schedule id and queue replay duplicates a prompt | Editing inboundScheduleId | The webhook delivery test pins webhook-hookId-deliveryId | bun test --conditions production src/server/webhooks/webhook-delivery.test.ts |
| A chat reports on a thread it does not handle | Removing the bound-chat check in report | The registry test refuses a report from another chat | bun test --conditions production src/server/inbox/inbox-registry.test.ts |
| A handler that never reports leaves a thread silent forever | Removing the turn-end subscription | The registry test escalates a pending thread when its chat's turn ends | bun test --conditions production src/server/inbox/inbox-registry.test.ts |
| The inbox log grows without bound | Removing the cap or the boot compaction | The registry test keeps 2000 records and rewrites the log | bun test --conditions production src/server/inbox/inbox-registry.test.ts |
