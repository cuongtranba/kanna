# Stack Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the server-side Stack entity (event-sourced state, store methods, WebSocket commands, read-model selector) so a Stack can be created, renamed, deleted, and have its project membership edited. No UI. No agent spawn wiring. No `chat_created` extension. Those land in Phase 2.

**Architecture:** Stack state lives inside the existing `event-store.ts` (the `KannaStore` class), not in a separate module. New events stream to a new `stacks.jsonl` log file alongside the existing per-domain logs (projects.jsonl, chats.jsonl, ...). Apply cases mutate a new `stacksById: Map<string, StackRecord>` slice of `StoreState`. WebSocket commands call public store methods. The `worktree-store.ts` pattern is a git wrapper, not a precedent for state stores.

> **Design doc correction.** The parent design (`docs/plans/2026-05-11-stack-multi-repo-design.md`) refers to "`src/server/stack-store.ts`" as a separate module mirroring `worktree-store.ts`. That was wrong: `worktree-store.ts` wraps git CLI calls, while domain state for projects and chats lives inside `event-store.ts`. This plan extends `event-store.ts` directly. The design doc will be updated after Phase 1 ships.

**Tech Stack:** TypeScript, Bun runtime, JSONL append-only event logs, `bun test` for tests.

**Source spec:** `docs/plans/2026-05-11-stack-multi-repo-design.md` (sections "Data model" and "Server module"). This plan implements only the parts of those sections that do NOT touch agent.ts or chat creation. The Phase 2 plan covers those.

**Out of scope (Phase 2):**

- `chat_created` extension with `stackId` + `stackBindings`.
- `resolvedBindings` on chat snapshot.
- Agent spawn wiring (`cwd` + `additionalDirectories`).
- All UI work.
- Keybindings.

---

## Pre-flight checks

Before Task 1, verify the worktree is correctly set up:

```bash
git rev-parse --show-toplevel        # → .../kanna/.worktrees/feat-stack-phase1
git rev-parse --abbrev-ref HEAD       # → feat/stack-phase1
git log -1 --oneline                  # base commit visible
bun test src/server/event-store.test.ts  # baseline green
```

If any check fails, stop and investigate before continuing.

---

## Task 1: Add `Stack` types to shared/types.ts

**Files:**
- Modify: `src/shared/types.ts` (add Stack-related types near `ProjectSummary`, ~line 417)

**Step 1: Pick the insertion point**

Run: `grep -n "export interface ProjectSummary" src/shared/types.ts`
Expected: a single line number. Insert the new types directly after this interface and its related neighbours.

**Step 2: Add the types**

Add to `src/shared/types.ts`:

```ts
export interface Stack {
  id: string
  title: string
  projectIds: string[]   // insertion order; drives sidebar order within the stack
  createdAt: number
  updatedAt: number
}

export interface StackSummary {
  id: string
  title: string
  projectIds: string[]
  memberCount: number
  createdAt: number
  updatedAt: number
}
```

These are pure data types. No methods. No optional fields beyond what's defined. Other Stack-shape types (chat bindings) belong in Phase 2.

**Step 3: Verify compile**

Run: `bun run typecheck` (or `bun x tsc --noEmit` if no script exists; check `package.json` first).
Expected: no errors.

**Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(stacks): add Stack and StackSummary shared types"
```

---

## Task 2: Add Stack events to `events.ts`

**Files:**
- Modify: `src/server/events.ts`

**Step 1: Read the file**

Run: `wc -l src/server/events.ts && sed -n '60,90p' src/server/events.ts`
Expected: see the `ProjectEvent` union, the pattern this task follows.

**Step 2: Add the event union**

After the `ProjectEvent` union (currently ending around line 80), add:

```ts
export type StackEvent =
  | {
      v: 3
      type: "stack_added"
      timestamp: number
      stackId: string
      title: string
      projectIds: string[]    // ≥2 at creation; invariant enforced by the store, not the event
    }
  | {
      v: 3
      type: "stack_removed"
      timestamp: number
      stackId: string
    }
  | {
      v: 3
      type: "stack_renamed"
      timestamp: number
      stackId: string
      title: string
    }
  | {
      v: 3
      type: "stack_project_added"
      timestamp: number
      stackId: string
      projectId: string
    }
  | {
      v: 3
      type: "stack_project_removed"
      timestamp: number
      stackId: string
      projectId: string
    }
