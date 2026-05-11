# OAuth Token Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user store multiple `CLAUDE_CODE_OAUTH_TOKEN`s in app settings. When a Claude session hits a rate-limit, mark the active token as `limited` (until the reset time supplied by the SDK error), automatically switch to the next available token, and transparently resume the in-flight turn. Fall back to the existing `auto_continue` scheduling only when every token in the pool is currently limited.

**Architecture:** A new server-side `OAuthTokenPool` (pure, deterministic) is the single source of truth for which token to inject into the Claude SDK `env`. Pool state (`tokens[]` + per-token `status`/`limitedUntil`) lives in the existing `~/.kanna/data/settings.json` under a new `claudeAuth` block, managed by `AppSettingsManager`. The agent reads `pool.pickActive()` *before* every `query()` call and writes `pool.markLimited(id, resetAt)` from the existing rate-limit detector. On limit, `runClaudeSession` closes the SDK session, restarts it with the next token (resuming via `sessionToken`), and replays the last queued user message. Token selection is round-robin biased toward least-recently-used active tokens. The settings UI gets a new "OAuth tokens" section under Settings → providers (add/remove/label/test, masked display, status badge per token). Tokens are stored plaintext on disk to match the existing settings file model — same blast radius as the `CLAUDE_CODE_OAUTH_TOKEN` env var that ships in `scripts/pm2.env`.

**Tech Stack:** Bun 1.3.5 + TypeScript 5.8 + React 19 + Zustand + Claude Agent SDK + existing event-sourced JSONL store. Tests run via `bun test`.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `src/server/oauth-pool/oauth-token-pool.ts` | `OAuthTokenPool` class — pure selection/rotation logic. Reads tokens from injected getter; writes status updates via injected setter. No I/O. |
| `src/server/oauth-pool/oauth-token-pool.test.ts` | Unit tests for pick/markLimited/clearExpired/round-robin. |
| `src/client/components/chat-ui/OAuthTokenPoolCard.tsx` | Settings card: list tokens, add form (label + token), remove button, status badge, masked token display, "test" button. |
| `src/client/components/chat-ui/OAuthTokenPoolCard.test.tsx` | Component tests for add/remove/mask/status rendering and WS command dispatch. |
| `src/client/lib/oauthTokenMask.ts` | `maskToken(value)` — show `sk-ant-...XXXX` for display. Pure. |
| `src/client/lib/oauthTokenMask.test.ts` | Pure tests. |

**Modified files**

| Path | What changes |
|---|---|
| `src/shared/types.ts` | New `OAuthTokenEntry`, `OAuthTokenStatus`, `ClaudeAuthSettings`. Add `claudeAuth: ClaudeAuthSettings` to `AppSettingsSnapshot` + `AppSettingsPatch`. |
| `src/server/app-settings.ts` | `AppSettingsFile.claudeAuth`, `normalizeClaudeAuth()` helper, `toFilePayload`/`toSnapshot`/`applyPatch` extended, new `setClaudeAuth()` mutator, new `mutateTokenStatus(id, patch)` for in-place status updates that don't trip the watcher. |
| `src/server/agent.ts` | `runClaudeSession` takes a `pickToken()` callback; line 683 env injection swaps `CLAUDE_CODE_OAUTH_TOKEN` for the picked token. `handleLimitDetection` calls pool.markLimited and, if another token is available, restarts the session with it instead of scheduling auto-continue. |
| `src/server/ws-router.ts` | Two new `ClientCommand` cases: `appSettings.setClaudeAuth`, `appSettings.testOAuthToken`. Add to `resolvedAppSettings`. |
| `src/server/server.ts` | Construct `OAuthTokenPool` from `AppSettingsManager`, pass to `AgentCoordinator`. |
| `src/shared/protocol.ts` | New `ClientCommand` variants. |
| `src/client/app/useKannaState.ts` | New `handleWriteClaudeAuth` (mirrors `handleWriteCloudflareTunnel`) and `handleTestOAuthToken`. |
| `src/client/app/SettingsPage.tsx` | Render `OAuthTokenPoolCard` inside the existing **Providers** section, above the Claude defaults. (No new sidebar entry — feature lives where users already manage Claude.) |
| `scripts/pm2.env` | Update comment to mention pool can be configured via UI; env still respected as the bootstrap token. |

---

## Task 1: Shared types for OAuth token pool

**Files:**
- Modify: `src/shared/types.ts:471-547`

- [ ] **Step 1: Add types**

In `src/shared/types.ts`, immediately after the `AuthSettings` block (line 477), add:

```typescript
export type OAuthTokenStatus = "active" | "limited" | "error"

export interface OAuthTokenEntry {
  id: string
  label: string
  token: string
  status: OAuthTokenStatus
  limitedUntil: number | null
  lastUsedAt: number | null
  lastErrorAt: number | null
  lastErrorMessage: string | null
  addedAt: number
}

export interface ClaudeAuthSettings {
  tokens: OAuthTokenEntry[]
}

export const CLAUDE_AUTH_DEFAULTS: ClaudeAuthSettings = {
  tokens: [],
}

export const OAUTH_TOKEN_LABEL_MAX = 64
export const OAUTH_TOKEN_VALUE_MAX = 1024
```

