---
target: c3-242
scope: insert
base: c3-242#n13633@v1:sha256:8442b1609973b02dfa862a47ed26baba47e02628b9ef9f7eb75e0df8b3fd6fa5
---
| Duplicate guard | OUT | A dedupe store created once per runtime remembers each send_message, chat.send and message.enqueue for 30 minutes (256 entries, oldest dropped first), keyed by client plus idempotency key or by client, destination and content hash; a repeat whose chat is still working, or whose queued copy is still queued, is not dispatched and follows the original with duplicate true; the slot is reserved before the dispatch resolves so overlapping calls dispatch once | c3-208 | src/server/remote-mcp/remote-mcp-dedupe.ts, src/server/remote-mcp/remote-mcp-send-guard.ts |
