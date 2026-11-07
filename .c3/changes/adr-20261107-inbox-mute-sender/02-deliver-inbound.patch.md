---
target: c3-247
scope: block
base: c3-247#n14446@v1:sha256:5eb479aae315bdc30c5d43bffa3e2de572e696a55673cd581a020947b110a1d2
---
| deliverInbound | IN | Publishes the inbound envelope, upserts the thread, resolves the handler chat (notify none, inline fixed, spawn one chat per thread created on first message and renamed source and sender), appends the card, queues the handler prompt under scheduleId webhook-hookId-deliveryId or mcp-sourceId-deliveryId and marks the thread pending; when the thread is muted it stops after the upsert and returns ok without a chat | A webhook delivery keeps its webhook_delivery card and schedule id unchanged; an MCP delivery appends an inbound_delivery card that stays out of share links; a muted delivery is recorded but gets no chat, card, prompt or escalation, so the MCP cursor still advances | src/server/inbound/deliver-inbound.ts |
