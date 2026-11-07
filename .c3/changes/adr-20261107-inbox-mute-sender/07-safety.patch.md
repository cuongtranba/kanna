---
target: c3-247
scope: insert
base: c3-247#n14474@v1:sha256:1b71077c46be74c9e85fd1d39d29e9ad4271d3391fc7af5c534824e781034609
---
| A muted sender is handled, or its muted messages return unread after a restart | Dropping the muted check in deliverInbound, or compacting away an earlier mute event | The delivery test records a muted message without a turn or card, and the registry test keeps a muted message read across unmute, compaction and restart | bun run test src/server/inbound/deliver-inbound.test.ts src/server/inbox/inbox-registry.test.ts |
