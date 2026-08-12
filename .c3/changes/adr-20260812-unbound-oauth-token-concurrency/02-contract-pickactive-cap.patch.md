---
target: c3-224
scope: block
base: c3-224#n9663@v1:sha256:273040346cdf0f26dd51d3dd18b4b87459bc7bcf88001669bf4f24692f6f4c9c
---
| pickActive(reservedFor?) | OUT | Returns the LRU-eligible token for caller, binds reservation under refcounted Set<chatId>. A token admits up to tokenCap(token) distinct chats (per-token maxConcurrent or ClaudeAuthSettings.concurrencyDefault, routed through the shared clampTokenConcurrency — rounded, floored at 1, no ceiling). Re-entrant pickActive returns the caller's already-owned token; otherwise spreads load by owner-count ASC then LRU. Revives expired-limited tokens. Null when none eligible. | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
