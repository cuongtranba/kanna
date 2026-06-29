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
1. explicit discovery + an `OAuthClientProvider` whose storage methods persist
   per-server into `settings.json`,
2. two WS commands to drive the manual paste flow,
3. bearer injection into both drivers at chat-spawn time,
4. Settings UI.

## Probe findings (2026-06-29, real `api.anthropic.com/v1/design/mcp`)

A throwaway spike validated every machine-checkable leg from the Bun runtime.
**The high-level SDK auto-discovery does NOT work against this server; Kanna must
drive discovery explicitly.** Concrete results:

- Unauthed `POST .../mcp` → `401` with
  `WWW-Authenticate: Bearer resource_metadata="https://api.anthropic.com/v1/design/.well-known/oauth-protected-resource", scope="user:design:read user:design:write"`.
- Protected-resource metadata is served at that **non-standard** path
  (`/v1/design/.well-known/oauth-protected-resource`, not the SDK-derived
  host-root `/.well-known/oauth-protected-resource/v1/design/mcp`). It returns
  `authorization_servers: ["https://claude.ai/v1/design/mcp"]`.
  → `discoverOAuthProtectedResourceMetadata(serverUrl)` throws "Resource server
  does not implement Protected Resource Metadata" because it guesses the wrong
  URL. **We must consume the `resource_metadata` URL from the 401 header.**
- AS metadata is published ONLY at the OpenID path
  `https://claude.ai/v1/design/mcp/.well-known/openid-configuration` →
  `authorization_endpoint: https://claude.ai/oauth/authorize`,
  `token_endpoint: https://api.anthropic.com/v1/design/mcp/oauth/token`,
  `registration_endpoint: https://api.anthropic.com/v1/design/mcp/oauth/register`.
  The RFC 8414 path-aware URL
  (`https://claude.ai/.well-known/oauth-authorization-server/v1/design/mcp`)
  returns claude.ai's **SPA `200 text/html`** (catch-all). The SDK's
  `StreamableHTTPClientTransport({authProvider})` connect tries that first,
  JSON-parses the HTML, throws "Failed to parse JSON", and aborts before
  reaching the OpenID doc. → **cannot use the transport `authProvider`
  auto-path; cannot use `discoverAuthorizationServerMetadata(issuer)` blindly.**
- Dynamic client registration is **open**: `POST .../oauth/register` → `201`,
  public client (`token_endpoint_auth_method: "none"`), grants
  `authorization_code` + `refresh_token`. PKCE expected.
- **Cloudflare:** `curl` hits the "Just a moment" JS challenge on some paths;
  **Bun's `fetch` does not.** Kanna runs on Bun, so discovery/token/refresh
  fetches are not Cloudflare-blocked. (Do not shell out to `curl`.)

### Revised approach (replaces "transport authProvider auto-path")

Kanna implements an explicit discovery + auth driver in
`mcp-oauth.adapter.ts`, using the SDK's **granular** helpers (all exported from
`@modelcontextprotocol/sdk/client/auth.js`) for the crypto-bearing legs only:

1. `connect probe` → read `401` `WWW-Authenticate`, extract `resource_metadata`
   URL (fallback to RFC 9728 derivation if header absent).
2. `fetch(resource_metadata)` → `authorization_servers[0]` (issuer).
3. Resolve AS metadata with a **robust candidate list** that prefers
   `${issuer}/.well-known/openid-configuration` and **skips any `200` whose
   content-type is not JSON** (the SPA trap). Helper:
   `discoverAuthorizationServerMetadata` is tried but its result is validated;
   on failure we fetch the OpenID URL directly.
4. `registerClient(...)` (SDK) → store `client_id` keyed by issuer.
5. `startAuthorization(...)` (SDK) → `{ authorizationUrl, codeVerifier }` with
   PKCE + `state` + `resource` param. Persist `flow`; surface the URL.
6. [user authorizes in browser, pastes callback URL]
7. `exchangeAuthorization(...)` (SDK) with the pasted `code` + stored verifier →
   `OAuthTokens`. Persist; `status:"authenticated"`.
8. `refreshAuthorization(...)` (SDK) in `ensureFreshMcpToken`.

The `OAuthClientProvider` interface is still implemented for storage typing, but
the flow is driven by the granular functions above rather than
`transport.finishAuth` / `client.connect`-triggered auth.

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

Exported functions (driven by the explicit discovery + granular SDK helpers
from the "Revised approach" above — NOT `transport.finishAuth` / connect-trigger,
which the probe proved unusable for this server):

- `resolveAuthServer(config) -> { issuer, metadata }`
  Internal. Probe `401` → `WWW-Authenticate` `resource_metadata` URL →
  `fetch` PRM → `authorization_servers[0]` → resolve AS metadata via the robust
  candidate list (prefer `openid-configuration`, skip `200` non-JSON). Cached on
  the `flow` for the complete step.

- `startMcpOAuth(config) -> { authorizationUrl } | { alreadyAuthenticated }`
  `resolveAuthServer` → `registerClient` (if no `client_id` for issuer) →
  `startAuthorization` (PKCE + `state` + `resource`). Persist `flow`
  (verifier/state/discovery/clientId) + `authorizationUrl`, set
  `status:"unauthenticated"`, return the URL.

- `completeMcpOAuth(config, callbackUrl) -> McpServerTestResult`
  Parse `new URL(callbackUrl).searchParams`. Verify `state === flow.state`
  (CSRF). `exchangeAuthorization(...)` with pasted `code` + stored verifier +
  client info → `OAuthTokens`. Persist tokens + `obtainedAt`, clear `flow`, set
  `status:"authenticated"`. Confirm by injecting the bearer and `listTools()`.
  Return `{status:"ok", toolCount}`. Never surface raw `error_description` to the
  UI on failure; set `status:"error"` with a generic message.

- `ensureFreshMcpToken(config) -> string`  (access token)
  If `tokens` absent → throw (caller skips injection). If access token still
  valid (`obtainedAt + expires_in - skew > now`) → return it. Else
  `refreshAuthorization(...)` (SDK) which rotates the token set; persist and
  return the new access token. On refresh failure → set `status:"error"`, throw.

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

`validateMcpServer` (`mcp-validator.ts`) injects the bearer from
`ensureFreshMcpToken` as an `Authorization` header (NOT the transport
`authProvider`, whose auto-discovery the probe proved broken for this server) so
the "Test" button works after auth.

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
