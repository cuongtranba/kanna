---
target: c3-226
scope: block
base: c3-226#n12111@v1:sha256:36db5e30091ec9c4e920ffd93e998ecb16d02d6512937f578a995e9943fb883c
---
| Per-run path-deny scope | IN | KannaMcpArgs.restrictedAllowedPaths threads through the kanna-mcp host into every shim ctx (ToolHandlerContext.restrictedAllowedPaths) and onto ToolCallbackSubmitArgs / EvaluateArgs; permission-gate.policy.evaluate auto-denies any read/write/bash path resolving outside the listed roots; lifetime is the subagent run (cleared with the spawn) | c3-210 | src/server/kanna-mcp.ts, src/server/permission-gate.ts, src/server/tool-callback.ts |
