---
target: c3-226
scope: block
base: c3-226#n13443@v1:sha256:b0ad5bd0027e95e1f0c79b44932523547e1529b2679c29188ab89035d732d370
---
Owns the Kanna MCP host runtime: builds the in-process SDK MCP server
(`createSdkMcpServer`, no HTTP endpoint) that publishes `mcp__kanna__*`
tools, registers the durable approval protocol used by `delegate_subagent`
(the model's native `AskUserQuestion` and `ExitPlanMode` reach the same
protocol through `canUseTool`, not through MCP stand-ins), and enforces
read/write path-deny on the seven built-in shims (`read`, `glob`, `grep`,
`bash`, `edit`, `write`, `webfetch`) gated by
`KANNA_MCP_TOOL_CALLBACKS`. Non-goals: turn orchestration (c3-210), Codex
App Server (c3-211), provider/model normalization (c3-212). The host never
performs the actual filesystem or network side-effect itself; each shim
delegates to the same node primitives the native tools would call after
the approval protocol clears.
