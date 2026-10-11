---
target: c3-203
scope: insert
base: c3-203#n11191@v1:sha256:14efcd95284aa69fd58ce5cf5765f4ba8c70c8c415e7c8ccb4e85252711ca621
---
| Forged client IP evades the OAuth rate limits | A route forwards a client-supplied x-kanna-client-ip to Better Auth, which rate-limits on that header | Eight registrations with eight forged addresses never return 429 | bun run test src/server/remote-mcp/remote-mcp-http-routes.test.ts |
