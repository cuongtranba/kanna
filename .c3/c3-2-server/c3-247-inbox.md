---
id: c3-247
c3-seal: 6d3c46fdfb0217df175b7f1296aa6bda8ba37f8a5bb8e9b5f9d16eb91d4df1ed
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
| Consumers | c3-243 webhooks delivers through deliverInbound; c3-208 ws-router serves the inbox topic and the twelve inbox commands; c3-248 mcp-sources supplies the callTool and rememberKey the outbox sends through; c3-226 kanna-mcp-host registers the inbox_report tool for main chats; c3-246 service-bus is the feed. |
| Boundary | Owns threads, outbound messages, activity items, verdicts, read state and the reply and instruct prompts. It does not own chat state, the queue or any source credential; it calls EventStore and AgentCoordinator through narrow Pick types. |

## Purpose

Owns the inbox feature: the InboxRegistry projection over an append-only inbox.jsonl log, threads keyed by source and thread key with one handler chat per thread, the activity items derived from every internal bus envelope, the inbox_report MCP tool through which the handler chat records a verdict and a draft, the fallback that marks a thread needs_you when its handler turn ends without a report, and the reply and instruct prompts the user sends from the Inbox. The InboxOutbox is the one owner of direct outbound sends: when a source declares a reply target it resolves the arguments, records the message as queued, calls the source's reply tool through the runner and records sent, failed or unknown. deliverInbound is the one delivery path for every inbound source. Autonomy: the handler chat can propose a send through inbox\_report, and the autonomy decision plus the autopilot decide whether the proposal becomes a draft, an approval card or a delayed auto-send with Undo; a human send pauses the agent on the thread. Non-goals: it does not call a source tool except through the outbox, never resends on its own, never lets an agent turn send, does not render the page, and does not decide push or toast; it only fires onNeedsYou.

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
| inbox_report tool | IN | thread_id, verdict needs_you or fyi or handled, summary up to 600 characters, optional draft_reply up to 4000, asked for on needs\_you only, and optional propose\_send with text up to 8000 characters, confidence from 0 to 1 and a reason up to 300 characters; accepted only from the thread's bound chat and only for main chats | A report never sends anything to the sender; a report from another chat is refused; a non-empty draft\_reply also appends inbox\_thread\_draft\_added; propose\_send is the only way an agent asks for a send and is handed to the autopilot, which decides | src/server/kanna-mcp-inbox.ts |
| inbox topic and commands | OUT | InboxSnapshot with threads, items, unreadCount and total; commands markRead, markAllRead, archive, page, reply, instruct, retrySend, approveProposal, rejectProposal, cancelProposal, setThreadAutonomy and resumeAgent | reply answers direct with an outboundId when the source has a reply target and agent with a chatId otherwise; reply and instruct enqueue a prompt into the thread chat under inbox-reply-threadId-n and inbox-instruct-threadId-ts; instruct takes the instruction text and an optional current draft and asks the agent for a draft, never a send, and refuses an archived thread; text is capped at 8000 characters | src/server/ws-router-inbox.ts |
| inbox.jsonl | IN/OUT | Append-only InboxEvent log under the data dir, replayed at boot, capped at 2000 live records with unread threads younger than seven days always kept | Compaction rewrites the file only at boot and keeps the last inbox_all_read | src/server/inbox/inbox-log.adapter.ts |
| InboxOutbox | IN/OUT | send(threadId, text) validates the text, resolves the source reply arguments against the latest inbound payload, appends inbox_thread_outbound_queued, calls the tool without blocking the command and appends inbox_thread_outbound_settled; retry(threadId, outboundId, confirmDuplicate) re-sends the same text as a new outbound | failed means nothing was sent or the tool rejected the call, unknown means the request may have gone out; only sent sets the thread to replied; a pending outbound at boot settles unknown and is never resent; a retry of unknown needs confirmDuplicate | src/server/inbox/inbox-outbox.ts |
| Draft versions | IN/OUT | InboxThread.drafts keeps at most five drafts, oldest first, each with id, text, at, origin triage or ask and the instruction that asked; inbox\_thread\_draft\_added appends one when a report carries a draft, and inbox\_thread\_pending carries the instruction of an ask | A new inbound message keeps the drafts and deletes the report; the origin is ask only when the pending schedule id is an instruct id | src/server/inbox/inbox-projection.ts |
| Autonomy decision | IN/OUT | decideProposal maps the effective level (the thread override, else the source level), the provider ceiling, the pause and the guardrails to draft, approval or auto. A paused thread gets a draft at any level. off and suggest save a draft with origin proposal; approve opens an approval card; auto sends only when every guardrail passes, otherwise it opens an approval card whose blockedBy names the first failing rule in the order provider, allowlist, confidence threshold, thread hourly cap, source daily cap, quiet hours, text filter | A source without a reply target only ever drafts; the caps count agent outbound on the thread and the source and undercount after the outbound list is trimmed; the text filter flags URLs, markdown links and images, HTML and text over maxChars | src/server/inbox/inbox-autonomy.ts |
| Autopilot | IN/OUT | An auto decision stores the proposal as scheduled with scheduledFor and arms an in-memory timer through an injected clock; on fire it re-checks that the proposal is still scheduled and the thread is not paused, sends by agent with the proposal id, confidence and reason, and resolves it sent; cancelProposal is Undo and clears the timer | Fire and Undo race on an in-memory claim so exactly one wins; the claim is not taken in the registry write lane because the outbox flush runs inside it; a new inbound message or a newer proposal expires the open or scheduled proposal | src/server/inbox/inbox-autopilot.ts |
| Restart rule | IN | At boot every scheduled proposal becomes an open approval card with blockedBy Kanna restarted before the auto-send | A restart never auto-sends; the timer is not persisted | src/server/inbox/inbox-registry.ts |
| Takeover pause | IN/OUT | A direct send by you and approveProposal call autopilot.takeOver, which rejects or cancels the thread proposal and pauses the agent for 30 minutes; resumeAgent clears the pause; typing never pauses | The pause is a per-thread timestamp, so the agent can still read and report while paused but only drafts | src/server/inbox/inbox-boot.ts |
| Handler turn kinds | OUT | inboxHandlerTurnKind maps a schedule id to triage (webhook- and mcp- prefixes), ask (inbox-instruct-) or agent-reply (inbox-reply-); c3-210 reads it to deny Bash and the reply server's tools in triage and ask turns | agent-reply is the legacy path for sources without a reply target and stays unrestricted | src/shared/inbound/handler-turn.ts |
| onNeedsYou | OUT | Fires once when a thread enters needs_you, by report, by notify-mode escalation or by the turn-end fallback | The only signal the notification layer consumes | src/server/inbox/inbox-registry.ts |
| referencedChatIds | OUT | Every chat id named by an MCP source handler, a webhook, an inbox thread binding or an inbox report, read on each prune | The empty-chat pruner never deletes a chat in this set, so a handler chat created ahead of its first delivery survives | src/server/inbound/referenced-chat-ids.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| CLAUDE.md Inbox section | c3-247 Contract | Wording is free; the one-chat-per-thread, no-agent-send-in-handler-turns and fallback invariants must survive | CLAUDE.md |
| Inbox page and notifications | c3-247 Contract | Presentation is free; it must read the inbox topic and send the twelve commands | src/shared/protocol.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| A webhook delivery changes its schedule id and queue replay duplicates a prompt | Editing inboundScheduleId | The webhook delivery test pins webhook-hookId-deliveryId | bun test --conditions production src/server/webhooks/webhook-delivery.test.ts |
| An outbound send is delivered twice | Resending a pending outbound at boot, or retrying an unknown one without confirmDuplicate | The outbox test settles a pending outbound as unknown on restart and refuses an unconfirmed retry | bun run test src/server/inbox/inbox-outbox.test.ts |
| A chat reports on a thread it does not handle | Removing the bound-chat check in report | The registry test refuses a report from another chat | bun test --conditions production src/server/inbox/inbox-registry.test.ts |
| An auto-send goes out after a restart or after the user took over | Arming from the log at boot, or skipping the pause check on fire | The autopilot test turns a scheduled proposal into an open card on restart and expires a proposal when the thread was paused | bun run test src/server/inbox/inbox-autopilot.test.ts |
| An agent sends past the guardrails | Reordering decideProposal or letting a guardrail default to pass | The autonomy test names the first failing guardrail for each rule | bun run test src/server/inbox/inbox-autonomy.test.ts |
| A handler that never reports leaves a thread silent forever | Removing the turn-end subscription | The registry test escalates a pending thread when its chat's turn ends | bun test --conditions production src/server/inbox/inbox-registry.test.ts |
| The inbox log grows without bound | Removing the cap or the boot compaction | The registry test keeps 2000 records and rewrites the log | bun test --conditions production src/server/inbox/inbox-registry.test.ts |
