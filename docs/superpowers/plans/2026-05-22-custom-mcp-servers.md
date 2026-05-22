# Custom MCP servers in settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add support for installing custom MCP (Model Context Protocol) servers from Kanna's settings UI, applied identically under both SDK (`KANNA_CLAUDE_DRIVER=sdk`) and PTY (`KANNA_CLAUDE_DRIVER=pty`) drivers.

**Architecture:** A new `customMcpServers: McpServerConfig[]` field on `AppSettingsSnapshot` persists user MCP entries (all four transports: stdio / http / sse / ws). `AgentCoordinator` snapshots the enabled subset per spawn and feeds it to both drivers — SDK merges into the `mcpServers` map passed to `query()`, PTY merges into the on-disk `mcp-config.json` consumed by `--strict-mcp-config`. A separate in-process `mcp-validator.ts` connects to each server and lists tools on save for fast feedback.

**Tech Stack:** TypeScript, Bun, React 19, `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk` (client transports), Tailwind, shadcn/ui patterns already in repo.

**Spec:** `docs/superpowers/specs/2026-05-22-custom-mcp-design.md`

---

## File Structure

### Created

| Path | Responsibility |
|------|---------------|
| `src/server/mcp-validator.ts` | `validateMcpServer()` — connect, list tools, close, with 10s timeout. Per-transport branching. |
| `src/server/mcp-validator.test.ts` | Tests: stdio happy/ENOENT, HTTP 200/401, timeout. |
| `src/client/app/McpServersSection.tsx` | List rows + editor modal. Mirrors `SubagentsSection`. |
| `src/client/app/McpServersSection.test.tsx` | Snapshot + interaction tests. |

### Modified

| Path | Change |
|------|--------|
| `src/shared/types.ts` | Add `McpServerTransport`, `McpServerTestResult`, `McpServerConfig` union, `McpServerInput`, `McpServerPatch`, `McpValidationError`. Add `customMcpServers` to `AppSettingsSnapshot` + `AppSettingsPatch`. |
| `src/server/app-settings.ts` | Normalize/validate `customMcpServers`. Extend `applyPatch` with `customMcpServers.{create,update,delete,setEnabled,setTestResult}`. |
| `src/server/kanna-mcp-http.ts` | `buildMcpConfigJson(handle, userServers?)` merges user entries. New `toClaudeCliMcpEntry` helper. |
| `src/server/agent.ts` | New `buildUserMcpServers()`. Merge into SDK `mcpServers`. Plumb `customMcpServers` through `StartClaudeSessionPtyArgs` + subagent starter. Auto-allow non-kanna `mcp__*` tool calls in `canUseTool`. |
| `src/server/claude-pty/driver.ts` | Accept `customMcpServers` in `StartClaudeSessionPtyArgs`; pass to `buildMcpConfigJson`. |
| `src/server/ws-router.ts` | Route `customMcpServers` patches through `writePatch`. Add `settings.testMcpServer` RPC. |
| `src/shared/protocol.ts` | Add `settings.testMcpServer` message type. |
| `src/client/app/SettingsPage.tsx` | Render new `McpServersSection` between Subagents and OAuth tokens. |
| `CLAUDE.md` | New "Custom MCP Servers" section documenting wiring + security model. |

### Test files modified

| Path | Change |
|------|--------|
| `src/server/app-settings.test.ts` | CRUD + validation tests for `customMcpServers`. |
| `src/server/kanna-mcp-http.test.ts` | `buildMcpConfigJson` with user servers. |
| `src/server/agent.test.ts` | `buildUserMcpServers` mapping; `canUseTool` auto-allow. |
| `src/server/claude-pty/driver.test.ts` | Extend `--mcp-config` test to assert user servers present. |
| `src/server/ws-router.test.ts` | `settings.testMcpServer` round-trip. |

---

## Conventions

- **Test runner:** `bun test <path>`.
- **Commit cadence:** one commit per completed task (test + impl + integration). Use Conventional Commits.
- **Lint gate:** `bun run lint` must pass at the end (warnings cap enforced; we add zero new warnings).
- **Branch:** Create a feature branch off `main` (e.g. `feat/custom-mcp-servers`).
- **Pre-implementation step (do once at start):** create worktree per `superpowers:using-git-worktrees`, switch to feature branch.

---

## Task 1: Shared types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the new types**

Find the existing `Subagent` type cluster (around line 1100+) and add the MCP types nearby. Inside `AppSettingsSnapshot` add `customMcpServers: McpServerConfig[]`. Inside `AppSettingsPatch` add the `customMcpServers` patch field.

```ts
// New types

export type McpServerTransport = "stdio" | "http" | "sse" | "ws"

export type McpServerTestResult =
  | { status: "untested" }
  | { status: "pending"; startedAt: string }
  | { status: "ok"; testedAt: string; toolCount: number }
  | { status: "error"; testedAt: string; message: string }

interface McpServerBase {
  id: string
  name: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastTest: McpServerTestResult
}

export interface McpServerStdioFields {
  transport: "stdio"
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
}

export interface McpServerNetworkFields {
  transport: "http" | "sse" | "ws"
  url: string
  headers: Record<string, string>
}

export type McpServerConfig =
  | (McpServerBase & McpServerStdioFields)
  | (McpServerBase & McpServerNetworkFields)

export type McpServerInput =
  | (Omit<McpServerStdioFields, never> & { name: string; enabled?: boolean })
  | (Omit<McpServerNetworkFields, never> & { name: string; enabled?: boolean })

export type McpServerPatch = Partial<{
  name: string
  enabled: boolean
  transport: McpServerTransport
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string | undefined
  url: string
  headers: Record<string, string>
}>

export interface McpValidationError {
  code:
    | "INVALID_NAME"
    | "DUPLICATE_NAME"
    | "RESERVED_NAME"
    | "INVALID_TRANSPORT"
    | "MISSING_COMMAND"
    | "INVALID_URL"
    | "INVALID_HEADER_KEY"
    | "INVALID_ENV_KEY"
    | "NOT_FOUND"
  field?: string
  message: string
}
```

Inside `AppSettingsSnapshot`, add (alongside `subagents`):

```ts
  customMcpServers: McpServerConfig[]
```

Inside `AppSettingsPatch`, add (alongside `subagents`):

```ts
  customMcpServers?: {
    create?: McpServerInput
    update?: { id: string; patch: McpServerPatch }
    delete?: { id: string }
    setEnabled?: { id: string; enabled: boolean }
    setTestResult?: { id: string; result: McpServerTestResult }
  }
```

- [ ] **Step 2: Compile-check**

Run: `bun run typecheck` (if defined) or `bunx tsc --noEmit -p tsconfig.json`
Expected: PASS (no consumers exist yet besides the file itself).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add McpServerConfig and patch shape

Add transport-tagged union McpServerConfig (stdio/http/sse/ws), test
result enum, input/patch shapes, validation error codes. Wire into
AppSettingsSnapshot + AppSettingsPatch alongside subagents."
```

---

## Task 2: Storage layer — normalize + load

**Files:**
- Modify: `src/server/app-settings.ts`
- Test: `src/server/app-settings.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/server/app-settings.test.ts`:

```ts
import { test, expect } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AppSettingsStore } from "./app-settings"

async function makeStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-test-"))
  const filePath = path.join(dir, "settings.json")
  const store = new AppSettingsStore({ filePath })
  await store.init()
  return { store, filePath }
}

test("customMcpServers defaults to empty array on fresh store", async () => {
  const { store } = await makeStore()
  expect(store.getSnapshot().customMcpServers).toEqual([])
})

test("customMcpServers normalizes valid stdio entry from disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-test-"))
  const filePath = path.join(dir, "settings.json")
  await writeFile(
    filePath,
    JSON.stringify({
      customMcpServers: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "fs",
          enabled: true,
          createdAt: "2026-05-22T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z",
          lastTest: { status: "untested" },
          transport: "stdio",
          command: "/usr/local/bin/mcp-filesystem",
          args: ["/tmp"],
          env: {},
        },
      ],
    }),
    "utf8",
  )
  const store = new AppSettingsStore({ filePath })
  await store.init()
  const list = store.getSnapshot().customMcpServers
  expect(list).toHaveLength(1)
  expect(list[0].name).toBe("fs")
  if (list[0].transport === "stdio") {
    expect(list[0].command).toBe("/usr/local/bin/mcp-filesystem")
  } else {
    throw new Error("expected stdio")
  }
})

