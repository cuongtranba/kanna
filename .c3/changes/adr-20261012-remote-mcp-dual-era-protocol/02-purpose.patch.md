---
target: c3-242
scope: block
base: c3-242#n13307@v1:sha256:1efa3dc8b93fbd509e939799baa9bfe14e8b4a9c8566fe82ef45d83ba842e4da
---
Owns the remote MCP surface: the /mcp endpoint, a stateless createMcpHandler that serves MCP 2026-07-28 and 2025-era clients from one per-request server factory, the bearer verifier that accepts an OAuth access token or the launch password, the allowlisted mount of Better Auth's OAuth endpoints with client-IP header stripping, the server-rendered login and consent pages, the generic parity tools (kanna_commands, kanna_command, kanna_read) backed by a typed command catalog, the typed intent tools, the resources, and the remoteMcp settings. Every tool runs through router.dispatchCommand or router.readSnapshot so WebSocket clients still see the broadcasts. Non-goals: password verification and rate limiting (c3-203 and Better Auth own them), the in-process MCP server Claude sessions attach to (c3-226), per-user accounts, MCP sessions and server-initiated notifications, and any route outside the allowlist.
