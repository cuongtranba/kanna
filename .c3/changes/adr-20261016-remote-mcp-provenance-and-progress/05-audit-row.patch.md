---
target: c3-242
scope: insert
base: c3-242#n13633@v1:sha256:8442b1609973b02dfa862a47ed26baba47e02628b9ef9f7eb75e0df8b3fd6fa5
---
| Tool-call audit log | OUT | Every registered tool call appends one JSON line with callId, tool, client, via, era, duration, outcome, chat and project ids and arguments passed through redactSecrets and truncated, to remote-mcp-calls.jsonl in the data directory through the StorageBackend port; the file rotates to .1 past 10 MiB, a failed write is logged and never reaches the tool, and a kanna.remote_mcp.tool_call counter carries tool, outcome and via only; resources are not audited | c3-202 | src/server/remote-mcp/remote-mcp-audit.ts, src/server/remote-mcp/remote-mcp-audit-log.ts, src/server/observability.ts |
