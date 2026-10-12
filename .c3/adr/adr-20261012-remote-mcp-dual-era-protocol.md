---
id: adr-20261012-remote-mcp-dual-era-protocol
c3-seal: 0c9a21387f84c8be117a55b70abf7f1fd55d1915004469dd5f3d8494ca3cbf18
title: remote-mcp-dual-era-protocol
type: adr
goal: Serve MCP protocol revision 2026-07-28 on the remote /mcp endpoint, so that ChatGPT and any other client speaking that revision can connect, while 2025-era clients such as Claude Code, Codex and Claude Desktop keep working on the same URL. The stateful session registry on @modelcontextprotocol/sdk 1.x is replaced by createMcpHandler from @modelcontextprotocol/server 2.x, which serves both protocol eras from one per-request server factory.
status: done
date: "2026-10-12"
---

## Goal

Serve MCP protocol revision 2026-07-28 on the remote /mcp endpoint, so that ChatGPT and any other client speaking that revision can connect, while 2025-era clients such as Claude Code, Codex and Claude Desktop keep working on the same URL. The stateful session registry on @modelcontextprotocol/sdk 1.x is replaced by createMcpHandler from @modelcontextprotocol/server 2.x, which serves both protocol eras from one per-request server factory.

## Context

Adding https://kanna.lowbit.link/mcp as a custom MCP server in ChatGPT failed with "Some app settings were rejected", although OAuth discovery, dynamic client registration with ChatGPT's redirect URI, and the 401 resource_metadata challenge were all verified correct against the live host. Revision 2026-07-28 makes MCP stateless: it removes initialize and the Mcp-Session-Id header, carries the protocol version and client capabilities in every request's _meta, and requires servers to implement server/discover. ChatGPT opens with server/discover. The 1.x WebStandardStreamableHTTPServerTransport answers any non-initialize request without a session with 400 "Bad Request: Server not initialized", reproduced locally against the same transport, and no 1.x release, including 1.32.1, knows the new revision. adr-20261011-remote-mcp-server rejected stateless Streamable HTTP because server-initiated notifications and the standalone SSE stream need a session; the remote MCP tools and resources never used either: no tool reads the request extra, emits notifications, progress, elicitation or sampling, or keeps per-session state, and buildRemoteMcpServer closes over process-wide host state only.

## Decision

Route /mcp through createMcpHandler(factory) from @modelcontextprotocol/server 2.x with its default legacy posture, stateless. Modern 2026-07-28 requests are served by the handler's per-request path; 2025-era requests, including the initialize handshake, are served by the SDK's stateless legacy fallback from the same factory, and GET and DELETE answer 405. Bearer and Origin verification stay in front of the handler and pass authInfo through, unchanged. remote-mcp-session-registry.ts and its test are deleted, the tool and resource modules import McpServer and ResourceTemplate from the v2 package, and every tool inputSchema is a z.object because the raw-shape overload is deprecated in v2. The in-process MCP server Claude sessions attach to (c3-226) stays on 1.x; the two packages are independent. This wins over keeping the 1.x registry for legacy traffic and adding a second, modern-only v2 handler beside it, because that would register every tool against two different McpServer classes and keep a session registry whose sessions nothing uses.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-242 | component | The /mcp transport, lifecycle and state change from a bounded session registry to a stateless per-request handler serving two protocol eras | c3-242#n13335@v1:sha256:bdb9b7f932040445e3781586522139219ebc79feaa300010175fe7d8e0cc25cb | Parent Fit Lifecycle row, Purpose, State row, the /mcp Contract row and the Session leak Change Safety row are rewritten by this unit |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-strong-typing | Tool inputs move from raw zod shapes to z.object and the route service is typed from the v2 handler | ref-strong-typing#n14175@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | The protocol support is a user-visible promise and needs a test against the real server | rule-colocated-bun-test#n14307@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply: remote-mcp-http-routes.test.ts drives a real 2026-07-28 client |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Handler | createMcpHandler replaces createRemoteMcpSessionRegistry; stop() awaits close() | src/server/remote-mcp/remote-mcp-boot.ts |
| Routes | The route service is the handler's fetch, called with the verified authInfo | src/server/remote-mcp/remote-mcp-http-routes.ts |
| Tools and resources | Imports move to @modelcontextprotocol/server; inputSchema wrapped in z.object | src/server/remote-mcp/remote-mcp-tools-\*.ts, remote-mcp-resources.ts, remote-mcp-server.ts |
| Deleted | The session registry and its test | src/server/remote-mcp/remote-mcp-session-registry.ts |
| Dependencies | @modelcontextprotocol/server added, @modelcontextprotocol/client added for tests | package.json |
| Docs | The remote MCP user guide drops the session note and names the supported revisions | wiki/src/content/docs/guides/user/remote-mcp.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| Modern client test | A 2026-07-28 client connects with the bearer, negotiates the modern era without initialize, lists tools and calls kanna_read | src/server/remote-mcp/remote-mcp-http-routes.test.ts |
| Legacy client tests | The 1.x SDK client, by password and through the full OAuth flow, still lists and calls tools through the stateless fallback | src/server/remote-mcp/remote-mcp-http-routes.test.ts, src/server/remote-mcp/remote-mcp-tools.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the 1.x session registry for 2025-era traffic and add a modern-only v2 handler routed by isLegacyRequest | Every tool would be registered against two McpServer classes from two packages, and the registry would keep sessions that no remote MCP tool or resource uses |
| Answer server/discover by hand in front of the 1.x transport | Revision 2026-07-28 changes every request, not only discovery: per-request _meta, resultType on every result, cacheable list results and new error codes |
| Wait for a 1.x release with the new revision | 1.32.1 is the latest 1.x and does not know it; the v2 package is the SDK's stable line for the new revision |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A 2025-era client relies on a session id or the standalone GET stream | Both are optional in the 2025 revisions and the server sends no server-initiated messages; GET answers 405, which clients treat as no stream | bun run test src/server/remote-mcp/remote-mcp-http-routes.test.ts |
| A server is built per request | Building the server with every tool measured about 2 ms per tools/list in steady state | bun run test src/server/remote-mcp/ |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/remote-mcp/ | 63 pass, 0 fail, including the 2026-07-28 client test |
| bun run typecheck | clean |
| bun run lint | clean |
