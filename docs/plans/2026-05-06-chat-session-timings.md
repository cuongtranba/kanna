# Chat Session Timings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface per-state and active-session timing in three UI surfaces (chat header, inline turn badge, sidebar row) so users can see how long the agent has been in each state and how long the active working session has lasted.

**Architecture:** Server-side derivation. Per-chat timing accumulator (`ChatTimingState`) lives in `StoreState`, mutated in `EventStore.apply` switch alongside other event reducers. `deriveChatSnapshot` reads the accumulator + a `waitStartedAt` map (in-memory in `AgentManager`) and emits `ChatRuntime.timings`. Sidebar gets a thin `stateEnteredAt` only. Client renders snapshot values via a pure `formatDuration` helper — no client-side ticking. `derivedAtMs` is baked into the snapshot to keep durations stable across React rerenders.

**Tech Stack:** TypeScript, Bun (test runner), React, existing event-sourcing scaffolding in `src/server/event-store.ts`.

**Reference design:** `docs/plans/2026-05-06-chat-session-timings-design.md`

---

## Phase 1 — Server foundation

### Task 1: Add `ChatStateTimings` type to shared types

**Files:**
- Modify: `src/shared/types.ts:1053-1063` (extend `ChatRuntime`)
- Modify: `src/shared/types.ts:376-388` (extend `SidebarChatRow`)

**Step 1: Add type definitions**

Insert above `ChatRuntime` interface (around line 1053):

```ts
export interface ChatTimingCumulativeMs {
  idle: number
  starting: number
  running: number
  waiting_for_user: number
  failed: number
}

export interface ChatStateTimings {
  activeSessionStartedAt: number
  chatCreatedAt: number
  stateEnteredAt: number
  lastTurnDurationMs: number | null
  derivedAtMs: number
  cumulativeMs: ChatTimingCumulativeMs
}
```

Extend `ChatRuntime`:

```ts
export interface ChatRuntime {
  chatId: string
  projectId: string
  localPath: string
  title: string
  status: KannaStatus
  isDraining: boolean
  provider: AgentProvider | null
  planMode: boolean
  sessionToken: string | null
  timings: ChatStateTimings
}
```

Extend `SidebarChatRow`:

```ts
export interface SidebarChatRow {
  _id: string
  _creationTime: number
  chatId: string
  title: string
  status: KannaStatus
  unread: boolean
  localPath: string
  provider: AgentProvider | null
  lastMessageAt?: number
  hasAutomation: boolean
  canFork?: boolean
  stateEnteredAt?: number
}
```

**Step 2: Run typecheck**

```bash
bun run --silent build 2>&1 | head -40 || true
# OR if tsc available:
bunx tsc --noEmit 2>&1 | head -40 || true
```

Expected: many errors — every place that constructs `ChatRuntime` literal is now missing `timings`. That's expected; later tasks fix them.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add ChatStateTimings to ChatRuntime and stateEnteredAt to SidebarChatRow"
```

---

### Task 2: Add `ChatTimingState` accumulator to StoreState

**Files:**
- Modify: `src/server/events.ts:28-35` (StoreState shape)
- Modify: `src/server/events.ts:204-...` (`createEmptyState`)

**Step 1: Add ChatTimingState type and field**

In `src/server/events.ts`, add after `ChatRecord`:

```ts
import type { KannaStatus } from "../shared/types"

export interface ChatTimingState {
  status: Exclude<KannaStatus, "waiting_for_user">  // waiting_for_user is in-memory only
  stateEnteredAt: number
  activeSessionStartedAt: number
  lastTurnStartedAt: number | null
  lastTurnDurationMs: number | null
  cumulativeMs: {
    idle: number
    starting: number
    running: number
    failed: number
  }
}
```

Note: `waiting_for_user` is NOT tracked here — it lives on `AgentManager.activeTurns[].waitStartedAt` and is merged at derivation time. `starting` IS tracked because event log emits no explicit start, but if a future event ever emits it we'll handle it; for now it stays at zero.

Extend `StoreState`:

```ts
export interface StoreState {
  projectsById: Map<string, ProjectRecord>
  projectIdsByPath: Map<string, string>
  chatsById: Map<string, ChatRecord>
  queuedMessagesByChatId: Map<string, QueuedChatMessage[]>
  sidebarProjectOrder: string[]
  autoContinueEventsByChatId: Map<string, AutoContinueEvent[]>
  chatTimingsByChatId: Map<string, ChatTimingState>
}
```

**Step 2: Initialize in `createEmptyState`**

```ts
export function createEmptyState(): StoreState {
  return {
    projectsById: new Map(),
    projectIdsByPath: new Map(),
    chatsById: new Map(),
    queuedMessagesByChatId: new Map(),
    sidebarProjectOrder: [],
    autoContinueEventsByChatId: new Map(),
    chatTimingsByChatId: new Map(),
  }
}
```

**Step 3: Run tests for events.ts (compile only)**

```bash
bunx tsc --noEmit src/server/events.ts 2>&1 | head -20 || true
```

Expected: file compiles. Other files referencing `StoreState` may still fail — fixed in Task 3.

**Step 4: Commit**

```bash
git add src/server/events.ts
git commit -m "feat(events): add ChatTimingState accumulator to StoreState"
```

---

### Task 3: Write failing test for `chatTimingsByChatId` accumulator

**Files:**
- Modify: `src/server/event-store.test.ts` (new test cases)

**Step 1: Add test cases**

Add at end of `src/server/event-store.test.ts`:

```ts
import { ACTIVE_SESSION_IDLE_GAP_MS } from "./read-models"

