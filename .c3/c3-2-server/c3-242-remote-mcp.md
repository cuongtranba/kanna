---
id: c3-242
c3-seal: ae47bd61d36b96eb1ffc9024f9d9141a225805248ea25474569c3e7878424a34
title: remote-mcp
type: component
category: feature
parent: c3-2
goal: Serve Kanna to external MCP clients (Claude Code, Codex, Claude Desktop, ChatGPT) over an authenticated Streamable HTTP endpoint at /mcp, with Better Auth acting as the OAuth 2.1 authorization server.
uses:
    - ref-side-effect-adapter
    - ref-strong-typing
    - ref-ws-subscription
    - rule-colocated-bun-test
    - rule-strong-typing
---

## Goal

Serve Kanna to external MCP clients (Claude Code, Codex, Claude Desktop, ChatGPT) over an authenticated Streamable HTTP endpoint at /mcp, with Better Auth acting as the OAuth 2.1 authorization server.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Expose HTTP + WebSocket endpoints" extended to remote agents: a third client of the ws-router command and snapshot seam beside the browser and the beacon daemon |
| Category | feature |
| Lifecycle | One runtime per server process, created in startKannaServer, started once the listen port is final and stopped before shutdownServices; one MCP server plus transport pair per client session |
| Replaceability | Replaceable while the /mcp Streamable HTTP contract, the OAuth discovery documents, the bearer rules and the fail-closed behaviour without --password are preserved |

## Purpose