```

**Step 3: Extend `StoreEvent` union**

Find the `StoreEvent` line (around line 217). Add `StackEvent`:

```ts
export type StoreEvent = ProjectEvent | ChatEvent | MessageEvent | QueuedMessageEvent | TurnEvent | StackEvent | AutoContinueEvent
```

**Step 4: Add `StackRecord` and extend `StoreState`**

Above `StoreState`, add:

```ts
export interface StackRecord {
  id: string
  title: string
  projectIds: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
}
```

Extend `StoreState`:

```ts
export interface StoreState {
  // existing fields...
  stacksById: Map<string, StackRecord>
}
```

**Step 5: Extend `createEmptyState`**

```ts
export function createEmptyState(): StoreState {
  return {
    // existing fields...
    stacksById: new Map(),
  }
}
```

**Step 6: Verify compile**

Run: `bun run typecheck` (or `bun x tsc --noEmit`).
Expected: no errors. `event-store.ts` may now warn that `applyEvent` does not handle `StackEvent` cases (TypeScript exhaustiveness). That is intentional and fixed in Task 4.

**Step 7: Commit**

```bash
git add src/server/events.ts
git commit -m "feat(stacks): add StackEvent union and StackRecord state slice"
```

---

## Task 3: Add `stacks.jsonl` log path + replay

**Files:**
- Modify: `src/server/event-store.ts`

**Step 1: Add the log path field**

After the existing `private readonly *LogPath: string` declarations (~line 176-183), add:

```ts
private readonly stacksLogPath: string
```

In the constructor body, after the other `LogPath` assignments (~line 196-203):

```ts
this.stacksLogPath = path.join(this.dataDir, "stacks.jsonl")
```

**Step 2: Ensure the file on init**

In `init()` (or wherever the existing `ensureFile` calls live, ~line 211-218), add:

```ts
await this.ensureFile(this.stacksLogPath)
```

**Step 3: Wire replay**

Find the existing replay sequence (search for `this.projectsLogPath`, then look at where it is replayed). Add an equivalent replay call for `this.stacksLogPath`. Use the same `replayLog` helper the projects log uses; mirror the order — projects → stacks → chats → ... — so that on replay, stacks see their member projects already loaded.

Run: `grep -n "projectsLogPath\|replayLog" src/server/event-store.ts | head -20`
Expected: identifies the replay loop. Add the stacks line directly after the projects line.

**Step 4: Wire clearStorage**

Find `clearStorage` (search the file). Add:

```ts
Bun.write(this.stacksLogPath, ""),
```

next to the other `Bun.write(...LogPath, "")` calls.

**Step 5: Verify compile and tests**

Run: `bun x tsc --noEmit && bun test src/server/event-store.test.ts`
Expected: typecheck green; existing tests pass.

**Step 6: Commit**

```bash
git add src/server/event-store.ts
git commit -m "feat(stacks): add stacks.jsonl log path with init, replay, and clear"
```

---

## Task 4: Add `applyEvent` cases for all Stack events

**Files:**
- Modify: `src/server/event-store.ts` (`applyEvent` method, ~line 472)

**Important.** No separate apply-only test file. The apply behavior is exercised by the public-API method tests in Task 5. (Existing tests in `event-store.test.ts` already follow this pattern: they call `openProject` and assert via `getProject`/state queries, not via direct `applyEvent` access.) Task 4 is implementation-only; tests come in Task 5.

**Step 1: Add the apply cases**

Inside the `applyEvent` switch (~line 472), after the `sidebar_project_order_set` case, add:

```ts
case "stack_added": {
  const record: StackRecord = {
    id: e.stackId,
    title: e.title,
    projectIds: [...e.projectIds],
    createdAt: e.timestamp,
    updatedAt: e.timestamp,
  }
  this.state.stacksById.set(record.id, record)
  break
}
case "stack_removed": {
  const stack = this.state.stacksById.get(e.stackId)
  if (!stack) break
  stack.deletedAt = e.timestamp
  stack.updatedAt = e.timestamp
  break
}
case "stack_renamed": {
  const stack = this.state.stacksById.get(e.stackId)
  if (!stack || stack.deletedAt) break
  stack.title = e.title
  stack.updatedAt = e.timestamp
  break
}
case "stack_project_added": {
  const stack = this.state.stacksById.get(e.stackId)
  if (!stack || stack.deletedAt) break
  if (stack.projectIds.includes(e.projectId)) break
  stack.projectIds = [...stack.projectIds, e.projectId]
  stack.updatedAt = e.timestamp
  break
}
case "stack_project_removed": {
  const stack = this.state.stacksById.get(e.stackId)
  if (!stack || stack.deletedAt) break
  const next = stack.projectIds.filter((id) => id !== e.projectId)
  stack.projectIds = next
  stack.updatedAt = e.timestamp
  break
}
```

Import `StackRecord` from `./events` at the top of the file if not already imported.

**Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: clean.

**Step 3: Commit**

```bash
git add src/server/event-store.ts
git commit -m "feat(stacks): apply stack events into store state"
```

---

## Task 5: Add public store methods (TDD)

Each sub-task here writes the test first, then the method. Five methods total. Group commits by method.

**Test pattern.** Use the same shape as existing `event-store.test.ts`:

```ts
import { describe, test, expect, afterAll } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventStore } from "./event-store"

