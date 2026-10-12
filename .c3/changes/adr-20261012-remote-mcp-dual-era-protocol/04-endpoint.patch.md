---
target: c3-242
scope: block
base: c3-242#n13335@v1:sha256:fc5bf3a0428eafaef46f31ad9ef021bd4a9c20c5710902e36aef01f645b13756
---
| /mcp endpoint | IN | Streamable HTTP through createMcpHandler from @modelcontextprotocol/server 2.x; a 2026-07-28 request (server/discover, per-request _meta) is served statelessly, a 2025-era request including initialize is served by the stateless legacy fallback from the same factory, GET and DELETE answer 405, and no Mcp-Session-Id is issued | c3-202 | src/server/remote-mcp/remote-mcp-boot.ts, src/server/remote-mcp/remote-mcp-http-routes.ts |
