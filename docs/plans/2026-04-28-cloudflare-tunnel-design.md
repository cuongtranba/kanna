# Cloudflare Tunnel Auto-Expose — Design

Date: 2026-04-28

## Goal

When Claude Code starts a local dev server inside a Kanna-managed project (Go, TypeScript, etc.), Kanna detects the listening port from Bash output, prompts the user to expose it via a Cloudflare quick tunnel, and renders the resulting public URL inline in the chat transcript. Lets users access localhost services from outside the local network without manual `cloudflared` invocation.

## Scope

- **In:** Quick tunnels (`cloudflared tunnel --url`), ephemeral `*.trycloudflare.com` URLs, inline transcript card UX, settings page integration, lifecycle tied to source process / session / manual stop.
- **Out:** Named tunnels, Cloudflare account auth, persistent subdomains, automatic `cloudflared` install, port allow/deny lists.

## Assumptions

- User has `cloudflared` binary installed (path configurable; default `cloudflared`).
- Anthropic API key already configured for the existing agent runtime — reused for haiku detector calls.
- Feature is opt-in (`enabled: false` by default) — no surprise tunnels.

## Architecture

New module: `src/server/cloudflare-tunnel/` mirroring the `auto-continue/` layout.

| File | Responsibility |
|------|----------------|
| `detector.ts` | Haiku agent wrapper. Input: Bash command + stdout. Output: `{ isServer: boolean; port?: number }`. Uses `@anthropic-ai/claude-agent-sdk` with `claude-haiku-4-5-20251001`. Cached system prompt for cost. |
| `tunnel-manager.ts` | Spawns / tracks `cloudflared tunnel --url http://localhost:PORT` child processes. Map `tunnelId → { proc, url, port, sourcePid, sessionId, state }`. Parses stdout for `*.trycloudflare.com` URL. |
| `events.ts` | Event types: `tunnel.proposed`, `tunnel.accepted`, `tunnel.active`, `tunnel.stopped`, `tunnel.failed`. Mirror `auto-continue/events.ts`. |
| `read-model.ts` | Projection over events for client subscription. Mirror `auto-continue/read-model.ts`. |
| `lifecycle.ts` | Watches source PIDs and session-close hooks; kills tunnels per termination rules. |

**Hook point:** `agent.ts` Bash tool post-handler invokes `detector.evaluate(cmd, stdout)`. If a server is detected, manager emits `tunnel.proposed { port, sourcePid, sessionId }`.

**Client:**
- `src/client/components/chat-ui/CloudflareTunnelCard.tsx` — mirrors `AutoContinueCard` state machine.
- `src/client/app/SettingsPage.tsx` — new "Cloudflare Tunnel" section.

## Settings

```ts
type CloudflareTunnelSettings = {
  enabled: boolean              // default false
  cloudflaredPath: string       // default "cloudflared"
  mode: "always-ask" | "auto-expose"  // default "always-ask"
}
```

Stored in existing `app-settings.ts` store. UI: enable toggle, mode radio (always-ask / auto-expose), `cloudflaredPath` input with debounced probe showing green "Found" / red "Not found".

## Data Flow

### Happy path (always-ask)

1. User chats; Claude calls Bash `bun run dev` via the agent runtime.
2. `agent.ts` Bash post-handler captures `{cmd, stdout, pid}`, forwards to `detector.evaluate()`.
3. Haiku returns `{isServer: true, port: 5173}`.
4. `tunnel-manager.propose({port, sourcePid, sessionId})` emits `tunnel.proposed`.
5. WS push → client read-model adds the proposed tunnel → `CloudflareTunnelCard` renders inline with `[Expose] [Dismiss]`.
6. User clicks **Expose** → WS command `tunnel.accept(tunnelId)` → server spawns `cloudflared tunnel --url http://localhost:5173`.
7. Manager parses cloudflared stdout for `https://<sub>.trycloudflare.com`, emits `tunnel.active { url }`.
8. Card flips to active state, shows URL with `[Copy] [Stop]`.

### Variants

- **auto-expose mode:** Skip steps 5/6 — manager spawns immediately on detection. Card renders directly in active state.
- **disabled mode:** Detector skipped entirely, no haiku call, zero overhead.

### Termination (hybrid lifecycle)

