# Custom MCP servers in settings — Design

**Status:** Draft for review
**Date:** 2026-05-22
**Author:** Brainstorm session (cuongtranba)

## Goal

Let users register custom MCP (Model Context Protocol) servers from
Kanna's settings UI. Each registered server becomes available as
`mcp__<name>__<tool>` to the model in every chat, with identical behavior
under both the SDK driver (`KANNA_CLAUDE_DRIVER=sdk`, default) and the PTY
driver (`KANNA_CLAUDE_DRIVER=pty`).

## Non-goals

- Per-chat enable/disable. Scope is global; each entry has its own
  `enabled` toggle.
- Per-project overrides (env/args customised by cwd).
- OS keychain integration. Env vars and headers live in `settings.json`
  alongside existing OAuth tokens. File mode stays `0600`.
- Routing user MCP tool calls through Kanna's durable approval gate.
  User MCP tools auto-allow (matches existing non-`mcp__kanna__*`
  behavior).
- Reading from `~/.claude.json`. PTY mode keeps `--strict-mcp-config`;
  Kanna settings are the single source of truth.

## Decisions

| # | Decision |
|---|----------|
| Q1 | Support all four transports: `stdio`, `http`, `sse`, `ws`. |
| Q2 | Global list with per-entry `enabled` toggle. |
| Q3 | Plain text in `settings.json` (0600). |
| Q4 | Schema validation + automatic connect-test on save. |
| Q5 | Auto-allow user MCP tools (no approval gate). |
| Q6 | Kanna settings only. `--strict-mcp-config` stays. |

## Architecture

```
┌─────────────────────────────┐
│  Settings UI                │
│  McpServersSection.tsx      │──┐
└─────────────────────────────┘  │ IPC (mcp.add/update/remove/test)
                                 ▼
┌─────────────────────────────────────────────┐
│  app-settings.ts                            │
│  • addMcpServer / updateMcpServer / remove  │
│  • listEnabledMcpServers()                  │
│  • setMcpServerTestResult()                 │
└────────────────┬────────────────────────────┘
                 │ snapshot at spawn time
                 ▼
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐   ┌─────────────────────────┐
│ agent.ts SDK │   │ kanna-mcp-http.ts +     │
│ mcpServers:  │   │ claude-pty/driver.ts    │
│ {kanna,...}  │   │ buildMcpConfigJson()    │
└──────┬───────┘   └─────────┬───────────────┘
       │                     │ writes mcp-config.json
       │                     │ + --strict-mcp-config
       ▼                     ▼
   query() SDK          claude CLI (TUI/PTY)

┌─────────────────────────────────────────────┐
│  mcp-validator.ts (in-process)              │
│  validateMcpServer() → connect, listTools,  │
│  close. 10s timeout. Per-transport client.  │
└─────────────────────────────────────────────┘
```

## §1 — Data model (`src/shared/types.ts`)

```ts
export type McpServerTransport = "stdio" | "http" | "sse" | "ws"

export type McpServerTestResult =
  | { status: "untested" }
  | { status: "pending"; startedAt: string }
  | { status: "ok"; testedAt: string; toolCount: number }
  | { status: "error"; testedAt: string; message: string }

interface McpServerBase {
  id: string                 // uuid, stable across renames
  name: string               // mcp-config key; tool prefix = mcp__<name>__
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastTest: McpServerTestResult
}

export type McpServerConfig =
  | (McpServerBase & {
      transport: "stdio"
      command: string
      args: string[]
      env: Record<string, string>
      cwd?: string
    })
  | (McpServerBase & {
      transport: "http" | "sse" | "ws"
      url: string
      headers: Record<string, string>
    })

export interface McpValidationError {
  field: string
  message: string
}
```

Extends `AppSettingsSnapshot` with `customMcpServers: McpServerConfig[]`.

