---
target: c3-206
scope: insert
base: c3-206#n6489@v1:sha256:bd01395fe5af85151f37ec061b1aefcc00d0878e971eb473a3e16365a139030c
---
| Boot dies on an ignorable event | Replay prices an event type by a runtime-strict switch | Server exits on startup with "Unhandled replay event type" and crash-loops | bun run test src/server/event-store-helpers.test.ts src/server/event-store-snapshot.test.ts |
