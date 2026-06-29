# MCP OAuth client for HTTP/SSE servers

Date: 2026-06-29
Branch: `feat/mcp-oauth-client`
Status: approved design

## Problem

OAuth-protected remote MCP servers (e.g. Anthropic's design MCP at
`https://api.anthropic.com/v1/design/mcp`) cannot be used inside Kanna. They
require an OAuth 2.1 bearer at the HTTP transport: the server returns `401`
before `tools/list` even succeeds, so the connection probe fails
(`status: "failed"`) and the tools never enter the chat's tool registry.

Evidence (session `f62473c3-8675-4219-9623-669eab1e6bdc`): Kanna injected
`anthropic-design` from `settings.json` `customMcpServers`, but both the SDK
driver (`buildUserMcpServers`) and the PTY driver (`buildMcpConfigJson`) only
support **static** `headers` — no OAuth. Meanwhile the `claude` CLI works
because `/design-login` ran the OAuth dance and persisted tokens in the CLI's
own keychain/`~/.claude.json`, which Kanna deliberately ignores (single source
of truth = Kanna settings).

This differs from `figma-remote-mcp`, which connects **unauthenticated** and
exposes its own `authenticate` / `complete_authentication` *tools* (application
-level OAuth handled entirely server-side). The design MCP has no such tools;
it enforces OAuth at the transport layer, so Kanna must act as the OAuth client.

## Goal

Let a user authenticate an OAuth-protected `http`/`sse` MCP server from Kanna's
Settings UI so its tools register in chats under both drivers. Implement the
full MCP-spec OAuth flow; drive login with a two-step **manual callback paste**
UX (no local callback server).

## Non-goals

- Loopback token proxy for mid-turn refresh (see "Known limitation").
- Cloudflare-tunnel redirect URI for off-localhost Kanna instances.
- Importing the `claude` CLI's keychain tokens.
- `stdio` / `ws` transports, or non-OAuth bearer servers (already covered by
  static `headers`).
- Touching the working `figma-remote-mcp` server-tool auth path.

## Key insight: the MCP SDK already does the OAuth work

Kanna already depends on `@modelcontextprotocol/sdk` (`src/server/mcp-validator.ts:3`).
Its client ships a complete OAuth 2.1 implementation behind the
`OAuthClientProvider` interface + `StreamableHTTPClientTransport({ authProvider })`:

- protected-resource + authorization-server metadata discovery (RFC 8414),
- dynamic client registration (RFC 7591),
- PKCE,
- authorization-code exchange and refresh,
- `iss` (RFC 9207) validation via `transport.finishAuth(params)`.

Kanna does **not** write OAuth/crypto. Kanna writes:
1. an `OAuthClientProvider` whose storage methods persist per-server into
   `settings.json`,
2. two WS commands to drive the manual paste flow,
3. bearer injection into both drivers at chat-spawn time,
4. Settings UI.

## Data model — `src/shared/types.ts`

Extend `McpServerNetworkFields` with an optional `oauth` block (only valid for
`http` / `sse`):

```ts
export interface McpOAuthState {
  enabled: boolean
  status: "unauthenticated" | "authenticated" | "error"
  errorMessage?: string
  // DCR result, keyed by authorization-server issuer (SEP-2352). A client_id
  // registered with one AS is never reused for another.
  clientByIssuer?: Record<string, OAuthClientInformationFull>
  tokens?: OAuthTokens               // access + refresh + expires_in (+ obtainedAt)
  obtainedAt?: number                // epoch ms; for expiry math
  // transient, present only mid-flow (cleared on complete/cancel):
  flow?: {
    codeVerifier: string
    state: string
    discovery?: OAuthDiscoveryState
    authorizationUrl: string
  }
}
```

The MCP SDK types (`OAuthClientInformationFull`, `OAuthTokens`,
`OAuthDiscoveryState`) are imported from
`@modelcontextprotocol/sdk/shared/auth.js`. All fields are secrets and stay in
`settings.json` (already mode `0600`).

`McpServerPatch` gains `oauth?: Partial<McpOAuthState>`. New
`AppSettingsPatch.customMcpServers` ops: `setOAuthState`.

### Validation — `src/server/app-settings.ts`

- `oauth.enabled` only permitted when `transport ∈ {http, sse}`; reject on
  `stdio` / `ws` (`INVALID_OAUTH_TRANSPORT`).
- `oauth` block never carries a user-supplied `Authorization` header at the same
  time (avoid ambiguity): if `oauth.enabled`, strip any static `Authorization`
  from `headers` at write time.

## New module — `src/server/mcp-oauth.ts`

Pure-ish orchestration; the single side effect (network) is the MCP SDK client.
This module is the **adapter boundary** for MCP OAuth network IO. Per the
side-effect seal it is named `mcp-oauth.adapter.ts` if it performs IO directly;
the storage closures are injected so the bulk is testable. (Final filename
decided in the plan; default `mcp-oauth.adapter.ts`.)

```ts
class KannaMcpOAuthProvider implements OAuthClientProvider {
  constructor(private io: {
    read(): McpOAuthState | undefined
    write(patch: Partial<McpOAuthState>): void
    onRedirect(url: URL): void
  }) {}
  // redirectUrl + clientMetadata: native loopback placeholder
  // (redirect_uris: ["http://localhost/callback"], application_type: "native")
  // clientInformation / saveClientInformation  -> io keyed by issuer
  // tokens / saveTokens                         -> io.tokens (+ obtainedAt)
  // state / saveCodeVerifier / codeVerifier     -> io.flow
  // saveDiscoveryState / discoveryState         -> io.flow.discovery
  // redirectToAuthorization                     -> io.onRedirect
}
```

