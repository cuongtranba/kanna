---
target: c3-226
scope: block
base: c3-226#n12087@v1:sha256:b5f7018eb7865fd42a5003ba957fce5a19379d3abfbdaeb1b48066f09e79c5aa
---
| Alternate — feature flag off | Default KANNA_MCP_TOOL_CALLBACKS=0: native built-ins handle reads/writes, AskUserQuestion and ExitPlanMode take the legacy canUseTool → onToolRequest path, and the eight built-in shims are not registered; delegate_subagent stays active | N.A - documented in CLAUDE.md "Tool Callback Feature Flag" |