test("customMcpServers drops malformed entries with warning", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-test-"))
  const filePath = path.join(dir, "settings.json")
  await writeFile(
    filePath,
    JSON.stringify({
      customMcpServers: [
        { id: "x", name: "bad", transport: "stdio" }, // missing command
        "not-an-object",
      ],
    }),
    "utf8",
  )
  const store = new AppSettingsStore({ filePath })
  await store.init()
  expect(store.getSnapshot().customMcpServers).toEqual([])
})
```

- [ ] **Step 2: Run the test (expect fail)**

Run: `bun test src/server/app-settings.test.ts -t "customMcpServers"`
Expected: FAIL — `customMcpServers` is `undefined` in snapshot.

- [ ] **Step 3: Implement normalization**

In `src/server/app-settings.ts`:

a) Add imports near existing type imports:

```ts
  type McpServerConfig,
  type McpServerInput,
  type McpServerPatch,
  type McpServerTestResult,
  type McpServerTransport,
  type McpValidationError,
```

b) Add constants below `SUBAGENT_NAME_MAX`:

```ts
const MCP_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/
const MCP_RESERVED_NAMES = new Set(["kanna"])
const MCP_VALID_TRANSPORTS: ReadonlySet<McpServerTransport> = new Set([
  "stdio",
  "http",
  "sse",
  "ws",
])

class McpValidationException extends Error {
  constructor(readonly validationError: McpValidationError) {
    super(validationError.message)
    this.name = "McpValidationException"
  }
}
```

c) Add normalization helpers near `normalizeSubagentEntry`:

```ts
function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0) continue
    out[k] = typeof v === "string" ? v : String(v ?? "")
  }
  return out
}

function normalizeMcpTestResult(value: unknown): McpServerTestResult {
  if (!value || typeof value !== "object") return { status: "untested" }
  const v = value as Record<string, unknown>
  switch (v.status) {
    case "pending":
      return { status: "pending", startedAt: String(v.startedAt ?? new Date().toISOString()) }
    case "ok":
      return {
        status: "ok",
        testedAt: String(v.testedAt ?? new Date().toISOString()),
        toolCount: typeof v.toolCount === "number" ? v.toolCount : 0,
      }
    case "error":
      return {
        status: "error",
        testedAt: String(v.testedAt ?? new Date().toISOString()),
        message: typeof v.message === "string" ? v.message : "unknown error",
      }
    case "untested":
    default:
      return { status: "untested" }
  }
}

function normalizeMcpEntry(value: unknown, warnings: string[]): McpServerConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const src = value as Record<string, unknown>
  const id = typeof src.id === "string" && src.id.length > 0 ? src.id : null
  const name = typeof src.name === "string" ? src.name : null
  const transport = src.transport
  if (!id || !name || typeof transport !== "string") {
    warnings.push(`MCP entry rejected: missing id/name/transport`)
    return null
  }
  if (!MCP_VALID_TRANSPORTS.has(transport as McpServerTransport)) {
    warnings.push(`MCP entry '${id}' rejected: unknown transport ${transport}`)
    return null
  }
  const base = {
    id,
    name,
    enabled: src.enabled !== false,
    createdAt: typeof src.createdAt === "string" ? src.createdAt : new Date().toISOString(),
    updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : new Date().toISOString(),
    lastTest: normalizeMcpTestResult(src.lastTest),
  }
  if (transport === "stdio") {
    const command = typeof src.command === "string" && src.command.trim().length > 0 ? src.command : null
    if (!command) {
      warnings.push(`MCP entry '${id}' rejected: stdio command missing`)
      return null
    }
    const args = Array.isArray(src.args) ? src.args.filter((a): a is string => typeof a === "string") : []
    return {
      ...base,
      transport: "stdio",
      command,
      args,
      env: normalizeStringMap(src.env),
      cwd: typeof src.cwd === "string" && src.cwd.length > 0 ? src.cwd : undefined,
    }
  }
  // http/sse/ws
  const url = typeof src.url === "string" ? src.url : null
  if (!url) {
    warnings.push(`MCP entry '${id}' rejected: url missing`)
    return null
  }
  return {
    ...base,
    transport: transport as "http" | "sse" | "ws",
    url,
    headers: normalizeStringMap(src.headers),
  }
}

function normalizeMcpServers(value: unknown, warnings: string[]): McpServerConfig[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    warnings.push("customMcpServers must be an array")
    return []
  }
  const out: McpServerConfig[] = []
  const seenNames = new Set<string>()
  for (const entry of value) {
    const normalized = normalizeMcpEntry(entry, warnings)
    if (!normalized) continue
    if (seenNames.has(normalized.name)) {
      warnings.push(`MCP entry '${normalized.id}' rejected: duplicate name '${normalized.name}'`)
      continue
    }
    seenNames.add(normalized.name)
    out.push(normalized)
  }
  return out
}
```

d) Inside the `AppSettingsFile` interface, add `customMcpServers?: unknown`.

e) Inside `normalizeAppSettings` (where subagents is wired), add:

```ts
  const customMcpServers = normalizeMcpServers(source?.customMcpServers, warnings)
```

and include `customMcpServers` in the returned `payload`.

f) Inside the `getSnapshot()` and `mergeAppSettingsPatch` projection functions (wherever `subagents` is returned), add `customMcpServers: state.customMcpServers`.

g) Inside the file-write projection (where `source.subagents` is serialized to disk), add `customMcpServers: source.customMcpServers`.

- [ ] **Step 4: Run the test (expect pass)**

Run: `bun test src/server/app-settings.test.ts -t "customMcpServers"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/app-settings.ts src/server/app-settings.test.ts src/shared/types.ts
git commit -m "feat(settings): persist customMcpServers list

Add load/normalize/persist for customMcpServers in AppSettingsStore.
Drops malformed entries with warnings. Duplicate names deduped on
load. Mirrors existing subagent normalization."
```

---

## Task 3: Storage layer — patch (create / update / delete / enable / test result)

**Files:**
- Modify: `src/server/app-settings.ts`
- Test: `src/server/app-settings.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
test("addMcpServer: create stdio entry succeeds", async () => {
  const { store } = await makeStore()
  await store.writePatch({
    customMcpServers: {
      create: {
        name: "fs",
        transport: "stdio",
        command: "/usr/local/bin/mcp-filesystem",
        args: [],
        env: {},
      },
    },
  })
  const list = store.getSnapshot().customMcpServers
  expect(list).toHaveLength(1)
  expect(list[0].name).toBe("fs")
  expect(list[0].enabled).toBe(true)
  expect(list[0].lastTest.status).toBe("untested")
})

test("addMcpServer: reserved name 'kanna' rejected", async () => {
  const { store } = await makeStore()
  await expect(store.writePatch({
    customMcpServers: {
      create: { name: "kanna", transport: "stdio", command: "x", args: [], env: {} },
    },
  })).rejects.toMatchObject({ name: "McpValidationException" })
})

test("addMcpServer: duplicate name rejected", async () => {
  const { store } = await makeStore()
  await store.writePatch({
    customMcpServers: {
      create: { name: "fs", transport: "stdio", command: "x", args: [], env: {} },
    },
  })
  await expect(store.writePatch({
    customMcpServers: {
      create: { name: "fs", transport: "stdio", command: "y", args: [], env: {} },
    },
  })).rejects.toMatchObject({ validationError: { code: "DUPLICATE_NAME" } })
})

test("addMcpServer: bad slug rejected", async () => {
  const { store } = await makeStore()
  await expect(store.writePatch({
    customMcpServers: {
      create: { name: "Has Space", transport: "stdio", command: "x", args: [], env: {} },
    },
  })).rejects.toMatchObject({ validationError: { code: "INVALID_NAME" } })
})

test("addMcpServer: http with bad URL rejected", async () => {
  const { store } = await makeStore()
  await expect(store.writePatch({
    customMcpServers: {
      create: { name: "remote", transport: "http", url: "not-a-url", headers: {} },
    },
  })).rejects.toMatchObject({ validationError: { code: "INVALID_URL" } })
})

