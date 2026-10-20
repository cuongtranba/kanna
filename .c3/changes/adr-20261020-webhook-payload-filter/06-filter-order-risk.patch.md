---
target: c3-243
scope: insert
base: c3-243#n14016@v1:sha256:08bce9c065e4e7172ccbbf354b900aaff1d11e7bf0aca569f95ad400a30bd94e
---
| A filtered delivery burns its delivery id or a rate-limit token, so Redeliver after a filter fix answers duplicate and noise starves matching events | Moving the filter check after claimDelivery or takeToken in handleWebhookRequest | The redelivery-after-filter-change and the filtered-noise rate-limit route tests fail | bun test --conditions production src/server/webhooks/webhook-http-routes.test.ts |
