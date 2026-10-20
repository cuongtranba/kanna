---
target: c3-243
scope: block
base: c3-243#n13990@v1:sha256:73b92e16d3e61537482be8e0d2c86fd4d3e91f3c2870a5153c2b9b84fea5483e
---
| Delivery path | OUT | deliverWebhook maps a hook to an InboundDelivery and calls deliverInbound (c3-247), which publishes the inbound envelope, upserts the inbox thread keyed by threadKeyPath or the delivery id, and appends the handler instruction to the queued prompt | The webhook_delivery card and the webhook-hookId-deliveryId schedule id are unchanged; threadKeyPath, senderPath, replyHint and filter are stored hook fields carried by parseStoredWebhook, the registry and the WS sanitizers, and a null patch clears each | src/server/webhooks/webhook-delivery.ts |
