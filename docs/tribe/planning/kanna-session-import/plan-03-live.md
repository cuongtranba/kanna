# PR C — Live Tail (WS-Live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An imported session whose source JSONL is still growing keeps updating in Kanna automatically, with a "following" pill, until the user takes over or the file goes idle.

**Architecture:** `FollowedSessionRegistry` — a pure, dependency-injected registry driven by a server-side tick (mirrors the `tickTimeouts` pattern from tool-callback and the WorkflowRegistry sibling-read-model precedent). On tick it stats each followed file; growth triggers re-parse + `importOneSession` delta (idempotent via row-UUID dedupe). Entries reach clients through the normal event-store append → snapshot broadcast; a small `followedSessionsUpdated` WS push drives the pill. NEVER touches the HarnessEvent/turn pipeline (c3-225).

**Tech Stack:** Bun + TypeScript; IO confined to a new `*-io.adapter.ts`.

## Global Constraints

- Depends on PR A merged (`importOneSession`, `parseClaudeSessionFile` reuse, `onSessionImported` seam in `importSessionsByIds`).
- WALLS: single-writer (never delta while a Kanna turn is active; permanent stop on takeover); turn-pipeline isolation; bulk import untouched; suites + lint green.
- Env vars (parse in `server.ts` with the existing `positiveIntegerFromEnv` helper, pass into deps — the registry itself reads only its deps, per side-effect seal): `KANNA_IMPORT_FOLLOW_POLL_MS` (default 2000), `KANNA_IMPORT_FOLLOW_ACTIVE_WINDOW_MS` (default 600000), `KANNA_IMPORT_FOLLOW_IDLE_MS` (default 600000).
- New client store selectors must return stable refs (`EMPTY` constant / `useShallow`) and pass `renderForLoopCheck` (React error #185 rule).
- PR targets `cuongtranba/kanna`; no agent co-author in commits.

---

### Task 1: `FollowedSessionRegistry` (pure core)

**Files:**
- Create: `src/server/followed-session-registry.ts`
- Test: `src/server/followed-session-registry.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (deps injected).
- Produces (Tasks 2–3 consume these exact names):

```ts
export interface FollowedSessionRegistryDeps {
  statFile: (path: string) => { size: number; mtimeMs: number } | null
  runDelta: (chatId: string, sourcePath: string) => Promise<void> // parse + importOneSession, wired in Task 2
  isTurnActive: (chatId: string) => boolean
  now: () => number
  onChange: (followedChatIds: string[]) => void // WS push, wired in Task 3
  activeWindowMs: number
  idleMs: number
}
export interface FollowedSessionRegistry {
  consider(info: { chatId: string; sessionId: string; sourcePath: string; sourceMtimeMs: number }): void
  stop(chatId: string, reason: "user_takeover" | "chat_deleted"): void
  tick(): Promise<void>
  isFollowing(chatId: string): boolean
  followedChatIds(): string[]
}
export function createFollowedSessionRegistry(deps: FollowedSessionRegistryDeps): FollowedSessionRegistry
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, mock, test } from "bun:test"
import { createFollowedSessionRegistry, type FollowedSessionRegistryDeps } from "./followed-session-registry"

function makeRegistry(over: Partial<FollowedSessionRegistryDeps> = {}) {
  let nowMs = 1_000_000
  const stat = { size: 100, mtimeMs: nowMs }
  const deps: FollowedSessionRegistryDeps = {
    statFile: mock(() => ({ ...stat })),
    runDelta: mock(async () => {}),
    isTurnActive: mock(() => false),
    now: () => nowMs,
    onChange: mock(() => {}),
    activeWindowMs: 600_000,
    idleMs: 600_000,
    ...over,
  }
  const reg = createFollowedSessionRegistry(deps)
  return { reg, deps, stat, advance: (ms: number) => { nowMs += ms }, setNow: (v: number) => { nowMs = v } }
}
const INFO = { chatId: "chat-1", sessionId: "s-1", sourcePath: "/p/s-1.jsonl", sourceMtimeMs: 1_000_000 }

