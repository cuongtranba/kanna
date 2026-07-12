---
target: c3-210
scope: block
base: c3-210#n6547@v1:sha256:edfe71da9a694d6d1d05a6caba881976a3ed576c1e0244ae63253eda90947eab
---
| findSubagent(id) | IN | Snapshot lookup (by exact id, else unambiguous exact name) used by the MCP host to reject keep_alive for non-claude subagents, and by the delegate tool to reject an unresolvable subagent_id BEFORE delegateRun so no ghost failed-run record is persisted for a guessed id | c3-226 | src/server/subagent-orchestrator.ts, src/server/kanna-mcp-tools/delegate-subagent.ts |
