---
target: c3-242
scope: insert
base: c3-242#n13633@v1:sha256:8442b1609973b02dfa862a47ed26baba47e02628b9ef9f7eb75e0df8b3fd6fa5
---
| Connection hold | OUT | After bearer verification the route asks Bun to extend the request idle timeout to 130 seconds, because Bun.serve closes a silent response after 10 seconds by default and a Cloudflare tunnel after 125 | c3-202 | src/server/remote-mcp/remote-mcp-http-routes.ts, src/server/remote-mcp/remote-mcp-boot.ts, src/server/http-dispatcher.ts |
