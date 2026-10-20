---
name: kanna-mcp
description: MCP in Kanna — user-registered custom MCP servers (transports, connect-test, OAuth 2.1 with PKCE/DCR, token refresh, bearer injection and respawn on stale bearer) and Kanna's own remote MCP server at /mcp (Better Auth OAuth allowlist, password bearer, command catalog, origin stamping, audit log, dedupe, wait clamps). Use whenever a task touches customMcpServers, mcp-oauth, mcp-validator, src/server/remote-mcp/**, a 401 or token-refresh failure from an MCP server, or connecting Claude Code / Codex / ChatGPT to Kanna over MCP.
---

# Kanna MCP — custom servers and the remote /mcp endpoint

Moved verbatim from the root `CLAUDE.md`.

## Custom MCP Servers

Users register MCP servers via Settings → "MCP servers". Entries persist
in `settings.json` under `customMcpServers` (written with the default umask,
mode 0644 — `writeTextFileUtf8` sets no mode; a secret belongs in a 0600 file of
its own, as `push/vapid.adapter.ts` does) and are
merged into the Claude session at chat spawn time: `buildUserMcpServers`
(`agent.ts`) maps each enabled entry to the SDK's per-transport config and
merges it into the `mcpServers` map passed to `query()` alongside
`mcp__kanna__*`. Kanna settings remain the single source of truth for which
servers a session sees.

