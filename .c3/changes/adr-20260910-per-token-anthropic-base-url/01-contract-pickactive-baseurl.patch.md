---
target: c3-224
scope: block
base: c3-224#n11458@v1:sha256:428766414fffc747e48c1e887e0dc1c03cca54f0226a64fc6c0960d8c4663716
---
| pickActive(reservedFor?) | OUT | Returns the LRU-eligible token for caller, binds reservation under refcounted Set<chatId>. A token admits up to tokenCap(token) distinct chats (per-token maxConcurrent or ClaudeAuthSettings.concurrencyDefault, routed through the shared clampTokenConcurrency — rounded, floored at 1, no ceiling). Re-entrant pickActive returns the caller's already-owned token; otherwise spreads load by owner-count ASC then LRU. Revives expired-limited tokens. Null when none eligible. The returned entry also carries the token's OPTIONAL baseUrl, the Anthropic endpoint that credential authenticates against; callers narrowing this port must carry it beside the token, since the endpoint belongs to the credential and one pool may hold both direct and proxied tokens. Absent baseUrl means the spawn inherits whatever ANTHROPIC_BASE_URL is ambient. | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
