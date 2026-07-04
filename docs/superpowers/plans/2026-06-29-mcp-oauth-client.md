# MCP OAuth Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an OAuth-protected HTTP/SSE MCP server (e.g. Anthropic design MCP) authenticate inside Kanna so its tools register in chats under both drivers.

**Architecture:** A new server adapter (`mcp-oauth.adapter.ts`) drives explicit OAuth discovery (consuming the 401 `WWW-Authenticate` `resource_metadata` URL + the OpenID-config path) and uses the `@modelcontextprotocol/sdk` granular helpers (`registerClient`/`startAuthorization`/`exchangeAuthorization`/`refreshAuthorization`) for the crypto legs. Tokens persist per-server in `settings.json`. At chat spawn, both drivers' MCP-config builders inject a freshly-refreshed `Authorization: Bearer` header for each authenticated server. UI drives a two-step manual callback-paste flow.

**Tech Stack:** TypeScript, Bun, `@modelcontextprotocol/sdk@1.29`, React 19, Kanna WS protocol.

**Spec:** `docs/superpowers/specs/2026-06-29-mcp-oauth-client-design.md` (probe-validated: 20 design tools returned live, 8h token TTL, rotating refresh).

---

## File Structure

- `src/shared/types.ts` — add `McpOAuthState`, extend `McpServerNetworkFields` + `McpServerPatch` + `AppSettingsPatch.customMcpServers` ops + `McpValidationError` codes.
- `src/server/mcp-oauth.adapter.ts` (NEW) — discovery + start/complete/refresh driver. `.adapter.ts` because it performs network IO (side-effect seal).
- `src/server/mcp-oauth.test.ts` (NEW) — adapter unit tests against a fake AS (injected `fetchFn`).
- `src/server/app-settings.ts` — `setOAuthState` patch op; `validateMcpShape` oauth rules; `applyMcpPatch` oauth handling.
- `src/server/agent.ts` — `buildUserMcpServers` gains a resolved-bearer map param.
- `src/server/kanna-mcp-http.ts` — `buildMcpConfigJson` / `toClaudeCliMcpEntry` gain the same map.
- `src/server/mcp-validator.ts` — inject bearer for oauth servers when testing.
- `src/server/ws-router.ts` — `settings.startMcpOAuth` + `settings.completeMcpOAuth` commands.
- `src/client/app/McpServersSection.tsx` — OAuth toggle + Authenticate/Complete UI.
- `CLAUDE.md` — document the OAuth flow under "Custom MCP Servers".

**Key decision:** the two MCP-config builders stay **synchronous + pure**. Token refresh (IO) happens in the adapter; the spawn caller pre-resolves a `Map<serverId, string>` of bearers and passes it in. This preserves the side-effect seal on `agent.ts` / `kanna-mcp-http.ts`.

---

## Task 1: Types — `McpOAuthState` + network field + patch ops

**Files:**
- Modify: `src/shared/types.ts:242-307` (McpServer types) and the `AppSettingsPatch.customMcpServers` union (~line 804).

- [ ] **Step 1: Add the OAuth state type + extend network fields**

In `src/shared/types.ts`, import the SDK auth types at the top of the file (with the other imports):

```ts
import type {
  OAuthTokens,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js"
```

Add after `McpServerTestResult` (after line 248):

```ts
export interface McpOAuthFlowState {
  codeVerifier: string
  state: string
  issuer: string
  authorizationUrl: string
  // AS metadata cached between start and complete (avoids re-discovery)
  metadata: Record<string, unknown>
}

export interface McpOAuthState {
  enabled: boolean
  status: "unauthenticated" | "authenticated" | "error"
  errorMessage?: string
  // resolved AS issuer (set on complete; used by refresh without re-discovery)
  issuer?: string
  // DCR result keyed by AS issuer (SEP-2352)
  clientByIssuer?: Record<string, OAuthClientInformationFull>
  tokens?: OAuthTokens
  obtainedAt?: number
  // present only mid-flow; cleared on complete/cancel
  flow?: McpOAuthFlowState
}
```

Extend `McpServerNetworkFields` (line 267-271):

```ts
export interface McpServerNetworkFields {
  transport: "http" | "sse" | "ws"
  url: string
  headers: Record<string, string>
  oauth?: McpOAuthState
}
```

Extend `McpServerPatch` (line 281) — add inside the `Partial<{...}>`:

```ts
  oauth: McpOAuthState
```

Add validation codes to `McpValidationError.code` (line 295-304):

```ts
    | "INVALID_OAUTH_TRANSPORT"
```

- [ ] **Step 2: Add the `setOAuthState` patch op**

Find `AppSettingsPatch` `customMcpServers` union (around line 804) and add `setOAuthState` alongside `setTestResult`:

```ts
  customMcpServers?: {
    create?: McpServerInput
    update?: { id: string; patch: McpServerPatch }
    delete?: { id: string }
    setEnabled?: { id: string; enabled: boolean }
    setTestResult?: { id: string; result: McpServerTestResult }
    setOAuthState?: { id: string; oauth: McpOAuthState }
  }
```

(Keep the existing fields; only `setOAuthState` is new.)

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit 2>&1 | head -20`
Expected: no new errors referencing `types.ts` (downstream files will error until later tasks — that's fine; confirm `types.ts` itself is clean).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(mcp-oauth): add McpOAuthState types and setOAuthState patch op"
```