Exported functions:

- `startMcpOAuth(config) -> { authorizationUrl } | { alreadyAuthenticated }`
  Build provider + `StreamableHTTPClientTransport`, `client.connect()`. The
  connect throws `UnauthorizedError` (possibly wrapped — unwrap `.data.cause`);
  the provider's `redirectToAuthorization` captured the URL. Persist
  `flow` (verifier/state/discovery) + `authorizationUrl`, set
  `status:"unauthenticated"`, return the URL.

- `completeMcpOAuth(config, callbackUrl) -> McpServerTestResult`
  Parse `new URL(callbackUrl).searchParams`. Verify `state === flow.state`
  (CSRF). `transport.finishAuth(params)` (SDK validates `iss`, exchanges code,
  saves tokens via provider). Reconnect on a fresh transport, `listTools()` to
  confirm. On success: clear `flow`, set `status:"authenticated"`, return
  `{status:"ok", toolCount}`. On `IssuerMismatchError`: never surface
  `error_description`; set `status:"error"`, generic message.

- `ensureFreshMcpToken(config) -> string`  (access token)
  If `tokens` absent → throw (caller skips injection). If access token still
  valid (`obtainedAt + expires_in - skew > now`) → return it. Else run the SDK
  refresh (`auth()` with no auth code, or a throwaway authed connect) which
  rotates + `saveTokens`; persist and return the new access token. On refresh
  failure → set `status:"error"`, throw.

Errors reuse `mcp-validator.ts:formatError` shape where practical.

## Spawn-time bearer injection

Both drivers bake a **static** `Authorization: Bearer <access_token>` header at
spawn:

- SDK driver — `buildUserMcpServers` (`src/server/agent.ts:76`). Made `async`
  (or fed a pre-resolved token map): for each enabled-oauth server,
  `await ensureFreshMcpToken(s)` and set
  `headers.Authorization = \`Bearer ${token}\``. Callers in `agent.ts` already
  `await` around spawn.
- PTY driver — `buildMcpConfigJson` (`src/server/kanna-mcp-http.ts`). Same
  resolution before serializing `mcp-config.json`.

`validateMcpServer` (`mcp-validator.ts`) uses the same provider so the "Test"
button works after auth (passes `authProvider` instead of static headers when
`oauth.enabled`).

### Known limitation (documented, accepted for v1)

The bearer is a static header fixed at spawn. A single turn outliving the access
-token TTL (design tokens ≈ 1h) will `401` mid-session until the next spawn
refreshes. Mitigation: refresh at every spawn; most turns are far shorter than
1h. A loopback token proxy (Kanna injects its own URL, adds a fresh bearer per
request) would remove this entirely and is the planned v2 follow-up.

## WS commands — `src/server/ws-router.ts`

Mirror the existing `settings.testMcpServer` (`ws-router.ts:1441`) pattern:

- `settings.startMcpOAuth { id }` → `startMcpOAuth`, persist flow, return
  `{ authorizationUrl }`.
- `settings.completeMcpOAuth { id, callbackUrl }` → `completeMcpOAuth`, persist
  result, return `McpServerTestResult`.

Both write via `appSettings.writePatch({ customMcpServers: { setOAuthState }})`.

## UI — `src/client/app/McpServersSection.tsx`

For `http`/`sse` rows (impeccable skill applied for consistency):

- An **OAuth** toggle (sets `oauth.enabled`; disables the manual
  `Authorization` header field).
- When `enabled && status !== "authenticated"`: an **Authenticate** button →
  calls `startMcpOAuth`, shows the returned URL (open + copy), plus a
  **callback URL** paste input and a **Complete** button → `completeMcpOAuth`.
  This mirrors the figma `authenticate` → `complete_authentication` two-step the
  user already knows.
- Status pill: `unauthenticated` / `authenticated` / `error` (reuse the
  existing `lastTest` pill styling).
- A **Re-authenticate** action when `authenticated` or `error`.

## Tests (TDD)

- `src/server/mcp-oauth.test.ts` — provider persistence round-trips;
  `startMcpOAuth` returns a URL and persists verifier/state; `completeMcpOAuth`
  happy path against a fake AS; `state` mismatch rejects; issuer-mismatch hides
  `error_description`; `ensureFreshMcpToken` refreshes when expired and returns
  cached when fresh.
- `src/server/agent.test.ts` — `buildUserMcpServers` injects
  `Authorization: Bearer` when oauth-authenticated, omits when unauthenticated
  / disabled.
- `src/server/kanna-mcp-http.test.ts` — same for `buildMcpConfigJson`.
- `src/server/app-settings.test.ts` — oauth validation rules
  (transport gate, header-strip).
- `src/server/ws-router.test.ts` — start/complete command happy + error paths
  with a stubbed `mcp-oauth` module.

Run with `bun run test` (production conditions). New server suites run
individually during TDD.

## C3 / docs

`customMcpServers` currently has no C3 component mapping. If `/c3 change`
identifies a touched component boundary (settings, ws-router, agent mcp
wiring), update `.c3/` in the same PR. Add a CLAUDE.md "Custom MCP Servers"
subsection documenting the OAuth flow + the static-header staleness bound.

## Rollout

Off by default per server (`oauth.enabled` defaults false). Existing static
-header servers and figma are untouched. PR targets `cuongtranba/kanna` `main`.