Owns the remote MCP surface: the /mcp endpoint and its bounded stateful session registry, the bearer verifier that accepts an OAuth access token or the launch password, the allowlisted mount of Better Auth's OAuth endpoints with client-IP header stripping, the server-rendered login and consent pages, the generic parity tools (kanna_commands, kanna_command, kanna_read) backed by a typed command catalog, the typed intent tools, the resources, and the remoteMcp settings. Every tool runs through router.dispatchCommand or router.readSnapshot so WebSocket clients still see the broadcasts. Non-goals: password verification and rate limiting (c3-203 and Better Auth own them), the in-process MCP server Claude sessions attach to (c3-226), per-user accounts, and any route outside the allowlist.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | The server started with --password; without it every owned path answers 404 and nothing is built on top of Better Auth | c3-203 |
| Input — origin | server.ts calls remoteMcp.start with the bound port; the public origin is remoteMcp.publicUrl or http://127.0.0.1:<port> and is re-applied when settings change | c3-202 |
| Input — commands | router.dispatchCommand runs any ClientCommand through the same handlers as a WebSocket client and returns the first envelope carrying the generated id; router.readSnapshot builds a topic envelope with no connection | c3-208 |
| State | Sessions live in memory only; OAuth clients, codes, tokens and keys live in the Better Auth database | c3-203 |
| Shared dep — settings | AppSettingsManager supplies remoteMcp.enabled and remoteMcp.publicUrl | c3-202 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | An external agent lists projects, runs chats, answers tool requests, moves board cards and reads snapshots without a browser | c3-208 |
| Primary path | Client without a token gets 401 plus a WWW-Authenticate resource_metadata URL, discovers the authorization server, registers dynamically, sends the owner through /oauth/login and /oauth/consent, and calls /mcp with a JWT | c3-203 |
| Alternate — password bearer | A client holding the launch password sends it as the bearer; one cached Better Auth sign-in proves it and later calls reuse the session cookie | c3-203 |
| Failure — disabled or no password | 404 JSON on every owned path, never 403, so the surface is indistinguishable from absent | c3-202 |
| Failure — throttled | Repeated wrong passwords relay Better Auth's 429 with Retry-After | c3-203 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | Tool inputs are zod shapes and the command catalog is typed against the ClientCommand union | must follow | rule-strong-typing applies; JsonValue, never unknown |
| rule-strong-typing | rule | No any, unknown or casts in tools, routes or the catalog | wired compliance target | command construction narrows through isClientCommandShape |
| ref-side-effect-adapter | ref | Only adapters touch the filesystem and Better Auth | must follow | better-auth-oauth.adapter.ts and server-io.adapter.ts hold the IO |
| ref-ws-subscription | ref | Tools reuse router topics and commands instead of reading the store | must follow | files tools are the documented exception |
| rule-colocated-bun-test | rule | Each module has a colocated test | wired compliance target | HTTP behaviour is proven against a real server and the real MCP SDK client |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| /mcp endpoint and session registry | IN | Streamable HTTP; a request without Mcp-Session-Id starts a session, an unknown id answers 404, idle sessions close after 60 minutes, at most 64 sessions live and the least recently used is evicted | c3-202 | src/server/remote-mcp/remote-mcp-session-registry.ts, src/server/remote-mcp/remote-mcp-http-routes.ts |
| Bearer verifier | IN | Accepts an OAuth JWT bound to the /mcp audience, or the launch password through one cached Better Auth sign-in keyed by sha256; the password is never compared in plaintext, 401 and 429 are relayed | c3-203 | src/server/remote-mcp/remote-mcp-bearer.ts |
| OAuth allowlist mount | IN | handleOAuth forwards only the authorize, token, register, revoke, jwks, well-known and protected-resource paths, rewrites the bare discovery paths, and the route strips any client x-kanna-client-ip before setting it from the socket | c3-203 | src/server/remote-mcp/oauth-paths.ts, src/server/remote-mcp/remote-mcp-http-routes.ts |
| Login and consent pages | IN/OUT | Server-rendered HTML with no script; sign-in resumes the OAuth flow through the signed oauth_query and consent returns the redirect | c3-203 | src/server/remote-mcp/oauth-pages.ts, src/server/remote-mcp/oauth-page-routes.ts |
| Generic parity tools | OUT | kanna_commands lists the catalog, kanna_command runs any cataloged command except browser-bound ones, kanna_read reads any topic; the catalog is typed against the union and regex-checked against the protocol source | c3-208 | src/shared/remote-mcp/command-catalog.ts, src/shared/remote-mcp/topics.ts |
| Typed intent tools | OUT | Intent-named tools each dispatch one command or read one topic; send_message waits by polling the chat snapshot; read_project_file checks real paths inside the project | c3-208 | src/server/remote-mcp/remote-mcp-tools-chat.ts, src/server/remote-mcp/send-and-wait.ts, src/server/remote-mcp/remote-mcp-tools-files.ts |
| Resources | OUT | kanna://projects, kanna://chats/{chatId} and kanna://boards/{boardId} | c3-208 | src/server/remote-mcp/remote-mcp-resources.ts |
| remoteMcp settings | IN/OUT | enabled and publicUrl; publicUrl is https or loopback http reduced to its origin because mcp() validates the resource at construction | c3-202 | src/shared/settings/remote-mcp.ts |
| Fail-closed boot | OUT | Without --password the routes answer 404; with it the runtime configures the Better Auth origin after the port is bound | c3-202 | src/server/remote-mcp/remote-mcp-boot.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Allowlist widened | A path such as sign-up, get-session or consent is added to isRemoteMcpOAuthPath, or the whole Better Auth handler is mounted | oauth-paths.test.ts rejects the unlisted paths | bun run test src/server/remote-mcp/oauth-paths.test.ts |
| Forged x-kanna-client-ip | The route forwards a client-supplied header, letting a caller rotate fake IPs past the register and token rate limits | The forged-header test registers eight clients with eight forged IPs and expects a 429 | bun run test src/server/remote-mcp/remote-mcp-http-routes.test.ts |
| Password compared in plaintext | The bearer verifier checks the password itself instead of signing in through Better Auth | The bearer tests drive a wrong password to 401 then 429 and a right one through a single sign-in | bun run test src/server/remote-mcp/remote-mcp-oauth.test.ts |
| Catalog missing a command | A ClientCommand is added without a catalog entry | The record is keyed by the union so typecheck fails, and the regex test compares the protocol source | bun run test src/server/remote-mcp/command-catalog.test.ts |
| Session leak | Sessions are never closed or the cap is removed | The registry tests close idle sessions and evict the oldest past the cap | bun run test src/server/remote-mcp/remote-mcp-session-registry.test.ts |
| publicUrl set to non-loopback http | mcp() rejects the resource and the instance keeps the previous origin | normalizeRemoteMcpPublicUrl returns null and configureRemoteMcp logs and keeps the old instance | bun run test src/shared/settings/remote-mcp.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/remote-mcp/remote-mcp-server.ts | Contract (generic parity tools, typed intent tools, resources) | Tool registration order | src/server/remote-mcp/remote-mcp-server.ts |
| src/shared/remote-mcp/command-catalog.ts | Contract (generic parity tools) | Summary wording | src/shared/remote-mcp/command-catalog.ts |
| src/server/better-auth-oauth.adapter.ts | Contract (OAuth allowlist mount, bearer verifier) | Better Auth call detail | src/server/better-auth-oauth.adapter.ts |
| wiki/src/content/docs/guides/user/remote-mcp.md | Contract (all surfaces) | Prose | wiki/src/content/docs/guides/user/remote-mcp.md |
