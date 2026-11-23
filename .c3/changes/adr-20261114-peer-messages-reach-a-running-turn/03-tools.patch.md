---
target: c3-249
scope: block
base: c3-249#n14778@v1:sha256:fc134c0d85cbf85a499800512fbd3247c5ec793383baac5f47966ebe75860072
---
| list_peer_chats, send_chat_message and wait_for_chat_message | IN | Defined once in tool-specs.schema.ts; Claude registers them through kanna-mcp for the main chat and for Claude subagents, Codex receives them as dynamicTools on thread/start only | A Codex chat started before a tool existed keeps its thread without it because thread/resume and thread/fork carry no dynamicTools of their own; Codex subagents get none | src/shared/peer-messaging/tool-specs.schema.ts |