const tempDirs: string[] = []
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanna-stack-test-"))
  tempDirs.push(dir)
  return dir
}

async function buildStoreWithProjects(paths: string[]): Promise<{ store: EventStore; projectIds: string[] }> {
  const store = new EventStore(await createTempDataDir())
  await store.initialize()
  const projectIds: string[] = []
  for (const p of paths) {
    const project = await store.openProject(p, p)
    projectIds.push(project.id)
  }
  return { store, projectIds }
}
```

Use real local paths (e.g. `/tmp/p1`, `/tmp/p2`) — `openProject` does not require the dir to exist on disk for state-only tests.

> If `EventStore` exposes a `dispose()` / shutdown method, call it in `afterAll`. Otherwise the `rm` in the cleanup is sufficient.

### 5a. `createStack(title, projectIds)`

**Files:**
- Modify: `src/server/event-store.ts`
- Create: `src/server/event-store.stack-methods.test.ts`

**Step 1: Failing test**

```ts
test("createStack writes a stack_added event and returns the new stack", async () => {
  const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
  const stack = await store.createStack("Integration", [p1, p2])
  expect(stack.id).toMatch(/[0-9a-f-]{36}/u)
  expect(stack.title).toBe("Integration")
  expect(stack.projectIds).toEqual([p1, p2])
  expect(store.getStack(stack.id)).toEqual(stack)
})

test("createStack rejects fewer than 2 projects", async () => {
  const { store, projectIds: [p1] } = await buildStoreWithProjects(["/tmp/p1"])
  await expect(store.createStack("Solo", [p1])).rejects.toThrow(/at least 2 projects/u)
})

