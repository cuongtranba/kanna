---
target: c3-226
scope: block
base: c3-226#n13706@v1:sha256:2a86535bddd9cf79d4b1c73cbce794ef8ae44608097e9caf34ce52a1a0cb6f2b
---
| Per-run path-deny scope | IN | KannaMcpArgs.restrictedAllowedPaths threads through the kanna-mcp host into the beacon approval context and onto ToolCallbackSubmitArgs / EvaluateArgs; permission-gate.policy.evaluate auto-denies any path resolving outside the listed roots; lifetime is the subagent run (cleared with the spawn) | c3-210 | src/server/kanna-mcp.ts, src/server/permission-gate.ts, src/server/tool-callback.ts |
