---
target: c3-211
scope: insert
base: c3-211#n10710@v1:sha256:49cd99efdf7e7789e9849a831cd15dc8f65d37b403a3b5f5eb5db10b42ea8dd8
---
| Alternate — no tool declaration | The protocol offers no way to give Codex a tool: `ThreadStartParams` carries no `mcpServers`, `TurnStartParams` no `tools`, and an unrecognised `item/tool/call` is answered `Unsupported dynamic tool call`. `developerInstructions` is therefore the ONLY per-session injection point, and it is how c3-210 delivers the local skill roster — naming each absolute `SKILL.md` path, which the thread can read because it runs `approvalPolicy: "never"` with `sandbox: "danger-full-access"`. See adr-20260905-provider-agnostic-slash-commands | c3-210 |