**Name validation:** `^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`. The name becomes
the mcp-config key, which the claude CLI / SDK turns into the tool
prefix `mcp__<name>__<tool>`. Reserved name: `kanna` (collides with
Kanna's loopback MCP).

## §2 — Storage layer (`src/server/app-settings.ts`)

New methods on `AppSettingsStore`, mirroring the existing `Subagent`
CRUD pattern:

```ts
addMcpServer(input: McpServerInput): { server: McpServerConfig } | { error: McpValidationError }
updateMcpServer(id: string, patch: McpServerPatch): { server: McpServerConfig } | { error: McpValidationError }
removeMcpServer(id: string): boolean
setMcpServerEnabled(id: string, enabled: boolean): boolean
setMcpServerTestResult(id: string, result: McpServerTestResult): boolean
listEnabledMcpServers(): McpServerConfig[]
```

- `loadAppSettings()` parses `customMcpServers` from `settings.json`,
  drops malformed entries with a warning (same as subagents).
- Atomic write via existing `writeFile + rename` helper. File mode
  stays `0600`.
- Validation rules:
  - Name slug regex above; uniqueness; reserved `kanna` rejected.
  - `stdio.command` non-empty string.
  - URL transports require parseable `url` with matching scheme:
    `http:` / `https:` for http+sse; `ws:` / `wss:` for ws.
  - Env / header keys non-empty; values may be empty strings.

## §3 — SDK driver wiring (`src/server/agent.ts`)

The `mcpServers` field at `agent.ts:967` becomes a merged map:

```ts
mcpServers: {
  [KANNA_MCP_SERVER_NAME]: createKannaMcpServer({ ... }),
  ...buildUserMcpServers(args.customMcpServers),
}
```

`buildUserMcpServers(servers: McpServerConfig[]): Record<string, McpServerConfigSdk>`:

- Filters `enabled === true` only.
- Maps each entry to the SDK's transport-specific config from
  `@anthropic-ai/claude-agent-sdk`:
  - `stdio` → `{ type: "stdio", command, args, env, cwd? }`
  - `http`  → `{ type: "http", url, headers }`
  - `sse`   → `{ type: "sse", url, headers }`
  - `ws`    → `{ type: "ws", url, headers }` (drop with warn if the SDK
    version doesn't export this transport).
- Skips entries whose name collides with `KANNA_MCP_SERVER_NAME`
  (storage validation prevents this; defensive).

**Plumbing:** `AgentCoordinator` reads
`appSettingsStore.listEnabledMcpServers()` once per spawn and passes the
snapshot through `startClaudeHarnessStream` args. Changes to the
settings list only take effect on the next chat spawn — consistent with
existing OAuth-token and subagent behavior.

**Permission gate:** `canUseTool` short-circuits any tool whose name
starts with `mcp__` AND whose prefix is NOT `mcp__kanna__` to
`{ behavior: "allow" }`. Kanna's own MCP tools keep going through the
existing approval path.

## §4 — PTY driver wiring

### `src/server/kanna-mcp-http.ts`

```ts
export function buildMcpConfigJson(
  handle: { url: string; bearerToken: string },
  userServers: McpServerConfig[] = [],
): string {
  const mcpServers: Record<string, unknown> = {
    [KANNA_MCP_SERVER_NAME]: {
      type: "http",
      url: handle.url,
      headers: { Authorization: `Bearer ${handle.bearerToken}` },
    },
  }
  for (const s of userServers.filter(
    (s) => s.enabled && s.name !== KANNA_MCP_SERVER_NAME,
  )) {
    mcpServers[s.name] = toClaudeCliMcpEntry(s)
  }
  return JSON.stringify({ mcpServers })
}
```

`toClaudeCliMcpEntry` produces claude-CLI-compatible entries:

- `stdio` → `{ type: "stdio", command, args, env, cwd? }`
- `http`  → `{ type: "http", url, headers }`
- `sse`   → `{ type: "sse", url, headers }`
- `ws`    → `{ type: "ws", url, headers }`

### `src/server/claude-pty/driver.ts`

`spawnClaudePty` accepts `customMcpServers` on
`StartClaudeSessionPtyArgs` and passes it to `buildMcpConfigJson`. The
`--strict-mcp-config` flag stays — Kanna's settings file is the only
source. `pid-registry.ts` cleanup already removes the runtime
`mcp-config.json` on exit; no change.

Both `buildClaudeSubagentStarter` (oneShot path) and the main
interactive path must receive the same `customMcpServers` snapshot so
subagent runs see identical MCP surface.

## §5 — Connect-test helper (`src/server/mcp-validator.ts`, new file)

```ts
export async function validateMcpServer(
  config: McpServerConfig,
  opts?: { timeoutMs?: number },     // default 10_000
): Promise<McpServerTestResult>
```

- Uses `@modelcontextprotocol/sdk/client` (transitive dep via the agent
  SDK).
- Per-transport client transport:
  - `stdio` → `StdioClientTransport({ command, args, env, cwd })`
  - `http`  → `StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } })`
  - `sse`   → `SSEClientTransport(new URL(url), { requestInit: { headers } })`
  - `ws`    → `WebSocketClientTransport(new URL(url))` (headers not
    supported; surface as schema warning when headers non-empty)
- Flow: `client.connect(transport)` → `client.listTools()` →
  `client.close()` (in `finally`) → return
  `{ status: "ok", testedAt, toolCount }`.
- Any throw or timeout returns
  `{ status: "error", testedAt, message }`.
- Runs in-process on the Kanna server, NEVER inside a chat spawn.
- Caller (storage layer): set `pending` → run validator → write result
  via `setMcpServerTestResult`. Triggered automatically after
  `addMcpServer` / `updateMcpServer` succeed.

Failure-mode messages:

- stdio `ENOENT` → `"command not found: <command>"`
- HTTP non-2xx → `"HTTP <status> from <host>"`
- Timeout → `"connection timed out after 10s"`
- Auth (401/403) → `"unauthorized (check headers/env)"`

## §6 — Settings UI (`src/client/components/settings/McpServersSection.tsx`)

Mirrors `SubagentsSection` and `PushNotificationsSection`.

**List view:** rows with name, transport badge, enabled toggle,
test-status pill (gray / spinner / green / red), test button, edit,
delete. Empty state: *"No custom MCP servers. Add one to extend the
model's tool surface."*

**Editor modal** (`McpServerEditor`):

- Name input with slug validation (live).
- Transport radio: stdio / http / sse / ws.
- Conditional fields:
  - **stdio:** command, args (chip list), env (key/value pairs,
    password-masked values), cwd (optional).
  - **http / sse:** url, headers (key/value pairs, masked values).
  - **ws:** url, note that headers aren't supported.
- Save calls `addMcpServer` / `updateMcpServer` → auto-test fires →
  UI streams the resulting `lastTest` via the existing settings
  subscription.
- Delete uses the existing confirm modal.

**Client wiring:**

- Extend `useAppSettingsStore` with a `mcpServers` slice. The selector
  returns a stable empty-array reference per CLAUDE.md
  render-loop rules:
  ```ts
  const EMPTY: McpServerConfig[] = []
  useAppSettingsStore((s) => s.customMcpServers ?? EMPTY)
  ```
- IPC: extend the settings RPC channel (where subagents already live)
  with `mcp.add`, `mcp.update`, `mcp.remove`, `mcp.setEnabled`,
  `mcp.test`.
- Manual "Test" button on each row re-runs `validateMcpServer`.

**Placement:** new section on the Settings page, between **Subagents**
and **OAuth tokens**.

## §7 — Tests, C3, rollout

### Tests

- `app-settings.test.ts` — add / update / remove MCP server, validation
  errors (bad slug, duplicate name, missing command, bad URL),
  reserved `kanna` name, `lastTest` persistence round-trip.
- `mcp-validator.test.ts` — stdio happy path (stub `node -e` MCP),
  stdio `ENOENT`, HTTP 200 (mock), HTTP 401, timeout. Network tests
  behind `KANNA_INTEGRATION=1`.
- `kanna-mcp-http.test.ts` — `buildMcpConfigJson` with 0, 1, and many
  user servers; `kanna` collision filtered; disabled entries dropped.
- `agent.test.ts` — `buildUserMcpServers` mapping each transport;
  disabled filtered; final `mcpServers` object includes both kanna +
  user entries.
- `driver.test.ts` — extend the existing `--mcp-config` test to assert
  user-server entries appear in the written file.
- `McpServersSection.test.tsx` — list render, editor open, schema
  validation surfaces, test-status pill states. Snapshot-stable per
  `kanna-react-style`.

### C3

`customMcpServers` crosses component boundaries (settings → agent →
both drivers). After implementation:

- Run `/c3 change`.
- Add a ref linking `app-settings.ts ↔ kanna-mcp-http.ts ↔ agent.ts ↔
  claude-pty/driver.ts`.
- Add a rule: *"User MCP server names must never equal
  `KANNA_MCP_SERVER_NAME`."*

### Rollout

- No feature flag. Additive: default `customMcpServers: []` = current
  behavior.
- Migration: `loadAppSettings` defaults the field to `[]`; no data
  migration needed.
- Docs: new "Custom MCP Servers" section in `CLAUDE.md`. Wiki settings
  screenshot regeneration via `bash wiki/scripts/capture-all.sh`.

### Risks

- stdio MCPs can hang their subprocess on shutdown.
  `validateMcpServer` enforces timeout + `transport.close()` in
  `finally`. Spawn-time hangs are owned by the claude CLI / agent SDK.
- HTTP / SSE / WS MCPs contact external hosts at every spawn. Document
  in `CLAUDE.md` that the user owns transport security; tool calls
  auto-allow per Q5.
- New SDK versions may rename transports. `buildUserMcpServers` falls
  back to dropping unsupported transports with a warning rather than
  crashing the spawn.