User MCP tool calls auto-allow (`canUseTool` already returns
`{ behavior: "allow" }` for any tool that isn't `AskUserQuestion` /
`ExitPlanMode`, which includes every `mcp__<name>__*` whose `<name>`
isn't `kanna`). Trust model: if the user installed it, they trust it.

Supported transports: `stdio`, `http`, `sse`, `ws`. Reserved name:
`kanna`. Names match `^[a-zA-Z][a-zA-Z0-9_-]{0,31}$` and form the tool
prefix `mcp__<name>__<tool>`.

**Connect-test:** on create/update, `ws-router.ts` fires a fire-and-
forget `validateMcpServer` (`src/server/mcp-validator.ts`, 10s timeout,
list-tools probe) and persists `lastTest` on the entry. The UI shows a
per-row status pill plus a manual "Test" button that drives the
explicit `settings.testMcpServer` RPC.

**Boundary rule:** user MCP server names MUST NOT equal
`KANNA_MCP_SERVER_NAME`. Enforced by both `validateMcpShape`
(`app-settings.ts`) and `buildUserMcpServers` / `buildMcpConfigJson`
filters (belt-and-suspenders).

### Custom MCP Servers → OAuth

OAuth 2.1 (PKCE + DCR + rotating refresh) is supported for `http` and `sse`
transports only. The flow is explicit discovery rather than SDK auto-discovery:
the SDK's `auth.js` `discovery()` helper follows RFC8414
(`<issuer>/.well-known/oauth-authorization-server`) but some servers (e.g.
Anthropic design MCP) serve the AS metadata only at the OpenID path
(`<issuer>/.well-known/openid-configuration`), returning the claude.ai SPA
HTML at the RFC8414 path — breaking auto-discovery. `mcp-oauth.adapter.ts`
probes the OpenID path first, then falls back to RFC8414.

**Two-step paste UX.** Kanna has no redirect server, so after the AS redirects
the browser to `http://localhost:8765/callback?code=…`, the user copies that
URL from the browser address bar and pastes it into the Settings UI. The
`completeMcpOAuth` WS command exchanges the code via PKCE and stores tokens.

**Kanna registers as a native client (`application_type: "native"`).** A
loopback redirect belongs to an app on the user's machine, which RFC 8252 calls
a native client. Omit the field and a strict authorization server reads the
client as `web` and refuses the `http://localhost` redirect at registration:
Better Auth's OAuth provider answers `400 invalid_redirect_uri` ("web clients
require https redirect URIs"), and it refuses `127.0.0.1` the same way. That is
how an Undercroft MCP server failed to connect from Kanna while Claude Code,
whose MCP SDK 2.x sends the field itself, connected fine. An AS that does not
know the field ignores it, so it costs nothing elsewhere. The SDK 1.x
`OAuthClientMetadata` type lacks it, so `mcp-oauth.adapter.ts` widens the type
rather than casting; `registerClient` sends the metadata through verbatim.

**Token lifecycle.** `ensureFreshMcpToken` (called at chat spawn) pre-fetches a
fresh access token if the current one is within 60 s of expiry. Rotating
refresh tokens are persisted back via `persistOAuthState`. The access-token TTL
is determined by the AS (Anthropic design MCP issues 8 h tokens) — but refresh
extends the session indefinitely, so the 8 h is not a re-auth interval.
`completeMcpOAuth` persists the resolved AS `metadata` (`token_endpoint`) onto
`McpOAuthState.metadata`; `ensureFreshMcpToken` uses it
(`metadataByIssuer?.[issuer] ?? oauth.metadata`) so `refreshAuthorization` hits
the cached `token_endpoint` directly and never re-discovers from `issuer` (which
may be a non-resolvable resource URL like `https://claude.ai/v1/design/mcp` —
re-discovery there returns SPA HTML and was the cause of "token refresh failed"
forcing an 8 h re-auth; see adr-20260630-mcp-oauth-refresh-metadata). Entries
authenticated before this fix lack persisted metadata and must re-auth once.

**Kanna asks for `offline_access` whenever the AS advertises it.** The requested
scope is the protected-resource metadata's `scopes_supported` plus
`offline_access` when the AS metadata's `scopes_supported` lists it
(`requestedScope`, `mcp-oauth.adapter.ts`). The PRM alone is not enough: it
names the RESOURCE's scopes, and `offline_access` is an authorization-server
scope that a well-behaved PRM never lists. Undercroft's `/mcp` is the case that
found it — its PRM says `undercroft:read undercroft:write`, its access tokens
live 15 minutes, and Better Auth issues a refresh token only to a client that
asked for `offline_access`. Without it `ensureFreshMcpToken` threw `access token
expired and no refresh token` a quarter hour after every connect. The MCP SDK
(1.29) does not add the scope itself. An entry authenticated before this fix
holds no refresh token and must reconnect once.

**A dead token is not "authenticated", in either direction.** An expired access
token with no refresh token used to stay `status: "authenticated"`:
`ensureFreshMcpToken` threw without persisting anything, and `startMcpOAuth`
answered `alreadyAuthenticated` for any authenticated entry holding tokens — so
the Authenticate button silently did nothing and the only way out was deleting
the server. Now the refresh path persists `status: "error"` before throwing, and
`startMcpOAuth` short-circuits only while `canStillAuthorize` holds (a refresh
token, or an access token still inside `bearerUsableUntil`).

**Storage.** OAuth state (`clientByIssuer`, `tokens`, `issuer`, `metadata`, `flow`) is
stored inside the server entry in `settings.json` (written with the default
umask, mode 0644, not 0600 — do not rely on the file mode to protect a secret).
The `flow` field is present only mid-flow and cleared on complete or cancel.
DCR results are keyed by AS issuer to avoid re-registering if the same AS
serves multiple servers.

**Bearer injection.** At spawn, `AgentCoordinator.buildOAuthBearers` iterates
enabled network servers, calls `ensureFreshMcpToken` (refresh if needed, then
return the access token), and returns `OAuthBearers` — the
`ReadonlyMap<serverId, token>` plus `usableUntil`, the soonest moment any of
those tokens stops being usable (`bearerUsableUntil`: expiry minus the same 60 s
skew the refresh uses; `null` when no token carries an expiry).
`buildUserMcpServers` merges `Authorization: Bearer <token>` into the transport
headers for that server.
`validateMcpServer` also accepts an optional `bearer` for the manual "Test"
action on OAuth servers.

**A header is fixed for the life of the claude process, so a stale bearer is a
respawn trigger.** The token rides the MCP config the CLI reads once at spawn;
refreshing the stored token does nothing for a session that is already running,
which kept sending the old one and got 401s until something else respawned it.
`spawnClaudeTurn` records `usableUntil` on `ClaudeSessionState.mcpBearersUsableUntil`
and `mcpBearersStale(now)` joins `contextClearPending` in the respawn condition,
so the next turn after expiry starts a fresh process (`--resume`, context kept)
with a freshly refreshed bearer. **It stands aside while `isHoldingWork(now)`**:
with 15-minute tokens a respawn would otherwise kill a background task or
workflow every quarter hour, and a stale MCP header is the smaller loss. Subagent
sessions are per-run and are not re-checked.

## Remote MCP server (`/mcp`, Better Auth OAuth, password bearer)

Kanna serves its own commands to external MCP clients (Claude Code, Codex,
Claude Desktop, ChatGPT) over Streamable HTTP at `/mcp`. Component `c3-242`,
ADR `adr-20261011-remote-mcp-server`; users read the wiki guide
`guides/user/remote-mcp`.

- **Better Auth is the authorization server.** `@better-auth/mcp`'s `mcp()` plus
  the core `jwt()` plugin sit in the existing `authOptions()`; do not hand-roll
  OAuth. `baseURL` is the public origin, so issuer, metadata and JWKS URLs are
  right. `remoteMcp.publicUrl` must be https or loopback http because `mcp()`
  validates the resource when it is constructed and throws otherwise; the
  adapter therefore rebuilds the instance when the origin changes
  (`configureRemoteMcp`) and, if `mcp()` refuses, logs and keeps the previous
  instance. The origin comes from the bound port (`remoteMcp.start`), never
  `actualPort`, which stays `0` under `port: 0`.
- **`handleOAuth` is an ALLOWLIST and must stay one.** `isRemoteMcpOAuthPath`
  (`remote-mcp/oauth-paths.ts`) names the authorize, token, register, revoke,
  jwks and well-known paths; everything else returns `null`. Mounting the whole
  Better Auth handler would expose sign-up, session and user routes.
  `oauth-paths.test.ts` pins the rejected paths.
- **`x-kanna-client-ip` is stripped.** Better Auth rate-limits on that header
  (`CLIENT_IP_HEADER`), so a forwarded client value lets a caller rotate fake
  addresses past the 5-per-minute register limit. `withTrustedClientIp` deletes
  it and sets it from `server.requestIP` through `AuthManager.clientIpFor`; the
  forged-header test in `remote-mcp-http-routes.test.ts` fails if the strip goes.
- **The password is a bearer through one cached sign-in.** `remote-mcp-bearer.ts`
  tries an OAuth JWT first, otherwise signs in once through Better Auth and
  caches the session cookie by sha256 (32 entries, FIFO). Never compare the
  password yourself: Better Auth's hash check and its 3-per-10-seconds limiter are
  the only verifier, and a 429 is relayed with `Retry-After`.
- **Fail closed.** Without `--password`, or with `remoteMcp.enabled` off, every
  owned path answers 404 (never 403, which would advertise the surface). The
  routes are dispatched after the share block and BEFORE the `/api/` cookie
  gate, because the OAuth paths live under `/api/auth/`.
- **Every tool runs through the ws-router seam.** `router.dispatchCommand` and
  `router.readSnapshot` reuse the exact handlers, so WebSocket clients still
  receive the broadcasts; a tool that reads the store instead skips them. The
  store-direct paths are `upload_attachment`, `read_project_file` and the
  `beforeCursor` page of `get_chat`, which calls `store.getMessagesPageBefore`,
  the very method `chat.loadHistory` wraps (the page is typed `ChatHistoryPage`,
  which a JSON ack result is not).
- **The command registry is the only command catalog.** `src/shared/commands`
  derives `ClientCommand`, validates `kanna_command` params and publishes the
  JSON Schemas; `COMMAND_CATALOG` is gone. A command that declares a `result`
  schema also publishes it as `resultSchema` in `kanna_commands` (omitted
  otherwise), and its handler answers through `ackResult`. See
  `adr-20261020-command-registry-single-source-of-truth`.
  `src/server/ws-router-coverage.test.ts` reads the ws-router handlers from the
  syntax tree and fails when a registry command has no handler literal or a
  handler claims a literal the registry lacks.
- **A web capability needs an MCP path or a stated reason.** The web client's
  plain HTTP calls are listed in `src/shared/http-routes.ts` (`HTTP_ROUTES`), each
  naming its MCP tool, its registry command or an exclusion with a reason; the
  client builds those paths from it, and `src/ops/parity` plus
  `remote-mcp-parity.test.ts` fail on a stray `/api/` literal, an unused entry,
  a tool the server does not register or an exclusion the wiki page omits.
  Actions and small reads belong in the registry, not in a new HTTP route.
- **A typed tool is one entry of the tool table, and its input comes from the
  registry.** `remote-mcp-tool-table.ts` lists every tool (`REMOTE_TOOLS`), each
  built by `commandTool`, `topicTool` or `mcpOnlyTool` from
  `remote-mcp-tool-spec.ts`. A `commandTool` names its registry command and
  derives `input` from that command's params: `input: (params) => params` takes
  all of them, `params.omit({...}).extend({...})` drops the fields in `hidden`
  (each with a reason, e.g. `origin`, which the registrar stamps) and adds
  tool-only fields such as `idempotencyKey`, `wait`, `timeoutSeconds`. A param
  added to a command therefore reaches its tool; hand-writing an inline zod
  object for a command's params is how `send_message` once lost `effort`,
  `modelOptions` and `autoResumeOnRateLimit`. `remote-mcp-tool-table.test.ts`
  fails when a non-hidden param is missing, a hidden field is unknown or still
  accepted, a reason is empty, a backing command is remote-excluded, or a topic
  is unknown; the tools test checks the served tool list and schemas against the
  table. A tool backed by no command or topic must say why (`mcpOnlyTool`).
  Field descriptions live on the registry schemas (`describe`), so the web UI,
  `kanna_commands` and the tools share them.
- **A typed tool's input only grows; legacy fields stay accepted.** Clients
  pin the shapes of the released tools, so a tool must accept every call it
  accepted in the last release: no field removed or renamed, none made required,
  no enum value dropped. When a registry command gets stricter than the tool it
  backs (a field becomes required, a scalar becomes an object), relax it in the
  `input: (params) => ...` hook and apply the old default in `handle`:
  `commit_changes` keeps `mode` optional (default `commit_only`), `move_card`
  keeps both positions optional (default null), `checkout_branch` accepts the
  legacy `name` (a local branch) as an alternative to `branch`, and `list_boards`
  accepts the legacy `projectId` as an alternative to `ownerId` and `ownerKind`.
  Where two fields mean one thing, a `superRefine` demands exactly one, and the
  message names both. Say "Legacy, accepted for compatibility" in the field's
  `describe`. The test "typed tools still accept their v1.85 inputs" in
  `remote-mcp-tools.test.ts` is the pin; an environment error (no git
  repository) is fine there, a message starting "Input validation error" is not.
- **A registry schema must render as JSON Schema.** The MCP SDK renders every
  tool input with `z.toJSONSchema` on `tools/list`, and one unrepresentable
  type (`z.undefined()`, a transform on the input side) fails the whole list with
  "Undefined cannot be represented in JSON Schema". `modelOptions` slots use
  `z.never().optional()` for that reason.
- **The endpoint is stateless.** `createMcpHandler` builds the MCP server per
  request (`remote-mcp-boot.ts`), so there is no session registry to bound or evict.
- **Tests need native streams.** `scripts/test-preload.ts` restores the native
  `TransformStream` and `WritableStream` after happy-dom replaces them; the SDK
  client's SSE parser fails with "readable property must be a ReadableStream"
  under happy-dom's versions, and every SDK-client test hangs.
- **Origin is stamped by the router, never claimed by a client.** Each tool call
  runs through `createToolRegistrar` (`remote-mcp-tool-registrar.ts`), which builds
  a `RemoteMcpOrigin` (client id, envelope client name, `oauth` or `password`,
  tool, call id) and holds it in an `AsyncLocalStorage` scope; the runtime wraps
  `dispatchCommand` to pass it to `router.dispatchCommand`. `routeCommand` is the
  one place that sets `origin` on `chat.send` and `message.enqueue`, and it
  deletes any origin a sender wrote, so a browser socket or a forged
  `kanna_command` parameter cannot label itself MCP. The origin flows through
  `QueuedChatMessage` into `UserPromptEntry`, is withheld from share snapshots,
  and becomes a `remote_mcp` board `CardActor` that `board-sync` holds like an
  agent write unless the binding sets `allowAgentPush`. Every tool is registered
  through the `ToolRegistrar` with an object `inputSchema` (`z.object({})` when
  it has no parameters), never the raw `McpServer`; the tool table does this.
- **Secrets are masked once, at the host, by data shape.** `buildRemoteMcpServer`
  wraps the host in `withEgressRedaction` (`remote-mcp-egress-redaction.ts`), so
  every tool, resource and follow loop reads masked data no matter which one
  reached it. It masks the app-settings and llm-provider snapshots and the acks of
  `settings.readAppSettings`, `writeAppSettings`, `writeAppSettingsPatch`,
  `appSettings.setCloudflareTunnel`, `appSettings.setClaudeAuth`,
  `settings.readLlmProvider` and `writeLlmProvider`: Claude OAuth token values,
  custom MCP server `env` and `headers` values, MCP OAuth state (reduced to
  enabled, status, issuer, error) and the LLM `apiKey`. Do not blanket-apply
  `redactSecrets` to results: `share.mint`, `beacons.mintPairingCode` and
  transcript token counts are meant to reach the caller. A new command or topic
  that returns one of these snapshots joins the sets in that module; the web
  socket is untouched and still carries the raw token to `OAuthTokenPoolCard`.
- **The audit sink is `remote-mcp-calls.jsonl` in the data dir.** One redacted
  record per tool call through the `StorageBackend` port, rotated to `.1` at
  10 MiB; a failed write is logged and never reaches the tool. The counter
  `kanna.remote_mcp.tool_call` carries tool, outcome and via only, never the
  client id (unbounded). Resources are not audited.
- **Dedupe lives in the runtime, not in the per-request server.**
  `createMcpHandler` builds a fresh `McpServer` per request, so
  `createDedupeStore` is created once in `createRemoteMcpRuntime`. A repeat of an
  in-flight request follows the original (`guardedDispatch` reserves the slot
  before the dispatch resolves) instead of dispatching again. Route
  `chat.send` and `message.enqueue` from any tool through `guardedChatSend` and
  `guardedEnqueue`.
- **A silent wait is clamped.** `Bun.serve` runs without `idleTimeout`, so its
  default closes a silent response after 10 seconds, and a Cloudflare tunnel does
  after 125. After bearer verification the route calls `server.timeout(req, 130)`,
  and `resolveWaitLimit` caps a wait at 100 seconds unless the request is legacy
  era (SSE pings) or carries a progress token (`notifications/progress` keeps the
  bytes flowing). `send_message` and `wait_for_chat` share `followChat`; a result
  is `done` or it carries a `next` that forbids resending.
- **Follow-up:** `handleProjectFileContent` still checks the path lexically, so
  a symlink inside a project that points outside it is served over HTTP, while
  `read_project_file` also compares real paths. Hardening the HTTP route may
  break projects that symlink out on purpose.
