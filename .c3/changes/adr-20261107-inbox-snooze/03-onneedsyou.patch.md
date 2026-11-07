---
target: c3-247
scope: block
base: c3-247#n14539@v1:sha256:aa0a6faa2103b2c4b99c93a828a41a30b54508eb2a6daf59286afb70e70c9eaa
---
| onNeedsYou | OUT | Fires once when a thread enters needs_you, by report, by notify-mode escalation, by the turn-end fallback or when a snoozed thread in needs\_you wakes by time | The only signal the notification layer consumes; a report that lands on a snoozed thread stays silent until the wake raises it once | src/server/inbox/inbox-registry.ts |