describe("FollowedSessionRegistry", () => {
  test("consider arms only recently-active files", () => {
    const { reg } = makeRegistry()
    reg.consider(INFO)
    expect(reg.isFollowing("chat-1")).toBe(true)
    const { reg: reg2, deps } = makeRegistry()
    reg2.consider({ ...INFO, sourceMtimeMs: 1_000_000 - 700_000 }) // older than activeWindowMs
    expect(reg2.isFollowing("chat-1")).toBe(false)
    expect(deps.onChange).not.toHaveBeenCalled()
  })
  test("tick with growth runs delta once and updates lastSize", async () => {
    const { reg, deps, stat } = makeRegistry()
    reg.consider(INFO)
    stat.size = 250
    await reg.tick()
    expect(deps.runDelta).toHaveBeenCalledTimes(1)
    await reg.tick() // no further growth
    expect(deps.runDelta).toHaveBeenCalledTimes(1)
  })
  test("tick pauses while a Kanna turn is active (still following)", async () => {
    const { reg, deps, stat } = makeRegistry({ isTurnActive: mock(() => true) })
    reg.consider(INFO); stat.size = 250
    await reg.tick()
    expect(deps.runDelta).not.toHaveBeenCalled()
    expect(reg.isFollowing("chat-1")).toBe(true)
  })
  test("stop(user_takeover) is permanent — re-consider does not re-arm", () => {
    const { reg } = makeRegistry()
    reg.consider(INFO)
    reg.stop("chat-1", "user_takeover")
    reg.consider(INFO)
    expect(reg.isFollowing("chat-1")).toBe(false)
  })
  test("idle beyond idleMs stops following; missing file stops too", async () => {
    const { reg, advance } = makeRegistry()
    reg.consider(INFO)
    advance(700_000) // no growth for > idleMs
    await reg.tick()
    expect(reg.isFollowing("chat-1")).toBe(false)
    const { reg: reg2 } = makeRegistry({ statFile: mock(() => null) })
    reg2.consider(INFO)
    await reg2.tick()
    expect(reg2.isFollowing("chat-1")).toBe(false)
  })
  test("onChange fires on every membership change with current ids", () => {
    const calls: string[][] = []
    const { reg } = makeRegistry({ onChange: (ids) => calls.push(ids) })
    reg.consider(INFO)
    reg.stop("chat-1", "chat_deleted")
    expect(calls).toEqual([["chat-1"], []])
  })
})
```

- [ ] **Step 2: Run to verify fail** — `bun test --conditions production src/server/followed-session-registry.test.ts`.

- [ ] **Step 3: Implement.** Internal state: `Map<chatId, { sourcePath; lastSize; lastGrowthAt }>` + `Set<chatId>` of permanently-stopped chats (takeover only; `chat_deleted` is not permanent). `consider`: skip if permanently stopped or `now() - sourceMtimeMs > activeWindowMs`; on arm/refresh set `lastGrowthAt = now()`, `lastSize` from `statFile` (fall back to 0 if null), fire `onChange` when membership changed. `tick`: for each entry — `statFile` null → drop; `isTurnActive(chatId)` → skip (no state change); `size > lastSize` → `await runDelta(chatId, sourcePath)` then update `lastSize`, `lastGrowthAt = now()`; else if `now() - lastGrowthAt > idleMs` → drop. Fire one `onChange` per tick if membership changed. Wrap each `runDelta` in try/catch (a bad file must not kill the tick loop).

- [ ] **Step 4: Run to verify pass.** **Step 5: Commit** — `git commit -m "feat(server): followed-session registry (pure core) for live import tail"`

### Task 2: IO adapter + server wiring

**Files:**
- Create: `src/server/followed-session-io.adapter.ts`
- Modify: `src/server/server.ts` (env parse + registry construction + interval)
- Modify: `src/server/ws-router.ts` (deps + `sessions.importClaudeSession` case + `chat.send` case + `chat.delete` case)
- Test: extend `src/server/followed-session-registry.test.ts` with one integration case using the importer-test store fixtures.

**Interfaces:**
- Consumes: `createFollowedSessionRegistry` (Task 1), `parseClaudeSessionFile`, `importOneSession` (PR A).
- Produces: `statSessionFile(path): {size:number; mtimeMs:number} | null` (adapter); a `followedSessionRegistry` field on the ws-router deps object (Task 3 consumes).

- [ ] **Step 1: Adapter**

```ts
// src/server/followed-session-io.adapter.ts
import { statSync } from "node:fs"
export function statSessionFile(path: string): { size: number; mtimeMs: number } | null {
  try {
    const s = statSync(path)
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Construct in `server.ts`** next to the other registries: deps = `statSessionFile`; `runDelta: async (chatId, sourcePath) => { const s = parseClaudeSessionFile(sourcePath); if (s) await importOneSession(store, s) }`; `isTurnActive` from the AgentCoordinator's existing active-turn query (find the accessor the idle reaper uses — `agentCoordinator` exposes chat activity; grep `activeTurn` in `agent.ts` and reuse; if only internal, add a thin `hasActiveTurn(chatId): boolean` public method delegating to that state); `now: Date.now`; `onChange` → Task 3's broadcast; env-parsed windows. Drive with `setInterval(() => void registry.tick(), followPollMs)` beside the tool-callback `tickTimeouts` interval; `clearInterval` in the same shutdown path.

- [ ] **Step 3: Wire ws-router.** Add `followedSessionRegistry?: FollowedSessionRegistry` to the deps interface (~line 160) and destructure (~430). In `sessions.importClaudeSession` (PR A's case): pass `onSessionImported: (info) => followedSessionRegistry?.consider(info)` into `importSessionsByIds`. In the `chat.send` case: `followedSessionRegistry?.stop(command.chatId, "user_takeover")` before dispatching the turn. In `chat.delete`: `stop(chatId, "chat_deleted")`.

- [ ] **Step 4: Integration test** (append): build the importer-test tmp-home fixture, import via `importSessionsByIds` with `onSessionImported: (i) => registry.consider(i)`, grow the file, `await registry.tick()`, assert the new entry appears in `store.getMessages(chatId)`.

- [ ] **Step 5: Gates + commit** — full suite + lint; `git commit -m "feat(server): live tail for imported sessions (stat-poll delta)"`

### Task 3: WS push + client pill

**Files:**
- Modify: `src/shared/protocol.ts` (server event union: `{ type: "followedSessionsUpdated"; chatIds: string[] }`)
- Modify: `src/server/ws-router.ts` (broadcast on registry `onChange` — reuse the broadcast helper the `workflowRunsUpdated` push uses)
- Create: `src/client/stores/followedSessionsStore.ts` (mirror the `workflowsStore` shape)
- Modify: the chat header component (find via `grep -rn "chat-ui-chrome\|ChatHeader" src/client/app` — the component c3-115 owns) to render the pill
- Test: `src/client/stores/followedSessionsStore.test.ts` + a `renderForLoopCheck` case for the pill's selector

**Interfaces:**
- Consumes: `followedChatIds()` / `onChange` (Task 1).
- Produces: `useFollowedSessionsStore((s) => s.chatIds)` with `const EMPTY: string[] = []` stable fallback; `selectIsFollowing(chatId)` helper.

- [ ] **Step 1: Store + failing test** — store holds `chatIds: string[]`, setter `setFollowed(chatIds)` called from the socket message handler (wire where `workflowRunsUpdated` is handled in the client socket layer); test: set → selector returns ids; unknown chat → false; selector returns the SAME reference across renders when state unchanged (stable-ref rule).

- [ ] **Step 2: Pill.** In the chat header, when `selectIsFollowing(activeChatId)`: render a small pill `following` with the project Tooltip: "Live view of an external Claude session. Sending a message takes over and stops following." Follow the house pill/badge styling used by the connection status dot (`KannaSidebar.tsx:484-485` shows the class pattern).

- [ ] **Step 3: renderForLoopCheck** via `src/client/lib/testing/` on the header with the store mounted.

- [ ] **Step 4: Gates + commit + PR** — full suite + lint; screenshots of the pill; PR body cites SPEC walls table.

## Self-review checklist

- [ ] Registry never imports fs/node modules (pure — deps only); only the `-io.adapter.ts` touches `statSync`.
- [ ] `runDelta` path goes through `importOneSession` (event store), never through any HarnessEvent code.
- [ ] Takeover stop is permanent even if the runner keeps growing the old file (PTY resume may mint a NEW session file — old tail must not re-arm; covered by the re-consider test).
- [ ] Bulk import (`sessions.importClaude`) never calls `consider`.