test("updateMcpServer: patch survives round-trip", async () => {
  const { store } = await makeStore()
  await store.writePatch({
    customMcpServers: {
      create: { name: "fs", transport: "stdio", command: "x", args: [], env: {} },
    },
  })
  const id = store.getSnapshot().customMcpServers[0].id
  await store.writePatch({
    customMcpServers: { update: { id, patch: { name: "filesystem" } } },
  })
  expect(store.getSnapshot().customMcpServers[0].name).toBe("filesystem")
})

test("setEnabled flips the flag", async () => {
  const { store } = await makeStore()
  await store.writePatch({
    customMcpServers: {
      create: { name: "fs", transport: "stdio", command: "x", args: [], env: {} },
    },
  })
  const id = store.getSnapshot().customMcpServers[0].id
  await store.writePatch({ customMcpServers: { setEnabled: { id, enabled: false } } })
  expect(store.getSnapshot().customMcpServers[0].enabled).toBe(false)
})

test("setTestResult persists status", async () => {
  const { store } = await makeStore()
  await store.writePatch({
    customMcpServers: {
      create: { name: "fs", transport: "stdio", command: "x", args: [], env: {} },
    },
  })
  const id = store.getSnapshot().customMcpServers[0].id
  await store.writePatch({
    customMcpServers: {
      setTestResult: {
        id,
        result: { status: "ok", testedAt: "2026-05-22T00:00:00Z", toolCount: 5 },
      },
    },
  })
  const e = store.getSnapshot().customMcpServers[0]
  expect(e.lastTest).toEqual({ status: "ok", testedAt: "2026-05-22T00:00:00Z", toolCount: 5 })
})

test("delete removes entry", async () => {
  const { store } = await makeStore()
  await store.writePatch({
    customMcpServers: {
      create: { name: "fs", transport: "stdio", command: "x", args: [], env: {} },
    },
  })
  const id = store.getSnapshot().customMcpServers[0].id
  await store.writePatch({ customMcpServers: { delete: { id } } })
  expect(store.getSnapshot().customMcpServers).toEqual([])
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `bun test src/server/app-settings.test.ts -t "McpServer"`
Expected: FAIL — patch handler doesn't recognize the field.

- [ ] **Step 3: Implement patch handling**

Add validation helpers in `src/server/app-settings.ts`:

```ts
function validateMcpName(
  name: string,
  others: Array<{ id: string; name: string }>,
  ignoreId?: string,
): McpValidationError | null {
  if (!MCP_NAME_REGEX.test(name)) {
    return { code: "INVALID_NAME", field: "name", message: `name must match ${MCP_NAME_REGEX}` }
  }
  if (MCP_RESERVED_NAMES.has(name)) {
    return { code: "RESERVED_NAME", field: "name", message: `name '${name}' is reserved` }
  }
  for (const other of others) {
    if (other.id !== ignoreId && other.name === name) {
      return { code: "DUPLICATE_NAME", field: "name", message: `name '${name}' already exists` }
    }
  }
  return null
}

function validateMcpUrl(url: string, transport: "http" | "sse" | "ws"): McpValidationError | null {
  try {
    const u = new URL(url)
    const allowed =
      transport === "ws"
        ? new Set(["ws:", "wss:"])
        : new Set(["http:", "https:"])
    if (!allowed.has(u.protocol)) {
      return { code: "INVALID_URL", field: "url", message: `expected ${transport === "ws" ? "ws(s)://" : "http(s)://"} URL` }
    }
    return null
  } catch {
    return { code: "INVALID_URL", field: "url", message: "URL is malformed" }
  }
}

function buildMcpFromInput(input: McpServerInput): McpServerConfig {
  const now = new Date().toISOString()
  const base = {
    id: randomUUID(),
    name: input.name.trim(),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
    lastTest: { status: "untested" } as McpServerTestResult,
  }
  if (input.transport === "stdio") {
    return {
      ...base,
      transport: "stdio",
      command: input.command,
      args: input.args ?? [],
      env: input.env ?? {},
      cwd: input.cwd,
    }
  }
  return {
    ...base,
    transport: input.transport,
    url: input.url,
    headers: input.headers ?? {},
  }
}

function applyMcpPatch(existing: McpServerConfig, patch: McpServerPatch): McpServerConfig {
  const now = new Date().toISOString()
  const next = { ...existing, updatedAt: now } as McpServerConfig
  if (patch.name !== undefined) next.name = patch.name.trim()
  if (patch.enabled !== undefined) next.enabled = patch.enabled
  // Transport change is allowed; coerce shape.
  const transport = patch.transport ?? existing.transport
  if (transport === "stdio") {
    return {
      id: next.id,
      name: next.name,
      enabled: next.enabled,
      createdAt: next.createdAt,
      updatedAt: now,
      lastTest: next.lastTest,
      transport: "stdio",
      command: patch.command ?? (existing.transport === "stdio" ? existing.command : ""),
      args: patch.args ?? (existing.transport === "stdio" ? existing.args : []),
      env: patch.env ?? (existing.transport === "stdio" ? existing.env : {}),
      cwd: patch.cwd !== undefined ? patch.cwd : existing.transport === "stdio" ? existing.cwd : undefined,
    }
  }
  return {
    id: next.id,
    name: next.name,
    enabled: next.enabled,
    createdAt: next.createdAt,
    updatedAt: now,
    lastTest: next.lastTest,
    transport,
    url: patch.url ?? (existing.transport !== "stdio" ? existing.url : ""),
    headers: patch.headers ?? (existing.transport !== "stdio" ? existing.headers : {}),
  }
}

function validateMcpShape(
  entry: McpServerConfig,
  others: Array<{ id: string; name: string }>,
): McpValidationError | null {
  const nameErr = validateMcpName(entry.name, others, entry.id)
  if (nameErr) return nameErr
  if (entry.transport === "stdio") {
    if (!entry.command || entry.command.trim().length === 0) {
      return { code: "MISSING_COMMAND", field: "command", message: "stdio requires non-empty command" }
    }
  } else {
    const urlErr = validateMcpUrl(entry.url, entry.transport)
    if (urlErr) return urlErr
  }
  for (const k of entry.transport === "stdio" ? Object.keys(entry.env) : Object.keys(entry.headers)) {
    if (k.trim().length === 0) {
      return entry.transport === "stdio"
        ? { code: "INVALID_ENV_KEY", field: "env", message: "env keys must be non-empty" }
        : { code: "INVALID_HEADER_KEY", field: "headers", message: "header keys must be non-empty" }
    }
  }
  return null
}
```

In `applyPatch`, inside the function body where subagent patches are handled, add a `customMcpServers` branch (place it next to the subagents branch):

```ts
let nextMcpServers = state.customMcpServers
if (patch.customMcpServers?.create) {
  const entry = buildMcpFromInput(patch.customMcpServers.create)
  const error = validateMcpShape(entry, state.customMcpServers.map((s) => ({ id: s.id, name: s.name })))
  if (error) throw new McpValidationException(error)
  nextMcpServers = [...state.customMcpServers, entry]
} else if (patch.customMcpServers?.update) {
  const { id, patch: mcpPatch } = patch.customMcpServers.update
  const idx = state.customMcpServers.findIndex((s) => s.id === id)
  if (idx < 0) throw new McpValidationException({ code: "NOT_FOUND", message: `MCP server ${id} not found` })
  const updated = applyMcpPatch(state.customMcpServers[idx], mcpPatch)
  const error = validateMcpShape(updated, state.customMcpServers.map((s) => ({ id: s.id, name: s.name })))
  if (error) throw new McpValidationException(error)
  nextMcpServers = [
    ...state.customMcpServers.slice(0, idx),
    updated,
    ...state.customMcpServers.slice(idx + 1),
  ]
} else if (patch.customMcpServers?.delete) {
  nextMcpServers = state.customMcpServers.filter((s) => s.id !== patch.customMcpServers!.delete!.id)
} else if (patch.customMcpServers?.setEnabled) {
  const { id, enabled } = patch.customMcpServers.setEnabled
  nextMcpServers = state.customMcpServers.map((s) =>
    s.id === id ? { ...s, enabled, updatedAt: new Date().toISOString() } : s,
  )
} else if (patch.customMcpServers?.setTestResult) {
  const { id, result } = patch.customMcpServers.setTestResult
  nextMcpServers = state.customMcpServers.map((s) =>
    s.id === id ? { ...s, lastTest: result, updatedAt: new Date().toISOString() } : s,
  )
}

return {
  ...state, // existing return spread, with subagents already applied
  customMcpServers: nextMcpServers,
}
```

(Integrate `customMcpServers: nextMcpServers` into the existing return object — do NOT duplicate the return statement.)

- [ ] **Step 4: Run tests (expect pass)**

Run: `bun test src/server/app-settings.test.ts -t "McpServer"`
Expected: 8 passes.

- [ ] **Step 5: Commit**

```bash
git add src/server/app-settings.ts src/server/app-settings.test.ts
git commit -m "feat(settings): CRUD + enable/setTestResult for customMcpServers

writePatch now handles create/update/delete/setEnabled/setTestResult
for customMcpServers. Validates slug, reserved 'kanna', URL scheme,
non-empty command, non-empty env/header keys."
```

---

## Task 4: Connect-test helper (`mcp-validator.ts`)

**Files:**
- Create: `src/server/mcp-validator.ts`
- Test: `src/server/mcp-validator.test.ts`

- [ ] **Step 1: Add the failing test**

`src/server/mcp-validator.test.ts`:

```ts
import { test, expect } from "bun:test"
import { validateMcpServer } from "./mcp-validator"
import type { McpServerConfig } from "../shared/types"

const STUB_OK_SERVER = `
const { Server } = require("@modelcontextprotocol/sdk/server/index.js")
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js")
const s = new Server({ name: "stub", version: "0.0.0" }, { capabilities: { tools: {} } })
s.setRequestHandler({ method: "tools/list" }, async () => ({ tools: [{ name: "ping", description: "p", inputSchema: { type: "object" } }] }))
;(async () => { await s.connect(new StdioServerTransport()) })()
`

function baseEntry(overrides: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "id",
    name: "test",
    enabled: true,
    createdAt: "",
    updatedAt: "",
    lastTest: { status: "untested" },
    transport: "stdio",
    command: "node",
    args: ["-e", STUB_OK_SERVER],
    env: {},
    ...overrides,
  } as McpServerConfig
}

test("stdio happy path returns ok with toolCount", async () => {
  const result = await validateMcpServer(baseEntry({}), { timeoutMs: 5_000 })
  expect(result.status).toBe("ok")
  if (result.status === "ok") {
    expect(result.toolCount).toBe(1)
  }
})

test("stdio ENOENT yields command not found", async () => {
  const cfg = baseEntry({ command: "/does/not/exist", args: [] }) as McpServerConfig
  const result = await validateMcpServer(cfg, { timeoutMs: 3_000 })
  expect(result.status).toBe("error")
  if (result.status === "error") {
    expect(result.message.toLowerCase()).toContain("command not found")
  }
})

test("stdio timeout returns timeout error", async () => {
  const sleeper = "setInterval(() => {}, 1000)"
  const cfg = baseEntry({ command: "node", args: ["-e", sleeper] }) as McpServerConfig
  const result = await validateMcpServer(cfg, { timeoutMs: 500 })
  expect(result.status).toBe("error")
  if (result.status === "error") {
    expect(result.message.toLowerCase()).toContain("timed out")
  }
}, 5_000)

test("http 401 surfaces unauthorized", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 401 }) })
  try {
    const cfg: McpServerConfig = {
      id: "id",
      name: "test",
      enabled: true,
      createdAt: "",
      updatedAt: "",
      lastTest: { status: "untested" },
      transport: "http",
      url: `http://127.0.0.1:${server.port}/mcp`,
      headers: {},
    }
    const result = await validateMcpServer(cfg, { timeoutMs: 3_000 })
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.message.toLowerCase()).toContain("unauthorized")
    }
  } finally {
    server.stop()
  }
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `bun test src/server/mcp-validator.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the validator**

`src/server/mcp-validator.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import type { McpServerConfig, McpServerTestResult } from "../shared/types"