---

## Task 2: `mcp-oauth.adapter.ts` — discovery + register + startAuthorization

**Files:**
- Create: `src/server/mcp-oauth.adapter.ts`
- Test: `src/server/mcp-oauth.test.ts`

The adapter takes an injected `fetchFn` (default global `fetch`) so tests run against a fake AS with no network.

- [ ] **Step 1: Write the failing test for discovery + start**

Create `src/server/mcp-oauth.test.ts`:

```ts
import { test, expect } from "bun:test"
import { startMcpOAuth } from "./mcp-oauth.adapter"
import type { McpServerConfig } from "../shared/types"

function baseConfig(): McpServerConfig {
  return {
    id: "s1",
    name: "design",
    enabled: true,
    createdAt: "2026-06-29T00:00:00Z",
    updatedAt: "2026-06-29T00:00:00Z",
    lastTest: { status: "untested" },
    transport: "http",
    url: "https://example.test/v1/mcp",
    headers: {},
    oauth: { enabled: true, status: "unauthenticated" },
  }
}

// Fake AS: 401 -> PRM -> openid-config -> register -> (authorize is browser).
function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    if (url === "https://example.test/v1/mcp" && init?.method === "POST" && !(init.headers as Record<string, string>)?.Authorization) {
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://example.test/v1/.well-known/oauth-protected-resource"',
        },
      })
    }
    if (url === "https://example.test/v1/.well-known/oauth-protected-resource") {
      return json({ authorization_servers: ["https://as.test/v1/mcp"], scopes_supported: ["a", "b"] })
    }
    if (url === "https://as.test/v1/mcp/.well-known/openid-configuration") {
      return json({
        issuer: "https://as.test/v1/mcp",
        authorization_endpoint: "https://as.test/oauth/authorize",
        token_endpoint: "https://as.test/oauth/token",
        registration_endpoint: "https://as.test/oauth/register",
        code_challenge_methods_supported: ["S256"],
      })
    }
    if (url === "https://as.test/oauth/register") {
      return json({ client_id: "client-123", redirect_uris: ["http://localhost:8765/callback"] }, 201)
    }
    throw new Error("unexpected fetch: " + url)
  }) as unknown as typeof fetch
}

test("startMcpOAuth discovers AS, registers, and returns an authorization URL", async () => {
  const cfg = baseConfig()
  const persisted: Record<string, unknown>[] = []
  const result = await startMcpOAuth(cfg, {
    fetchFn: fakeFetch(),
    persist: (oauth) => persisted.push(oauth as never),
  })
  expect(result.kind).toBe("authorizationUrl")
  if (result.kind !== "authorizationUrl") throw new Error("unreachable")
  const u = new URL(result.authorizationUrl)
  expect(u.origin + u.pathname).toBe("https://as.test/oauth/authorize")
  expect(u.searchParams.get("client_id")).toBe("client-123")
  expect(u.searchParams.get("code_challenge_method")).toBe("S256")
  expect(u.searchParams.get("resource")).toBe("https://example.test/v1/mcp")
  // flow persisted for the complete step
  const last = persisted.at(-1) as { flow?: { state?: string; codeVerifier?: string } }
  expect(last.flow?.state).toBeTruthy()
  expect(last.flow?.codeVerifier).toBeTruthy()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test --conditions production src/server/mcp-oauth.test.ts`
Expected: FAIL — `Cannot find module './mcp-oauth.adapter'`.

- [ ] **Step 3: Implement discovery + start**

Create `src/server/mcp-oauth.adapter.ts`:

```ts
import {
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import type { McpServerConfig, McpOAuthState, McpServerTestResult } from "../shared/types"

const REDIRECT_URI = "http://localhost:8765/callback"

const CLIENT_METADATA: OAuthClientMetadata = {
  client_name: "Kanna MCP OAuth",
  redirect_uris: [REDIRECT_URI],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  application_type: "native",
}

export interface McpOAuthDeps {
  fetchFn?: typeof fetch
  persist: (oauth: McpOAuthState) => void
}

export type StartResult =
  | { kind: "authorizationUrl"; authorizationUrl: string }
  | { kind: "alreadyAuthenticated" }

function requireNetworkUrl(config: McpServerConfig): string {
  if (config.transport === "stdio") throw new Error("oauth not supported for stdio")
  return config.url
}

// Parse the resource_metadata URL out of a WWW-Authenticate Bearer challenge.
function resourceMetadataUrl(header: string | null, serverUrl: string): string {
  const m = header?.match(/resource_metadata="([^"]+)"/)
  if (m) return m[1]!
  // RFC 9728 fallback: host-root well-known with the resource path appended.
  const u = new URL(serverUrl)
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`
}

interface ResolvedAuthServer {
  issuer: string
  scope: string
  metadata: Record<string, unknown>
}