test("createStack rejects unknown projectId", async () => {
  const { store, projectIds: [p1] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
  await expect(store.createStack("X", [p1, "ghost"])).rejects.toThrow(/Project not found/u)
})

test("createStack rejects duplicate projectIds in the input", async () => {
  const { store, projectIds: [p1] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
  await expect(store.createStack("X", [p1, p1])).rejects.toThrow(/duplicate/u)
})
```

**Step 2: Run the failing tests**

Run: `bun test src/server/event-store.stack-methods.test.ts`
Expected: FAIL — `createStack` not defined.

**Step 3: Implement the method**

In `event-store.ts`, near `openProject` (~line 763), add:

```ts
async createStack(title: string, projectIds: string[]): Promise<StackRecord> {
  const trimmed = title.trim()
  if (trimmed === "") throw new Error("Stack title cannot be empty")
  if (projectIds.length < 2) throw new Error("Stack requires at least 2 projects")
  if (new Set(projectIds).size !== projectIds.length) throw new Error("Stack projectIds contain duplicates")
  for (const projectId of projectIds) {
    const project = this.state.projectsById.get(projectId)
    if (!project || project.deletedAt) throw new Error(`Project not found: ${projectId}`)
  }
  const stackId = crypto.randomUUID()
  const event: StackEvent = {
    v: STORE_VERSION,
    type: "stack_added",
    timestamp: Date.now(),
    stackId,
    title: trimmed,
    projectIds: [...projectIds],
  }
  await this.append(this.stacksLogPath, event)
  return this.state.stacksById.get(stackId)!
}

getStack(stackId: string): StackRecord | null {
  const stack = this.state.stacksById.get(stackId)
  return stack && !stack.deletedAt ? stack : null
}

listStacks(): StackRecord[] {
  return [...this.state.stacksById.values()].filter((s) => !s.deletedAt)
}
```

Import `StackEvent`, `StackRecord` from `./events` as needed.

**Step 4: Run tests**

Run: `bun test src/server/event-store.stack-methods.test.ts`
Expected: all 4 pass.

**Step 5: Commit**

```bash
git add src/server/event-store.ts src/server/event-store.stack-methods.test.ts
git commit -m "feat(stacks): add createStack with validation (≥2 projects, unique, known)"
```

### 5b. `renameStack(stackId, title)`

**Step 1: Failing tests**

```ts
test("renameStack updates the title and emits stack_renamed", async () => { /* ... */ })
test("renameStack on unknown id throws", async () => { /* ... */ })
test("renameStack on deleted stack throws", async () => { /* ... */ })
test("renameStack with empty title throws", async () => { /* ... */ })
```

**Step 2-4: Run, implement, run**

Method body:

```ts
async renameStack(stackId: string, title: string): Promise<void> {
  const stack = this.state.stacksById.get(stackId)
  if (!stack || stack.deletedAt) throw new Error("Stack not found")
  const trimmed = title.trim()
  if (trimmed === "") throw new Error("Stack title cannot be empty")
  if (trimmed === stack.title) return
  const event: StackEvent = {
    v: STORE_VERSION,
    type: "stack_renamed",
    timestamp: Date.now(),
    stackId,
    title: trimmed,
  }
  await this.append(this.stacksLogPath, event)
}
```

**Step 5: Commit**

```bash
git add src/server/event-store.ts src/server/event-store.stack-methods.test.ts
git commit -m "feat(stacks): add renameStack"
```

### 5c. `removeStack(stackId)`

Phase 1 has no chat-binding concept yet, so the "blocked when live chats reference the stack" rule from the design doc cannot be enforced here. Phase 2 will add it. For Phase 1, removeStack is unconditional.

**Step 1: Failing tests**

```ts
test("removeStack marks the stack deleted; getStack returns null", async () => { /* ... */ })
test("removeStack on unknown id throws", async () => { /* ... */ })
test("removeStack on already-deleted id is idempotent (does not throw)", async () => { /* ... */ })
```

**Step 2-4: Run, implement, run**

```ts
async removeStack(stackId: string): Promise<void> {
  const stack = this.state.stacksById.get(stackId)
  if (!stack) throw new Error("Stack not found")
  if (stack.deletedAt) return
  const event: StackEvent = {
    v: STORE_VERSION,
    type: "stack_removed",
    timestamp: Date.now(),
    stackId,
  }
  await this.append(this.stacksLogPath, event)
}
```

**Step 5: Commit**

```bash
git add src/server/event-store.ts src/server/event-store.stack-methods.test.ts
git commit -m "feat(stacks): add removeStack (no live-chat check yet; Phase 2)"
```

### 5d. `addProjectToStack(stackId, projectId)`

**Step 1: Failing tests**

```ts
test("addProjectToStack appends the project id", async () => { /* ... */ })
test("addProjectToStack on unknown stack throws", async () => { /* ... */ })
test("addProjectToStack with unknown project throws", async () => { /* ... */ })
test("addProjectToStack with already-member project is idempotent", async () => { /* ... */ })
```

**Step 2-4: Run, implement, run**

```ts
async addProjectToStack(stackId: string, projectId: string): Promise<void> {
  const stack = this.state.stacksById.get(stackId)
  if (!stack || stack.deletedAt) throw new Error("Stack not found")
  const project = this.state.projectsById.get(projectId)
  if (!project || project.deletedAt) throw new Error("Project not found")
  if (stack.projectIds.includes(projectId)) return
  const event: StackEvent = {
    v: STORE_VERSION,
    type: "stack_project_added",
    timestamp: Date.now(),
    stackId,
    projectId,
  }
  await this.append(this.stacksLogPath, event)
}
```

**Step 5: Commit**

```bash
git add src/server/event-store.ts src/server/event-store.stack-methods.test.ts
git commit -m "feat(stacks): add addProjectToStack"
```

### 5e. `removeProjectFromStack(stackId, projectId)`

Invariant: stack must keep ≥2 members. Refusing the remove call is the Phase 1 behavior; deleting the stack outright is a separate user action.

**Step 1: Failing tests**

```ts
test("removeProjectFromStack removes the project", async () => { /* ... */ })
test("removeProjectFromStack blocks dropping below 2 members", async () => { /* ... */ })
test("removeProjectFromStack on non-member is idempotent", async () => { /* ... */ })
test("removeProjectFromStack on unknown stack throws", async () => { /* ... */ })
```

**Step 2-4: Run, implement, run**

```ts
async removeProjectFromStack(stackId: string, projectId: string): Promise<void> {
  const stack = this.state.stacksById.get(stackId)
  if (!stack || stack.deletedAt) throw new Error("Stack not found")
  if (!stack.projectIds.includes(projectId)) return
  if (stack.projectIds.length <= 2) {
    throw new Error("Stack must keep at least 2 projects. Delete the stack instead.")
  }
  const event: StackEvent = {
    v: STORE_VERSION,
    type: "stack_project_removed",
    timestamp: Date.now(),
    stackId,
    projectId,
  }
  await this.append(this.stacksLogPath, event)
}
```

**Step 5: Commit**

```bash
git add src/server/event-store.ts src/server/event-store.stack-methods.test.ts
git commit -m "feat(stacks): add removeProjectFromStack with min-2-members invariant"
```

---

## Task 6: Replay determinism test

**Files:**
- Modify: `src/server/event-store.stack-methods.test.ts`

**Step 1: Test**

```ts
test("Replay produces identical state to live mutations", async () => {
  const dir = await createTempDataDir()

  // Live mutations.
  const store1 = new EventStore(dir)
  await store1.initialize()
  const pa = await store1.openProject("/tmp/a", "A")
  const pb = await store1.openProject("/tmp/b", "B")
  const pc = await store1.openProject("/tmp/c", "C")
  const s = await store1.createStack("X", [pa.id, pb.id])
  await store1.addProjectToStack(s.id, pc.id)
  await store1.renameStack(s.id, "Renamed")
  await store1.removeProjectFromStack(s.id, pa.id)
  const liveStacks = store1.listStacks()

  // Fresh store, same dir → replays the log.
  const store2 = new EventStore(dir)
  await store2.initialize()
  const replayed = store2.listStacks()
  expect(replayed).toEqual(liveStacks)
})
```

Note: this test reuses `createTempDataDir` defined in the file's top-level helper. If `EventStore` retains background timers or open file handles, a `store1.shutdown?.()` call may be needed before the second `initialize()`. Add it only if the test hangs or flakes; otherwise leave omitted.

**Step 2: Run**

Run: `bun test src/server/event-store.stack-methods.test.ts -t Replay`
Expected: PASS. If it does not, replay order in Task 3 is wrong; fix the order and retest.

**Step 3: Commit**

```bash
git add src/server/event-store.stack-methods.test.ts
git commit -m "test(stacks): event log replay produces identical state"
```

---

## Task 7: WebSocket protocol

**Files:**
- Modify: `src/shared/protocol.ts`

**Step 1: Add to `ClientCommand` union**

Around line 69, in the `ClientCommand` union (after the project.* commands), add:

```ts
| { type: "stack.create"; title: string; projectIds: string[] }
| { type: "stack.rename"; stackId: string; title: string }
| { type: "stack.remove"; stackId: string }
| { type: "stack.addProject"; stackId: string; projectId: string }
| { type: "stack.removeProject"; stackId: string; projectId: string }
```

**Step 2: Verify compile**

Run: `bun x tsc --noEmit`
Expected: no errors.

**Step 3: Commit**

```bash
git add src/shared/protocol.ts
git commit -m "feat(stacks): add stack.* WebSocket client commands"
```

---

## Task 8: WebSocket router handlers

**Files:**
- Modify: `src/server/ws-router.ts`
- Create: `src/server/ws-router.stack.test.ts`

**Step 1: Failing test**

```ts
test("stack.create routes to store.createStack and acks with stackId", async () => { /* ... */ })
test("stack.create with <2 projects sends a typed error", async () => { /* ... */ })
test("stack.rename routes to store.renameStack and acks", async () => { /* ... */ })
test("stack.remove routes to store.removeStack and acks", async () => { /* ... */ })
test("stack.addProject routes to store.addProjectToStack and acks", async () => { /* ... */ })
test("stack.removeProject routes to store.removeProjectFromStack and acks", async () => { /* ... */ })
test("stack.create broadcasts the updated stacks list", async () => { /* ... */ })
```

Test harness pattern (mirrors `ws-router.test.ts`):

- Construct a real `EventStore` with `createTempDataDir()` and `await store.initialize()`. Open two projects with `store.openProject(...)`.
- Pass the store to `createWsRouter({ store, ... })`. All other deps (agent, terminals, keybindings, etc.) can be stubbed with the same `as never` shapes used by existing tests; copy the minimal stubs from the `system.ping` test (`ws-router.test.ts:243`).
- Use the existing `FakeWebSocket` class. Drive commands by calling `router.handleMessage(ws, JSON.stringify({ v: 1, type: "command", id, command: { type: "stack.create", title, projectIds } }))`.
- Assert against `ws.sent` for the ack payload. Track broadcasts by counting `handleMessage` triggers; the broadcastFilteredSnapshots call lands in the snapshot subscription pipe.

Do NOT mock the store — the tests should observe real `store.listStacks()` mutation, which catches both wiring and side-effect bugs.

`resolvedAnalytics.track("stack_created")` requires the event name to be added to `src/server/analytics.ts`. Add it in the same commit. If `analytics.ts` enforces a closed union of event names, extend the union; if it accepts any string, no change needed.

**Step 2: Run the failing tests**

Run: `bun test src/server/ws-router.stack.test.ts`
Expected: FAIL with "unknown command type" or similar.

**Step 3: Add the handlers**

In `ws-router.ts`, in the command-routing switch (find the `chat.create` case around line 1365 as a template), add:

```ts
case "stack.create": {
  const stack = await store.createStack(command.title, command.projectIds)
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { stackId: stack.id } })
  resolvedAnalytics.track("stack_created")
  await broadcastFilteredSnapshots({ includeSidebar: true })
  return
}
case "stack.rename": {
  await store.renameStack(command.stackId, command.title)
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id })
  await broadcastFilteredSnapshots({ includeSidebar: true })
  return
}
case "stack.remove": {
  await store.removeStack(command.stackId)
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id })
  await broadcastFilteredSnapshots({ includeSidebar: true })
  return
}
case "stack.addProject": {
  await store.addProjectToStack(command.stackId, command.projectId)
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id })
  await broadcastFilteredSnapshots({ includeSidebar: true })
  return
}
case "stack.removeProject": {
  await store.removeProjectFromStack(command.stackId, command.projectId)
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id })
  await broadcastFilteredSnapshots({ includeSidebar: true })
  return
}
```

If `resolvedAnalytics.track("stack_created")` requires the event name to be registered in `src/server/analytics.ts`, add it there in the same commit.

**Step 4: Run the tests**

Run: `bun test src/server/ws-router.stack.test.ts`
Expected: all pass.

**Step 5: Commit**

```bash
git add src/server/ws-router.ts src/server/ws-router.stack.test.ts src/server/analytics.ts
git commit -m "feat(stacks): wire stack.* WebSocket commands to store methods"
```

---

## Task 9: Read-model `stackSummaries` selector

**Files:**
- Modify: `src/server/read-models.ts`
- Modify: `src/server/read-models.test.ts`

**Step 1: Failing test**

```ts
import { createEmptyState } from "./events"
import { stackSummaries } from "./read-models"

