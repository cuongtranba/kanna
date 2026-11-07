---
target: c3-247
scope: block
base: c3-247#n14449@v1:sha256:94a1281cb189dd2c7e8f443d1daeb3302a5cc1bf9dadf40fca9d03821e5f20fc
---
| Consumers | c3-243 webhooks delivers through deliverInbound; c3-208 ws-router serves the inbox topic and the fifteen inbox commands; c3-248 mcp-sources supplies the callTool and rememberKey the outbox sends through; c3-226 kanna-mcp-host registers the inbox_report tool for main chats; c3-246 service-bus is the feed. |
