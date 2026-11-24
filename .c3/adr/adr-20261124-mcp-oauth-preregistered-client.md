---
id: adr-20261124-mcp-oauth-preregistered-client
c3-seal: ff4175c021ae20294c044cd5640ddb701fdf9ee98613a2841ba7e114da99727d
title: mcp-oauth-preregistered-client
type: adr
goal: Let a custom MCP server authenticate with a pre-registered OAuth client, so an authorization server that offers no dynamic client registration (Slack at https://mcp.slack.com/mcp) works. The client id, an optional client secret and an optional callback port are stored on the server's OAuth state and win over dynamic client registration.
status: proposed
date: "2026-11-24"
---

## Goal

Let a custom MCP server authenticate with a pre-registered OAuth client, so an authorization server that offers no dynamic client registration (Slack at https://mcp.slack.com/mcp) works. The client id, an optional client secret and an optional callback port are stored on the server's OAuth state and win over dynamic client registration.

## Context

`startMcpOAuth` always called the SDK's `registerClient` when no client was stored for the issuer. Slack's authorization server metadata has no `registration_endpoint`, so the SDK threw "Incompatible auth server: does not support dynamic client registration" and the Authenticate button could never succeed. Slack's documentation tells harnesses to use a pre-registered Slack app client id, and Claude Code accepts `clientId`, `callbackPort` and a client secret for the same reason. The redirect URI was a private constant in the adapter (`http://localhost:8765/callback`), so a provider app that registered a different port could not be matched, and the settings UI had no copy of it to show the user. This extends adr-20260629-mcp-oauth-client.

## Decision

`McpOAuthState` gains an optional `preRegisteredClient` of `clientId`, `clientSecret` and `callbackPort`, mirrored in the zod schema with the parity assert kept. `mcpOAuthRedirectUri` in `src/shared/mcp-types.ts` is the one owner of the redirect URI and its default port; the adapter (registration metadata, authorization request, code exchange) and the settings editor import it. The adapter resolves the client through one helper used by start, complete and refresh: a pre-registered client wins and is built fresh from the stored fields on every call, otherwise the DCR result in `clientByIssuer` is used. A pre-registered client is never copied into `clientByIssuer`, so editing the id or secret takes effect with no stale copy. `registerClient` runs only when neither exists; when the authorization server also has no `registration_endpoint`, start throws an error that names the client id, the optional secret and the redirect URL to register. The SDK picks `client_secret_post` itself when a secret is present. The settings editor shows Client ID, Client secret and Callback port fields under the OAuth toggle, with the redirect URL for the typed port, and saves them with the server on both create and update; an update that leaves the three fields unchanged sends no `oauth` so a stale snapshot never overwrites stored tokens. The client secret lives in `settings.json` beside the tokens, the same store the earlier ADR chose over a separate secret store; the file is written with the default umask, so it is not mode 0600, and remote MCP egress redaction already reduces OAuth state to enabled, status, issuer and error.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-226 | component | mcp-oauth.adapter.ts resolves the client through one helper, skips registration for a pre-registered client and reports a missing registration endpoint with guidance | c3-226#n13753@v1:sha256:36ed55bf289ccb36dda2e5754700673eff77f3c112189b6daf666c194138856d "Owns the Kanna MCP host runtime: builds the in-process SDK MCP server" | ref-strong-typing: the helper returns the SDK client information type with no cast |
| c3-301 | component | McpOAuthState gains preRegisteredClient, and mcpOAuthRedirectUri becomes the shared owner of the redirect URI | c3-301#n15136@v1:sha256:5d19dca29fe0454f3f314901783d2878ed88aa8ee34044b744b582918c641df0 "Defines the discriminated unions and structural types that cross the wire: project records, chat snapshots, transcript entries, provider catalog entries. Non-go" | ref-strong-typing: the zod mirror carries the same field and assertParity still holds |
| c3-116 | component | McpServersSection and the MCP server draft gain the Client ID, Client secret and Callback port fields saved on create and update | c3-116#n11927@v1:sha256:9f6e3ac8943d89276398fdab980fb40a5a26c8ca7e600344486d38a7fd9d1696 "Surfaces user-facing configuration: provider API keys, theme, typography scale, custom keybindings, chat preferences, notification toggles, data directory, clou" | kanna-react-style: named store patches, design tokens only |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/mcp-oauth.test.ts src/client/app/McpServersSection.test.tsx src/client/lib/mcpServerDraft.test.ts | a pre-registered client starts and completes a flow with no registration request and the chosen callback port; a server with no registration endpoint and no client fails with guidance; saving a Client ID keeps stored tokens |
| bun run lint, bun run typecheck, bun run lint:comments, bun run check:arch | exit 0 |
| c3x check | exits 0 |
