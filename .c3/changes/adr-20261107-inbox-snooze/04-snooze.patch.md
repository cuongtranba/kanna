---
target: c3-247
scope: insert
base: c3-247#n14542@v1:sha256:708fedcbacaa5b24fb66951f2e9b3c6209e3bb0b19f1bf0395692b4025e55279
---
| Snooze and its wake timer | IN/OUT | inbox\_thread\_snoozed with an until time sets InboxThread.snoozedUntil and inbox\_thread\_unsnoozed with the reason time, message or user clears it; a snoozed thread leaves inboxTab and the unread count while its own unread flag is kept; waking by time marks the thread unread unless its sender is muted; startInboxSnoozeWaker arms one timer for the earliest snooze through the injected AutopilotClock, re-arms after every change and wake, clamps the delay to the timer limit, and at start wakes every snooze already due before arming the rest | Only a thread that is new, needs\_you or fyi can be snoozed; a new message, a handled report, a reply, a sent outbound and archive each end the snooze; a message into a snoozed thread also records the message reason; raisesNotification is needs\_you and not snoozed, so a report during a snooze is silent and the wake fires onNeedsYou once; snooze refuses an until time that is not in the future | src/server/inbox/inbox-snooze-waker.ts |