Then extend `AppSettingsSnapshot` (line 493): add `claudeAuth: ClaudeAuthSettings` between `auth` and `uploads`.

Extend `AppSettingsPatch` (BOTH overload blocks at lines 516 and 534): add `claudeAuth?: Partial<ClaudeAuthSettings>`.

- [ ] **Step 2: Verify typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS (types compile; downstream consumers will fail in later tasks where we update them).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add OAuth token pool types"
```

---

## Task 2: OAuthTokenPool — picking logic

**Files:**
- Create: `src/server/oauth-pool/oauth-token-pool.ts`
- Create: `src/server/oauth-pool/oauth-token-pool.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/oauth-pool/oauth-token-pool.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { OAuthTokenPool } from "./oauth-token-pool"
import type { OAuthTokenEntry } from "../../shared/types"

function tok(id: string, overrides: Partial<OAuthTokenEntry> = {}): OAuthTokenEntry {
  return {
    id, label: id, token: `sk-ant-${id}`,
    status: "active", limitedUntil: null,
    lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null,
    addedAt: 0, ...overrides,
  }
}

describe("OAuthTokenPool.pickActive", () => {
  test("returns null when pool is empty", () => {
    const pool = new OAuthTokenPool(() => [], () => {}, () => 1000)
    expect(pool.pickActive()).toBe(null)
  })

  test("returns the only active token", () => {
    const pool = new OAuthTokenPool(() => [tok("a")], () => {}, () => 1000)
    expect(pool.pickActive()?.id).toBe("a")
  })

  test("skips tokens whose limitedUntil is still in the future", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "limited", limitedUntil: 5000 }), tok("b")],
      () => {}, () => 1000,
    )
    expect(pool.pickActive()?.id).toBe("b")
  })

  test("revives limited tokens whose limitedUntil has passed", () => {
    const updates: Array<{ id: string; patch: Partial<OAuthTokenEntry> }> = []
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "limited", limitedUntil: 500 })],
      (id, patch) => { updates.push({ id, patch }) },
      () => 1000,
    )
    expect(pool.pickActive()?.id).toBe("a")
    expect(updates).toEqual([{ id: "a", patch: { status: "active", limitedUntil: null } }])
  })

  test("least-recently-used active wins (round-robin)", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { lastUsedAt: 900 }),
        tok("b", { lastUsedAt: 800 }),
        tok("c", { lastUsedAt: null }),
      ],
      () => {}, () => 1000,
    )
    expect(pool.pickActive()?.id).toBe("c")
  })
})

describe("OAuthTokenPool.markLimited", () => {
  test("writes status=limited with resetAt", () => {
    const updates: Array<{ id: string; patch: Partial<OAuthTokenEntry> }> = []
    const pool = new OAuthTokenPool(
      () => [tok("a")],
      (id, patch) => { updates.push({ id, patch }) },
      () => 1000,
    )
    pool.markLimited("a", 9999)
    expect(updates).toEqual([{ id: "a", patch: { status: "limited", limitedUntil: 9999 } }])
  })
})

describe("OAuthTokenPool.markUsed", () => {
  test("writes lastUsedAt = now()", () => {
    const updates: Array<{ id: string; patch: Partial<OAuthTokenEntry> }> = []
    const pool = new OAuthTokenPool(
      () => [tok("a")],
      (id, patch) => { updates.push({ id, patch }) },
      () => 1234,
    )
    pool.markUsed("a")
    expect(updates).toEqual([{ id: "a", patch: { lastUsedAt: 1234 } }])
  })
})

