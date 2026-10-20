---
id: c3-242
c3-seal: f8d7e825e53a3e92419a953500e33beeef9dc142a3d303ffb17a99e7c91fb21b
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
| Lifecycle | One runtime per server process, created in startKannaServer, started once the listen port is final and stopped before shutdownServices; one MCP server instance per HTTP request, built by the createMcpHandler factory and discarded with its response |
| Replaceability | Replaceable while the /mcp Streamable HTTP contract, the OAuth discovery documents, the bearer rules and the fail-closed behaviour without --password are preserved |

## Purpose

Owns the remote MCP surface: the /mcp endpoint, a stateless createMcpHandler that serves MCP 2026-07-28 and 2025-era clients from one per-request server factory, the bearer verifier that accepts an OAuth access token or the launch password, the allowlisted mount of Better Auth's OAuth endpoints with client-IP header stripping, the server-rendered login and consent pages, the generic parity tools (kanna_commands, kanna_command, kanna_read) backed by the command registry, the typed intent tools declared once in a tool table whose command-backed tools derive their input from the registry, the resources, and the remoteMcp settings. It also owns what makes a remote caller accountable and followable: the tool registrar that labels each call with a server-built origin and writes an audit record, the follow loop behind send_message and wait_for_chat, and the dedupe store that stops a retried request from starting duplicate work. Every tool runs through router.dispatchCommand or router.readSnapshot so WebSocket clients still see the broadcasts. Non-goals: password verification and rate limiting (c3-203 and Better Auth own them), the in-process MCP server Claude sessions attach to (c3-226), per-user accounts, MCP sessions, server-initiated requests such as sampling or elicitation, and any route outside the allowlist.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | The server started with --password; without it every owned path answers 404 and nothing is built on top of Better Auth | c3-203 |
| Input — origin | server.ts calls remoteMcp.start with the bound port; the public origin is remoteMcp.publicUrl or http://127.0.0.1:<port> and is re-applied when settings change | c3-202 |
| Input — commands | router.dispatchCommand runs any ClientCommand through the same handlers as a WebSocket client and returns the first envelope carrying the generated id; it takes an optional CommandOrigin that it sets on its synthetic connection, and routeCommand stamps it onto chat.send and message.enqueue; router.readSnapshot builds a topic envelope with no connection | c3-208 |
| State | The /mcp endpoint holds no MCP state between requests; OAuth clients, codes, tokens and keys live in the Better Auth database | c3-203 |
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
| ref-strong-typing | ref | Tool inputs are zod shapes and every command is parsed by the command registry that derives the ClientCommand union | must follow | rule-strong-typing applies; JsonValue, never unknown |
| rule-strong-typing | rule | No any, unknown or casts in tools, routes or the command registry | wired compliance target | command construction goes through parseClientCommand |
| ref-side-effect-adapter | ref | Only adapters touch the filesystem and Better Auth | must follow | better-auth-oauth.adapter.ts and server-io.adapter.ts hold the IO |
| ref-ws-subscription | ref | Tools reuse router topics and commands instead of reading the store | must follow | upload_attachment and read_project_file are the documented exceptions, and get_chat reads an older page through the same store method chat.loadHistory calls |
| rule-colocated-bun-test | rule | Each module has a colocated test | wired compliance target | HTTP behaviour is proven against a real server and the real MCP SDK client |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| /mcp endpoint | IN | Streamable HTTP through createMcpHandler from @modelcontextprotocol/server 2.x; a 2026-07-28 request (server/discover, per-request _meta) is served statelessly, a 2025-era request including initialize is served by the stateless legacy fallback from the same factory, GET and DELETE answer 405, and no Mcp-Session-Id is issued | c3-202 | src/server/remote-mcp/remote-mcp-boot.ts, src/server/remote-mcp/remote-mcp-http-routes.ts |
| Bearer verifier | IN | Accepts an OAuth JWT bound to the /mcp audience, or the launch password through one cached Better Auth sign-in keyed by sha256; the password is never compared in plaintext, 401 and 429 are relayed | c3-203 | src/server/remote-mcp/remote-mcp-bearer.ts |
| OAuth allowlist mount | IN | handleOAuth forwards only the authorize, token, register, revoke, jwks, well-known and protected-resource paths, rewrites the bare discovery paths, and the route strips any client x-kanna-client-ip before setting it from the socket | c3-203 | src/server/remote-mcp/oauth-paths.ts, src/server/remote-mcp/remote-mcp-http-routes.ts |
| Login and consent pages | IN/OUT | Server-rendered HTML with no script; sign-in resumes the OAuth flow through the signed oauth_query and consent returns the redirect | c3-203 | src/server/remote-mcp/oauth-pages.ts, src/server/remote-mcp/oauth-page-routes.ts |
| Generic parity tools | OUT | kanna_commands lists every registry command with its risk, remote policy, a JSON Schema of its params and, for a command that declares one, a JSON Schema of its result, kanna_command validates params with parseClientCommand and refuses a remote-excluded command quoting its reason and takes an optional idempotencyKey that makes a repeated chat.send or message.enqueue return the original through the send guard, kanna_read reads any topic and runs the host project discovery first for local-projects, as the WebSocket subscribe does | c3-208 | src/shared/commands/index.ts, src/shared/remote-mcp/topics.ts |
| Typed intent tools | OUT | Every typed tool is one entry of REMOTE_TOOLS built by commandTool, topicTool or mcpOnlyTool and registered through the tool registrar; a commandTool names its registry command and its input is the registry params of that command, optionally omit-ed or extended with tool-only fields such as idempotencyKey, wait and timeoutSeconds, so a param added to a command reaches the tool unless the tool lists it as hidden with a reason; a typed tool input only grows and legacy fields stay accepted, so commit_changes keeps mode optional, move_card keeps both positions optional, checkout_branch takes the legacy name and list_boards the legacy projectId; a topicTool names its subscription topic and an mcpOnlyTool states why neither backs it; send_message and wait_for_chat share one poll loop that returns done, a cursor and a next instruction, understands queued messages, stops on the request abort signal and sends notifications/progress when the client asked for progress; a wait is capped at 100 seconds unless the connection streams; get_chat returns olderCursor and pages back through beforeCursor; read_project_file checks real paths inside the project | c3-208 | src/server/remote-mcp/remote-mcp-tool-spec.ts, src/server/remote-mcp/remote-mcp-tool-table.ts, src/server/remote-mcp/remote-mcp-tools-chat.ts, src/server/remote-mcp/send-and-wait.ts, src/server/remote-mcp/remote-mcp-follow.ts, src/server/remote-mcp/remote-mcp-follow-view.ts, src/server/remote-mcp/remote-mcp-tools-files.ts |
| Resources | OUT | kanna://projects, kanna://chats/{chatId} and kanna://boards/{boardId} | c3-208 | src/server/remote-mcp/remote-mcp-resources.ts |
| Connection hold | OUT | After bearer verification the route asks Bun to extend the request idle timeout to 130 seconds, because Bun.serve closes a silent response after 10 seconds by default and a Cloudflare tunnel after 125 | c3-202 | src/server/remote-mcp/remote-mcp-http-routes.ts, src/server/remote-mcp/remote-mcp-boot.ts, src/server/http-dispatcher.ts |
| Duplicate guard | OUT | A dedupe store created once per runtime remembers each send_message, chat.send and message.enqueue for 30 minutes (256 entries, oldest dropped first), keyed by client plus idempotency key or by client, destination and content hash; a repeat whose chat is still working, or whose queued copy is still queued, is not dispatched and follows the original with duplicate true; the slot is reserved before the dispatch resolves so overlapping calls dispatch once | c3-208 | src/server/remote-mcp/remote-mcp-dedupe.ts, src/server/remote-mcp/remote-mcp-send-guard.ts |
| Tool-call audit log | OUT | Every registered tool call appends one JSON line with callId, tool, client, via, era, duration, outcome, chat and project ids and arguments passed through redactSecrets and truncated, to remote-mcp-calls.jsonl in the data directory through the StorageBackend port; the file rotates to .1 past 10 MiB, a failed write is logged and never reaches the tool, and a kanna.remote_mcp.tool_call counter carries tool, outcome and via only; resources are not audited | c3-202 | src/server/remote-mcp/remote-mcp-audit.ts, src/server/remote-mcp/remote-mcp-audit-log.ts, src/server/observability.ts |
| Egress redaction | OUT | buildRemoteMcpServer wraps the host in withEgressRedaction, so every tool, resource and follow loop reads through one chokepoint; by data shape it masks claudeAuth token values, custom MCP server env and header values and OAuth state down to enabled, status, issuer and error, and the LLM provider apiKey, for the app-settings and llm-provider snapshots and for the acks of the settings read and write commands that return them, and an unrecognised ack of those commands falls back to key-name redactSecrets; other results are left untouched so share tokens, pairing codes and token counts survive, and the browser socket still receives the raw values | c3-208 | src/server/remote-mcp/remote-mcp-egress-redaction.ts, src/server/remote-mcp/remote-mcp-server.ts |
| Command origin | OUT | The registrar builds a RemoteMcpOrigin per tool call (client id, optional client name from the per-request envelope, via oauth or password, tool, call id) and runs the handler in an AsyncLocalStorage scope; the runtime's dispatchCommand reads the scope and passes the origin to the router, so no tool threads it by hand; the origin reaches the queue, the user_prompt transcript entry and the board actor and is withheld from share snapshots | c3-208 | src/server/remote-mcp/remote-mcp-tool-registrar.ts, src/server/remote-mcp/remote-mcp-call-scope.ts, src/shared/command-origin.ts |
| remoteMcp settings | IN/OUT | enabled and publicUrl; publicUrl is https or loopback http reduced to its origin because mcp() validates the resource at construction | c3-202 | src/shared/settings/remote-mcp.ts |
| Fail-closed boot | OUT | Without --password the routes answer 404; with it the runtime configures the Better Auth origin after the port is bound | c3-202 | src/server/remote-mcp/remote-mcp-boot.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Allowlist widened | A path such as sign-up, get-session or consent is added to isRemoteMcpOAuthPath, or the whole Better Auth handler is mounted | oauth-paths.test.ts rejects the unlisted paths | bun run test src/server/remote-mcp/oauth-paths.test.ts |
| Forged x-kanna-client-ip | The route forwards a client-supplied header, letting a caller rotate fake IPs past the register and token rate limits | The forged-header test registers eight clients with eight forged IPs and expects a 429 | bun run test src/server/remote-mcp/remote-mcp-http-routes.test.ts |
| Password compared in plaintext | The bearer verifier checks the password itself instead of signing in through Better Auth | The bearer tests drive a wrong password to 401 then 429 and a right one through a single sign-in | bun run test src/server/remote-mcp/remote-mcp-oauth.test.ts |
| Malformed command params | A kanna_command call whose params break the registry schema | parseClientCommand rejects it with an error naming the command and the failing path before any handler runs | bun run test src/server/remote-mcp/remote-mcp-tools.test.ts |
| Protocol era dropped | The handler is replaced by one that speaks only 2025-era initialize, or legacy serving is set to reject | The routes test connects a 2026-07-28 client and asserts the modern era, and the 1.x client tests still list and call tools | bun run test src/server/remote-mcp/remote-mcp-http-routes.test.ts |
| publicUrl set to non-loopback http | mcp() rejects the resource and the instance keeps the previous origin | normalizeRemoteMcpPublicUrl returns null and configureRemoteMcp logs and keeps the old instance | bun run test src/shared/settings/remote-mcp.test.ts |
| Audit record leaks or blocks | An argument bypasses redactSecrets or truncation, or a write failure is allowed to reach the tool | A secret appears in remote-mcp-calls.jsonl or a tool call fails when the disk is full | bun run test src/server/remote-mcp/remote-mcp-audit-log.test.ts src/server/remote-mcp/remote-mcp-tools.test.ts |
| Secret escapes through a generic tool | A new command or topic returns an AppSettingsSnapshot or LlmProviderSnapshot that egress redaction does not recognise, or a tool reads host.appSettings directly into its result | kanna_read or kanna_command output holds a raw OAuth token, header, env value or apiKey | bun run test src/server/remote-mcp/remote-mcp-egress-redaction.test.ts src/server/remote-mcp/remote-mcp-tools.test.ts |
| Silent wait cut off | A wait exceeds the proxy idle time on a connection that streams nothing, or progress stops reaching modern-era clients | The client sees a closed socket and retries the prompt | bun run test src/server/remote-mcp/remote-mcp-follow-view.test.ts src/server/remote-mcp/remote-mcp-tools.test.ts |
| Duplicate work from a retry | send_message, kanna_command chat.send or enqueue_message bypasses the guard, or the guard stops reserving before the dispatch resolves | A retried or overlapping identical request starts a second chat or queues a second copy | bun run test src/server/remote-mcp/remote-mcp-send-guard.test.ts |
| Typed tool drifts from its command | A param is added to a registry command and a tool hides it, or a tool is hand-declared instead of derived, so MCP clients cannot set what the web UI can | remote-mcp-tool-table.test.ts fails when a command-backed tool lacks a non-hidden registry param, hides an unknown param or gives no reason, and the tools test compares the served tool list and input schemas with the table | bun run test src/server/remote-mcp/remote-mcp-tool-table.test.ts src/server/remote-mcp/remote-mcp-tools.test.ts |
| Origin trusted from the caller | stampCommandOrigin stops replacing a caller-supplied origin, or a browser socket gets a commandOrigin | A browser or a forged kanna_command parameter labels its own message as coming from MCP | bun run test src/server/ws-router.test.ts src/server/remote-mcp/remote-mcp-tools.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/remote-mcp/remote-mcp-server.ts | Contract (generic parity tools, typed intent tools, resources) | Tool registration order | src/server/remote-mcp/remote-mcp-server.ts |
| src/server/remote-mcp/remote-mcp-tool-table.ts | Contract (typed intent tools) | Which tools exist and how each is described; a command-backed input follows the registry | src/server/remote-mcp/remote-mcp-tool-spec.ts |
| src/shared/commands/index.ts | Contract (generic parity tools) | Summary wording or a risk or remote policy | src/shared/commands/index.ts |
| src/server/better-auth-oauth.adapter.ts | Contract (OAuth allowlist mount, bearer verifier) | Better Auth call detail | src/server/better-auth-oauth.adapter.ts |
| wiki/src/content/docs/guides/user/remote-mcp.md | Contract (all surfaces) | Prose | wiki/src/content/docs/guides/user/remote-mcp.md |
