---
target: c3-126
scope: insert
base: c3-126#n12016@v1:sha256:3eefe67ad0a2c5dc3ae8b03a0dc7904c1c9949976b9c070d22c466ad46cafed5
---
| A snoozed thread shows in the Inbox views, or the snooze sends a time other than the one shown | Dropping the snoozed check from inboxTab or the Snoozed filter, or computing the presets again at click time | The filter test hides a snoozed thread from every Inbox filter but Snoozed, and the thread detail test sends inbox.snooze for the chosen preset | bun run test src/client/lib/inboxFilter.test.ts src/client/app/InboxThreadDetail.test.tsx src/client/lib/inboxActions.test.ts |
