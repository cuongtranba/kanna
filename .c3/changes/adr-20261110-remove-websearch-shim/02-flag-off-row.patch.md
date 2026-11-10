---
target: c3-226
scope: block
base: c3-226#n13458@v1:sha256:0c6d498923de9c5698957c24521b7f28a354f97e9c19407fa3d152b204a21e8c
---
| Alternate — feature flag off | Default KANNA_MCP_TOOL_CALLBACKS=0: native built-ins handle reads/writes, AskUserQuestion and ExitPlanMode take the legacy canUseTool → onToolRequest path, and the seven built-in shims are not registered; delegate_subagent stays active | N.A - documented in CLAUDE.md "Tool Callback Feature Flag" |
