---
target: c3-203
scope: insert
base: c3-203#n11158@v1:sha256:ac348c190b5819a67bd7ce1ac9cd2e09a6ee93b7489ea94b6cda6bd62f17c034
---
| Password brute force | Sign-in bypasses the Better Auth handler, or forwarded IP headers trusted from a non-loopback peer | Repeated wrong passwords never return 429 | bun run test src/server/auth.test.ts |
