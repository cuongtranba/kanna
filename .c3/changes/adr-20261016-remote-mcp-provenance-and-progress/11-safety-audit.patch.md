---
target: c3-242
scope: insert
base: c3-242#n13644@v1:sha256:33024f72476a60363416b4f513fa06aa3a9a24373921911341a8806805786859
---
| Audit record leaks or blocks | An argument bypasses redactSecrets or truncation, or a write failure is allowed to reach the tool | A secret appears in remote-mcp-calls.jsonl or a tool call fails when the disk is full | bun run test src/server/remote-mcp/remote-mcp-audit-log.test.ts src/server/remote-mcp/remote-mcp-tools.test.ts |
