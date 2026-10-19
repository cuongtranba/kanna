---
target: c3-242
scope: insert
base: c3-242#n13644@v1:sha256:33024f72476a60363416b4f513fa06aa3a9a24373921911341a8806805786859
---
| Duplicate work from a retry | send_message, kanna_command chat.send or enqueue_message bypasses the guard, or the guard stops reserving before the dispatch resolves | A retried or overlapping identical request starts a second chat or queues a second copy | bun run test src/server/remote-mcp/remote-mcp-send-guard.test.ts |
