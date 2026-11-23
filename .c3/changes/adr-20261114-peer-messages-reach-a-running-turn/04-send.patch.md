---
target: c3-249
scope: block
base: c3-249#n14779@v1:sha256:1a9e07c6d626d82175426ad5b2e7e32acc55e57321247d0ba3da7450bb9a90d7
---
| PeerMessenger.send | IN/OUT | Refusals in fixed order: unknown chat, self, archived, inbound refused, too large, duplicate, rate limited, queue full; otherwise hand it to a matching wait, or to the addressed running subagent run, or enqueue with a peer_chat origin, start the next queued message and, when the chat is still busy, inject it into the running turn; the result status is delivered, injected or queued | The origin is server-stamped, command-origin-stamp strips any origin a client sends, and a peer message is delivered as plain text, never parsed as a builtin or slash command | src/server/peer-messaging/peer-messenger.ts |
