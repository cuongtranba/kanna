---
target: c3-206
scope: insert
base: c3-206#n9616@v1:sha256:bd01395fe5af85151f37ec061b1aefcc00d0878e971eb473a3e16365a139030c
---
| Queued message silently drops a dispatch field | buildEnqueueMessageResult enumerating QueuedChatMessage field by field instead of spreading the caller's message; an omitted optional property is not a type error, so neither compile nor runtime signals the loss | The builder owns only id, createdAt and the defensive attachments copy and spreads the rest; a round-trip test asserts every dispatch field survives enqueue and reload | bun test src/server/event-store-write-ops.test.ts src/server/event-store.test.ts |