- `lifecycle.ts` polls `sourcePid` via `process-utils.ts`. On exit → emit `tunnel.stopped`, SIGTERM cloudflared.
- Session close hook kills all tunnels for that `sessionId`.
- Manual Stop button → WS command `tunnel.stop(tunnelId)`.
- Server shutdown hook (in `cli-supervisor`) kills every child cloudflared.

## Card State Machine

| State | Render |
|-------|--------|
| `proposed` | "Port {port} detected. Expose via Cloudflare? `[Expose]` `[Dismiss]`" |
| `active` | "Tunnel live: {url} `[Copy]` `[Stop]`" |
| `stopped` | "Tunnel stopped" |
| `failed` | "Tunnel failed: {error} `[Retry]` `[Dismiss]`" |

Mirrors `AutoContinueCard.tsx` for visual + interaction consistency.

## Detection Strategy

Pure haiku agent (no regex first):
- Every Bash result piped to haiku with the cached prompt: *"Given a shell command and its stdout, return JSON `{isServer: boolean, port?: number}`. isServer is true only if the command started an HTTP service that is now listening."*
- Fire-and-forget — does not block the Bash tool result returning to the client.
- Malformed JSON → log + skip (no proposal).
- Cost: one haiku call per Bash invocation while `enabled: true`. Disabled mode short-circuits before any LLM call.

## Persistence

- Settings → existing `app-settings` store.
- Tunnel records → in-memory `Map`, ephemeral by design (quick tunnels regenerate URLs per spawn anyway).
- Events → `event-store` for in-session replay only; not durable across restarts.

## Failure Modes

| Condition | Behavior |
|-----------|----------|
| `cloudflared` binary missing | `tunnel.failed` with install link |
| Cloudflared exits before URL parsed | `tunnel.failed` with stderr tail |
| Haiku returns malformed JSON | Log + skip, no proposal |
| Port already exposed | Reuse existing tunnel, re-emit `proposed` pointing to same `tunnelId` |
| Cloudflare rate-limit | `tunnel.failed`, `[Retry]` button on card |

## Edge Cases

- IPv6 `[::1]:3000` — haiku prompt explicitly handles.
- Multiple ports in one output (Vite client + HMR) — propose first non-HMR port; let haiku judge.
- Background Bash (`&`) — capture stdout via existing stream wiring.
- Duplicate `bun run dev` runs — manager keys by `port`, returns existing record.
- Detector latency — async, never blocks Bash tool result.

## Testing

Colocated `*.test.ts` next to source (per `ref-colocated-bun-test`).

| Test | Coverage |
|------|----------|
| `detector.test.ts` | Stubbed haiku SDK; table-driven cases for `bun run dev`, `go run`, `ls`, malformed JSON, empty stdout |
| `tunnel-manager.test.ts` | Spawn → URL parse, port reuse, ENOENT, stop SIGTERM, multi-line stdout |
| `lifecycle.test.ts` | Source-PID exit, session close, manual stop |
| `events.test.ts` | Event shape + round-trip via event-store |
| `read-model.test.ts` | Projection from event sequence |
| `e2e.test.ts` | Full path: fake Bash → propose → accept → active → source-pid kill → stopped |
| `CloudflareTunnelCard.test.tsx` | Render each state, button handlers fire correct WS commands |
| `SettingsPage.test.tsx` | New section toggles, mode radio, path probe states |

## Constraints

- Strong typing: no `any` / `unknown`. Concrete `TunnelRecord`, `TunnelEvent` discriminated unions.
- WS subscription pattern (`ref-ws-subscription`) — read-model push, not pull.
- Colocated bun:test (`ref-colocated-bun-test`).
- Local-first data (`ref-local-first-data`) — settings stored client-side via `app-settings`.

## C3 Impact

- New component: `c3-2xx cloudflare-tunnel` under `c3-2 server` container.
- Modifies: `c3-116 settings-page` (new section), `c3-112 chat-page` / `c3-114 messages-renderer` (new card type), `agent.ts` (Bash post-handler hook).
- New refs: none required — reuses `ref-ws-subscription`, `ref-strong-typing`, `ref-colocated-bun-test`.

## Open Questions

None blocking implementation. Future considerations (out of scope for v1):
- Named tunnels for stable URLs.
- Auto-install `cloudflared` if missing.
- Per-project port allow/deny list.
