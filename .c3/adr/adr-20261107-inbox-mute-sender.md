---
id: adr-20261107-inbox-mute-sender
c3-seal: 7f925cffd664f18278a4ff8fe5416b335fd7c81fad09765f295aa3bb7af969a8
title: inbox-mute-sender
type: adr
goal: 'Let the user mute one sender within one inbound source, so that sender''s messages are still recorded in their Inbox thread but are never handled: no handler turn, no chat card, no needs_you escalation or push, no unread count and no Inbox-tab entry, while every other sender on that source keeps working.'
status: done
date: "2026-11-07"
---

## Goal

Let the user mute one sender within one inbound source, so that sender's messages are still recorded in their Inbox thread but are never handled: no handler turn, no chat card, no needs_you escalation or push, no unread count and no Inbox-tab entry, while every other sender on that source keeps working.

## Context

A noisy contact on a shared source (one Zalo contact on the Zalo MCP source, one sender on a webhook) today forces the user to disable the whole source or archive the thread after every message, because each new message resets the thread to new and unread and queues a handler turn. The Inbox (c3-247) owns threads, read state and verdicts as an event-sourced projection over inbox.jsonl, and deliverInbound is the one delivery path for every inbound source, so both the state and the gate have a single natural owner. A sender is the display string the source reports through senderPath, not a stable id.

## Decision

Mute state is an Inbox event, inbox\_sender\_muted with sourceKind, sourceId, sender and muted, replayed by the projection into a set of muted sender keys; every thread carries a derived muted flag. deliverInbound records the message and returns ok without a chat when the thread is muted, so the MCP cursor advances and webhooks still answer 202. A muted thread stays read, leaves the Inbox tab, never fires onNeedsYou, and the autopilot treats it as paused. Compaction keeps every mute event so replay stays faithful. The user toggles it with the inbox.muteSender command from the thread. Settings were rejected because an mcpSources edit restarts the MCP connection and webhook config needs four whitelists, and the decision belongs next to read and archive state.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-247 | component | Gains the mute event, the derived muted flag, the deliverInbound short-circuit, the inbox.muteSender command and the autopilot pause on muted threads | c3-247#n14446@v1:sha256:30f67bf26887838edad896c3a7809a4d34d89a39497d5a318cd6643b3be839cc | ref-event-sourcing: the mute is an appended event replayed at boot; ref-strong-typing: the event is parsed with zod |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/inbound src/server/inbox src/shared/inbox src/client/lib | deliver-inbound and inbox-registry tests prove a muted sender is recorded but not handled, survives restart and compaction, and stays read |
| bun run check | lint, types, comment lint and client build pass |
| bun run check:arch | architecture ratchets pass |
