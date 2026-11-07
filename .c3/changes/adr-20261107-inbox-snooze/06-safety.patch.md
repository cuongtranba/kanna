---
target: c3-247
scope: insert
base: c3-247#n14559@v1:sha256:928df37f6b5fd467a4887d5803c9cc0dd3a460136cd60bb7816c064ebffca52d
---
| A snoozed thread never returns, returns twice or notifies while it sleeps | Dropping the re-arm after a wake, arming at boot without waking what is already due, or firing needs-you from a report during a snooze | The waker test wakes at the time as unread and fires needs-you once, wakes a past-due snooze at boot and arms a future one after a restart, and the registry test shows a new message, archive and unsnooze each end the snooze | bun run test src/server/inbox/inbox-snooze-waker.test.ts src/server/inbox/inbox-registry.test.ts |