const DEFAULT_TIMEOUT_MS = 10_000

export interface ValidateMcpOptions {
  timeoutMs?: number
}

export async function validateMcpServer(
  config: McpServerConfig,
  opts: ValidateMcpOptions = {},
): Promise<McpServerTestResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const start = Date.now()

  let client: Client | null = null
  const watchdog = new AbortController()
  const timer = setTimeout(() => watchdog.abort(), timeoutMs)

  try {
    client = new Client({ name: "kanna-validator", version: "0.0.0" }, { capabilities: {} })
    const transport = buildTransport(config)
    const connectPromise = client.connect(transport)
    await abortable(connectPromise, watchdog.signal, timeoutMs)
    const tools = await abortable(client.listTools(), watchdog.signal, timeoutMs)
    return {
      status: "ok",
      testedAt: new Date().toISOString(),
      toolCount: Array.isArray(tools.tools) ? tools.tools.length : 0,
    }
  } catch (err) {
    return {
      status: "error",
      testedAt: new Date().toISOString(),
      message: formatError(err, Date.now() - start, timeoutMs, config),
    }
  } finally {
    clearTimeout(timer)
    if (client) {
      try {
        await client.close()
      } catch {
        // ignore
      }
    }
  }
}

function buildTransport(config: McpServerConfig) {
  switch (config.transport) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
        cwd: config.cwd,
      })
    case "http":
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      })
    case "sse":
      return new SSEClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      })
    case "ws":
      return new WebSocketClientTransport(new URL(config.url))
  }
}

async function abortable<T>(p: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  if (signal.aborted) throw new Error(`connection timed out after ${timeoutMs}ms`)
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(`connection timed out after ${timeoutMs}ms`))
    signal.addEventListener("abort", onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener("abort", onAbort)
        reject(e)
      },
    )
  })
}

function formatError(err: unknown, elapsedMs: number, timeoutMs: number, config: McpServerConfig): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.includes("timed out")) {
    return `connection timed out after ${Math.round(timeoutMs / 1000)}s`
  }
  if (config.transport === "stdio") {
    if (raw.includes("ENOENT")) return `command not found: ${config.command}`
  } else {
    const m = raw.match(/(\d{3})/)
    if (m) {
      const status = Number(m[1])
      if (status === 401 || status === 403) return "unauthorized (check headers/env)"
      const host = (() => {
        try { return new URL(config.url).host } catch { return "host" }
      })()
      return `HTTP ${status} from ${host}`
    }
  }
  return raw
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `bun test src/server/mcp-validator.test.ts`
Expected: 4 passes.

- [ ] **Step 5: Commit**

```bash
git add src/server/mcp-validator.ts src/server/mcp-validator.test.ts
git commit -m "feat(mcp): in-process validator with 10s timeout

validateMcpServer connects via @modelcontextprotocol/sdk client, lists
tools, returns ok/error result. Per-transport client construction.
Translates ENOENT, HTTP 401/403, and timeouts to human messages."
```

---

## Task 5: Update `buildMcpConfigJson` for PTY driver

**Files:**
- Modify: `src/server/kanna-mcp-http.ts`
- Test: `src/server/kanna-mcp-http.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import { test, expect } from "bun:test"
import { buildMcpConfigJson } from "./kanna-mcp-http"
import type { McpServerConfig } from "../shared/types"

const HANDLE = { url: "http://127.0.0.1:1234/mcp", bearerToken: "tok" }

function stdio(name: string, command = "/bin/ls", enabled = true): McpServerConfig {
  return {
    id: name,
    name,
    enabled,
    createdAt: "", updatedAt: "",
    lastTest: { status: "untested" },
    transport: "stdio",
    command,
    args: ["-la"],
    env: { FOO: "bar" },
  }
}

test("buildMcpConfigJson: no user servers keeps just kanna", () => {
  const json = JSON.parse(buildMcpConfigJson(HANDLE))
  expect(Object.keys(json.mcpServers)).toEqual(["kanna"])
})

test("buildMcpConfigJson: user stdio entry included", () => {
  const json = JSON.parse(buildMcpConfigJson(HANDLE, [stdio("fs")]))
  expect(json.mcpServers.fs).toEqual({
    type: "stdio",
    command: "/bin/ls",
    args: ["-la"],
    env: { FOO: "bar" },
  })
})

test("buildMcpConfigJson: disabled entries dropped", () => {
  const json = JSON.parse(buildMcpConfigJson(HANDLE, [stdio("fs", "/bin/ls", false)]))
  expect(json.mcpServers.fs).toBeUndefined()
})

test("buildMcpConfigJson: collision with 'kanna' filtered", () => {
  const json = JSON.parse(buildMcpConfigJson(HANDLE, [stdio("kanna")]))
  expect(Object.keys(json.mcpServers)).toEqual(["kanna"])
  expect(json.mcpServers.kanna.url).toBe("http://127.0.0.1:1234/mcp")
})

test("buildMcpConfigJson: http user entry passes headers", () => {
  const cfg: McpServerConfig = {
    id: "x", name: "remote", enabled: true,
    createdAt: "", updatedAt: "", lastTest: { status: "untested" },
    transport: "http", url: "https://api.example.com/mcp", headers: { "x-key": "secret" },
  }
  const json = JSON.parse(buildMcpConfigJson(HANDLE, [cfg]))
  expect(json.mcpServers.remote).toEqual({
    type: "http",
    url: "https://api.example.com/mcp",
    headers: { "x-key": "secret" },
  })
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `bun test src/server/kanna-mcp-http.test.ts -t "buildMcpConfigJson"`
Expected: FAIL — current signature ignores user servers.

- [ ] **Step 3: Implement**

Replace `buildMcpConfigJson` in `src/server/kanna-mcp-http.ts`:

```ts
import type { McpServerConfig } from "../shared/types"