async function resolveAuthServer(
  config: McpServerConfig,
  fetchFn: typeof fetch,
): Promise<ResolvedAuthServer> {
  const serverUrl = requireNetworkUrl(config)
  // 1. probe for the 401 challenge
  const probe = await fetchFn(serverUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  })
  const prmUrl = resourceMetadataUrl(probe.headers.get("www-authenticate"), serverUrl)
  // 2. protected-resource metadata
  const prm = (await (await fetchFn(prmUrl, { headers: { accept: "application/json" } })).json()) as {
    authorization_servers?: string[]
    scopes_supported?: string[]
  }
  const issuer = prm.authorization_servers?.[0]
  if (!issuer) throw new Error("protected-resource metadata has no authorization_servers")
  const scope = (prm.scopes_supported ?? []).join(" ")
  // 3. AS metadata — prefer OpenID config; skip any 200 that is not JSON (SPA trap)
  const candidates = [
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
    `${new URL(issuer).origin}/.well-known/oauth-authorization-server${new URL(issuer).pathname}`,
  ]
  for (const c of candidates) {
    const r = await fetchFn(c, { headers: { accept: "application/json" } })
    const ct = r.headers.get("content-type") ?? ""
    if (r.ok && ct.includes("json")) {
      const metadata = (await r.json()) as Record<string, unknown>
      if (metadata.authorization_endpoint && metadata.token_endpoint) {
        return { issuer, scope, metadata }
      }
    }
  }
  throw new Error("could not resolve authorization-server metadata")
}

export async function startMcpOAuth(
  config: McpServerConfig,
  deps: McpOAuthDeps,
): Promise<StartResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const prev = config.transport === "stdio" ? undefined : config.oauth
  if (prev?.status === "authenticated" && prev.tokens) {
    return { kind: "alreadyAuthenticated" }
  }
  const { issuer, scope, metadata } = await resolveAuthServer(config, fetchFn)
  const existingClient = prev?.clientByIssuer?.[issuer]
  const client =
    existingClient ??
    (await registerClient(issuer, {
      metadata: metadata as never,
      clientMetadata: CLIENT_METADATA,
      scope,
      fetchFn,
    }))
  const state = crypto.randomUUID()
  const { authorizationUrl, codeVerifier } = await startAuthorization(issuer, {
    metadata: metadata as never,
    clientInformation: client,
    redirectUrl: REDIRECT_URI,
    scope,
    state,
    resource: new URL(requireNetworkUrl(config)),
  })
  const next: McpOAuthState = {
    enabled: true,
    status: "unauthenticated",
    clientByIssuer: { ...(prev?.clientByIssuer ?? {}), [issuer]: client },
    tokens: prev?.tokens,
    obtainedAt: prev?.obtainedAt,
    flow: {
      codeVerifier,
      state,
      issuer,
      authorizationUrl: authorizationUrl.toString(),
      metadata,
    },
  }
  deps.persist(next)
  return { kind: "authorizationUrl", authorizationUrl: authorizationUrl.toString() }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test --conditions production src/server/mcp-oauth.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/server/mcp-oauth.adapter.ts src/server/mcp-oauth.test.ts
git commit -m "feat(mcp-oauth): discovery + register + startAuthorization driver"
```

---

## Task 3: `mcp-oauth.adapter.ts` — completeMcpOAuth (token exchange)

**Files:**
- Modify: `src/server/mcp-oauth.adapter.ts`
- Test: `src/server/mcp-oauth.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/server/mcp-oauth.test.ts`:

```ts
import { completeMcpOAuth } from "./mcp-oauth.adapter"

function authedConfigWithFlow(): McpServerConfig {
  const c = baseConfig()
  c.oauth = {
    enabled: true,
    status: "unauthenticated",
    clientByIssuer: {
      "https://as.test/v1/mcp": { client_id: "client-123", redirect_uris: ["http://localhost:8765/callback"] } as never,
    },
    flow: {
      codeVerifier: "verifier-xyz",
      state: "state-abc",
      issuer: "https://as.test/v1/mcp",
      authorizationUrl: "https://as.test/oauth/authorize?...",
      metadata: {
        issuer: "https://as.test/v1/mcp",
        authorization_endpoint: "https://as.test/oauth/authorize",
        token_endpoint: "https://as.test/oauth/token",
      },
    },
  }
  return c
}

function tokenFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url === "https://as.test/oauth/token") {
      return new Response(
        JSON.stringify({ access_token: "AT", refresh_token: "RT", token_type: "Bearer", expires_in: 28800, scope: "a b" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    throw new Error("unexpected fetch: " + url)
  }) as unknown as typeof fetch
}

test("completeMcpOAuth rejects on state mismatch", async () => {
  const cfg = authedConfigWithFlow()
  await expect(
    completeMcpOAuth(cfg, "http://localhost:8765/callback?code=C&state=WRONG", {
      fetchFn: tokenFetch(),
      persist: () => {},
      listTools: async () => 20,
    }),
  ).rejects.toThrow(/state/i)
})

test("completeMcpOAuth exchanges code, persists tokens, returns ok", async () => {
  const cfg = authedConfigWithFlow()
  let saved: McpOAuthStateForTest | undefined
  const result = await completeMcpOAuth(cfg, "http://localhost:8765/callback?code=C&state=state-abc", {
    fetchFn: tokenFetch(),
    persist: (o) => { saved = o as never },
    listTools: async () => 20,
  })
  expect(result.status).toBe("ok")
  if (result.status !== "ok") throw new Error("unreachable")
  expect(result.toolCount).toBe(20)
  expect(saved?.status).toBe("authenticated")
  expect(saved?.tokens?.access_token).toBe("AT")
  expect(saved?.tokens?.refresh_token).toBe("RT")
  expect(saved?.flow).toBeUndefined()
})
```

Add at the top of the test file (after imports):

```ts
type McpOAuthStateForTest = import("../shared/types").McpOAuthState
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --conditions production src/server/mcp-oauth.test.ts`
Expected: FAIL — `completeMcpOAuth` not exported.

- [ ] **Step 3: Implement completeMcpOAuth**

Append to `src/server/mcp-oauth.adapter.ts`:

```ts
export interface CompleteDeps {
  fetchFn?: typeof fetch
  persist: (oauth: McpOAuthState) => void
  // injected so the adapter does not import the validator (avoids a cycle);
  // returns tool count after a bearer-authenticated listTools.
  listTools: (serverUrl: string, accessToken: string) => Promise<number>
}

export async function completeMcpOAuth(
  config: McpServerConfig,
  callbackUrl: string,
  deps: CompleteDeps,
): Promise<McpServerTestResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const oauth = config.transport === "stdio" ? undefined : config.oauth
  const flow = oauth?.flow
  if (!oauth || !flow) throw new Error("no pending OAuth flow; start authentication first")
  const params = new URL(callbackUrl).searchParams
  if (params.get("state") !== flow.state) throw new Error("OAuth state mismatch (possible CSRF)")
  const code = params.get("code")
  if (!code) throw new Error("callback URL missing authorization code")
  const client = oauth.clientByIssuer?.[flow.issuer]
  if (!client) throw new Error("missing registered client for issuer")

  let tokens: OAuthTokens
  try {
    tokens = await exchangeAuthorization(flow.issuer, {
      metadata: flow.metadata as never,
      clientInformation: client,
      authorizationCode: code,
      codeVerifier: flow.codeVerifier,
      redirectUri: REDIRECT_URI,
      resource: new URL(requireNetworkUrl(config)),
      fetchFn,
    })
  } catch (err) {
    const next: McpOAuthState = { ...oauth, status: "error", errorMessage: "token exchange failed", flow: undefined }
    deps.persist(next)
    return { status: "error", testedAt: new Date().toISOString(), message: "token exchange failed" }
  }

  const toolCount = await deps.listTools(requireNetworkUrl(config), tokens.access_token)
  const next: McpOAuthState = {
    enabled: true,
    status: "authenticated",
    clientByIssuer: oauth.clientByIssuer,
    tokens,
    obtainedAt: Date.now(),
    flow: undefined,
  }
  deps.persist(next)
  return { status: "ok", testedAt: new Date().toISOString(), toolCount }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test --conditions production src/server/mcp-oauth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/mcp-oauth.adapter.ts src/server/mcp-oauth.test.ts
git commit -m "feat(mcp-oauth): completeMcpOAuth token exchange + persistence"
```

---

## Task 4: `ensureFreshMcpToken` (refresh-on-expiry)

**Files:**
- Modify: `src/server/mcp-oauth.adapter.ts`
- Test: `src/server/mcp-oauth.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `src/server/mcp-oauth.test.ts`:

```ts
import { ensureFreshMcpToken } from "./mcp-oauth.adapter"

function freshTokenConfig(obtainedAt: number, expiresIn: number): McpServerConfig {
  const c = baseConfig()
  c.oauth = {
    enabled: true,
    status: "authenticated",
    clientByIssuer: { "https://as.test/v1/mcp": { client_id: "client-123" } as never },
    tokens: { access_token: "OLD", refresh_token: "RT", token_type: "Bearer", expires_in: expiresIn } as never,
    obtainedAt,
  }
  // stash issuer/metadata for refresh by reusing flow-less storage:
  return c
}

test("ensureFreshMcpToken returns cached token when still valid", async () => {
  const cfg = freshTokenConfig(Date.now(), 28800)
  const token = await ensureFreshMcpToken(cfg, {
    fetchFn: tokenFetch(),
    persist: () => {},
    metadataByIssuer: { "https://as.test/v1/mcp": { token_endpoint: "https://as.test/oauth/token" } },
  })
  expect(token).toBe("OLD")
})

test("ensureFreshMcpToken refreshes and persists rotated tokens when expired", async () => {
  const cfg = freshTokenConfig(Date.now() - 30000 * 1000, 28800)
  let saved: McpOAuthStateForTest | undefined
  const token = await ensureFreshMcpToken(cfg, {
    fetchFn: tokenFetch(),
    persist: (o) => { saved = o as never },
    metadataByIssuer: { "https://as.test/v1/mcp": { token_endpoint: "https://as.test/oauth/token" } },
  })
  expect(token).toBe("AT")
  expect(saved?.tokens?.refresh_token).toBe("RT")
  expect(saved?.obtainedAt).toBeGreaterThan(0)
})
```

> Note: refresh uses the `issuer` field added to `McpOAuthState` in Task 1. Ensure `startMcpOAuth`'s `next` sets `issuer` and `completeMcpOAuth`'s `next` sets `issuer: flow.issuer` (add these one-line assignments in the Task 2/3 objects if not already present, and re-run their tests).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --conditions production src/server/mcp-oauth.test.ts`
Expected: FAIL — `ensureFreshMcpToken` not exported.

- [ ] **Step 3: Implement ensureFreshMcpToken**

Append to `src/server/mcp-oauth.adapter.ts`:

```ts
const EXPIRY_SKEW_MS = 60_000

export interface EnsureFreshDeps {
  fetchFn?: typeof fetch
  persist: (oauth: McpOAuthState) => void
  // AS metadata per issuer (token_endpoint). Provided by the caller, which
  // already holds it; falls back to a minimal { token_endpoint } if absent.
  metadataByIssuer?: Record<string, Record<string, unknown>>
}

export async function ensureFreshMcpToken(
  config: McpServerConfig,
  deps: EnsureFreshDeps,
): Promise<string> {
  const fetchFn = deps.fetchFn ?? fetch
  const oauth = config.transport === "stdio" ? undefined : config.oauth
  if (!oauth?.tokens?.access_token) throw new Error("server is not authenticated")
  const tokens = oauth.tokens
  const expiresInMs = (tokens.expires_in ?? 0) * 1000
  const stillValid =
    oauth.obtainedAt !== undefined && oauth.obtainedAt + expiresInMs - EXPIRY_SKEW_MS > Date.now()
  if (stillValid) return tokens.access_token
  if (!tokens.refresh_token) throw new Error("access token expired and no refresh token")
  const issuer = oauth.issuer
  if (!issuer) throw new Error("missing issuer for refresh")
  const client = oauth.clientByIssuer?.[issuer]
  if (!client) throw new Error("missing client for refresh")
  const metadata = deps.metadataByIssuer?.[issuer]
  try {
    const next = await refreshAuthorization(issuer, {
      metadata: metadata as never,
      clientInformation: client,
      refreshToken: tokens.refresh_token,
      resource: new URL(requireNetworkUrl(config)),
      fetchFn,
    })
    const updated: McpOAuthState = {
      ...oauth,
      status: "authenticated",
      tokens: next,
      obtainedAt: Date.now(),
    }
    deps.persist(updated)
    return next.access_token
  } catch (err) {
    deps.persist({ ...oauth, status: "error", errorMessage: "token refresh failed" })
    throw err instanceof Error ? err : new Error("token refresh failed")
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test --conditions production src/server/mcp-oauth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/mcp-oauth.adapter.ts src/server/mcp-oauth.test.ts src/shared/types.ts
git commit -m "feat(mcp-oauth): ensureFreshMcpToken refresh-on-expiry with token rotation"
```

---

## Task 5: Settings validation + patch op (`setOAuthState`)

**Files:**
- Modify: `src/server/app-settings.ts` (`validateMcpShape:998`, `applyMcpPatch:1053`, patch dispatch `:1167-1198`)
- Test: `src/server/app-settings.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/server/app-settings.test.ts` (follow the file's existing import + harness style):

```ts
test("validateMcpShape rejects oauth.enabled on stdio transport", () => {
  const entry = {
    id: "x", name: "bad", enabled: true,
    createdAt: "t", updatedAt: "t", lastTest: { status: "untested" } as const,
    transport: "stdio" as const, command: "echo", args: [], env: {},
    // @ts-expect-error intentionally invalid shape for the test
    oauth: { enabled: true, status: "unauthenticated" },
  }
  const err = validateMcpShape(entry as never, [])
  expect(err?.code).toBe("INVALID_OAUTH_TRANSPORT")
})

test("applyAppSettingsPatch setOAuthState updates the entry oauth block", () => {
  // build a state with one http entry, then patch setOAuthState; assert persisted.
  // (use the same state-builder helper the other app-settings tests use)
})
```

> Use `validateMcpShape` via its existing export/test access in that file; if it is not exported, test through `applyAppSettingsPatch` create with an invalid oauth shape and assert the returned error.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --conditions production src/server/app-settings.test.ts`
Expected: FAIL — no `INVALID_OAUTH_TRANSPORT` handling / no `setOAuthState` branch.

- [ ] **Step 3: Implement validation + patch op**

In `validateMcpShape` (`src/server/app-settings.ts:998`), after the transport-specific checks, add:

```ts
  if (entry.transport === "stdio" && "oauth" in entry && (entry as { oauth?: { enabled?: boolean } }).oauth?.enabled) {
    return { code: "INVALID_OAUTH_TRANSPORT", field: "oauth", message: "OAuth is only supported for http/sse transports" }
  }
```

In the `customMcpServers` patch dispatch (after the `setTestResult` branch at line ~1195), add:

```ts
  } else if (patch.customMcpServers?.setOAuthState) {
    const { id, oauth } = patch.customMcpServers.setOAuthState
    nextMcpServers = state.customMcpServers.map((s) =>
      s.id === id && s.transport !== "stdio" ? { ...s, oauth } : s,
    )
```

In `applyMcpPatch` (`:1053`), ensure an `oauth` patch field is merged for network transports:

```ts
  if (patch.oauth !== undefined && existing.transport !== "stdio") {
    return { ...existing, oauth: patch.oauth }
  }
```

(Place alongside the other field merges; keep existing behavior.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun test --conditions production src/server/app-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/app-settings.ts src/server/app-settings.test.ts
git commit -m "feat(mcp-oauth): settings validation + setOAuthState patch op"
```

---

## Task 6: Spawn-time bearer injection (both drivers)

**Files:**
- Modify: `src/server/agent.ts` (`buildUserMcpServers:76`)
- Modify: `src/server/kanna-mcp-http.ts` (`buildMcpConfigJson:194`, `toClaudeCliMcpEntry:215`)
- Test: `src/server/agent.test.ts`, `src/server/kanna-mcp-http.test.ts`

The builders stay sync + pure; they take a resolved-bearer map.

- [ ] **Step 1: Write failing tests**

Add to `src/server/kanna-mcp-http.test.ts`:

```ts
test("buildMcpConfigJson injects oauth bearer header for authenticated server", () => {
  const json = buildMcpConfigJson(
    { url: "http://loopback/mcp", bearerToken: "KANNA" },
    [
      {
        id: "s1", name: "design", enabled: true, createdAt: "t", updatedAt: "t",
        lastTest: { status: "untested" }, transport: "http",
        url: "https://api.example/mcp", headers: {},
        oauth: { enabled: true, status: "authenticated", tokens: { access_token: "AT" } as never },
      },
    ],
    new Map([["s1", "AT"]]),
  )
  const parsed = JSON.parse(json)
  expect(parsed.mcpServers.design.headers.Authorization).toBe("Bearer AT")
})

test("buildMcpConfigJson omits Authorization when no bearer resolved", () => {
  const json = buildMcpConfigJson(
    { url: "http://loopback/mcp", bearerToken: "KANNA" },
    [{ id: "s2", name: "plain", enabled: true, createdAt: "t", updatedAt: "t", lastTest: { status: "untested" }, transport: "http", url: "https://api.example/mcp", headers: {} }],
    new Map(),
  )
  const parsed = JSON.parse(json)
  expect(parsed.mcpServers.plain.headers?.Authorization).toBeUndefined()
})
```

Add an equivalent test to `src/server/agent.test.ts` for `buildUserMcpServers` asserting `out.design.headers.Authorization === "Bearer AT"`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --conditions production src/server/kanna-mcp-http.test.ts`
Expected: FAIL — `buildMcpConfigJson` takes 2 args / no bearer map.

- [ ] **Step 3: Implement the bearer-map param**

In `src/server/kanna-mcp-http.ts`, change `buildMcpConfigJson` (line 194) signature and body:

```ts
export function buildMcpConfigJson(
  handle: { url: string; bearerToken: string },
  userServers: readonly McpServerConfig[] = [],
  oauthBearers: ReadonlyMap<string, string> = new Map(),
): string {
  const mcpServers: Record<string, unknown> = {
    [KANNA_MCP_SERVER_NAME]: {
      type: "http", url: handle.url,
      headers: { Authorization: `Bearer ${handle.bearerToken}` },
    },
  }
  for (const s of userServers) {
    if (!s.enabled) continue
    if (s.name === KANNA_MCP_SERVER_NAME) continue
    mcpServers[s.name] = toClaudeCliMcpEntry(s, oauthBearers.get(s.id))
  }
  return JSON.stringify({ mcpServers })
}
```

In `toClaudeCliMcpEntry` (line 215), add an `oauthBearer?: string` param and, for network transports, merge the header:

```ts
function toClaudeCliMcpEntry(s: McpServerConfig, oauthBearer?: string): Record<string, unknown> {
  if (s.transport === "stdio") {
    return { type: "stdio", command: s.command, args: s.args, env: s.env, ...(s.cwd ? { cwd: s.cwd } : {}) }
  }
  const headers = oauthBearer ? { ...s.headers, Authorization: `Bearer ${oauthBearer}` } : s.headers
  return { type: s.transport, url: s.url, headers }
}
```

In `src/server/agent.ts` `buildUserMcpServers` (line 76), add the same third param and set `headers.Authorization` from `oauthBearers.get(s.id)` for the http/sse/ws branch.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test --conditions production src/server/kanna-mcp-http.test.ts src/server/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the resolver at the spawn call sites**

Find every caller of `buildUserMcpServers` and `buildMcpConfigJson` in `agent.ts` / `kanna-mcp-http.ts` / `claude-pty/driver.ts`. Before each, build the bearer map:

```ts
const oauthBearers = new Map<string, string>()
for (const s of enabledCustomMcpServers) {
  if (s.transport !== "stdio" && s.oauth?.status === "authenticated") {
    try {
      oauthBearers.set(s.id, await ensureFreshMcpToken(s, {
        persist: (oauth) => void appSettings.writePatch({ customMcpServers: { setOAuthState: { id: s.id, oauth } } }),
        metadataByIssuer: s.oauth.issuer && s.oauth.flow?.metadata ? { [s.oauth.issuer]: s.oauth.flow.metadata } : undefined,
      }))
    } catch (err) {
      console.warn("[kanna/mcp-oauth] token refresh failed for", s.name, err)
    }
  }
}
```

Pass `oauthBearers` as the new third arg. (These call sites are already `async`.)

- [ ] **Step 6: Run the full server build + targeted tests**

Run: `bun run tsc --noEmit 2>&1 | head -20` then `bun test --conditions production src/server/agent.test.ts src/server/kanna-mcp-http.test.ts`
Expected: typecheck clean; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/agent.ts src/server/kanna-mcp-http.ts src/server/claude-pty/driver.ts src/server/agent.test.ts src/server/kanna-mcp-http.test.ts
git commit -m "feat(mcp-oauth): inject refreshed bearer into both drivers at spawn"
```

---

## Task 7: `validateMcpServer` uses the bearer for oauth servers

**Files:**
- Modify: `src/server/mcp-validator.ts` (`buildTransport:59`)
- Test: `src/server/mcp-validator.test.ts` (create if absent — follow `mcp-oauth.test.ts` fake-fetch style; or assert header passed via a stub transport)

- [ ] **Step 1: Write the failing test**

Assert that when a config has `oauth.status==="authenticated"` and a caller-supplied bearer, `buildTransport` sets `requestInit.headers.Authorization`. Expose a small pure helper `networkHeaders(config, bearer?)` returning the merged header object and unit-test that (keeps the network out of the test):

```ts
import { networkHeaders } from "./mcp-validator"
test("networkHeaders adds bearer for oauth server", () => {
  expect(networkHeaders({ headers: { X: "1" } } as never, "AT")).toEqual({ X: "1", Authorization: "Bearer AT" })
})
```

- [ ] **Step 2: Run to verify it fails** — `networkHeaders` not exported.

- [ ] **Step 3: Implement** — add `export function networkHeaders(config, bearer?)`, use it in the http/sse branches of `buildTransport`, and thread an optional `bearer` through `validateMcpServer(config, opts)` (`opts.bearer`). The ws-router test command (Task 8) and the auto-test call `ensureFreshMcpToken` first for oauth servers and pass the bearer.

- [ ] **Step 4: Run to verify it passes** — `bun test --conditions production src/server/mcp-validator.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/server/mcp-validator.ts src/server/mcp-validator.test.ts
git commit -m "feat(mcp-oauth): validateMcpServer sends bearer for authenticated oauth servers"
```

---

## Task 8: WS commands — start/complete OAuth

**Files:**
- Modify: `src/server/ws-router.ts` (after `settings.testMcpServer:1441`)
- Test: `src/server/ws-router.test.ts`

- [ ] **Step 1: Write failing tests** — mirror the `settings.testMcpServer` test: a `settings.startMcpOAuth` command returns `{ authorizationUrl }` and persists `setOAuthState`; `settings.completeMcpOAuth` with a stubbed `mcp-oauth` module returns a `McpServerTestResult` and persists `authenticated`. Stub `startMcpOAuth`/`completeMcpOAuth` via dependency injection or a module mock consistent with how the suite stubs `validateMcpServer`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the two command cases** in the same `switch` as `settings.testMcpServer`:

```ts
case "settings.startMcpOAuth": {
  const snapshot = resolvedAppSettings.getSnapshot()
  const entry = snapshot.customMcpServers.find((s) => s.id === command.id)
  if (!entry || entry.transport === "stdio") {
    send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: "not found or unsupported transport" } })
    return
  }
  try {
    const result = await startMcpOAuth(entry, {
      persist: (oauth) => void resolvedAppSettings.writePatch({ customMcpServers: { setOAuthState: { id: entry.id, oauth } } }),
    })
    send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true, ...(result.kind === "authorizationUrl" ? { authorizationUrl: result.authorizationUrl } : { alreadyAuthenticated: true }) } })
  } catch (err) {
    send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: err instanceof Error ? err.message : "oauth start failed" } })
  }
  return
}
case "settings.completeMcpOAuth": {
  const snapshot = resolvedAppSettings.getSnapshot()
  const entry = snapshot.customMcpServers.find((s) => s.id === command.id)
  if (!entry || entry.transport === "stdio") {
    send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: "not found" } })
    return
  }
  try {
    const result = await completeMcpOAuth(entry, command.callbackUrl, {
      persist: (oauth) => void resolvedAppSettings.writePatch({ customMcpServers: { setOAuthState: { id: entry.id, oauth } } }),
      listTools: async (serverUrl, accessToken) => {
        const r = await validateMcpServer({ ...entry, headers: { ...entry.headers, Authorization: `Bearer ${accessToken}` } } as never)
        return r.status === "ok" ? r.toolCount : 0
      },
    })
    send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true, testResult: result } })
  } catch (err) {
    send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: err instanceof Error ? err.message : "oauth complete failed" } })
  }
  return
}
```

Add the imports at the top of `ws-router.ts`:

```ts
import { startMcpOAuth, completeMcpOAuth } from "./mcp-oauth.adapter"
```

Add the two command shapes to the WS command protocol type (wherever `settings.testMcpServer` is declared — `src/shared/` protocol types): `{ type: "settings.startMcpOAuth"; id: string }` and `{ type: "settings.completeMcpOAuth"; id: string; callbackUrl: string }`.

- [ ] **Step 4: Run to verify it passes** — `bun test --conditions production src/server/ws-router.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/server/ws-router.ts src/shared/ src/server/ws-router.test.ts
git commit -m "feat(mcp-oauth): ws commands startMcpOAuth + completeMcpOAuth"
```

---

## Task 9: Settings UI — OAuth toggle + Authenticate/Complete

**Files:**
- Modify: `src/client/app/McpServersSection.tsx`
- Apply the `impeccable` skill for visual consistency (project rule 3).
- Test: co-locate per `kanna-react-style` (a `.test.tsx` mounting the row, asserting the Authenticate button appears for an unauthenticated oauth http server and calls the WS command).

- [ ] **Step 1: Read the existing component** and locate the network-transport row (where `headers` and the "Test" button render). Note the WS-send helper the section already uses (the same one behind the "Test" button → `settings.testMcpServer`).

- [ ] **Step 2: Write the failing test** mounting a single http row with `oauth: { enabled: true, status: "unauthenticated" }`; assert an "Authenticate" button renders and clicking it invokes the section's send helper with `{ type: "settings.startMcpOAuth", id }`.

- [ ] **Step 3: Implement** for http/sse rows:
  - An **OAuth** checkbox bound to `oauth.enabled` (patches via `update` → `{ oauth: { enabled, status: "unauthenticated" } }`); when on, disable the manual `Authorization` header input.
  - When `oauth?.enabled && oauth.status !== "authenticated"`: an **Authenticate** button → send `settings.startMcpOAuth`; on `authorizationUrl` ack, render the URL (open-in-new + copy) and a **callback URL** text input + **Complete** button → send `settings.completeMcpOAuth` with the pasted value.
  - A status pill reusing the `lastTest` pill styles: `unauthenticated` / `authenticated` / `error` (+ `errorMessage` tooltip via the project Tooltip component, not native `title`).
  - A **Re-authenticate** button when `authenticated` or `error`.

- [ ] **Step 4: Run to verify it passes** — `bun test --conditions production src/client/app/McpServersSection.test.tsx`.

- [ ] **Step 5: Lint + commit**

```bash
bun run lint 2>&1 | tail -5
git add src/client/app/McpServersSection.tsx src/client/app/McpServersSection.test.tsx
git commit -m "feat(mcp-oauth): settings UI for OAuth authenticate/complete"
```

---

## Task 10: Full suite, lint, docs, C3

- [ ] **Step 1: Full test + lint**

Run: `bun run test 2>&1 | tail -15` then `bun run lint 2>&1 | tail -5`
Expected: all pass; **0 lint warnings** (verify no `node:*`/IO leaked outside the `.adapter.ts` — the adapter uses only `fetch` + SDK + `crypto.randomUUID`, all allowed).

- [ ] **Step 2: Manual smoke (real design MCP)** — register the design server in Settings, toggle OAuth, Authenticate, paste callback, confirm status → `authenticated`, then start a chat and confirm `mcp__design__*` tools are usable (`list_projects` etc.). If you cannot drive the browser, state so explicitly.

- [ ] **Step 3: Docs** — add a "Custom MCP Servers → OAuth" subsection to `CLAUDE.md` documenting: explicit discovery (why SDK auto-discovery is bypassed), the two-step paste flow, the 8h-TTL static-header bound, token rotation, and that secrets persist in `settings.json` (0600).

- [ ] **Step 4: C3** — run `/c3 change` (or `c3x lookup` for the touched files) to update `.c3/` if any component boundary/ref/rule changed. Commit `.c3/` updates in this PR.

- [ ] **Step 5: Commit + open PR**

```bash
git add CLAUDE.md .c3/
git commit -m "docs(mcp-oauth): document OAuth MCP flow + C3 updates"
git push -u origin feat/mcp-oauth-client
gh pr create --repo cuongtranba/kanna --base main --head feat/mcp-oauth-client \
  --title "feat: OAuth client for HTTP/SSE MCP servers" \
  --body "$(cat <<'EOF'
