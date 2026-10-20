---
target: c3-243
scope: insert
base: c3-243#n13802@v1:sha256:bfdcfd1182edead3dd0ca55e2c51c6baf25c8de01b6d195bc0289f4bd3980861
---
| Delivery path | OUT | deliverWebhook maps a hook to an InboundDelivery and calls deliverInbound (c3-247), which publishes the inbound envelope, upserts the inbox thread keyed by threadKeyPath or the delivery id, and appends the handler instruction to the queued prompt | The webhook_delivery card and the webhook-hookId-deliveryId schedule id are unchanged; threadKeyPath, senderPath and replyHint are optional hook fields | src/server/webhooks/webhook-delivery.ts |