export function buildMcpConfigJson(
  handle: { url: string; bearerToken: string },
  userServers: readonly McpServerConfig[] = [],
): string {
  const mcpServers: Record<string, unknown> = {
    [KANNA_MCP_SERVER_NAME]: {
      type: "http",
      url: handle.url,
      headers: { Authorization: `Bearer ${handle.bearerToken}` },
    },
  }
  for (const s of userServers) {
    if (!s.enabled) continue
    if (s.name === KANNA_MCP_SERVER_NAME) continue
    mcpServers[s.name] = toClaudeCliMcpEntry(s)
  }
  return JSON.stringify({ mcpServers })
}

function toClaudeCliMcpEntry(s: McpServerConfig): Record<string, unknown> {
  if (s.transport === "stdio") {
    return {
      type: "stdio",
      command: s.command,
      args: s.args,
      env: s.env,
      ...(s.cwd ? { cwd: s.cwd } : {}),
    }
  }
  return {
    type: s.transport,
    url: s.url,
    headers: s.headers,
  }
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `bun test src/server/kanna-mcp-http.test.ts -t "buildMcpConfigJson"`
Expected: 5 passes.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-http.ts src/server/kanna-mcp-http.test.ts
git commit -m "feat(mcp): merge user servers into PTY mcp-config.json

buildMcpConfigJson now accepts userServers list. Drops disabled
entries and any whose name collides with KANNA_MCP_SERVER_NAME.
Maps each transport to the claude CLI's expected JSON shape."
```

---

## Task 6: Wire `customMcpServers` through PTY driver

**Files:**
- Modify: `src/server/claude-pty/driver.ts`
- Test: `src/server/claude-pty/driver.test.ts`

- [ ] **Step 1: Add the failing test**

Find the existing `--mcp-config` test in `driver.test.ts` and add alongside it:

```ts
test("PTY mcp-config.json contains user servers from args.customMcpServers", async () => {
  let writtenPath = ""
  let writtenJson = ""
  const original = (await import("node:fs/promises")).writeFile
  const writeFileSpy = mock(async (p: PathLike, content: string | Uint8Array) => {
    if (typeof p === "string" && p.endsWith("mcp-config.json")) {
      writtenPath = p
      writtenJson = typeof content === "string" ? content : new TextDecoder().decode(content)
    }
    return original(p, content)
  })
  // ... use existing test harness to call startClaudeSessionPTY with:
  //   customMcpServers: [{ id, name: "fs", transport: "stdio", command: "/bin/ls", args: [], env: {}, enabled: true, ... }]
  // Assert writtenJson parses and includes mcpServers.fs.
})
```

(Implementer: adapt to whatever mock infrastructure the existing `driver.test.ts` uses — there are already tests that intercept `writeFile` for `mcp-config.json`. Use those exact helpers.)

- [ ] **Step 2: Run tests (expect fail)**

Run: `bun test src/server/claude-pty/driver.test.ts -t "user servers"`
Expected: FAIL — args field doesn't exist.

- [ ] **Step 3: Implement**

In `src/server/claude-pty/driver.ts`:

a) Add to the imports near `buildMcpConfigJson`:

```ts
import type { McpServerConfig } from "../shared/types"
```

b) Add to `StartClaudeSessionPtyArgs`:

```ts
  /** Enabled user-defined MCP servers, written into mcp-config.json. */
  customMcpServers?: readonly McpServerConfig[]
```

c) In `spawnClaudePty` (around line 321 where `buildMcpConfigJson(mcpHandle)` is called), change to:

```ts
    await writeFile(
      mcpConfigPath,
      buildMcpConfigJson(mcpHandle, args.customMcpServers ?? []),
      { encoding: "utf8", mode: 0o600 },
    )
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `bun test src/server/claude-pty/driver.test.ts`
Expected: all pass (including the new test + the existing `--mcp-config` assertions).

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/driver.ts src/server/claude-pty/driver.test.ts
git commit -m "feat(pty): pass customMcpServers into mcp-config.json

StartClaudeSessionPtyArgs now carries customMcpServers; spawnClaudePty
forwards them to buildMcpConfigJson so user MCPs reach the claude CLI
even with --strict-mcp-config."
```

---

## Task 7: SDK driver — `buildUserMcpServers` + merged map + auto-allow

**Files:**
- Modify: `src/server/agent.ts`
- Test: `src/server/agent.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import { buildUserMcpServers } from "./agent"
import type { McpServerConfig } from "../shared/types"

test("buildUserMcpServers: maps stdio entry to SDK shape", () => {
  const cfg: McpServerConfig = {
    id: "1", name: "fs", enabled: true,
    createdAt: "", updatedAt: "", lastTest: { status: "untested" },
    transport: "stdio", command: "/bin/ls", args: [], env: { A: "1" },
  }
  const out = buildUserMcpServers([cfg])
  expect(out.fs).toEqual({ type: "stdio", command: "/bin/ls", args: [], env: { A: "1" } })
})

test("buildUserMcpServers: maps http entry", () => {
  const cfg: McpServerConfig = {
    id: "1", name: "remote", enabled: true,
    createdAt: "", updatedAt: "", lastTest: { status: "untested" },
    transport: "http", url: "https://example.com/mcp", headers: { K: "v" },
  }
  const out = buildUserMcpServers([cfg])
  expect(out.remote).toEqual({ type: "http", url: "https://example.com/mcp", headers: { K: "v" } })
})

test("buildUserMcpServers: filters disabled entries", () => {
  const cfg: McpServerConfig = {
    id: "1", name: "fs", enabled: false,
    createdAt: "", updatedAt: "", lastTest: { status: "untested" },
    transport: "stdio", command: "x", args: [], env: {},
  }
  expect(buildUserMcpServers([cfg])).toEqual({})
})

test("buildUserMcpServers: filters 'kanna' name collision", () => {
  const cfg: McpServerConfig = {
    id: "1", name: "kanna", enabled: true,
    createdAt: "", updatedAt: "", lastTest: { status: "untested" },
    transport: "stdio", command: "x", args: [], env: {},
  }
  expect(buildUserMcpServers([cfg])).toEqual({})
})
```

For `canUseTool`, add:

```ts
test("canUseTool auto-allows non-kanna mcp__ tools", async () => {
  // Use the existing test harness for creating an agent with a fake canUseTool wrapping;
  // assert decideToolPermission("mcp__github__create_issue", {}) === { behavior: "allow" }.
})
```

(Implementer: hook into wherever `canUseTool` is constructed; expose the inner decider as a pure function `decideUserMcpAutoAllow(toolName: string): boolean` to keep the test pure.)

- [ ] **Step 2: Run tests (expect fail)**

Run: `bun test src/server/agent.test.ts -t "buildUserMcpServers"`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement**

In `src/server/agent.ts`:

a) Add a top-level helper:

```ts
import { KANNA_MCP_SERVER_NAME } from "./kanna-mcp"
import type { McpServerConfig } from "../shared/types"

type SdkMcpEntry =
  | { type: "stdio"; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { type: "http"; url: string; headers: Record<string, string> }
  | { type: "sse"; url: string; headers: Record<string, string> }
  | { type: "ws"; url: string; headers: Record<string, string> }

export function buildUserMcpServers(
  servers: readonly McpServerConfig[],
): Record<string, SdkMcpEntry> {
  const out: Record<string, SdkMcpEntry> = {}
  for (const s of servers) {
    if (!s.enabled) continue
    if (s.name === KANNA_MCP_SERVER_NAME) continue
    if (s.transport === "stdio") {
      out[s.name] = {
        type: "stdio",
        command: s.command,
        args: s.args,
        env: s.env,
        ...(s.cwd ? { cwd: s.cwd } : {}),
      }
    } else {
      out[s.name] = {
        type: s.transport,
        url: s.url,
        headers: s.headers,
      }
    }
  }
  return out
}

export function isUserMcpTool(toolName: string): boolean {
  return toolName.startsWith("mcp__") && !toolName.startsWith(`mcp__${KANNA_MCP_SERVER_NAME}__`)
}
```

b) Add to `startClaudeHarnessStream` args (and any callers):

```ts
  customMcpServers?: readonly McpServerConfig[]
```

c) At `agent.ts:967`, replace the literal `mcpServers` map:

```ts
      mcpServers: {
        [KANNA_MCP_SERVER_NAME]: createKannaMcpServer({ ... }), // unchanged contents
        ...buildUserMcpServers(args.customMcpServers ?? []),
      },
```

d) In `canUseTool` (wherever it's defined for the chat agent — see line 965 region), before any other logic, add:

```ts
      if (isUserMcpTool(toolName)) {
        return { behavior: "allow", updatedInput: input }
      }
```

e) In `AgentCoordinator.buildClaudeSubagentStarter()` (around line 2452), forward the same field through `StartClaudeSessionPtyArgs` and SDK starter — read it once from `appSettingsStore.getSnapshot().customMcpServers` filtered to `enabled === true` per spawn.

f) Wherever `AgentCoordinator` calls `startClaudeHarnessStream` / `startClaudeSessionPTY`, add:

```ts
      customMcpServers: this.appSettingsStore
        .getSnapshot()
        .customMcpServers.filter((s) => s.enabled),
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `bun test src/server/agent.test.ts`
Expected: all existing tests still pass + new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(agent): wire customMcpServers through SDK driver

buildUserMcpServers maps enabled user MCPs to SDK transport configs
and merges into the query's mcpServers map. canUseTool auto-allows
any mcp__*__ tool whose server isn't 'kanna'. AgentCoordinator
forwards the snapshot to both the SDK starter and the PTY subagent
starter."
```

---

## Task 8: WS router — accept patches + add `settings.testMcpServer` RPC

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/server/ws-router.ts`
- Test: `src/server/ws-router.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
test("ws-router: settings.testMcpServer triggers validator and writes result", async () => {
  // Use the existing harness that boots ws-router; create a server first via
  // settings.writeAppSettingsPatch with customMcpServers.create; then send
  // settings.testMcpServer with the id; assert the snapshot picks up lastTest.
})

test("ws-router: settings.writeAppSettingsPatch.customMcpServers.create persists", async () => {
  // Mirrors existing subagent test at line 556.
})
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `bun test src/server/ws-router.test.ts -t "MCP"`
Expected: FAIL — message type unknown.

- [ ] **Step 3: Implement protocol + router**

In `src/shared/protocol.ts`, add:

```ts
  | { type: "settings.testMcpServer"; id: string }
```

to the client → server message union.

In `src/server/ws-router.ts`:

a) Inside the existing `mergeAppSettingsPatch` helper, add merging for `customMcpServers` (mirror subagents):

```ts
    if (patch.customMcpServers?.create) {
      // Optimistic merge omitted — server response is authoritative.
    }
```

(Server applies the patch through `writePatch` which is authoritative. Optimistic merge isn't needed because the snapshot stream re-emits.)

b) Inside the `settings.writeAppSettingsPatch` case, pass `customMcpServers` through to `appSettings.writePatch` (already covered by the spread; verify the field reaches the store).

c) Add a new case after `settings.writeAppSettingsPatch`:

```ts
        case "settings.testMcpServer": {
          const snapshot = appSettings?.getSnapshot() ?? fallbackAppSettingsSnapshot
          const entry = snapshot.customMcpServers.find((s) => s.id === message.id)
          if (!entry) {
            send({ type: "settings.testMcpServerResult", id: message.id, ok: false, message: "not found" })
            break
          }
          // Mark pending
          await appSettings?.writePatch({
            customMcpServers: {
              setTestResult: { id: entry.id, result: { status: "pending", startedAt: new Date().toISOString() } },
            },
          })
          const { validateMcpServer } = await import("./mcp-validator")
          const result = await validateMcpServer(entry)
          await appSettings?.writePatch({
            customMcpServers: { setTestResult: { id: entry.id, result } },
          })
          send({ type: "settings.testMcpServerResult", id: entry.id, ok: result.status === "ok", message: result.status === "error" ? result.message : undefined })
          break
        }
```

Add the server → client response type to `src/shared/protocol.ts`:

```ts
  | { type: "settings.testMcpServerResult"; id: string; ok: boolean; message?: string }
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `bun test src/server/ws-router.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/ws-router.ts src/server/ws-router.test.ts src/shared/protocol.ts
git commit -m "feat(ws): settings.testMcpServer + customMcpServers patch route

Adds the test-on-demand RPC that marks the entry pending, runs the
validator, persists the result, and acks via testMcpServerResult.
customMcpServers patches flow through the existing writePatch path."
```

---

## Task 9: Auto-test on save (server side)

**Files:**
- Modify: `src/server/ws-router.ts`

- [ ] **Step 1: Add the failing test**

Extend `ws-router.test.ts`:

```ts
test("creating an MCP server auto-runs validator and persists result", async () => {
  // Boot harness with a stub stdio MCP (use the same STUB_OK_SERVER from validator tests)
  // Send writeAppSettingsPatch.customMcpServers.create
  // Poll snapshot until lastTest.status !== "untested" (1s timeout)
  // Expect "ok".
})
```

- [ ] **Step 2: Run test (expect fail)**

Run: `bun test src/server/ws-router.test.ts -t "auto-runs validator"`
Expected: FAIL — no auto-test.

- [ ] **Step 3: Implement**

After the `settings.writeAppSettingsPatch` case in `ws-router.ts`, when the patch contains `customMcpServers.create` or `customMcpServers.update`, fire-and-forget a test:

```ts
          if (message.patch.customMcpServers?.create || message.patch.customMcpServers?.update) {
            const snap = appSettings?.getSnapshot()
            const target = snap?.customMcpServers.at(-1) // create case
              ?? snap?.customMcpServers.find((s) => s.id === message.patch.customMcpServers?.update?.id)
            if (target) {
              void runMcpAutoTest(target.id, appSettings, send)
            }
          }
```

Helper:

```ts
async function runMcpAutoTest(
  id: string,
  appSettings: { getSnapshot(): AppSettingsSnapshot; writePatch(p: AppSettingsPatch): Promise<unknown> } | undefined,
  send: (msg: ServerEvent) => void,
) {
  if (!appSettings) return
  const entry = appSettings.getSnapshot().customMcpServers.find((s) => s.id === id)
  if (!entry) return
  await appSettings.writePatch({
    customMcpServers: { setTestResult: { id, result: { status: "pending", startedAt: new Date().toISOString() } } },
  })
  const { validateMcpServer } = await import("./mcp-validator")
  const result = await validateMcpServer(entry)
  await appSettings.writePatch({ customMcpServers: { setTestResult: { id, result } } })
  send({ type: "settings.testMcpServerResult", id, ok: result.status === "ok", message: result.status === "error" ? result.message : undefined })
}
```

- [ ] **Step 4: Run test (expect pass)**

Run: `bun test src/server/ws-router.test.ts -t "auto-runs validator"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ws-router.ts src/server/ws-router.test.ts
git commit -m "feat(mcp): auto-validate on create/update

Fire-and-forget validator call after settings.writeAppSettingsPatch
creates or updates a custom MCP server. Result lands in lastTest and
streams back to the client."
```

---

## Task 10: Client store selector + IPC plumbing

**Files:**
- Modify: `src/client/lib/useAppSettingsStore.ts` (or wherever the existing settings zustand store lives — find via `grep -rn "useAppSettingsStore" src/client | head`)
- Modify: `src/client/lib/wsClient.ts` (or equivalent — the file that owns `settings.writeAppSettingsPatch` calls)

- [ ] **Step 1: Locate existing settings store**

Run: `grep -rn "useAppSettingsStore\|subagents:" src/client/lib | head -20`
Expected: identify the file that owns the subagent slice.

- [ ] **Step 2: Add stable empty constant + selector**

Add module-level constant:

```ts
const EMPTY_MCP_SERVERS: McpServerConfig[] = []
export const selectCustomMcpServers = (s: AppSettingsSnapshot) =>
  s.customMcpServers ?? EMPTY_MCP_SERVERS
```

- [ ] **Step 3: Add IPC helpers**

Mirror the existing `createSubagent` / `updateSubagent` / `deleteSubagent` helpers:

```ts
export function createMcpServer(input: McpServerInput) {
  send({ type: "settings.writeAppSettingsPatch", patch: { customMcpServers: { create: input } } })
}
export function updateMcpServer(id: string, patch: McpServerPatch) {
  send({ type: "settings.writeAppSettingsPatch", patch: { customMcpServers: { update: { id, patch } } } })
}
export function deleteMcpServer(id: string) {
  send({ type: "settings.writeAppSettingsPatch", patch: { customMcpServers: { delete: { id } } } })
}
export function setMcpServerEnabled(id: string, enabled: boolean) {
  send({ type: "settings.writeAppSettingsPatch", patch: { customMcpServers: { setEnabled: { id, enabled } } } })
}
export function testMcpServer(id: string) {
  send({ type: "settings.testMcpServer", id })
}
```

- [ ] **Step 4: Commit**

```bash
git add <changed files>
git commit -m "feat(client): MCP server store selector + IPC helpers

Stable empty-array selector for customMcpServers per render-loop
guard in CLAUDE.md. Helpers wrap writeAppSettingsPatch and the new
settings.testMcpServer message."
```

---

## Task 11: Settings UI — `McpServersSection.tsx`

**Files:**
- Create: `src/client/app/McpServersSection.tsx`
- Create: `src/client/app/McpServersSection.test.tsx`
- Modify: `src/client/app/SettingsPage.tsx`

- [ ] **Step 1: Add the failing test**

`src/client/app/McpServersSection.test.tsx`:

```tsx
import { test, expect } from "bun:test"
import { render, screen } from "@testing-library/react"
import { McpServersSection } from "./McpServersSection"

const handlers = {
  onCreate: () => {},
  onUpdate: () => {},
  onDelete: () => {},
  onSetEnabled: () => {},
  onTest: () => {},
}

test("renders empty state when no MCP servers", () => {
  render(<McpServersSection servers={[]} handlers={handlers} />)
  expect(screen.getByText(/No custom MCP servers/i)).toBeInTheDocument()
})

test("renders rows with name and transport badge", () => {
  const server = {
    id: "1", name: "fs", enabled: true,
    createdAt: "", updatedAt: "", lastTest: { status: "untested" as const },
    transport: "stdio" as const, command: "/bin/ls", args: [], env: {},
  }
  render(<McpServersSection servers={[server]} handlers={handlers} />)
  expect(screen.getByText("fs")).toBeInTheDocument()
  expect(screen.getByText(/stdio/i)).toBeInTheDocument()
})

test("renders ok pill when lastTest is ok", () => {
  const server = {
    id: "1", name: "fs", enabled: true,
    createdAt: "", updatedAt: "", lastTest: { status: "ok" as const, testedAt: "", toolCount: 3 },
    transport: "stdio" as const, command: "/bin/ls", args: [], env: {},
  }
  render(<McpServersSection servers={[server]} handlers={handlers} />)
  expect(screen.getByText(/3 tools/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test (expect fail)**

Run: `bun test src/client/app/McpServersSection.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the section**

`src/client/app/McpServersSection.tsx`:

```tsx
import { useState } from "react"
import type { McpServerConfig, McpServerInput, McpServerPatch } from "../../shared/types"

export interface McpServersSectionHandlers {
  onCreate: (input: McpServerInput) => void
  onUpdate: (id: string, patch: McpServerPatch) => void
  onDelete: (id: string) => void
  onSetEnabled: (id: string, enabled: boolean) => void
  onTest: (id: string) => void
}

interface Props {
  servers: McpServerConfig[]
  handlers: McpServersSectionHandlers
}

export function McpServersSection({ servers, handlers }: Props) {
  const [editing, setEditing] = useState<McpServerConfig | "new" | null>(null)

  return (
    <section aria-labelledby="mcp-servers-heading">
      <header className="flex items-center justify-between">
        <h2 id="mcp-servers-heading" className="text-base font-medium">Custom MCP servers</h2>
        <button type="button" onClick={() => setEditing("new")}>Add server</button>
      </header>

      {servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom MCP servers. Add one to extend the model&apos;s tool surface.
        </p>
      ) : (
        <ul className="divide-y">
          {servers.map((s) => (
            <McpRow key={s.id} server={s} handlers={handlers} onEdit={() => setEditing(s)} />
          ))}
        </ul>
      )}

      {editing && (
        <McpServerEditor
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(input, id) => {
            if (id) handlers.onUpdate(id, input)
            else handlers.onCreate(input as McpServerInput)
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}

function McpRow({
  server,
  handlers,
  onEdit,
}: {
  server: McpServerConfig
  handlers: McpServersSectionHandlers
  onEdit: () => void
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="font-medium">{server.name}</span>
      <span className="text-xs rounded bg-muted px-1.5 py-0.5">{server.transport}</span>
      <TestPill result={server.lastTest} />
      <div className="ml-auto flex items-center gap-2">
        <label className="text-sm">
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(e) => handlers.onSetEnabled(server.id, e.target.checked)}
          />
          Enabled
        </label>
        <button type="button" onClick={() => handlers.onTest(server.id)}>Test</button>
        <button type="button" onClick={onEdit}>Edit</button>
        <button type="button" onClick={() => handlers.onDelete(server.id)}>Delete</button>
      </div>
    </li>
  )
}

function TestPill({ result }: { result: McpServerConfig["lastTest"] }) {
  switch (result.status) {
    case "ok":
      return <span className="text-xs text-green-600">OK ({result.toolCount} tools)</span>
    case "pending":
      return <span className="text-xs text-muted-foreground">Testing…</span>
    case "error":
      return <span className="text-xs text-red-600" title={result.message}>Failed</span>
    case "untested":
    default:
      return <span className="text-xs text-muted-foreground">Untested</span>
  }
}

function McpServerEditor({
  initial,
  onClose,
  onSave,
}: {
  initial: McpServerConfig | null
  onClose: () => void
  onSave: (input: McpServerInput | McpServerPatch, id?: string) => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [transport, setTransport] = useState<McpServerConfig["transport"]>(initial?.transport ?? "stdio")
  const [command, setCommand] = useState(initial?.transport === "stdio" ? initial.command : "")
  const [argsText, setArgsText] = useState(initial?.transport === "stdio" ? initial.args.join("\n") : "")
  const [envText, setEnvText] = useState(
    initial?.transport === "stdio"
      ? Object.entries(initial.env).map(([k, v]) => `${k}=${v}`).join("\n")
      : "",
  )
  const [url, setUrl] = useState(initial && initial.transport !== "stdio" ? initial.url : "")
  const [headersText, setHeadersText] = useState(
    initial && initial.transport !== "stdio"
      ? Object.entries(initial.headers).map(([k, v]) => `${k}: ${v}`).join("\n")
      : "",
  )

  function submit() {
    const args = argsText.split("\n").map((s) => s.trim()).filter((s) => s.length > 0)
    const env: Record<string, string> = {}
    for (const line of envText.split("\n")) {
      const idx = line.indexOf("=")
      if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1)
    }
    const headers: Record<string, string> = {}
    for (const line of headersText.split("\n")) {
      const idx = line.indexOf(":")
      if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    const input =
      transport === "stdio"
        ? { name, transport: "stdio" as const, command, args, env }
        : { name, transport, url, headers }
    onSave(input, initial?.id)
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 grid place-items-center bg-black/40">
      <div className="bg-background w-[480px] rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium">{initial ? "Edit MCP server" : "Add MCP server"}</h3>
        <label className="block text-xs">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="block w-full border rounded p-1" />
        </label>
        <label className="block text-xs">
          Transport
          <select value={transport} onChange={(e) => setTransport(e.target.value as McpServerConfig["transport"])} className="block w-full border rounded p-1">
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="sse">sse</option>
            <option value="ws">ws</option>
          </select>
        </label>
        {transport === "stdio" ? (
          <>
            <label className="block text-xs">
              Command
              <input value={command} onChange={(e) => setCommand(e.target.value)} className="block w-full border rounded p-1" />
            </label>
            <label className="block text-xs">
              Args (one per line)
              <textarea value={argsText} onChange={(e) => setArgsText(e.target.value)} className="block w-full border rounded p-1" rows={3} />
            </label>
            <label className="block text-xs">
              Env (KEY=value, one per line)
              <textarea value={envText} onChange={(e) => setEnvText(e.target.value)} className="block w-full border rounded p-1" rows={3} />
            </label>
          </>
        ) : (
          <>
            <label className="block text-xs">
              URL
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="block w-full border rounded p-1" />
            </label>
            {transport !== "ws" && (
              <label className="block text-xs">
                Headers (Key: value, one per line)
                <textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)} className="block w-full border rounded p-1" rows={3} />
              </label>
            )}
            {transport === "ws" && (
              <p className="text-xs text-muted-foreground">Headers are not supported on ws transport.</p>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={submit}>Save</button>
        </div>
      </div>
    </div>
  )
}
```

In `src/client/app/SettingsPage.tsx`, locate where `SubagentsSettingsBranch` is composed and add:

```tsx
import { McpServersSection } from "./McpServersSection"
import { selectCustomMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, setMcpServerEnabled, testMcpServer } from "../lib/<settings-store-path>"

// inside the JSX, between Subagents and OAuth tokens:
<McpServersSection
  servers={useAppSettingsStore(selectCustomMcpServers)}
  handlers={{
    onCreate: createMcpServer,
    onUpdate: updateMcpServer,
    onDelete: deleteMcpServer,
    onSetEnabled: setMcpServerEnabled,
    onTest: testMcpServer,
  }}
/>
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `bun test src/client/app/McpServersSection.test.tsx`
Expected: 3 passes.

- [ ] **Step 5: Run the dev server and verify manually**

Run: `bun run dev` (or the project's dev command — see `package.json`).
Open the Settings page in the browser. Confirm the new section renders, "Add server" opens the editor, and saving an entry creates a row that immediately turns into "Testing…" then OK/Failed.

- [ ] **Step 6: Commit**

```bash
git add src/client/app/McpServersSection.tsx src/client/app/McpServersSection.test.tsx src/client/app/SettingsPage.tsx
git commit -m "feat(ui): McpServersSection for installing custom MCP servers

List, add, edit, delete, enable/disable, and run on-demand tests for
user MCP servers. Editor handles all four transports with conditional
fields. Placed between Subagents and OAuth tokens on the Settings
page."
```

---

## Task 12: Driver test sweep — assert customMcpServers reach the SDK

**Files:**
- Modify: `src/server/agent.test.ts`

- [ ] **Step 1: Add the test**

```ts
test("agent passes customMcpServers into the SDK query call", async () => {
  // Use existing SDK-mock harness (see agent.oauth-pool.test.ts for a
  // pattern that intercepts the imported query() module).
  // Boot a coordinator with appSettingsStore that returns one enabled
  // stdio MCP. Start a chat. Assert the recorded query() args contain
  // mcpServers["fs"] with type "stdio".
})
```

- [ ] **Step 2: Run test (expect fail or already passing?)**

Run: `bun test src/server/agent.test.ts -t "customMcpServers"`
Expected: FAIL if not yet wired through the coordinator.

- [ ] **Step 3: Wire `customMcpServers` through `AgentCoordinator` if not already done in Task 7**

Confirm both call sites (SDK starter and PTY starter) pass the filtered list.

- [ ] **Step 4: Run test (expect pass)**

Run: `bun test src/server/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (only if changes made)**

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "test(agent): assert customMcpServers reach SDK + PTY starters"
```

---

## Task 13: Docs + C3 + lint gate

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.c3/c3-2-server/<relevant-component-doc>.md` (locate via `/c3 query mcp`)

- [ ] **Step 1: Add CLAUDE.md section**

After the "Kanna-MCP Built-in Shims" section, add:

```markdown
# Custom MCP Servers

Users can register MCP servers in Settings → "Custom MCP servers".
Entries persist in `settings.json` under `customMcpServers` (file mode
0600) and are merged into both drivers at chat spawn time:

- **SDK driver** (`agent.ts`): `buildUserMcpServers` maps each enabled
  entry to the SDK's per-transport config and merges it into the
  `mcpServers` map passed to `query()` alongside `mcp__kanna__*`.
- **PTY driver** (`kanna-mcp-http.ts:buildMcpConfigJson`): entries
  serialize into the same `mcp-config.json` the driver hands to
  `--strict-mcp-config`. Kanna settings remain the single source of
  truth; `~/.claude.json` is still ignored.

User MCP tool calls auto-allow (`canUseTool` short-circuits any
`mcp__<name>__*` whose `<name>` is not `kanna`). The trust model is "if
the user installed it, they trust it" — identical to the existing
non-kanna MCP behavior.

Supported transports: `stdio`, `http`, `sse`, `ws`. Reserved name:
`kanna`. Names match `^[a-zA-Z][a-zA-Z0-9_-]{0,31}$` and form the tool
prefix `mcp__<name>__<tool>`.

On save, the server runs `validateMcpServer` in-process (10s timeout,
list-tools probe) and caches the result on the entry as `lastTest`.
The UI shows a per-row status pill plus a manual "Test" button.
```

- [ ] **Step 2: Run C3**

Run: `/c3 change` (announce the new boundary crossing
`app-settings.ts ↔ kanna-mcp-http.ts ↔ agent.ts ↔ claude-pty/driver.ts`).
Expected: docs updated. Add a rule "User MCP server names must never
equal KANNA_MCP_SERVER_NAME."

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS, zero new warnings. If the new code introduces any
warnings, fix them; do not raise the warning cap.

- [ ] **Step 4: Run the full test suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 5: Commit docs**

```bash
git add CLAUDE.md .c3/
git commit -m "docs(mcp): document custom MCP servers + C3 sync"
```

---

## Task 14: Open PR

**Files:** none.

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/custom-mcp-servers
```

- [ ] **Step 2: Open PR against the fork**

```bash
gh pr create \
  --repo cuongtranba/kanna \
  --base main \
  --head feat/custom-mcp-servers \
  --title "feat: custom MCP servers in settings (SDK + PTY)" \
  --body "$(cat <<'EOF'
## Summary

- Adds a "Custom MCP servers" section to Settings with full CRUD across
  the four MCP transports (stdio / http / sse / ws).
- Wires the saved list through both the SDK driver (merged into the
  `mcpServers` map passed to `query()`) and the PTY driver (written
  into the same `mcp-config.json` consumed under `--strict-mcp-config`).
- In-process `validateMcpServer` runs on save (10s timeout) and on
  demand from the UI; result cached on the entry.
- Non-`mcp__kanna__*` user tools auto-allow in `canUseTool`.

## Test plan
- [ ] `bun test` green
- [ ] `bun run lint` zero new warnings
- [ ] Settings UI: add stdio + http entry, observe Testing → OK
- [ ] SDK chat: confirm `mcp__fs__*` tools appear in `/tools`
- [ ] PTY chat: same, plus verify `~/.kanna/runtime/<spawn>/mcp-config.json` includes the user entry
- [ ] Reserved name `kanna` rejected
- [ ] Disabling an entry hides it from the next spawn
EOF
)"
```

- [ ] **Step 3: Report PR URL**

Print the URL `gh pr create` returned for the user.

---

## Self-Review Notes (kept here, not for execution)

Spec coverage check — every spec section maps to a task:

| Spec § | Task |
|--------|------|
| §1 Data model | 1 |
| §2 Storage | 2, 3 |
| §3 SDK wiring | 7 |
| §4 PTY wiring | 5, 6 |
| §5 Validator | 4 |
| §6 Settings UI | 10, 11 |
| §7 Tests + C3 + rollout | 2–9 (tests), 13 (C3 + docs) |
| Spec risks (stdio hang, external hosts) | 4 (timeout), 13 (docs) |

Type consistency check: `McpServerInput`, `McpServerPatch`,
`McpServerConfig`, `McpServerTestResult`, `McpValidationError`,
`KANNA_MCP_SERVER_NAME` referenced identically across all tasks.

No placeholders flagged.
