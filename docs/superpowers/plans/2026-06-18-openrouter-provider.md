# OpenRouter Provider (SDK mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `openrouter` as a third chat `AgentProvider` peer to claude/codex, running full agentic turns through the existing Claude Agent SDK redirected to OpenRouter's Anthropic-compatible endpoint.

**Architecture:** OpenRouter turns reuse `startClaudeTurn` → `startClaudeSession` → `query()`. The only deltas: `buildClaudeEnv` injects `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY=""`, the model slug is passed raw, the OAuth pool is skipped, and the SDK driver is forced (never PTY). The model list is fetched live from OpenRouter, filtered to tool-capable, cached, and exposed via RPC. SDK mode only.

**Tech Stack:** Bun, TypeScript, `@anthropic-ai/claude-agent-sdk`, React 19, Zustand, browser-native `fetch`.

**Spec:** `docs/superpowers/specs/2026-06-18-openrouter-provider-design.md`
**ADR:** `adr-20260618-openrouter-sdk-provider`

**Conventions:**
- Run tests scoped to changed files: `bun test src/server/<file>.test.ts`.
- `bun run lint` must stay at 0 errors; do not add `eslint-disable`.
- IO (model-list fetch + cache) MUST live in `*-io.adapter.ts`.
- Commit after each task.

---

## File Structure

- `src/shared/types.ts` — add `"openrouter"` to `AgentProvider`, `OpenRouterModel` type, openrouter `PROVIDERS` entry, `OPENROUTER_BASE_URL`/`OPENROUTER_MODELS_URL` consts.
- `src/server/provider-catalog.ts` — `isClaudeSdkProvider` helper + openrouter server entry.
- `src/server/openrouter-models-io.adapter.ts` (new) — fetch + tool-capable filter + on-disk cache. The only IO.
- `src/server/openrouter-models.ts` (new) — pure cache/TTL logic, fetch injected.
- `src/server/agent.ts` — `buildClaudeEnv` openrouter branch; dispatch + `startClaudeTurn` provider routing; `authReady`.
- `src/server/ws-router.ts` — `settings.listOpenRouterModels` RPC.
- `src/shared/protocol.ts` — RPC command/result type.
- `src/client/stores/openrouterModelsStore.ts` (new) — Zustand store, stable `EMPTY` ref.
- `src/client/components/chat-ui/ChatPreferenceControls.tsx` — provider icon + searchable openrouter model picker.

---

## Task 1: Add `openrouter` to the AgentProvider union + shared consts

**Files:**
- Modify: `src/shared/types.ts:6`, `:13-14`
- Test: `src/shared/types.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test**

Append to `src/shared/types.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { PROVIDERS, OPENROUTER_BASE_URL, OPENROUTER_MODELS_URL, DEFAULT_OPENROUTER_SDK_MODEL } from "./types"

