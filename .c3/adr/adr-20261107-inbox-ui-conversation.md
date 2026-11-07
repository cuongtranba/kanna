---
id: adr-20261107-inbox-ui-conversation
c3-seal: 7320c3eebe04061b2cbff2b0c2eaf87d11e01af334b700e4cc25317482a78108
title: inbox-ui-conversation
type: adr
goal: 'Make the Inbox page work like the inbox of a chat or triage app: unread threads stand out and come first, quick filters and search narrow the list, a thread reads as a conversation, and the user can triage many threads at once from the keyboard or a bulk bar with an Undo for archive.'
status: done
date: "2026-11-07"
---

## Goal

Make the Inbox page work like the inbox of a chat or triage app: unread threads stand out and come first, quick filters and search narrow the list, a thread reads as a conversation, and the user can triage many threads at once from the keyboard or a bulk bar with an Undo for archive.

## Context

The page showed unread only as heavier text, repeated day headings because unread-first sorting was grouped by consecutive day, had no filter or search on the Inbox tab, showed each message as a 160-character preview in a flat list, and offered no mark unread, no Undo and no way to act on several threads. Slack Activity, Linear, Intercom and Superhuman all solve these with an unread marker, quick filters, a conversation view, list-level and bulk actions and single-key triage.

## Decision

Rows carry an unread dot, an initial, a relative time and a two-line summary; the Inbox tab leads with an Unread group, then day groups, narrowed by quick filters and a search box. The detail is a conversation with a sticky header holding archive, mark unread and previous and next, and the agent read pinned above the composer. New keybindings close the thread, focus search, show the shortcuts, toggle unread and check a thread; a bulk bar acts on the checked threads and archive offers Undo through the server unarchive command.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-126 | component | The tabs, thread detail and keyboard contracts change and bulk selection is added | c3-126#n15633@v1:sha256:3321a5eb0d7837a86eba644c18f9d7a89c4bba8a7bc87b5412245cbdcfd074eb | ref-zustand-store: selection, quick filter, search and the unread hold are named store actions; rule-zustand-store: selectors stay reference-stable |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/client/app/InboxPage.test.tsx src/client/app/InboxKeyboard.test.tsx src/client/lib/inboxFilter.test.ts | single day labels, quick filter and search, the cold-load skeleton, Escape, the unread hold and bulk archive with Undo pass |
| bun run check | lint, types, comment lint and client build pass |
