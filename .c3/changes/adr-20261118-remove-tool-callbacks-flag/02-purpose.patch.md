---
target: c3-226
scope: block
base: c3-226#n13670@v1:sha256:fd6a0d04832d3d2357a70bc58ed8bc678ee0e3e3c7a545161bf7992f8d2aba35
---
Owns the Kanna MCP host runtime: builds the in-process SDK MCP server
(`createSdkMcpServer`, no HTTP endpoint) that publishes `mcp__kanna__*`
tools, and runs the durable approval protocol (`tool-callback.ts`, decided by
`permission-gate.ts`) that every beacon tool call submits to before it
runs. The model's native `AskUserQuestion` and `ExitPlanMode` do not use
this protocol: they reach the UI through `canUseTool` → `onToolRequest` →
`PendingToolSlots` and are answered by `respondTool` (c3-210). The host
ships no file or shell shims; native built-ins do reads and writes.
Non-goals: turn orchestration (c3-210), Codex App Server (c3-211),
provider/model normalization (c3-212).