test("stackSummaries returns active stacks with member counts in insertion order", () => {
  const state = createEmptyState()
  state.stacksById.set("s1", {
    id: "s1",
    title: "A",
    projectIds: ["p1", "p2"],
    createdAt: 1,
    updatedAt: 1,
  })
  state.stacksById.set("s2", {
    id: "s2",
    title: "B",
    projectIds: ["p2", "p3"],
    createdAt: 2,
    updatedAt: 2,
  })
  const summaries = stackSummaries(state)
  expect(summaries).toHaveLength(2)
  expect(summaries[0]?.title).toBe("A")
  expect(summaries[0]?.memberCount).toBe(2)
})

test("stackSummaries excludes deleted stacks", () => {
  const state = createEmptyState()
  state.stacksById.set("s1", {
    id: "s1",
    title: "Gone",
    projectIds: ["p1", "p2"],
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 2,
  })
  expect(stackSummaries(state)).toEqual([])
})
```

`read-models.ts` exports per-selector functions (see existing `deriveSidebarData`, `deriveChatSnapshot`, etc.). Follow that pattern: a free function that takes `StoreState` and returns the projection.

**Step 2: Run**

Run: `bun test src/server/read-models.test.ts -t stackSummaries`
Expected: FAIL.

**Step 3: Implement**

```ts
export function stackSummaries(state: StoreState): StackSummary[] {
  return [...state.stacksById.values()]
    .filter((s) => !s.deletedAt)
    .map((s) => ({
      id: s.id,
      title: s.title,
      projectIds: [...s.projectIds],
      memberCount: s.projectIds.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
}
```

If `read-models.ts` already exports a full sidebar snapshot, extend that snapshot to include `stacks: StackSummary[]` alongside.

**Step 4: Run**

Run: `bun test src/server/read-models.test.ts`
Expected: all pass; no regressions.

**Step 5: Commit**

```bash
git add src/server/read-models.ts src/server/read-models.test.ts
git commit -m "feat(stacks): add stackSummaries read-model selector"
```

---

## Task 10: Full-suite verification

**Step 1: Run all tests**

Run: `bun test`
Expected: full green. Zero new failures. Existing tests untouched.

If anything is red and is **not** a pre-existing failure on `main`, stop and report per the project's pre-existing-issue rule (`~/.claude/CLAUDE.md`).

**Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: no errors.

**Step 3: Manual sanity (optional, only if a dev branch is wanted)**

Boot the server, open the WS client console, send:

```js
ws.send(JSON.stringify({ id: "1", v: 3, type: "stack.create", title: "Test", projectIds: [<two real ids>] }))
```

Expect: ack with `stackId`. Open the data dir; `stacks.jsonl` contains the event.

---

## Task 11: Push and open PR

**Step 1: Push**

```bash
git push -u origin feat/stack-phase1
```

**Step 2: Open PR**

```bash
gh pr create --repo cuongtranba/kanna --base main --head feat/stack-phase1 \
  --title "feat(stacks): Phase 1 — server, events, store, ws-router" \
  --body "$(cat <<'EOF'
## Summary
- Adds the Stack entity (event-sourced) inside event-store.ts.
- Adds stacks.jsonl event log with init / replay / clear wiring.
- Adds public store methods: createStack, renameStack, removeStack, addProjectToStack, removeProjectFromStack.
- Adds stack.* WebSocket commands routed to the store.
- Adds stackSummaries read-model selector.
- No UI. No agent.ts spawn changes. No chat_created extension. Those land in Phase 2.

## Design
- Spec: docs/plans/2026-05-11-stack-multi-repo-design.md
- Phase plan: docs/plans/2026-05-11-stack-phase1-plan.md

## Test plan
- [x] bun test green (full suite)
- [x] bun x tsc --noEmit clean
- [x] Replay determinism test passes
- [ ] Manual: round-trip a stack via WS console
EOF
)"
```

**Step 3: Update the parent design doc**

After Phase 1 merges to main, open a follow-up PR that revises `docs/plans/2026-05-11-stack-multi-repo-design.md` to drop the "stack-store.ts as separate module" claim. The doc should reflect the actual implementation: stack state lives inside `event-store.ts`.

---

## Done-when checklist

- [ ] All tasks above committed, each as its own commit.
- [ ] `bun test` green.
- [ ] `bun x tsc --noEmit` clean.
- [ ] PR open against `cuongtranba/kanna` main.
- [ ] Phase 2 plan written (next session).

## Notes for the executor

- **Subprocess hygiene** (from project CLAUDE.md): any new test that spawns subprocesses must set `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0` and pass an explicit `30_000` ms timeout to `test()`. Phase 1 should not spawn subprocesses at all (this is pure state work), but if a test helper does, follow the rule.
- **Strong typing** (from global CLAUDE.md): no `any`, no `unknown` without narrowing, no untyped maps. `Map<string, StackRecord>` is the only acceptable shape for `stacksById`.
- **One commit per logical step**: do not batch unrelated changes. The plan's commit boundaries are intentional.
- **Pre-existing failures**: if `bun test` is already red on `main`, stop and ask the user before continuing.
- **Reference the design doc, not memory**: when in doubt, re-read `docs/plans/2026-05-11-stack-multi-repo-design.md` rather than inferring.