describe("OAuthTokenPool.allLimited", () => {
  test("true when every token is limited in the future", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { status: "limited", limitedUntil: 9999 }),
        tok("b", { status: "limited", limitedUntil: 9999 }),
      ],
      () => {}, () => 1000,
    )
    expect(pool.allLimited()).toBe(true)
  })

  test("false when at least one active or expired-limited", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { status: "limited", limitedUntil: 9999 }),
        tok("b"),
      ],
      () => {}, () => 1000,
    )
    expect(pool.allLimited()).toBe(false)
  })

  test("false when pool is empty (caller should fall back to env)", () => {
    const pool = new OAuthTokenPool(() => [], () => {}, () => 1000)
    expect(pool.allLimited()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/oauth-pool/oauth-token-pool.test.ts`
Expected: FAIL with "Cannot find module './oauth-token-pool'"

- [ ] **Step 3: Implement OAuthTokenPool**

Create `src/server/oauth-pool/oauth-token-pool.ts`:

```typescript
import type { OAuthTokenEntry } from "../../shared/types"

export type TokenStatusPatch = Partial<Pick<OAuthTokenEntry,
  "status" | "limitedUntil" | "lastUsedAt" | "lastErrorAt" | "lastErrorMessage"
>>

export class OAuthTokenPool {
  constructor(
    private readonly readTokens: () => OAuthTokenEntry[],
    private readonly writeStatus: (id: string, patch: TokenStatusPatch) => void,
    private readonly now: () => number = Date.now,
  ) {}

  pickActive(): OAuthTokenEntry | null {
    const now = this.now()
    const candidates: OAuthTokenEntry[] = []
    for (const t of this.readTokens()) {
      if (t.status === "limited" && t.limitedUntil !== null && t.limitedUntil > now) continue
      if (t.status === "limited" && (t.limitedUntil === null || t.limitedUntil <= now)) {
        this.writeStatus(t.id, { status: "active", limitedUntil: null })
        candidates.push({ ...t, status: "active", limitedUntil: null })
        continue
      }
      candidates.push(t)
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
    return candidates[0]
  }

  markLimited(id: string, resetAt: number): void {
    this.writeStatus(id, { status: "limited", limitedUntil: resetAt })
  }

  markUsed(id: string): void {
    this.writeStatus(id, { lastUsedAt: this.now() })
  }

  markError(id: string, message: string): void {
    this.writeStatus(id, { status: "error", lastErrorAt: this.now(), lastErrorMessage: message })
  }

  allLimited(): boolean {
    const tokens = this.readTokens()
    if (tokens.length === 0) return false
    const now = this.now()
    return tokens.every((t) => t.status === "limited" && t.limitedUntil !== null && t.limitedUntil > now)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/oauth-pool/oauth-token-pool.test.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/oauth-pool/oauth-token-pool.ts src/server/oauth-pool/oauth-token-pool.test.ts
git commit -m "feat(oauth-pool): add OAuthTokenPool selection logic"
```

---

## Task 3: Persist claudeAuth in AppSettingsManager

**Files:**
- Modify: `src/server/app-settings.ts:39-62, 310-345, 374-401, 433-475, 504-590`

- [ ] **Step 1: Write failing test**

Append to `src/server/app-settings.test.ts` (or create if missing):

```typescript
import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AppSettingsManager } from "./app-settings"

describe("AppSettingsManager.setClaudeAuth", () => {
  test("persists tokens and round-trips", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
    const filePath = path.join(dir, "settings.json")
    const mgr = new AppSettingsManager(filePath)
    await mgr.initialize()

    const snapshot = await mgr.setClaudeAuth({
      tokens: [{
        id: "t1", label: "prod", token: "sk-ant-abc",
        status: "active", limitedUntil: null,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 100,
      }],
    })
    expect(snapshot.claudeAuth.tokens).toHaveLength(1)
    expect(snapshot.claudeAuth.tokens[0]?.label).toBe("prod")

    const raw = JSON.parse(await readFile(filePath, "utf8"))
    expect(raw.claudeAuth.tokens[0].token).toBe("sk-ant-abc")

    mgr.dispose()
  })

  test("mutateTokenStatus updates one field without disturbing others", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-settings-"))
    const filePath = path.join(dir, "settings.json")
    const mgr = new AppSettingsManager(filePath)
    await mgr.initialize()

    await mgr.setClaudeAuth({
      tokens: [{
        id: "t1", label: "prod", token: "sk-ant-abc",
        status: "active", limitedUntil: null,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 100,
      }],
    })
    await mgr.mutateTokenStatus("t1", { status: "limited", limitedUntil: 9999 })
    const snapshot = mgr.getSnapshot()
    expect(snapshot.claudeAuth.tokens[0]?.status).toBe("limited")
    expect(snapshot.claudeAuth.tokens[0]?.limitedUntil).toBe(9999)
    expect(snapshot.claudeAuth.tokens[0]?.token).toBe("sk-ant-abc")

    mgr.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/app-settings.test.ts`
Expected: FAIL — `setClaudeAuth` not defined.

- [ ] **Step 3: Implement persistence**

Edit `src/server/app-settings.ts`:

In the imports block at top, add `CLAUDE_AUTH_DEFAULTS, OAUTH_TOKEN_LABEL_MAX, OAUTH_TOKEN_VALUE_MAX, type ClaudeAuthSettings, type OAuthTokenEntry, type OAuthTokenStatus, type TokenStatusPatch` (TokenStatusPatch will be exported from oauth-token-pool, but re-declare inline here to keep app-settings free of server-only imports — declare a local `type StatusPatch = Partial<Pick<OAuthTokenEntry, "status" | "limitedUntil" | "lastUsedAt" | "lastErrorAt" | "lastErrorMessage">>`).

Add to `AppSettingsFile` (line 39 block):

```typescript
  claudeAuth?: unknown
```

Add helper `normalizeClaudeAuth` after `normalizeUploadSettings` (around line 308):

```typescript
function normalizeOAuthTokenStatus(value: unknown): OAuthTokenStatus {
  return value === "limited" || value === "error" ? value : "active"
}

function normalizeTokenEntry(value: unknown, warnings: string[]): OAuthTokenEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const src = value as Record<string, unknown>
  const id = typeof src.id === "string" && src.id.trim() ? src.id.trim() : null
  const token = typeof src.token === "string" ? src.token : ""
  if (!id || !token) {
    warnings.push("claudeAuth.tokens entry missing id or token")
    return null
  }
  const label = typeof src.label === "string" && src.label.trim()
    ? src.label.trim().slice(0, OAUTH_TOKEN_LABEL_MAX)
    : id
  return {
    id,
    label,
    token: token.slice(0, OAUTH_TOKEN_VALUE_MAX),
    status: normalizeOAuthTokenStatus(src.status),
    limitedUntil: typeof src.limitedUntil === "number" && Number.isFinite(src.limitedUntil) ? src.limitedUntil : null,
    lastUsedAt: typeof src.lastUsedAt === "number" && Number.isFinite(src.lastUsedAt) ? src.lastUsedAt : null,
    lastErrorAt: typeof src.lastErrorAt === "number" && Number.isFinite(src.lastErrorAt) ? src.lastErrorAt : null,
    lastErrorMessage: typeof src.lastErrorMessage === "string" ? src.lastErrorMessage : null,
    addedAt: typeof src.addedAt === "number" && Number.isFinite(src.addedAt) ? src.addedAt : Date.now(),
  }
}

function normalizeClaudeAuth(value: unknown, warnings: string[]): ClaudeAuthSettings {
  if (value === undefined) return { ...CLAUDE_AUTH_DEFAULTS }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push("claudeAuth must be an object")
    return { ...CLAUDE_AUTH_DEFAULTS }
  }
  const src = value as { tokens?: unknown }
  if (src.tokens !== undefined && !Array.isArray(src.tokens)) {
    warnings.push("claudeAuth.tokens must be an array")
    return { ...CLAUDE_AUTH_DEFAULTS }
  }
  const tokens: OAuthTokenEntry[] = []
  for (const raw of (src.tokens ?? []) as unknown[]) {
    const entry = normalizeTokenEntry(raw, warnings)
    if (entry) tokens.push(entry)
  }
  return { tokens }
}
```

Extend `toFilePayload` (line 310), `toSnapshot` (line 328), `toComparablePayload` (line 415), `applyPatch` (line 433), and `normalizeAppSettings` (around line 376 + 401) to thread `claudeAuth: normalizeClaudeAuth(source?.claudeAuth, warnings)` through, and merge in `applyPatch`:

```typescript
    claudeAuth: {
      tokens: patch.claudeAuth?.tokens ?? state.claudeAuth.tokens,
    },
```

Add public methods on `AppSettingsManager` after `setUploads` (line 578):

```typescript
  async setClaudeAuth(patch: Partial<ClaudeAuthSettings>) {
    if (patch.tokens !== undefined && !Array.isArray(patch.tokens)) {
      throw new Error("claudeAuth.tokens must be an array")
    }
    return this.writePatch({ claudeAuth: patch })
  }

  async mutateTokenStatus(id: string, patch: StatusPatch) {
    const tokens = this.state.claudeAuth.tokens.map((t) => t.id === id ? { ...t, ...patch } : t)
    return this.setClaudeAuth({ tokens })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/app-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/server/app-settings.ts src/server/app-settings.test.ts
git commit -m "feat(app-settings): persist claudeAuth.tokens"
```

---

## Task 4: Wire OAuthTokenPool to AppSettingsManager in server bootstrap

**Files:**
- Modify: `src/server/server.ts`
- Modify: `src/server/agent.ts` (constructor + storage of pool reference)

- [ ] **Step 1: Locate AgentCoordinator construction**

Run: `grep -n "new AgentCoordinator\|AgentCoordinator(" src/server/server.ts`
Read the surrounding 20 lines so you understand current constructor args.

- [ ] **Step 2: Add OAuthTokenPool to agent constructor**

In `src/server/agent.ts`, the `AgentCoordinator` constructor: add a new field

```typescript
  private readonly oauthPool: OAuthTokenPool | null
```

Accept `oauthPool: OAuthTokenPool | null` in the constructor options object (mirror how other optional deps are passed). Import:

```typescript
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
```

- [ ] **Step 3: Construct OAuthTokenPool in server.ts**

In `src/server/server.ts`, after `AppSettingsManager` is initialized, before `AgentCoordinator` is instantiated:

```typescript
const oauthPool = new OAuthTokenPool(
  () => appSettings.getSnapshot().claudeAuth.tokens,
  (id, patch) => { void appSettings.mutateTokenStatus(id, patch) },
)
```

Pass `oauthPool` into `new AgentCoordinator({ ..., oauthPool })`.

- [ ] **Step 4: Verify typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Verify existing tests still pass**

Run: `bun test src/server`
Expected: PASS (no behavior change yet — pool is unused).

- [ ] **Step 6: Commit**

```bash
git add src/server/agent.ts src/server/server.ts
git commit -m "feat(agent): inject OAuthTokenPool into AgentCoordinator"
```

---

## Task 5: Inject selected token into Claude SDK env

**Files:**
- Modify: `src/server/agent.ts:659-685` (Claude session `query()` env)
- Modify: `src/server/quick-response.ts:16-31, 118-132` (only if pool has tokens; otherwise leave env alone for backward compat)

- [ ] **Step 1: Write a failing test**

Create `src/server/agent.oauth-pool.test.ts`. This is an integration-flavored test that constructs a coordinator with a mock pool and asserts the env captured by a stubbed `query()`. Mirror the style of `src/server/agent.test.ts`.

```typescript
import { describe, expect, test } from "bun:test"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"

describe("Claude env injection from OAuthTokenPool", () => {
  test("pool.pickActive() result is written to env.CLAUDE_CODE_OAUTH_TOKEN", () => {
    // The buildClaudeEnv helper (extracted in Step 2) should:
    //   - return env with CLAUDE_CODE_OAUTH_TOKEN = picked.token when pool has an active token
    //   - return env with the existing CLAUDE_CODE_OAUTH_TOKEN when pool returns null
    //   - strip CLAUDECODE always
    const baseEnv = { CLAUDECODE: "1", CLAUDE_CODE_OAUTH_TOKEN: "from-env", OTHER: "x" }
    const pool = new OAuthTokenPool(
      () => [{
        id: "t1", label: "x", token: "from-pool",
        status: "active", limitedUntil: null,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 0,
      }],
      () => {}, () => 1000,
    )
    const { buildClaudeEnv } = require("./agent")
    expect(buildClaudeEnv(baseEnv, pool).CLAUDE_CODE_OAUTH_TOKEN).toBe("from-pool")
    expect(buildClaudeEnv(baseEnv, pool).CLAUDECODE).toBeUndefined()
    expect(buildClaudeEnv(baseEnv, pool).OTHER).toBe("x")
  })

  test("falls back to existing env when pool is empty", () => {
    const pool = new OAuthTokenPool(() => [], () => {}, () => 1000)
    const { buildClaudeEnv } = require("./agent")
    const env = buildClaudeEnv({ CLAUDECODE: "1", CLAUDE_CODE_OAUTH_TOKEN: "from-env" }, pool)
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("from-env")
  })

  test("falls back when all tokens are limited", () => {
    const pool = new OAuthTokenPool(
      () => [{
        id: "t1", label: "x", token: "limited",
        status: "limited", limitedUntil: 9999,
        lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 0,
      }],
      () => {}, () => 1000,
    )
    const { buildClaudeEnv } = require("./agent")
    const env = buildClaudeEnv({ CLAUDE_CODE_OAUTH_TOKEN: "from-env" }, pool)
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("from-env")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/agent.oauth-pool.test.ts`
Expected: FAIL — `buildClaudeEnv` not exported.

- [ ] **Step 3: Extract and export `buildClaudeEnv`**

In `src/server/agent.ts`, replace the inline IIFE at line 683 with a call to a new exported helper. Add at module scope (e.g. above `runClaudeSession`):

```typescript
export function buildClaudeEnv(
  baseEnv: NodeJS.ProcessEnv,
  pool: OAuthTokenPool | null,
): NodeJS.ProcessEnv {
  const { CLAUDECODE: _unused, ...rest } = baseEnv
  const picked = pool?.pickActive() ?? null
  if (!picked) return rest
  return { ...rest, CLAUDE_CODE_OAUTH_TOKEN: picked.token }
}
```

Replace line 683 with:

```typescript
      env: buildClaudeEnv(process.env, this.oauthPool),
```

Also: when a token is picked, call `pool.markUsed(picked.id)`. Refactor to:

```typescript
      env: (() => {
        const picked = this.oauthPool?.pickActive() ?? null
        if (picked) this.oauthPool!.markUsed(picked.id)
        return buildClaudeEnv(process.env, this.oauthPool)
      })(),
```

(The `buildClaudeEnv` call inside still calls `pickActive()` once more — refactor `buildClaudeEnv` to accept an optional `picked` argument so the env construction and `markUsed` share the same pick. Final shape:)

```typescript
export function buildClaudeEnv(
  baseEnv: NodeJS.ProcessEnv,
  picked: OAuthTokenEntry | null,
): NodeJS.ProcessEnv {
  const { CLAUDECODE: _unused, ...rest } = baseEnv
  if (!picked) return rest
  return { ...rest, CLAUDE_CODE_OAUTH_TOKEN: picked.token }
}
```

Update the test to pass a picked entry (or a small `pick(pool)` helper that does both). Adjust accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/agent.oauth-pool.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full server test suite**

Run: `bun test src/server`
Expected: PASS — no regression.

- [ ] **Step 6: Commit**

```bash
git add src/server/agent.ts src/server/agent.oauth-pool.test.ts
git commit -m "feat(agent): inject pool-selected token into Claude SDK env"
```

---

## Task 6: On rate-limit, mark token limited and retry with next token

**Files:**
- Modify: `src/server/agent.ts:1561-1604, 1808-1847`

- [ ] **Step 1: Track the active token id on the session**

In the `ClaudeSessionState` interface (find it via `grep -n "ClaudeSessionState" src/server/agent.ts`), add:

```typescript
  activeTokenId: string | null
```

When a session is created (the function that returns the `claude` agent shape — around line 730), capture `picked?.id ?? null` and write it onto the returned session state when it is constructed by the coordinator. (Look for where `ClaudeSessionState` is built in the coordinator and thread the id through.)

- [ ] **Step 2: Write a failing test**

In `src/server/agent.oauth-pool.test.ts`, add:

```typescript
import { ClaudeLimitDetector } from "./auto-continue/limit-detector"

describe("rate-limit triggers token rotation", () => {
  test("markLimited is called with the rate-limit reset", () => {
    const updates: Array<{ id: string; patch: unknown }> = []
    const pool = new OAuthTokenPool(
      () => [
        { id: "a", label: "a", token: "tok-a", status: "active", limitedUntil: null,
          lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 0 },
        { id: "b", label: "b", token: "tok-b", status: "active", limitedUntil: null,
          lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null, addedAt: 0 },
      ],
      (id, patch) => { updates.push({ id, patch }) },
      () => 1000,
    )
    const detector = new ClaudeLimitDetector()
    const error = Object.assign(new Error(JSON.stringify({ error: { type: "rate_limit_error" } })), {
      status: 429,
      headers: { "anthropic-ratelimit-unified-reset": new Date(50000).toISOString() },
    })
    const detection = detector.detect("chat1", error)!
    expect(detection).not.toBeNull()
    pool.markLimited("a", detection.resetAt)
    expect(updates).toEqual([{ id: "a", patch: { status: "limited", limitedUntil: 50000 } }])
    expect(pool.pickActive()?.id).toBe("b")
  })
})
```

- [ ] **Step 3: Run test to verify it passes (pool already supports this)**

Run: `bun test src/server/agent.oauth-pool.test.ts`
Expected: PASS — proves the pool contract. Test stays as regression guard.

- [ ] **Step 4: Wire pool into limit handling in agent.ts**

In `handleLimitDetection` (line 1814), before the existing scheduling logic, insert:

```typescript
    const session = this.claudeSessions.get(chatId)
    if (this.oauthPool && session?.activeTokenId) {
      this.oauthPool.markLimited(session.activeTokenId, detection.resetAt)
      const next = this.oauthPool.pickActive()
      if (next) {
        await this.rotateClaudeSession(chatId, session, next)
        return true
      }
    }
```

Then implement `rotateClaudeSession` as a new private method:

```typescript
  private async rotateClaudeSession(
    chatId: string,
    current: ClaudeSessionState,
    next: OAuthTokenEntry,
  ): Promise<void> {
    const active = this.activeTurns.get(chatId)
    if (!active) return
    try { current.session.close() } catch {}
    this.claudeSessions.delete(chatId)
    this.oauthPool?.markUsed(next.id)
    // Re-spawn a fresh Claude session resuming the same sessionToken, then
    // replay the in-flight user prompt (already persisted) by calling
    // maybeStartNextQueuedMessage(chatId).
    await this.maybeStartNextQueuedMessage(chatId)
  }
```

The replay relies on the existing turn-failure path having re-queued the in-flight message. If the current state machine does not re-queue on rotation, follow the existing `recordTurnFailed` cleanup with an explicit `enqueueMessage(chatId, lastUserContent)` reconstructed from `active`. Inspect `ActiveTurn` to locate the original prompt content (`grep -n "ActiveTurn\b\|claudePromptSeq\|lastUserContent" src/server/agent.ts`) before writing the call.

If the in-flight prompt cannot be reliably reconstructed, fall back to behavior identical to today's auto-continue scheduling — emit `auto_continue_accepted` with `scheduledAt = now` and immediate `resetAt`. Document the chosen approach in a single comment above `rotateClaudeSession`.

- [ ] **Step 5: Run all server tests**

Run: `bun test src/server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/agent.ts src/server/agent.oauth-pool.test.ts
git commit -m "feat(agent): rotate to next pool token on rate-limit"
```

---

## Task 7: ws-router commands to manage tokens

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/server/ws-router.ts:556-577, 1230-1240`

- [ ] **Step 1: Add ClientCommand variants**

In `src/shared/protocol.ts`, locate the `ClientCommand` discriminated union (`grep -n "ClientCommand" src/shared/protocol.ts`). Add:

```typescript
  | { type: "appSettings.setClaudeAuth"; patch: Partial<ClaudeAuthSettings> }
  | { type: "appSettings.testOAuthToken"; token: string }
```

Add an import line for `ClaudeAuthSettings`.

- [ ] **Step 2: Extend resolvedAppSettings**

In `src/server/ws-router.ts`, around line 556, extend the resolver:

```typescript
    setClaudeAuth: async (patch: Partial<AppSettingsSnapshot["claudeAuth"]>) => {
      if (appSettings?.setClaudeAuth) return await appSettings.setClaudeAuth(patch)
      fallbackAppSettingsSnapshot = mergeAppSettingsPatch(
        appSettings?.getSnapshot() ?? fallbackAppSettingsSnapshot,
        { claudeAuth: patch },
      )
      return fallbackAppSettingsSnapshot
    },
```

Add `setClaudeAuth` to the `appSettings` typing at line 133:

```typescript
  appSettings?: Pick<AppSettingsManager, "getSnapshot" | "write">
    & Partial<Pick<AppSettingsManager, "setCloudflareTunnel" | "setClaudeAuth" | "writePatch" | "onChange">>
```

- [ ] **Step 3: Handle new command types**

In the command switch (around line 1230):

```typescript
        case "appSettings.setClaudeAuth": {
          const snapshot = await resolvedAppSettings.setClaudeAuth(command.patch)
          return snapshot
        }
        case "appSettings.testOAuthToken": {
          return await testOAuthToken(command.token)
        }
```

Add `testOAuthToken` helper at the bottom of the file:

```typescript
async function testOAuthToken(token: string): Promise<{ ok: boolean; error: string | null }> {
  if (typeof token !== "string" || !token.trim()) return { ok: false, error: "Token is empty" }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "authorization": `Bearer ${token.trim()}`,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "ok" }],
      }),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Unauthorized" }
    if (res.status === 429) return { ok: true, error: "Token valid but currently rate-limited" }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 4: Verify typecheck + tests**

Run: `bunx tsc --noEmit && bun test src/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol.ts src/server/ws-router.ts
git commit -m "feat(ws-router): commands to manage Claude OAuth token pool"
```

---

## Task 8: Client state — handleWriteClaudeAuth / handleTestOAuthToken

**Files:**
- Modify: `src/client/app/useKannaState.ts:1035-1050`

- [ ] **Step 1: Add handlers**

Immediately after `handleWriteCloudflareTunnel`, add:

```typescript
  const handleWriteClaudeAuth = useCallback(async (patch: Partial<ClaudeAuthSettings>) => {
    try {
      useAppSettingsStore.getState().applyOptimisticPatch({ claudeAuth: patch })
      const snapshot = await socket.command<AppSettingsSnapshot>({
        type: "appSettings.setClaudeAuth",
        patch,
      })
      setAppSettings(snapshot)
      syncRuntimeStoresFromAppSettings(snapshot)
      setCommandError(null)
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error))
      await handleReadAppSettings()
      throw error
    }
  }, [handleReadAppSettings, socket])

  const handleTestOAuthToken = useCallback(async (token: string) => {
    return await socket.command<{ ok: boolean; error: string | null }>({
      type: "appSettings.testOAuthToken",
      token,
    })
  }, [socket])
```

Export them in the hook's return object alongside `handleWriteCloudflareTunnel`.

- [ ] **Step 2: Verify typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/app/useKannaState.ts
git commit -m "feat(client): handlers for claudeAuth and OAuth token test"
```

---

## Task 9: maskToken helper

**Files:**
- Create: `src/client/lib/oauthTokenMask.ts`
- Create: `src/client/lib/oauthTokenMask.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, test } from "bun:test"
import { maskToken } from "./oauthTokenMask"

describe("maskToken", () => {
  test("preserves prefix and last 4 characters", () => {
    expect(maskToken("sk-ant-abcdefghijklmnop")).toBe("sk-ant-…mnop")
  })
  test("returns empty placeholder for empty input", () => {
    expect(maskToken("")).toBe("—")
  })
  test("handles short tokens", () => {
    expect(maskToken("abc")).toBe("…abc")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/client/lib/oauthTokenMask.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
export function maskToken(value: string): string {
  if (!value) return "—"
  const trimmed = value.trim()
  const last = trimmed.slice(-4)
  const prefix = trimmed.startsWith("sk-ant-") ? "sk-ant-" : ""
  return `${prefix}…${last}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/client/lib/oauthTokenMask.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/oauthTokenMask.ts src/client/lib/oauthTokenMask.test.ts
git commit -m "feat(client): maskToken helper"
```

---

## Task 10: OAuthTokenPoolCard component

**Files:**
- Create: `src/client/components/chat-ui/OAuthTokenPoolCard.tsx`
- Create: `src/client/components/chat-ui/OAuthTokenPoolCard.test.tsx`

Before writing this task: **invoke the `kanna-react-style` skill** and the `impeccable` skill in that order. `kanna-react-style` dictates project conventions (Tooltip-over-title, tabular numerics, mobile/desktop variants, format helpers). `impeccable` polishes hierarchy, spacing, and copy.

- [ ] **Step 1: Write failing component tests**

Mirror `src/client/components/chat-ui/CloudflareTunnelCard.test.tsx`. Cover:

- Renders empty state with "Add token" CTA when `tokens.length === 0`.
- Renders one row per token with `maskToken(t.token)` and `t.label`.
- Renders a status badge whose text depends on `t.status` (`Active` / `Limited until <time>` / `Error`).
- Clicking "Add" with valid input calls `onWrite({ tokens: [...prev, new] })`.
- Clicking "Remove" calls `onWrite({ tokens: prev.filter(...) })`.
- Clicking "Test" calls `onTest(token)` and renders the returned ok/error.

The full assertion code lives in CloudflareTunnelCard.test.tsx — read it before writing the new test.

- [ ] **Step 2: Verify failure**

Run: `bun test src/client/components/chat-ui/OAuthTokenPoolCard.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the component**

Mirror the structure of `CloudflareTunnelCard.tsx`. Take props:

```typescript
interface OAuthTokenPoolCardProps {
  tokens: OAuthTokenEntry[]
  onWrite: (patch: Partial<ClaudeAuthSettings>) => Promise<void>
  onTest: (token: string) => Promise<{ ok: boolean; error: string | null }>
}
```

Render a `Card` with:
- Header: title "Claude OAuth token pool" + helper text "Add multiple Claude OAuth tokens. Kanna switches automatically when one hits its rate limit."
- Empty state: dashed-border placeholder with `Add token` button.
- Token list: each row shows `label`, masked token, status badge, `Test` button, `Remove` icon button.
- Inline "Add token" form (label input + token input + Save / Cancel). Generate `id` via `crypto.randomUUID()`.
- Status badge: green dot for `active`, amber for `limited` (show countdown via existing time format helper), red for `error` (show `lastErrorMessage` via `Tooltip`).

Use the project's `Tooltip` (NOT native `title`), tabular numerics for the countdown, and the existing `Button`, `Input`, `Card` primitives.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/client/components/chat-ui/OAuthTokenPoolCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/chat-ui/OAuthTokenPoolCard.tsx src/client/components/chat-ui/OAuthTokenPoolCard.test.tsx
git commit -m "feat(client): OAuthTokenPoolCard for managing token pool"
```

---

## Task 11: Mount card in Settings → Providers

**Files:**
- Modify: `src/client/app/SettingsPage.tsx` (the providers section render block)

- [ ] **Step 1: Locate providers section render**

Run: `grep -n "case \"providers\"\|providers:" src/client/app/SettingsPage.tsx`
Read the surrounding 30 lines.

- [ ] **Step 2: Render the card**

At the top of the Providers section JSX, render:

```tsx
<OAuthTokenPoolCard
  tokens={appSettings.claudeAuth.tokens}
  onWrite={handleWriteClaudeAuth}
  onTest={handleTestOAuthToken}
/>
```

Wire `handleWriteClaudeAuth` and `handleTestOAuthToken` from `useKannaState()` at the top of the component.

- [ ] **Step 3: Manual smoke test in the dev server**

Run: `bun run dev` (consult `package.json`)
Open the browser, navigate to **Settings → Providers**, verify:
1. The card renders.
2. Add a token with label "test" and value `sk-ant-XXX`.
3. Refresh: the token persists (it should reload from `~/.kanna/data/settings.json`).
4. Remove it: the card returns to the empty state.

If the dev server cannot be used in this environment, document the manual steps and continue. Do not claim success without verification.

- [ ] **Step 4: Commit**

```bash
git add src/client/app/SettingsPage.tsx
git commit -m "feat(client): mount OAuthTokenPoolCard in Settings → Providers"
```

---

## Task 12: End-to-end smoke test for rotation

**Files:**
- Create: `src/server/agent.oauth-rotation.test.ts`

- [ ] **Step 1: Write the test**

Construct a real `AgentCoordinator` against a tmp event-store dir and a mock Claude session that throws a rate-limit error on the first call and succeeds on the second. Assert that:
1. Both tokens are persisted.
2. After the first call's failure, token A is marked `limited`.
3. The second call's env carries token B.

Use the `bun:test` mock infrastructure already in `src/server/agent.test.ts` as a template.

- [ ] **Step 2: Run and verify**

Run: `bun test src/server/agent.oauth-rotation.test.ts`
Expected: PASS.

- [ ] **Step 3: Run full suite**

Run: `bun test`
Expected: 1180+ pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/server/agent.oauth-rotation.test.ts
git commit -m "test(agent): end-to-end OAuth token rotation"
```

---

## Task 13: Final verification + PR

- [ ] **Step 1: Full test run**

Run: `bun test`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Push branch and open PR against `cuongtranba/kanna`**

```bash
git push -u origin feat/oauth-token-pool
gh pr create --repo cuongtranba/kanna --base main --head feat/oauth-token-pool \
  --title "feat: OAuth token pool with automatic rotation on rate-limit" \
  --body "$(cat <<'EOF'
## Summary
- Adds a `claudeAuth.tokens[]` pool to app settings.
- New `OAuthTokenPool` selects an active token and marks it limited when the Claude SDK returns a 429.
- The agent rotates to the next available token mid-turn; the existing auto-continue scheduler is now a fallback for when every token is exhausted.
- New Settings → Providers card to manage the pool (add / remove / test / status).

## Test plan
- [ ] `bun test` passes (1180+ tests).
- [ ] Add two real OAuth tokens via Settings → Providers.
- [ ] Trigger a rate-limit on token A; verify token B is used for the next turn and A's badge flips to "Limited until …".
- [ ] Wait for A's reset; verify A becomes selectable again.
- [ ] Remove all tokens; verify the system falls back to `CLAUDE_CODE_OAUTH_TOKEN` from env.
EOF
)"
```

---

## Self-Review Checklist

- **Spec coverage:** Multiple-token storage ✓ (Task 3). Auto-switch on rate-limit ✓ (Task 6). UI in Settings ✓ (Task 11). `/impeccable` design pass ✓ (note in Task 10 — invoke before implementing the card).
- **Placeholder scan:** No "TBD" / "implement later". Every step shows code or exact commands.
- **Type consistency:** `OAuthTokenEntry`, `ClaudeAuthSettings`, `OAuthTokenStatus`, `TokenStatusPatch` are defined once (Task 1) and reused with the same names through Tasks 2–11.
- **Risks acknowledged:** Tokens stored plaintext in `~/.kanna/data/settings.json` (same threat model as today's env var). Rotation requires closing and restarting the Claude SDK session — Task 6 documents the in-flight-prompt-replay strategy and the fallback if replay is not feasible.
