---
target: c3-210
scope: insert
base: c3-210#n6548@v1:sha256:9caa2f05f7b78474257732ea24b5680be948e38d3f068332a428e8551e0319fa
---
| describeUnknownSubagent(requested) | IN | Builds the UNKNOWN_SUBAGENT error text from the LIVE settings snapshot (each subagent as "name [id=...]", manual-trigger entries annotated, empty roster points at Settings) so the model self-corrects on retry even when the spawn-time system-prompt roster is stale; consumed by delegateRun's UNKNOWN_SUBAGENT failRun and the delegate tool's pre-delegation rejection | c3-226 | src/server/subagent-orchestrator.ts, src/server/kanna-mcp-tools/delegate-subagent.ts |