describe("openrouter provider", () => {
  test("openrouter is a known provider with a default model and empty static models", () => {
    const entry = PROVIDERS.find((p) => p.id === "openrouter")
    expect(entry).toBeDefined()
    expect(entry?.defaultModel).toBe(DEFAULT_OPENROUTER_SDK_MODEL)
    expect(entry?.models).toEqual([])
    expect(entry?.supportsPlanMode).toBe(true)
  })
  test("openrouter endpoints are defined", () => {
    expect(OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api")
    expect(OPENROUTER_MODELS_URL).toBe("https://openrouter.ai/api/v1/models")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/shared/types.test.ts`
Expected: FAIL — `openrouter` entry undefined / consts not exported.

- [ ] **Step 3: Implement**

In `src/shared/types.ts` line 6:

```ts
export type AgentProvider = "claude" | "codex" | "openrouter"
```

Add consts near `DEFAULT_OPENROUTER_SDK_MODEL` (line 14):

```ts
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api"
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

export interface OpenRouterModel {
  id: string
  label: string
  contextLength: number
}
```

Append an entry to the `PROVIDERS` array (after the codex entry, before the closing `]` at line 397):

```ts
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: DEFAULT_OPENROUTER_SDK_MODEL,
    supportsPlanMode: true,
    models: [],
    efforts: [],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/shared/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check the union widening**

Run: `bun run check 2>&1 | head -40`
Expected: surface every `switch`/`===` site that no longer covers the union. Note them — Tasks 2–6 fix them. If `check` is too broad, run `bunx tsc --noEmit 2>&1 | grep -i openrouter`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/types.test.ts
git commit -m "feat(types): add openrouter to AgentProvider union"
```

---

## Task 2: `isClaudeSdkProvider` helper + server catalog entry

**Files:**
- Modify: `src/server/provider-catalog.ts`
- Test: `src/server/provider-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/server/provider-catalog.test.ts`:

```ts
import { isClaudeSdkProvider, getServerProviderCatalog } from "./provider-catalog"

describe("isClaudeSdkProvider", () => {
  test("claude and openrouter use the Claude SDK path; codex does not", () => {
    expect(isClaudeSdkProvider("claude")).toBe(true)
    expect(isClaudeSdkProvider("openrouter")).toBe(true)
    expect(isClaudeSdkProvider("codex")).toBe(false)
  })
  test("openrouter server catalog entry exists", () => {
    const entry = getServerProviderCatalog("openrouter")
    expect(entry.id).toBe("openrouter")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/provider-catalog.test.ts`
Expected: FAIL — `isClaudeSdkProvider` not exported.

- [ ] **Step 3: Implement**

In `src/server/provider-catalog.ts`, add:

```ts
export function isClaudeSdkProvider(provider: AgentProvider): boolean {
  return provider === "claude" || provider === "openrouter"
}
```

`SERVER_PROVIDERS` already maps over `PROVIDERS`, so the openrouter entry from Task 1 flows through unchanged. No further edit needed for the catalog list.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/provider-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/provider-catalog.ts src/server/provider-catalog.test.ts
git commit -m "feat(provider-catalog): add isClaudeSdkProvider + openrouter entry"
```

---

## Task 3: `buildClaudeEnv` OpenRouter branch

**Files:**
- Modify: `src/server/agent.ts:1085-1091`
- Test: `src/server/agent.test.ts` (append; create if the targeted describe is absent)

- [ ] **Step 1: Write the failing test**

Append to `src/server/agent.test.ts`:

```ts
import { buildClaudeEnv } from "./agent"

describe("buildClaudeEnv openrouter branch", () => {
  test("openrouter sets endpoint+auth, empties ANTHROPIC_API_KEY, strips oauth", () => {
    const env = buildClaudeEnv(
      { PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "should-be-stripped", ANTHROPIC_API_KEY: "leftover" } as NodeJS.ProcessEnv,
      "oauth-ignored",
      { apiKey: "sk-or-test" },
    )
    expect(env.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api")
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-or-test")
    expect(env.ANTHROPIC_API_KEY).toBe("")
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })
  test("non-openrouter keeps existing oauth behavior", () => {
    const env = buildClaudeEnv({ PATH: "/bin" } as NodeJS.ProcessEnv, "oauth-123")
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-123")
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/agent.test.ts -t "buildClaudeEnv openrouter"`
Expected: FAIL — third arg ignored; env vars unset.

- [ ] **Step 3: Implement**

Replace `buildClaudeEnv` at `src/server/agent.ts:1085`:

```ts
export function buildClaudeEnv(
  baseEnv: NodeJS.ProcessEnv,
  oauthToken: string | null,
  openrouter?: { apiKey: string } | null,
): NodeJS.ProcessEnv {
  const { CLAUDECODE: _unused, CLAUDE_CODE_OAUTH_TOKEN: _oauth, ...rest } = baseEnv
  if (openrouter) {
    // OpenRouter's Anthropic-compatible endpoint. ANTHROPIC_API_KEY MUST be
    // explicitly empty or the SDK prefers it and auth fails.
    return {
      ...rest,
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: openrouter.apiKey,
      ANTHROPIC_API_KEY: "",
    }
  }
  if (!oauthToken) return { ...rest, ...(baseEnv.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: baseEnv.CLAUDE_CODE_OAUTH_TOKEN } : {}) }
  return { ...rest, CLAUDE_CODE_OAUTH_TOKEN: oauthToken }
}
```

Note: the non-openrouter branch must preserve prior behavior — when `oauthToken` is null but the base env already had `CLAUDE_CODE_OAUTH_TOKEN`, keep it (matches old `...rest` which retained it). The destructure now strips it, so re-add it in that one case.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/agent.test.ts -t "buildClaudeEnv"`
Expected: PASS (both cases).

- [ ] **Step 5: Thread openrouter into the query() call site**

At `src/server/agent.ts:1178`, `startClaudeSession` builds `env: buildClaudeEnv(process.env, args.oauthToken)`. Add an optional arg to `startClaudeSession`'s arg type (near `oauthToken: string | null` at line 1101):

```ts
  /** When set, redirect the SDK to OpenRouter instead of Anthropic. */
  openrouterApiKey?: string | null
```

Change line 1178 to:

```ts
      env: buildClaudeEnv(process.env, args.oauthToken, args.openrouterApiKey ? { apiKey: args.openrouterApiKey } : null),
```

- [ ] **Step 6: Run targeted tests + commit**

Run: `bun test src/server/agent.test.ts -t "buildClaudeEnv"`
Expected: PASS.

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(agent): buildClaudeEnv openrouter env redirect"
```

---

## Task 4: Route openrouter turns through the Claude SDK path

**Files:**
- Modify: `src/server/agent.ts` — dispatch (`:2233`), `startClaudeTurn` (`:2448`), `authReady` (`:2887`), proactive-compact guard (`:2684`), idle/session `provider === "claude"` checks (`:1396`, `:1502`).
- Test: `src/server/agent.test.ts`

- [ ] **Step 1: Write the failing test (auth gating)**

Append to `src/server/agent.test.ts`. Construct an `AgentCoordinator` the same way existing tests in this file do (reuse the local `makeCoordinator`/fixture helper already present — match its current signature). Assert:

```ts
describe("openrouter auth gating", () => {
  test("authReady('openrouter') is false when no openrouter key is configured", async () => {
    // Build a coordinator whose llm-provider snapshot has no openrouter key.
    // (Reuse this file's existing coordinator fixture; inject a readLlmProvider
    // stub returning { provider: 'openrouter', enabled: false }.)
    const ready = await coordinatorAuthReady("openrouter") // helper from fixture
    expect(ready).toBe(false)
  })
  test("authReady('openrouter') is true when an enabled openrouter key exists", async () => {
    const ready = await coordinatorAuthReadyWithKey("openrouter")
    expect(ready).toBe(true)
  })
})
```

If the existing test file has no coordinator fixture, write the assertions against a thin extraction instead: add a pure helper `openrouterAuthReady(snapshot: LlmProviderSnapshot): boolean` to `src/server/provider-catalog.ts` and test that directly:

```ts
// provider-catalog.test.ts
import { openrouterAuthReady } from "./provider-catalog"
test("openrouterAuthReady requires enabled openrouter snapshot", () => {
  expect(openrouterAuthReady({ provider: "openrouter", enabled: true } as any)).toBe(true)
  expect(openrouterAuthReady({ provider: "openrouter", enabled: false } as any)).toBe(false)
  expect(openrouterAuthReady({ provider: "openai", enabled: true } as any)).toBe(false)
})
```

Prefer the pure-helper form — it is deterministic and avoids coordinator wiring.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/provider-catalog.test.ts -t "openrouterAuthReady"`
Expected: FAIL — helper missing.

- [ ] **Step 3: Implement the auth helper**

In `src/server/provider-catalog.ts`:

```ts
import type { LlmProviderSnapshot } from "../shared/types"

export function openrouterAuthReady(snapshot: LlmProviderSnapshot): boolean {
  return snapshot.provider === "openrouter" && snapshot.enabled && snapshot.apiKey.length > 0
}
```

- [ ] **Step 4: Wire dispatch + startClaudeTurn + authReady**

In `src/server/agent.ts`:

(a) Import the helpers at the top: `isClaudeSdkProvider`, `openrouterAuthReady` from `./provider-catalog`, and `readLlmProviderSnapshot` from `./llm-provider`.

(b) Dispatch at `:2233` — change `if (args.provider === "claude")` to `if (isClaudeSdkProvider(args.provider))`. Pass the provider into `startClaudeTurn`:

```ts
      turn = await this.startClaudeTurn({
        chatId: args.chatId,
        provider: args.provider,           // NEW
        projectId: project.id,
        localPath: spawn.cwd,
        ...
      })
```

(c) `startClaudeTurn` arg type (`:2448`) — add `provider: AgentProvider`. Inside, before the spawn:

```ts
    const isOpenRouter = args.provider === "openrouter"
    const openrouterApiKey = isOpenRouter
      ? (await this.readLlmProvider()).apiKey   // inject via constructor dep; see step 4e
      : null
```

For OpenRouter: skip the OAuth pool entirely and force SDK:

```ts
      const picked = isOpenRouter ? null : (this.oauthPool?.pickActive(args.chatId) ?? null)
      if (!isOpenRouter && this.oauthPool && this.oauthPool.hasAnyToken() && !picked) {
        throw new OAuthPoolUnavailableError(this.buildPoolUnavailableMessage(args.chatId, ""))
      }
      if (picked) this.oauthPool!.markUsed(picked.id)
      const usePty = !isOpenRouter && this.resolveClaudeDriverPreference() === "pty"
```

In the SDK `startClaudeSessionFn({...})` call (`:2531`), add:

```ts
              openrouterApiKey,
```

(d) `authReady` at `:2887`:

```ts
      authReady: async (provider) => {
        if (provider === "openrouter") {
          return openrouterAuthReady(await this.readLlmProvider())
        }
        if (provider === "claude") {
          return Boolean(settings.claudeAuth?.authenticated || this.oauthPool?.hasUsable(args.chatId))
        }
        // codex unchanged
        ...
      },
```

(e) Constructor dep — `AgentCoordinator` needs `readLlmProvider`. Add to `AgentCoordinatorArgs`:

```ts
  /** Reads the persisted LLM provider snapshot (OpenRouter key source). */
  readLlmProvider?: () => Promise<LlmProviderSnapshot>
```

Store it: `this.readLlmProvider = args.readLlmProvider ?? readLlmProviderSnapshot`. Wire the real impl in `server.ts` where `AgentCoordinator` is constructed (search `new AgentCoordinator(`).

(f) Session-management `provider === "claude"` checks at `:1396` and `:1502` — change to `isClaudeSdkProvider(...)` so openrouter sessions are tracked + idle-reaped like claude.

(g) Proactive-compact guard at `:2684` — leave as `provider === "claude"` (compaction is a claude-CLI slash command; do NOT inject `/compact` for openrouter). Add a comment noting the deliberate exclusion.

- [ ] **Step 5: Run targeted tests**

Run: `bun test src/server/provider-catalog.test.ts src/server/agent.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `bunx tsc --noEmit 2>&1 | grep -iE "openrouter|provider" | head`
Expected: no errors referencing the new code paths.

- [ ] **Step 7: Commit**

```bash
git add src/server/agent.ts src/server/provider-catalog.ts src/server/provider-catalog.test.ts src/server/server.ts
git commit -m "feat(agent): route openrouter turns through SDK path with llm-provider key"
```

---

## Task 5: OpenRouter model-list adapter (fetch + filter + cache)

**Files:**
- Create: `src/server/openrouter-models.ts` (pure)
- Create: `src/server/openrouter-models-io.adapter.ts` (IO)
- Test: `src/server/openrouter-models.test.ts`

- [ ] **Step 1: Write the failing test (pure parse + filter + TTL)**

`src/server/openrouter-models.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { parseOpenRouterModels, OpenRouterModelCache } from "./openrouter-models"

const RAW = {
  data: [
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", context_length: 200000, supported_parameters: ["tools", "temperature"] },
    { id: "x/no-tools", name: "No Tools", context_length: 8000, supported_parameters: ["temperature"] },
  ],
}

describe("parseOpenRouterModels", () => {
  test("keeps only tool-capable models, mapped to OpenRouterModel", () => {
    const models = parseOpenRouterModels(RAW)
    expect(models).toEqual([{ id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", contextLength: 200000 }])
  })
  test("tolerates missing fields without throwing", () => {
    expect(parseOpenRouterModels({})).toEqual([])
    expect(parseOpenRouterModels({ data: [{ id: "y", supported_parameters: ["tools"] }] }))
      .toEqual([{ id: "y", label: "y", contextLength: 0 }])
  })
})

describe("OpenRouterModelCache", () => {
  test("fetches once, serves cache within TTL, refetches after TTL", async () => {
    let calls = 0
    let now = 1000
    const cache = new OpenRouterModelCache({
      fetchRaw: async () => { calls++; return RAW },
      ttlMs: 100,
      now: () => now,
    })
    expect((await cache.list()).length).toBe(1)
    expect((await cache.list()).length).toBe(1)
    expect(calls).toBe(1)
    now = 1200
    await cache.list()
    expect(calls).toBe(2)
  })
  test("on fetch failure returns last good list", async () => {
    let fail = false
    const cache = new OpenRouterModelCache({
      fetchRaw: async () => { if (fail) throw new Error("net"); return RAW },
      ttlMs: 0,
      now: () => Date.now(),
    })
    await cache.list()
    fail = true
    expect((await cache.list()).length).toBe(1) // stale-but-good
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/openrouter-models.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the pure module**

`src/server/openrouter-models.ts`:

```ts
import type { OpenRouterModel } from "../shared/types"

interface RawModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  supported_parameters?: unknown
}

export function parseOpenRouterModels(raw: unknown): OpenRouterModel[] {
  const data = (raw as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: OpenRouterModel[] = []
  for (const entry of data as RawModel[]) {
    if (typeof entry?.id !== "string") continue
    const params = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : []
    if (!params.includes("tools")) continue
    out.push({
      id: entry.id,
      label: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id,
      contextLength: typeof entry.context_length === "number" ? entry.context_length : 0,
    })
  }
  return out
}

export interface OpenRouterModelCacheDeps {
  fetchRaw: () => Promise<unknown>
  ttlMs: number
  now: () => number
}

export class OpenRouterModelCache {
  private cached: OpenRouterModel[] | null = null
  private fetchedAt = 0
  constructor(private readonly deps: OpenRouterModelCacheDeps) {}

  async list(): Promise<OpenRouterModel[]> {
    const fresh = this.cached !== null && this.deps.now() - this.fetchedAt < this.deps.ttlMs
    if (fresh) return this.cached!
    try {
      const models = parseOpenRouterModels(await this.deps.fetchRaw())
      this.cached = models
      this.fetchedAt = this.deps.now()
      return models
    } catch (error) {
      if (this.cached !== null) return this.cached // stale-but-good
      throw error
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/openrouter-models.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the IO adapter**

`src/server/openrouter-models-io.adapter.ts`:

```ts
import { OPENROUTER_MODELS_URL } from "../shared/types"

export async function fetchOpenRouterModelsRaw(): Promise<unknown> {
  const res = await fetch(OPENROUTER_MODELS_URL, { headers: { accept: "application/json" } })
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`)
  return res.json()
}
```

- [ ] **Step 6: Commit**

```bash
git add src/server/openrouter-models.ts src/server/openrouter-models-io.adapter.ts src/server/openrouter-models.test.ts
git commit -m "feat(server): openrouter model-list fetch + tool-capable filter + cache"
```

---

## Task 6: `settings.listOpenRouterModels` RPC

**Files:**
- Modify: `src/shared/protocol.ts` (command + result types)
- Modify: `src/server/ws-router.ts` (handler + dep)
- Test: `src/server/ws-router.test.ts` (append; match existing harness)

- [ ] **Step 1: Write the failing test**

Append to `src/server/ws-router.test.ts`, following the file's existing RPC-test harness (locate an existing `case "settings.*"` test and mirror it). Assert that sending `{ type: "settings.listOpenRouterModels" }` acks with an array of `{ id, label, contextLength }` from an injected `listOpenRouterModels` dep.

```ts
test("settings.listOpenRouterModels returns the cached model list", async () => {
  const models = [{ id: "a/b", label: "A B", contextLength: 100 }]
  const ws = makeRouter({ listOpenRouterModels: async () => models }) // match existing makeRouter signature
  const result = await sendAndAwaitAck(ws, { type: "settings.listOpenRouterModels" })
  expect(result).toEqual(models)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/ws-router.test.ts -t "listOpenRouterModels"`
Expected: FAIL — unknown command.

- [ ] **Step 3: Implement**

(a) `src/shared/protocol.ts` — add the command to the request union and a result type:

```ts
  | { v: number; type: "settings.listOpenRouterModels"; id: string }
```

Result is `OpenRouterModel[]` (import the type). Match the exact envelope shape the other `settings.*` commands use in this file.

(b) `src/server/ws-router.ts` — add the dep to the router args interface near the `llmProvider` block (`:143`):

```ts
  listOpenRouterModels?: () => Promise<OpenRouterModel[]>
```

Add a handler near the other `settings.*` cases (`:1466`):

```ts
        case "settings.listOpenRouterModels": {
          const models = listOpenRouterModels ? await listOpenRouterModels() : []
          send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: models })
          break
        }
```

(c) In `server.ts`, construct an `OpenRouterModelCache` (ttl 1h, `now: Date.now`, `fetchRaw: fetchOpenRouterModelsRaw`) and pass `listOpenRouterModels: () => cache.list()` into the ws-router wiring.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/ws-router.test.ts -t "listOpenRouterModels"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol.ts src/server/ws-router.ts src/server/server.ts src/server/ws-router.test.ts
git commit -m "feat(ws): settings.listOpenRouterModels RPC"
```

---

## Task 7: Client — provider icon + searchable openrouter model picker

**Files:**
- Create: `src/client/stores/openrouterModelsStore.ts`
- Modify: `src/client/components/chat-ui/ChatPreferenceControls.tsx`
- Modify: `src/client/app/useKannaState.ts` (fetch the list on demand; match existing RPC-call pattern)
- Test: `src/client/stores/openrouterModelsStore.test.ts`, `src/client/components/chat-ui/ChatPreferenceControls.test.tsx` (if present)

- [ ] **Step 1: Write the failing store test**

`src/client/stores/openrouterModelsStore.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { useOpenRouterModelsStore, EMPTY_OPENROUTER_MODELS } from "./openrouterModelsStore"

describe("openrouterModelsStore", () => {
  test("default list is the shared stable EMPTY ref", () => {
    expect(useOpenRouterModelsStore.getState().models).toBe(EMPTY_OPENROUTER_MODELS)
  })
  test("setModels replaces the list", () => {
    useOpenRouterModelsStore.getState().setModels([{ id: "a/b", label: "A B", contextLength: 1 }])
    expect(useOpenRouterModelsStore.getState().models.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/client/stores/openrouterModelsStore.test.ts`
Expected: FAIL — store missing.

- [ ] **Step 3: Implement the store (stable EMPTY ref — React #185 guard)**

`src/client/stores/openrouterModelsStore.ts`:

```ts
import { create } from "zustand"
import type { OpenRouterModel } from "../../shared/types"

export const EMPTY_OPENROUTER_MODELS: OpenRouterModel[] = []

interface OpenRouterModelsState {
  models: OpenRouterModel[]
  setModels: (models: OpenRouterModel[]) => void
}

export const useOpenRouterModelsStore = create<OpenRouterModelsState>((set) => ({
  models: EMPTY_OPENROUTER_MODELS,
  setModels: (models) => set({ models: models.length > 0 ? models : EMPTY_OPENROUTER_MODELS }),
}))
```

- [ ] **Step 4: Run store test**

Run: `bun test src/client/stores/openrouterModelsStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the picker**

In `ChatPreferenceControls.tsx`:

(a) Add an OpenRouter icon to `PROVIDER_ICONS` (reuse an existing lucide icon already imported, e.g. `Box`/`Globe` — match the import style; do NOT add a new dep).

(b) When `selectedProvider === "openrouter"`, source the model list from `useOpenRouterModelsStore((s) => s.models)` instead of `providerConfig.models`, and render a **searchable** dropdown (filter by typed substring against `id` + `label`) since the list is ~300 entries. Reuse the existing dropdown primitive; add a text input at the top that filters the mapped options. Keep claude/codex on their current static `providerConfig.models` path.

(c) Selecting an openrouter model calls `onModelChange("openrouter", candidate.id)` exactly like the other providers.

(d) On opening the model dropdown for openrouter (or on provider switch to openrouter), trigger the fetch: call the `useKannaState` action that sends `settings.listOpenRouterModels` and pushes the result into `setModels`. Guard so it fetches at most once per session unless empty.

- [ ] **Step 6: Add the fetch action in useKannaState.ts**

Mirror an existing `settings.*` RPC call (e.g. `readLlmProvider`): add `listOpenRouterModels()` that sends the command, awaits the ack, and calls `useOpenRouterModelsStore.getState().setModels(result)`.

- [ ] **Step 7: Manual UI verification (golden path + edge)**

Start the dev server (match the project's run command, e.g. `bun run dev`). In the browser:
- Provider picker shows Claude · Codex · OpenRouter.
- Pick OpenRouter → model dropdown populates with tool-capable models; typing filters.
- Pick a model, send "read package.json and summarize" → streamed reply + file-read tool approval works.
- With no OpenRouter key configured → turn surfaces the AUTH_REQUIRED result linking to Settings.
- Switch back to Claude → model picker reverts to the static Claude list (no regression).

Report explicitly if the UI cannot be exercised.

- [ ] **Step 8: Lint + commit**

Run: `bun run lint 2>&1 | tail -5`
Expected: 0 errors.

```bash
git add src/client/stores/openrouterModelsStore.ts src/client/stores/openrouterModelsStore.test.ts src/client/components/chat-ui/ChatPreferenceControls.tsx src/client/app/useKannaState.ts
git commit -m "feat(chat-ui): openrouter provider picker + searchable model list"
```

---

## Task 8: Full verification + C3 doc sync

**Files:**
- Docs: update C3 via skill (no raw edits to `.c3/`).

- [ ] **Step 1: Full test suite**

Run: `bun test 2>&1 | tail -15`
Expected: all green. Investigate any failure before proceeding (do not skip).

- [ ] **Step 2: Lint**

Run: `bun run lint 2>&1 | tail -5`
Expected: 0 errors; if warnings dropped below the cap, lower the cap in `eslint.config.js` in this PR.

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit 2>&1 | tail -20`
Expected: clean.

- [ ] **Step 4: C3 change — sync docs**

Run the C3 change/sweep op (skill `c3-skill:c3`) to update `c3-212`, `c3-210`, add the `openrouter-models` component, and document the env-redirect on `ref-provider-adapter`. Then:

Run: `C3X_MODE=agent bash <c3-skill>/bin/c3x.sh check --include-adr`
Expected: no errors; transition `adr-20260618-openrouter-sdk-provider` to `implemented`.

- [ ] **Step 5: Commit doc sync**

```bash
git add .c3
git commit -m "docs(c3): sync openrouter provider topology + ADR implemented"
```

- [ ] **Step 6: Open PR (fork target)**

```bash
git push -u origin feat/openrouter-provider
gh pr create --repo cuongtranba/kanna --base main --head feat/openrouter-provider \
  --title "feat: OpenRouter as a first-class SDK chat provider" \
  --body "$(cat <<'EOF'
## Summary
- Add `openrouter` AgentProvider (peer to claude/codex), running full agentic turns through the Claude Agent SDK redirected to OpenRouter via env vars.
- Live tool-capable model list with searchable picker.
- Reuses the existing OpenRouter key in llm-provider.json. SDK mode only.

## Test plan
- [ ] `bun test` green
- [ ] `bun run lint` 0 errors
- [ ] Manual: pick OpenRouter + tool-capable model, run a file-read turn end-to-end
- [ ] Manual: missing key surfaces AUTH_REQUIRED
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** provider union (T1), catalog+helper (T2), env redirect (T3), dispatch/auth/driver-forcing (T4), model fetch+filter+cache (T5), RPC (T6), UI picker (T7), verify+docs (T8). All spec sections mapped.
- **Type consistency:** `OpenRouterModel { id, label, contextLength }` used identically across types, adapter, RPC, store, picker. `isClaudeSdkProvider` / `openrouterAuthReady` names stable across T2/T4. `buildClaudeEnv(base, oauth, openrouter?)` signature stable across T3/T4.
- **No placeholders:** every code step shows real code; test steps show real assertions.
- **Open coupling to verify during execution:** the exact `AgentCoordinator` test fixture and `ws-router` test harness signatures must be matched to what already exists in those test files — T4/T6 say to mirror the existing pattern rather than invent one.
