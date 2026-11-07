---
target: c3-247
scope: block
base: c3-247#n14433@v1:sha256:393da3c2c29265ea1add7d4c3e101682942bdc5f668512b3c0ecae30c5acfb93
---
| Consumers | c3-243 webhooks delivers through deliverInbound; c3-208 ws-router serves the inbox topic and the thirteen inbox commands; c3-248 mcp-sources supplies the callTool and rememberKey the outbox sends through; c3-226 kanna-mcp-host registers the inbox_report tool for main chats; c3-246 service-bus is the feed. |