## Summary
- Adds full MCP-spec OAuth (discovery + DCR + PKCE + refresh) for http/sse custom MCP servers, driven by the MCP SDK granular helpers with explicit discovery (Anthropic design MCP serves AS metadata only at the OpenID path; RFC8414 path returns the claude.ai SPA, breaking SDK auto-discovery).
- Manual callback-paste UX in Settings. Bearer injected into both drivers at spawn; refreshed on expiry (rotating refresh tokens).
- Probe-validated end-to-end: 20 design tools returned live, 8h token TTL.

## Test plan
- [ ] `bun run test` green
- [ ] `bun run lint` 0 warnings
- [ ] Manual: authenticate design MCP, tools register in chat
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** types (T1), adapter start/complete/refresh (T2-4), validation+patch (T5), spawn injection both drivers (T6), validator bearer (T7), ws commands (T8), UI (T9), docs/C3/PR (T10). All spec sections mapped.
- **Type consistency:** `McpOAuthState` fields (`clientByIssuer`, `tokens`, `obtainedAt`, `issuer`, `flow`) used identically across adapter, settings, and spawn resolver. `ensureFreshMcpToken` returns `string`; builders take `ReadonlyMap<string,string>` keyed by server `id`.
- **Known follow-up:** `issuer` field on `McpOAuthState` is introduced in T1 but first exercised in T4 — T4 Step 1 note flags going back to set it in T2/T3 `next` objects.
- **Side-effect seal:** all network IO confined to `mcp-oauth.adapter.ts` (allowed: `fetch`); builders stay pure; `persist` injected as a callback.
