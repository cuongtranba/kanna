---
target: c3-242
scope: block
base: c3-242#n13351@v1:sha256:ef6e99d4a8194ed55a6b44b9a6431b5cbcd275d183a2fe380c41ff4c09e56a75
---
| Protocol era dropped | The handler is replaced by one that speaks only 2025-era initialize, or legacy serving is set to reject | The routes test connects a 2026-07-28 client and asserts the modern era, and the 1.x client tests still list and call tools | bun run test src/server/remote-mcp/remote-mcp-http-routes.test.ts |
