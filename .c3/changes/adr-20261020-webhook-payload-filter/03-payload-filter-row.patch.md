---
target: c3-243
scope: insert
base: c3-243#n13990@v1:sha256:d0344f5c1df71f2baa2116a5704defd38ec53c33b7aabb1d465bd1b2a822f9a0
---
| Payload filter | IN | An optional YAML filter: on names events from X-GitHub-Event with optional types matched against body.action, and if is a CEL condition over body, event and headers that must be true; a non-match answers 200 filtered and records the reason as the last delivery | Checked after authentication and before the delivery-id claim and the rate-limit token. A CEL error is a non-match, and a stored filter that no longer compiles filters every delivery. yaml and @bufbuild/cel are server-only. | src/server/webhooks/webhook-filter.ts |
