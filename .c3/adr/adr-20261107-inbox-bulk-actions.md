---
id: adr-20261107-inbox-bulk-actions
c3-seal: 10c815e7a6ab2e6c8f2e6b4fcc622ce007ea244edceae020f87dd8f803bdfd06
title: inbox-bulk-actions
type: adr
goal: 'Let the user triage many Inbox threads quickly: mark a thread unread again, select several threads and act on them at once, archive with an Undo that restores the thread exactly, and read a message in full instead of its 160-character preview.'
status: done
date: "2026-11-07"
---

## Goal

Let the user triage many Inbox threads quickly: mark a thread unread again, select several threads and act on them at once, archive with an Undo that restores the thread exactly, and read a message in full instead of its 160-character preview.

## Context

The Inbox (c3-247) is an event-sourced projection over inbox.jsonl. Reading a thread marked it read for good, archive was one thread at a time and final, and a message was stored only as a 160-character preview, so a long message could not be read in the thread. Every one of these belongs to the same projection and the same command set, so they ship together.

## Decision

Mark unread extends inbox\_thread\_read with an optional read flag that defaults to true, so persisted logs replay unchanged, rather than adding an event with the opposite meaning. Archive stays one event per thread, but the inbox.archive command takes threadId or threadIds, both optional, because remote MCP callers already send threadId. Unarchive is a new event; the projection remembers each thread state and unread flag at archive time and restores exactly that, so the restore rule is defined once and needs no new persisted field. An inbound message gains an optional text, computed once on ingest by the same extractor as the preview, capped, and kept only when it differs from the preview. On the client the open thread is not re-marked read after the user marks it unread until the selection changes, the selection lives in the inbox store and is pruned to the visible threads, and the Undo toast goes through runPendingAction.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-247 | component | Gains the markUnread and unarchive commands, the optional read flag, the remembered archive state, multi-thread archive and the full message text | c3-247#n15615@v1:sha256:708fedcbacaa5b24fb66951f2e9b3c6209e3bb0b19f1bf0395692b4025e55279 | ref-event-sourcing: the new state is an appended event replayed at boot; ref-strong-typing: the event and the text are parsed with zod |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/inbox src/shared/inbox src/client/app/Inbox src/client/lib src/client/stores/inboxStore | the registry tests prove mark unread, the exact restore after unarchive and a restart, and the full text; the client tests prove bulk archive sends one command, Undo unarchives each thread and an unread mark survives opening the thread |
| bun run check | lint, types, comment lint and client build pass |
| bun run check:arch | architecture ratchets pass |