describe("ChatTimingState accumulator", () => {
  test("chat_created seeds idle state with createdAt", () => {
    const store = new EventStore("/tmp/test-timings-1")
    store.append({ v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    store.append({ v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })

    const t = store.state.chatTimingsByChatId.get("c1")
    expect(t).toBeDefined()
    expect(t!.status).toBe("idle")
    expect(t!.stateEnteredAt).toBe(2000)
    expect(t!.activeSessionStartedAt).toBe(2000)
    expect(t!.cumulativeMs).toEqual({ idle: 0, starting: 0, running: 0, failed: 0 })
  })

  test("turn_started transitions idle -> running and accumulates idle time", () => {
    const store = new EventStore("/tmp/test-timings-2")
    store.append({ v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    store.append({ v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })
    store.append({ v: 3, type: "turn_started", timestamp: 5000, chatId: "c1" })

    const t = store.state.chatTimingsByChatId.get("c1")!
    expect(t.status).toBe("running")
    expect(t.stateEnteredAt).toBe(5000)
    expect(t.cumulativeMs.idle).toBe(3000)
    expect(t.cumulativeMs.running).toBe(0)
    expect(t.lastTurnStartedAt).toBe(5000)
  })

  test("turn_finished transitions running -> idle, sets lastTurnDurationMs", () => {
    const store = new EventStore("/tmp/test-timings-3")
    store.append({ v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    store.append({ v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })
    store.append({ v: 3, type: "turn_started", timestamp: 5000, chatId: "c1" })
    store.append({ v: 3, type: "turn_finished", timestamp: 8000, chatId: "c1" })

    const t = store.state.chatTimingsByChatId.get("c1")!
    expect(t.status).toBe("idle")
    expect(t.stateEnteredAt).toBe(8000)
    expect(t.cumulativeMs.idle).toBe(3000)
    expect(t.cumulativeMs.running).toBe(3000)
    expect(t.lastTurnDurationMs).toBe(3000)
  })

  test("turn_failed transitions running -> failed", () => {
    const store = new EventStore("/tmp/test-timings-4")
    store.append({ v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    store.append({ v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })
    store.append({ v: 3, type: "turn_started", timestamp: 5000, chatId: "c1" })
    store.append({ v: 3, type: "turn_failed", timestamp: 7000, chatId: "c1", error: "boom" })

    const t = store.state.chatTimingsByChatId.get("c1")!
    expect(t.status).toBe("failed")
    expect(t.stateEnteredAt).toBe(7000)
    expect(t.cumulativeMs.running).toBe(2000)
  })

  test("idle gap > ACTIVE_SESSION_IDLE_GAP_MS resets activeSessionStartedAt and cumulative", () => {
    const store = new EventStore("/tmp/test-timings-5")
    const HOUR = 60 * 60 * 1000
    store.append({ v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    store.append({ v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })
    store.append({ v: 3, type: "turn_started", timestamp: 5000, chatId: "c1" })
    store.append({ v: 3, type: "turn_finished", timestamp: 8000, chatId: "c1" })
    // Gap of 1 hour > 30 min threshold
    store.append({ v: 3, type: "turn_started", timestamp: 8000 + HOUR, chatId: "c1" })

    const t = store.state.chatTimingsByChatId.get("c1")!
    expect(t.activeSessionStartedAt).toBe(8000 + HOUR)
    expect(t.cumulativeMs.idle).toBe(0)
    expect(t.cumulativeMs.running).toBe(0)
    expect(t.status).toBe("running")
    expect(t.stateEnteredAt).toBe(8000 + HOUR)
  })
})
```

**Step 2: Run tests — expect failure**

```bash
bun test src/server/event-store.test.ts 2>&1 | tail -25
```

Expected: failures. `chatTimingsByChatId` will be empty Map (no reducer logic yet) and `ACTIVE_SESSION_IDLE_GAP_MS` import unresolved.

**Step 3: Commit failing test**

```bash
git add src/server/event-store.test.ts
git commit -m "test(event-store): add timing accumulator tests (failing)"
```

---

### Task 4: Implement `ACTIVE_SESSION_IDLE_GAP_MS` constant

**Files:**
- Modify: `src/server/read-models.ts:18` (add constant)

**Step 1: Add export**

Above `SIDEBAR_RECENT_WINDOW_MS`:

```ts
export const ACTIVE_SESSION_IDLE_GAP_MS = 30 * 60 * 1_000
```

**Step 2: Commit**

```bash
git add src/server/read-models.ts
git commit -m "feat(read-models): add ACTIVE_SESSION_IDLE_GAP_MS constant"
```

---

### Task 5: Implement timing accumulator reducer in event-store

**Files:**
- Modify: `src/server/event-store.ts` (apply loop, lines ~98-110 and ~613-640)

**Step 1: Add helper above the apply switch**

In `src/server/event-store.ts`, add private method on `EventStore`:

```ts
private updateTiming(chatId: string, eventTs: number, nextStatus: ChatTimingState["status"], onTurnStart?: boolean, onTurnFinish?: boolean) {
  const prev = this.state.chatTimingsByChatId.get(chatId)
  if (!prev) {
    // chat_created path: seed
    this.state.chatTimingsByChatId.set(chatId, {
      status: nextStatus,
      stateEnteredAt: eventTs,
      activeSessionStartedAt: eventTs,
      lastTurnStartedAt: null,
      lastTurnDurationMs: null,
      cumulativeMs: { idle: 0, starting: 0, running: 0, failed: 0 },
    })
    return
  }

  const segmentMs = Math.max(0, eventTs - prev.stateEnteredAt)
  let activeSessionStartedAt = prev.activeSessionStartedAt
  let cumulativeMs = { ...prev.cumulativeMs }

  // Detect long idle gap when leaving idle -> something
  if (prev.status === "idle" && nextStatus !== "idle" && segmentMs > ACTIVE_SESSION_IDLE_GAP_MS) {
    activeSessionStartedAt = eventTs
    cumulativeMs = { idle: 0, starting: 0, running: 0, failed: 0 }
  } else {
    cumulativeMs[prev.status] += segmentMs
  }

  let lastTurnStartedAt = prev.lastTurnStartedAt
  let lastTurnDurationMs = prev.lastTurnDurationMs
  if (onTurnStart) lastTurnStartedAt = eventTs
  if (onTurnFinish && lastTurnStartedAt != null) lastTurnDurationMs = Math.max(0, eventTs - lastTurnStartedAt)

  this.state.chatTimingsByChatId.set(chatId, {
    status: nextStatus,
    stateEnteredAt: eventTs,
    activeSessionStartedAt,
    lastTurnStartedAt,
    lastTurnDurationMs,
    cumulativeMs,
  })
}
```

Add import at top:

```ts
import type { ChatTimingState } from "./events"
import { ACTIVE_SESSION_IDLE_GAP_MS } from "./read-models"
```

**Step 2: Wire reducer into apply switch**

Find each case and append the timing call:

```ts
case "chat_created": {
  // ... existing logic
  this.updateTiming(e.chatId, e.timestamp, "idle")
  break
}
case "turn_started": {
  // ... existing
  this.updateTiming(e.chatId, e.timestamp, "running", true, false)
  break
}
case "turn_finished": {
  // ... existing
  this.updateTiming(e.chatId, e.timestamp, "idle", false, true)
  break
}
case "turn_failed": {
  // ... existing
  this.updateTiming(e.chatId, e.timestamp, "failed", false, true)
  break
}
case "turn_cancelled": {
  // ... existing
  this.updateTiming(e.chatId, e.timestamp, "idle", false, true)
  break
}
case "chat_deleted": {
  // ... existing
  this.state.chatTimingsByChatId.delete(e.chatId)
  break
}
```

**Step 3: Run tests — expect pass**

```bash
bun test src/server/event-store.test.ts 2>&1 | tail -15
```

Expected: 5 new tests pass. Existing tests still pass.

**Step 4: Commit**

```bash
git add src/server/event-store.ts
git commit -m "feat(event-store): accumulate ChatTimingState on turn events"
```

---

### Task 6: Write failing test for `deriveTimings` snapshot helper

**Files:**
- Modify: `src/server/read-models.test.ts`

**Step 1: Add test cases**

Append:

```ts
import { deriveTimings, ACTIVE_SESSION_IDLE_GAP_MS } from "./read-models"

describe("deriveTimings", () => {
  const baseTiming = {
    status: "idle" as const,
    stateEnteredAt: 1000,
    activeSessionStartedAt: 500,
    lastTurnStartedAt: null,
    lastTurnDurationMs: null,
    cumulativeMs: { idle: 500, starting: 0, running: 0, failed: 0 },
  }

  test("formats accumulator + nowMs into ChatStateTimings", () => {
    const out = deriveTimings(
      { createdAt: 500 } as any,
      { ...baseTiming },
      undefined, // no in-memory wait
      undefined,
      3000,
    )
    expect(out.activeSessionStartedAt).toBe(500)
    expect(out.chatCreatedAt).toBe(500)
    expect(out.stateEnteredAt).toBe(1000)
    expect(out.derivedAtMs).toBe(3000)
    expect(out.cumulativeMs.idle).toBe(500 + 2000) // 500 from accumulator + 2000 open segment to nowMs
    expect(out.cumulativeMs.waiting_for_user).toBe(0)
  })

  test("waitStartedAt overrides current state to waiting_for_user and adds open segment", () => {
    const out = deriveTimings(
      { createdAt: 500 } as any,
      { ...baseTiming, status: "running", stateEnteredAt: 1500, lastTurnStartedAt: 1500 },
      "waiting_for_user",
      2500,
      3000,
    )
    expect(out.cumulativeMs.waiting_for_user).toBe(500) // 3000 - 2500
    expect(out.stateEnteredAt).toBe(2500)
  })

  test("missing accumulator (legacy chat) falls back to chat.createdAt for everything", () => {
    const out = deriveTimings(
      { createdAt: 1000 } as any,
      undefined,
      undefined,
      undefined,
      4000,
    )
    expect(out.activeSessionStartedAt).toBe(1000)
    expect(out.chatCreatedAt).toBe(1000)
    expect(out.stateEnteredAt).toBe(1000)
    expect(out.cumulativeMs.idle).toBe(3000)
    expect(out.lastTurnDurationMs).toBeNull()
  })
})
```

**Step 2: Run tests — expect failure**

```bash
bun test src/server/read-models.test.ts 2>&1 | tail -15
```

Expected: import errors / undefined `deriveTimings`.

**Step 3: Commit**

```bash
git add src/server/read-models.test.ts
git commit -m "test(read-models): add deriveTimings tests (failing)"
```

---

### Task 7: Implement `deriveTimings`

**Files:**
- Modify: `src/server/read-models.ts`

**Step 1: Add function**

Above `deriveChatSnapshot`:

```ts
import type { ChatStateTimings, KannaStatus } from "../shared/types"
import type { ChatRecord, ChatTimingState } from "./events"

export function deriveTimings(
  chat: Pick<ChatRecord, "createdAt">,
  accumulator: ChatTimingState | undefined,
  activeStatus: KannaStatus | undefined,
  waitStartedAt: number | undefined,
  nowMs: number,
): ChatStateTimings {
  const cumulativeMs = {
    idle: 0,
    starting: 0,
    running: 0,
    waiting_for_user: 0,
    failed: 0,
  }

  if (!accumulator) {
    // Legacy chat with no events folded yet
    const idleSegment = Math.max(0, nowMs - chat.createdAt)
    cumulativeMs.idle = idleSegment
    return {
      activeSessionStartedAt: chat.createdAt,
      chatCreatedAt: chat.createdAt,
      stateEnteredAt: chat.createdAt,
      lastTurnDurationMs: null,
      derivedAtMs: nowMs,
      cumulativeMs,
    }
  }

  cumulativeMs.idle = accumulator.cumulativeMs.idle
  cumulativeMs.starting = accumulator.cumulativeMs.starting
  cumulativeMs.running = accumulator.cumulativeMs.running
  cumulativeMs.failed = accumulator.cumulativeMs.failed

  // Open segment from accumulator's stateEnteredAt → nowMs
  const openSegmentMs = Math.max(0, nowMs - accumulator.stateEnteredAt)

  let stateEnteredAt = accumulator.stateEnteredAt

  if (activeStatus === "waiting_for_user" && waitStartedAt != null) {
    // Add the running portion before wait started
    const preWaitMs = Math.max(0, waitStartedAt - accumulator.stateEnteredAt)
    cumulativeMs[accumulator.status] += preWaitMs
    cumulativeMs.waiting_for_user += Math.max(0, nowMs - waitStartedAt)
    stateEnteredAt = waitStartedAt
  } else {
    cumulativeMs[accumulator.status] += openSegmentMs
  }

  return {
    activeSessionStartedAt: accumulator.activeSessionStartedAt,
    chatCreatedAt: chat.createdAt,
    stateEnteredAt,
    lastTurnDurationMs: accumulator.lastTurnDurationMs,
    derivedAtMs: nowMs,
    cumulativeMs,
  }
}
```

**Step 2: Run tests — expect pass**

```bash
bun test src/server/read-models.test.ts 2>&1 | tail -15
```

Expected: all 12 existing + 3 new tests pass.

**Step 3: Commit**

```bash
git add src/server/read-models.ts
git commit -m "feat(read-models): implement deriveTimings"
```

---

### Task 8: Wire `timings` into `deriveChatSnapshot` and sidebar rows

**Files:**
- Modify: `src/server/read-models.ts:64-118` (`deriveSidebarData`)
- Modify: `src/server/read-models.ts:183-230` (`deriveChatSnapshot`)

**Step 1: Update `deriveChatSnapshot` signature + body**

Add `waitStartedAtByChatId` parameter:

```ts
export function deriveChatSnapshot(
  state: StoreState,
  activeStatuses: Map<string, KannaStatus>,
  drainingChatIds: Set<string>,
  slashCommandsLoadingChatIds: Set<string>,
  chatId: string,
  getMessages: (chatId: string) => Pick<ChatSnapshot, "messages" | "history">,
  getTunnelEvents: (chatId: string) => readonly CloudflareTunnelEvent[],
  waitStartedAtByChatId: Map<string, number>,
  nowMs: number = Date.now(),
): ChatSnapshot | null {
```

Build runtime with `timings`:

```ts
const runtime: ChatRuntime = {
  chatId: chat.id,
  projectId: project.id,
  localPath: project.localPath,
  title: chat.title,
  status: deriveStatus(chat, activeStatuses.get(chat.id)),
  isDraining: drainingChatIds.has(chat.id),
  provider: chat.provider,
  planMode: chat.planMode,
  sessionToken: chat.sessionToken,
  timings: deriveTimings(
    chat,
    state.chatTimingsByChatId.get(chat.id),
    activeStatuses.get(chat.id),
    waitStartedAtByChatId.get(chat.id),
    nowMs,
  ),
}
```

**Step 2: Update `deriveSidebarData` to populate `stateEnteredAt`**

In `toSidebarChatRows`:

```ts
.map((chat) => ({
  _id: chat.id,
  _creationTime: chat.createdAt,
  chatId: chat.id,
  title: chat.title,
  status: deriveStatus(chat, activeStatuses.get(chat.id)),
  unread: chat.unread,
  localPath: project.localPath,
  provider: chat.provider,
  lastMessageAt: chat.lastMessageAt,
  hasAutomation: false,
  canFork: canForkChat(chat, activeStatuses, drainingChatIds) || undefined,
  stateEnteredAt: state.chatTimingsByChatId.get(chat.id)?.stateEnteredAt,
}))
```

**Step 3: Update existing call sites in `ws-router.ts`**

Find every `deriveChatSnapshot(` call and pass `agent.getWaitStartedAtByChatId()` (added in Task 9) and `Date.now()`. Compile errors will pinpoint locations:

```bash
bun test src/server/read-models.test.ts 2>&1 | tail -15
bunx tsc --noEmit 2>&1 | head -30
```

Most existing tests in `read-models.test.ts` will need `new Map()` and explicit `nowMs` added to their `deriveChatSnapshot` calls. Update them.

**Step 4: Run tests — expect pass**

```bash
bun test src/server/read-models.test.ts 2>&1 | tail -15
```

**Step 5: Commit**

```bash
git add src/server/read-models.ts src/server/read-models.test.ts
git commit -m "feat(read-models): wire timings into ChatRuntime and SidebarChatRow"
```

---

## Phase 2 — Wait-state in-memory tracking

### Task 9: Track `waitStartedAt` in `AgentManager`

**Files:**
- Modify: `src/server/agent.ts:1035-1050` (active turn waiting block)
- Modify: `src/server/agent.ts:755-761` (add `getWaitStartedAtByChatId`)

**Step 1: Add field to `ActiveTurn` interface**

Find `interface ActiveTurn` (search):

```bash
grep -n "interface ActiveTurn" src/server/agent.ts
```

Add field:

```ts
interface ActiveTurn {
  // ...existing
  waitStartedAt: number | null
}
```

**Step 2: Initialize `waitStartedAt: null` everywhere `ActiveTurn` is constructed**

```bash
grep -n "this.activeTurns.set\|: ActiveTurn" src/server/agent.ts
```

Add `waitStartedAt: null,` to each.

**Step 3: Set on transition to `waiting_for_user`**

Around line 1040:

```ts
active.status = "waiting_for_user"
active.waitStartedAt = Date.now()
this.emitStateChange(args.chatId)
```

**Step 4: Clear when tool resolved**

Find the `pendingTool.resolve` site (right after the Promise resolution site that fires when permission grants). Search:

```bash
grep -n "pendingTool.resolve\|pendingTool = undefined\|pendingTool = null" src/server/agent.ts
```

After resolving and clearing pendingTool, add:

```ts
active.waitStartedAt = null
active.status = "running"
this.emitStateChange(chatId)
```

(Adapt to actual control flow at that site.)

**Step 5: Add accessor method**

After `getActiveStatuses`:

```ts
getWaitStartedAtByChatId(): Map<string, number> {
  const out = new Map<string, number>()
  for (const [chatId, turn] of this.activeTurns.entries()) {
    if (turn.waitStartedAt != null) out.set(chatId, turn.waitStartedAt)
  }
  return out
}
```

**Step 6: Run agent tests for what we changed**

```bash
bun test src/server/agent 2>&1 | tail -15
```

Expected: pass (no new test added; behavior change is additive).

**Step 7: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat(agent): track waitStartedAt per active turn for waiting_for_user timing"
```

---

### Task 10: Wire `waitStartedAt` map through `ws-router`

**Files:**
- Modify: `src/server/ws-router.ts:600-620` (chat snapshot derivation site)
- Modify: `src/server/ws-router.ts:430-445` (sidebar derivation site — sidebar reads accumulator directly, no wait map needed there)

**Step 1: Update `deriveChatSnapshot` call**

Around line 603:

```ts
data: deriveChatSnapshot(
  store.state,
  agent.getActiveStatuses(),
  agent.getDrainingChatIds(),
  agent.getSlashCommandsLoadingChatIds(),
  chatId,
  (cid) => store.getMessagesPage(cid),     // existing arg shape
  (cid) => store.getTunnelEvents(cid),
  agent.getWaitStartedAtByChatId(),
  Date.now(),
),
```

(Adjust to match the actual signature lines around that call — search `deriveChatSnapshot(` to see current shape.)

**Step 2: Run targeted tests**

```bash
bun test src/server/ws-router 2>&1 | tail -15
bun test src/server/read-models 2>&1 | tail -15
```

Expected: pass.

**Step 3: Commit**

```bash
git add src/server/ws-router.ts
git commit -m "feat(ws-router): pass waitStartedAt map and nowMs into chat snapshot derivation"
```

---

## Phase 3 — Client format helper

### Task 11: Write failing tests for `formatDuration`

**Files:**
- Create: `src/client/lib/formatDuration.test.ts`

**Step 1: Write tests**

```ts
import { describe, expect, test } from "bun:test"
import { formatCompactDuration, formatLiveDuration } from "./formatDuration"

describe("formatCompactDuration", () => {
  test("under a minute → Ns", () => {
    expect(formatCompactDuration(0)).toBe("0s")
    expect(formatCompactDuration(42_000)).toBe("42s")
    expect(formatCompactDuration(59_999)).toBe("59s")
  })
  test("under an hour → Mm", () => {
    expect(formatCompactDuration(60_000)).toBe("1m")
    expect(formatCompactDuration(120_000)).toBe("2m")
    expect(formatCompactDuration(59 * 60_000)).toBe("59m")
  })
  test("under a day → Hh Mm", () => {
    expect(formatCompactDuration(60 * 60_000)).toBe("1h")
    expect(formatCompactDuration(3_660_000)).toBe("1h 1m")
    expect(formatCompactDuration(23 * 60 * 60_000 + 59 * 60_000)).toBe("23h 59m")
  })
  test("≥ a day → Dd Hh", () => {
    expect(formatCompactDuration(24 * 60 * 60_000)).toBe("1d")
    expect(formatCompactDuration(25 * 60 * 60_000)).toBe("1d 1h")
    expect(formatCompactDuration(48 * 60 * 60_000 + 30 * 60_000)).toBe("2d") // <1h trailing → drop
  })
  test("negative input clamps to 0s", () => {
    expect(formatCompactDuration(-50)).toBe("0s")
  })
})

describe("formatLiveDuration", () => {
  test("under an hour → M:SS", () => {
    expect(formatLiveDuration(0)).toBe("0:00")
    expect(formatLiveDuration(12_000)).toBe("0:12")
    expect(formatLiveDuration(125_000)).toBe("2:05")
    expect(formatLiveDuration(59 * 60_000 + 59_000)).toBe("59:59")
  })
  test("≥ 1h → falls back to compact", () => {
    expect(formatLiveDuration(60 * 60_000)).toBe("1h")
    expect(formatLiveDuration(3_660_000)).toBe("1h 1m")
  })
})
```

**Step 2: Run — expect failure**

```bash
bun test src/client/lib/formatDuration.test.ts 2>&1 | tail -10
```

Expected: file not found.

**Step 3: Commit failing test**

```bash
git add src/client/lib/formatDuration.test.ts
git commit -m "test(client): add formatDuration tests (failing)"
```

---

### Task 12: Implement `formatDuration`

**Files:**
- Create: `src/client/lib/formatDuration.ts`

**Step 1: Write implementation**

```ts
const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatCompactDuration(ms: number): string {
  const v = Math.max(0, ms)
  if (v < MINUTE) return `${Math.floor(v / SECOND)}s`
  if (v < HOUR) return `${Math.floor(v / MINUTE)}m`
  if (v < DAY) {
    const h = Math.floor(v / HOUR)
    const m = Math.floor((v % HOUR) / MINUTE)
    return m === 0 ? `${h}h` : `${h}h ${m}m`
  }
  const d = Math.floor(v / DAY)
  const h = Math.floor((v % DAY) / HOUR)
  return h === 0 ? `${d}d` : `${d}d ${h}h`
}

export function formatLiveDuration(ms: number): string {
  const v = Math.max(0, ms)
  if (v >= HOUR) return formatCompactDuration(v)
  const totalSec = Math.floor(v / SECOND)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}
```

**Step 2: Run tests — expect pass**

```bash
bun test src/client/lib/formatDuration.test.ts 2>&1 | tail -10
```

**Step 3: Commit**

```bash
git add src/client/lib/formatDuration.ts
git commit -m "feat(client): add formatDuration helpers"
```

---

## Phase 4 — UI integration

### Task 13: Render timing in `ChatNavbar`

**Files:**
- Modify: `src/client/components/chat-ui/ChatNavbar.tsx`
- Modify: `src/client/app/ChatPage/index.tsx:905` (pass `timings` prop)

**Step 1: Add `timings` prop to ChatNavbar**

Extend `Props`:

```ts
interface Props {
  // ...existing
  timings?: ChatStateTimings
  status?: KannaStatus
}
```

Import:

```ts
import type { ChatStateTimings, KannaStatus } from "../../../shared/types"
import { formatCompactDuration, formatLiveDuration } from "../../lib/formatDuration"
```

**Step 2: Render timing block**

Inside the navbar JSX, add a center segment between left and right icon groups:

```tsx
{timings && status && (
  <div className="flex items-center gap-2 text-xs text-muted-foreground"
       title={`Chat created ${formatCompactDuration((timings.derivedAtMs - timings.chatCreatedAt))} ago\nthis session: idle ${formatCompactDuration(timings.cumulativeMs.idle)} · running ${formatCompactDuration(timings.cumulativeMs.running)} · waiting ${formatCompactDuration(timings.cumulativeMs.waiting_for_user)}`}>
    <span className="font-medium">
      {status} {formatLiveDuration(timings.derivedAtMs - timings.stateEnteredAt)}
    </span>
    <span>·</span>
    <span>session {formatCompactDuration(timings.derivedAtMs - timings.activeSessionStartedAt)}</span>
    {timings.lastTurnDurationMs != null && (
      <>
        <span>·</span>
        <span>last turn {formatCompactDuration(timings.lastTurnDurationMs)}</span>
      </>
    )}
  </div>
)}
```

Place the block in a flex-1 wrapper so it sits between the existing left and right groups without disturbing them.

**Step 3: Pass props at ChatPage call site (line ~905)**

```tsx
<ChatNavbar
  // ...existing props
  timings={state.runtime?.timings}
  status={state.runtime?.status}
/>
```

**Step 4: Run typecheck + tests**

```bash
bunx tsc --noEmit 2>&1 | head -20
bun test src/client/app 2>&1 | tail -15
```

**Step 5: Commit**

```bash
git add src/client/components/chat-ui/ChatNavbar.tsx src/client/app/ChatPage/index.tsx
git commit -m "feat(chat-navbar): render state duration, session age, last turn"
```

---

### Task 14: Render stamp/badge in sidebar rows

**Files:**
- Modify: `src/client/app/KannaSidebar.tsx`

**Step 1: Find sidebar row rendering**

```bash
grep -n "lastMessageAt\|SidebarChatRow\|chat.title" src/client/app/KannaSidebar.tsx | head -10
```

**Step 2: Add stamp/badge**

In the row component (likely near where title and status indicator render), add:

```tsx
{(() => {
  const isLive = chat.status === "running" || chat.status === "waiting_for_user"
  if (isLive && chat.stateEnteredAt != null) {
    return (
      <span className="text-xs text-muted-foreground tabular-nums">
        {chat.status === "waiting_for_user" ? "wait" : "run"} {formatLiveDuration(Date.now() - chat.stateEnteredAt)}
      </span>
    )
  }
  const ts = chat.lastMessageAt ?? chat._creationTime
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {formatCompactDuration(Date.now() - ts)}
    </span>
  )
})()}
```

Note: sidebar uses `Date.now()` because no `derivedAtMs` is plumbed to it. Acceptable — reads only update on snapshot push, and React stops re-evaluating between renders since props are stable. If render flickers prove a problem, plumb `derivedAtMs` later.

**Step 3: Add imports**

```ts
import { formatCompactDuration, formatLiveDuration } from "../lib/formatDuration"
```

**Step 4: Run tests**

```bash
bun test src/client/app 2>&1 | tail -10
```

**Step 5: Commit**

```bash
git add src/client/app/KannaSidebar.tsx
git commit -m "feat(sidebar): show compact stamp or live state badge per chat row"
```

---

### Task 15: Inline turn duration on `ResultMessage`

**Files:**
- Modify: `src/client/components/messages/ResultMessage.tsx`

**Step 1: Inspect file**

```bash
cat src/client/components/messages/ResultMessage.tsx | head -80
```

**Step 2: Append duration**

After existing result text/cost render, add:

```tsx
{result.durationMs != null && (
  <span className="text-xs text-muted-foreground ml-2">
    · {formatCompactDuration(result.durationMs)}
  </span>
)}
```

Import:

```ts
import { formatCompactDuration } from "../../lib/formatDuration"
```

**Step 3: Run tests**

```bash
bun test src/client/components/messages 2>&1 | tail -10
```

**Step 4: Commit**

```bash
git add src/client/components/messages/ResultMessage.tsx
git commit -m "feat(result-message): append compact turn duration"
```

---

## Phase 5 — Verification

### Task 16: Full server test sweep

**Step 1: Run scoped server tests**

```bash
bun test src/server/event-store src/server/read-models src/server/agent 2>&1 | tail -25
bun test src/server/ws-router 2>&1 | tail -15
```

Expected: all pass.

**Step 2: Run client lib tests**

```bash
bun test src/client/lib/formatDuration src/client/app 2>&1 | tail -20
```

**Step 3: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

If any test fails or types complain, fix before proceeding. **Do not skip.**

**Step 4: Commit any cleanups**

```bash
git status
git diff
# If trivial fixes needed
git add <fixes>
git commit -m "chore: post-integration fixups"
```

---

### Task 17: Manual smoke test

**Step 1: Start dev server**

```bash
bun run dev 2>&1 | head -30
```

(Or whatever the project's dev script is — check `package.json`.)

**Step 2: Verify in browser**

- Open chat with no turns → header shows `idle 0s · session 0s` (no last turn)
- Send a message → during turn header switches to `running 0:0X`, sidebar row shows `run 0:0X`
- After turn → header shows `idle 0:00 · session 1m · last turn 3.2s`
- Each result message has `· 3.2s` appended
- Wait 30+ minutes idle, send another message → `session` resets to start of new burst

**Step 3: Update C3 docs if needed**

```bash
ls .c3/refs | head -5
```

If c3 conventions require a new ref entry for timings, add minimal stub. Otherwise skip.

**Step 4: Final commit + push**

```bash
git status
# If any updates from smoke test:
git add -A
git commit -m "chore: smoke-test fixups"
```

---

## Done criteria

- [ ] `ChatRuntime.timings` populated in every WS chat snapshot
- [ ] `SidebarChatRow.stateEnteredAt` populated for live chats
- [ ] ChatNavbar shows state, session age, last turn
- [ ] Sidebar rows swap compact stamp ↔ live state badge based on status
- [ ] Result messages append `· Ns` duration
- [ ] All targeted tests pass (`event-store`, `read-models`, `agent`, `ws-router`, `formatDuration`)
- [ ] `tsc --noEmit` clean
- [ ] Active session resets after >30 min idle gap (verified in test + smoke)
- [ ] Commit history is one logical change per commit

---

## Notes for the executing agent

- **Worktree:** Already at `/Users/cuongtran/Desktop/repo/kanna/.worktrees/chat-session-timings` on branch `feature/chat-session-timings`. Stay there.
- **Resource safety:** Per CLAUDE.md, only run tests scoped to changed files. Do not run full project test suite from a subagent.
- **Strong typing:** Per global CLAUDE.md, no `any`/`unknown`/`interface{}`. Cast `as any` is allowed only in tests for mock fixtures (already used in Task 6).
- **Commit cadence:** One commit per task; messages follow conventional commits (`feat:`, `test:`, `fix:`, `chore:`).
- **If a task hits unexpected schema drift** (e.g. existing call site of `deriveChatSnapshot` has different shape than documented): inspect with `grep -n` first, update the plan inline, then proceed. Do not silently change semantics.
