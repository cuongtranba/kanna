---
id: adr-20261107-inbox-snooze
c3-seal: 9a31a6ee469717bfa60ec8397f7cc8317ae666b58b88dab56163109178bd3186
title: inbox-snooze
type: adr
goal: Let the user snooze an Inbox thread until a chosen time or until new activity, so a thread that needs them on Friday leaves the Inbox now and returns unread when it is due, including after a Kanna restart.
status: done
date: "2026-11-07"
---

## Goal

Let the user snooze an Inbox thread until a chosen time or until new activity, so a thread that needs them on Friday leaves the Inbox now and returns unread when it is due, including after a Kanna restart.

## Context

The Inbox (c3-247) had two ways to get a thread out of sight: leave it in the Inbox tab or archive it and forget it. Linear, Superhuman and Intercom treat snooze as a core triage action. The state belongs to the same event-sourced projection and command set as read state and archive, and the wake timer has the same shape as the autopilot's scheduled proposal, so both facts change together with the client page (c3-126) that offers the menu.

## Decision

A snooze is the optional InboxThread.snoozedUntil, set by inbox\_thread\_snoozed and cleared by inbox\_thread\_unsnoozed with the reason time, message or user. The projection owns the clearing rules: a new message, a handled report, a reply, a sent outbound and archive all end a snooze, so a snooze never outlives the thread being new, needs\_you or fyi, which is the only state that can be snoozed. The wake timer is a separate module that reuses the injected AutopilotClock rather than a second clock port: it arms one timer for the earliest snooze, re-arms after every registry change and wake, and at start wakes whatever is already due. Waking by time marks the thread unread and, if the thread needs you, fires onNeedsYou once; raisesNotification is needs\_you and not snoozed on both the server and the client toast diff, so a report that lands during a snooze stays silent and the wake is the one notification. snooze refuses a time that is not in the future and skips an archived thread, and the unread count skips a snoozed thread while its own unread flag is kept. On the client one menu, owned by inboxStore so the H key and the buttons share it, offers three presets and a picked time, computed once when the menu opens so the label is what is sent; the toast offers Undo through unsnooze. The touch layout of the row checkbox moves beside the avatar so the two no longer overlap.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-247 | component | Gains snoozedUntil, the two snooze events, the snooze and unsnooze commands and the wake timer that reuses the autopilot clock | c3-247#n15682@v1:sha256:b42850d563ce95fb7ecd89a391cbcf48184e94a5a8cb9944f1d320ec9bb6b3e9 | ref-event-sourcing: the snooze is an appended event replayed at boot and the clearing rules live in the pure projection; ref-strong-typing: both events are parsed with zod |
| c3-126 | component | Gains the snooze menu, the Snoozed quick filter, the H key, the snoozed notice with Unsnooze and the touch checkbox layout | c3-126#n15684@v1:sha256:630d3b5d04cd1e525d0595f919f2c0c89305e6586bd969e7571fc484f22e46e8 | ref-zustand-store: the open menu and the picked time are named store actions; rule-zustand-store: selectors stay reference-stable |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/inbox src/shared/inbox src/client/app/Inbox src/client/lib/inbox src/client/stores/inboxStore | 22 files and 206 tests pass: a snooze leaves the Inbox tab and the unread count, wakes at its time as unread with one needs-you signal, wakes a past-due snooze at boot and re-arms a future one after a restart, ends on a new message, archive or unsnooze, and refuses a past time; the Snoozed filter hides snoozed threads everywhere else; the header sends inbox.snooze and the toast Undo sends inbox.unsnooze |
| bun run test | 812 files and 9819 tests pass, one skipped |
| bun run check | lint, types, comment lint and the client build pass, and the entry bundle stays under its budget |
| bun run check:arch | architecture ratchets pass without raising a pin |
