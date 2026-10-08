---
target: c3-226
scope: block
base: c3-226#n12113@v1:sha256:5e7cc03db404779df42a2219eb3b563171827631642b8b39c308fdce93fb89b5
---
| validate_mermaid tool | OUT | Takes one source (a diagram without its ``` fence) and answers VALID, or isError: true carrying the offending line, mermaid's caret excerpt and an actionable hint (formatMermaidDefect). isError is deliberate — it is what makes the model treat the reply as work to redo rather than a note. Registered by buildValidateMermaidToolList whenever a chatId is present, so subagents get it too; one tool() call registers it on the in-process server. Backed by KannaMcpArgs.parseMermaid, defaulting to mermaid-parse.adapter.ts — the only server module that loads mermaid, which installs a measured-minimum DOM shim ONLY around await import("mermaid") and restores it in a finally, standing down entirely when a real document already exists. Read-only: not gated by KANNA_MCP_TOOL_CALLBACKS and does not touch the durable approval protocol | c3-114 | src/server/kanna-mcp.ts, src/server/mermaid-parse.adapter.ts, src/shared/mermaid-validate.ts |
