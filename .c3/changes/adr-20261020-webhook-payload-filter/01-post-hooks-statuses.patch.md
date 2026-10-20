---
target: c3-243
scope: block
base: c3-243#n13984@v1:sha256:5847f925d22f0b01e11742131d73ad20bd049bd5356bd5571587438bc72aca06
---
| POST /hooks/id | IN | Bearer secret or X-Hub-Signature-256 HMAC over the raw body; answers 202 with the delivery id, 200 filtered, 200 duplicate, 401, 404, 405, 409, 413, 429 | Unknown, disabled and globally disabled hooks all answer 404 so the response does not reveal which hooks exist. The body cap is 256 KiB. | src/server/webhooks/webhook-http-routes.ts |
