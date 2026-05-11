# Stack Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the Stack entity (server-only, shipped in Phase 1) into chat creation and agent spawn. A chat created inside a stack stores its per-project worktree bindings as part of the `chat_created` event; the agent spawn maps the primary binding to the SDK `cwd` and peer bindings to `additionalDirectories`. Snapshot consumers see a resolved binding list on the chat snapshot. No UI yet — Phase 3 handles sidebar, creation panel, peer strip, and keybindings.

**Architecture:** Extend the existing `chat_created` event with two optional fields (`stackId`, `stackBindings`); extend `ChatRecord` to carry the same; extend `EventStore.createChat` to accept stack options with validation; extend the `chat.create` WebSocket command symmetrically; extend the Claude agent spawn site to pass `additionalDirectories: string[]` derived from peer bindings; extend `deriveChatSnapshot` to emit `resolvedBindings`. Codex spawn keeps a single `cwd` and falls back to per-write `grantRoot` approvals (Codex App Server has no `additionalDirectories` field).

**Tech Stack:** Bun + TypeScript. Event store at `src/server/event-store.ts`. Event shapes at `src/server/events.ts`. Shared types at `src/shared/types.ts`. Agent spawn at `src/server/agent.ts`. WebSocket router at `src/server/ws-router.ts`. Read models at `src/server/read-models.ts`. Tests via `bun test` against ephemeral data dirs.

**Source spec:** `docs/plans/2026-05-11-stack-multi-repo-design.md` (sections "Server module", "Agent spawn", "Read models"). Phase 1 plan at `docs/plans/2026-05-11-stack-phase1-plan.md` (already shipped on this branch lineage).

**Binding-key decision.** Worktree state is not yet in the event store (the `feat/worktree-events` branch is unstarted). Phase 2 binds by **absolute worktree path** (`worktreePath: string`), not by a `worktreeId`. Path is the value the SDK already takes as `cwd`. When worktree-events ships later, a follow-up migration can resolve paths to ids. This decision narrows the design doc's `worktreeId` reference to `worktreePath` for now; the design doc is amended in Task 12 below.

**Out of scope (Phase 3):**

- All client UI (`StacksSection`, inline creation panel, stack chat row, `PeerWorktreeStrip`).
- Keybindings.
- Branch / dirty-status enrichment on peer strip.
- Re-binding a peer worktree on a live chat (`chat_binding_changed` event).

---

## Pre-flight checks

Working directory: `/Users/cuongtran/Desktop/repo/kanna/.worktrees/feat-stack-phase2`. Branch: `feat/stack-phase2`. Base: Phase 1 tip (`6cfa605`).

Before Task 1:

```bash
git rev-parse --abbrev-ref HEAD                 # → feat/stack-phase2
git log -1 --oneline                            # → 6cfa605 (Phase 1 tip)
bun test --timeout 30000                        # baseline green: 1207 pass / 0 fail
bun x tsc --noEmit 2>&1 | grep -v sonner        # only 3 pre-existing sonner errors
```

Stop and ask if any check fails. Do NOT bypass.

---

## Task 1: Add `StackBinding` to shared types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Insert near the existing Stack types**

Find them: `grep -n "export interface Stack\b\|export interface StackSummary\b" src/shared/types.ts`.

Insert directly after `StackSummary`:

```ts
export interface StackBinding {
  projectId: string
  worktreePath: string                          // absolute, matches agent SDK cwd input
  role: "primary" | "additional"
}
```

Only one `role: "primary"` per chat. The invariant is enforced by the store (Task 5), not the type.

**Step 2: Typecheck**

```bash
bun x tsc --noEmit 2>&1 | grep -v sonner | head
```

Expected: no new errors.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(stacks): add StackBinding shared type"
```

---

## Task 2: Extend `chat_created` event + `ChatRecord`

**Files:**
- Modify: `src/server/events.ts`

**Step 1: Extend the `chat_created` variant in `ChatEvent`**

Find: `grep -n 'type: "chat_created"' src/server/events.ts`. The variant lives around line 87. Add two optional fields after `title`:

```ts
{
  v: 3
  type: "chat_created"
  timestamp: number
  chatId: string
  projectId: string
  title: string
  stackId?: string
  stackBindings?: StackBinding[]
}
```

Import `StackBinding`:

```ts
import type { /* existing... */ StackBinding } from "../shared/types"
```

**Step 2: Extend `ChatRecord`**

Find `ChatRecord` near the top of `events.ts`. Add the same optional fields:

```ts
export interface ChatRecord {
  // existing fields...
  stackId?: string
  stackBindings?: StackBinding[]
}
```

**Step 3: Typecheck**

```bash
bun x tsc --noEmit 2>&1 | grep -v sonner | head
```

Expected: no new errors. (The `applyEvent` `chat_created` case will still compile because it does not destructure these new fields.)

**Step 4: Commit**

```bash
git add src/server/events.ts
git commit -m "feat(stacks): extend chat_created event and ChatRecord with stack fields"
```

---

## Task 3: `applyEvent` propagates stack fields onto ChatRecord (TDD)

**Files:**
- Modify: `src/server/event-store.ts` (the `chat_created` case in `applyEvent`, ~line 527)
- Modify: `src/server/event-store.stack-methods.test.ts`

**Step 1: Failing test**

Append to `event-store.stack-methods.test.ts`:

```ts
describe("chat_created with stack fields", () => {
  test("apply preserves stackId and stackBindings on the ChatRecord", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("X", [p1, p2])
    const chat = await store.createChat(p1, {
      stackId: stack.id,
      stackBindings: [
        { projectId: p1, worktreePath: "/tmp/p1", role: "primary" },
        { projectId: p2, worktreePath: "/tmp/p2", role: "additional" },
      ],
    })
    expect(chat.stackId).toBe(stack.id)
    expect(chat.stackBindings).toEqual([
      { projectId: p1, worktreePath: "/tmp/p1", role: "primary" },
      { projectId: p2, worktreePath: "/tmp/p2", role: "additional" },
    ])
  })

  test("apply ignores stack fields when absent (legacy path)", async () => {
    const { store, projectIds: [p1] } = await buildStoreWithProjects(["/tmp/p1"])
    const chat = await store.createChat(p1)
    expect(chat.stackId).toBeUndefined()
    expect(chat.stackBindings).toBeUndefined()
  })
})
```

**Step 2: Run**

```bash
bun test src/server/event-store.stack-methods.test.ts -t "with stack fields"
```

Expected: FAIL — `createChat` signature does not yet accept options.

**Step 3: Implement apply**

In `event-store.ts`, the `chat_created` apply case (~line 527) currently writes `provider`, `planMode`, etc. Add a single block to copy the new optional fields if present:

```ts
case "chat_created": {
  const chat = {
    // existing field assembly (unchanged)
  }
  if (e.stackId !== undefined) chat.stackId = e.stackId
  if (e.stackBindings !== undefined) chat.stackBindings = e.stackBindings.map((b) => ({ ...b }))
  this.state.chatsById.set(chat.id, chat)
  this.updateTiming(e.chatId, e.timestamp, "idle")
  break
}
```

(The `createChat` implementation is in Task 4. Tests still fail until then; commit is at the end of Task 4.)

**Step 4: Do not commit yet** — the test still fails. Continue to Task 4.

---

## Task 4: Extend `createChat` to accept stack options (TDD)

**Files:**
- Modify: `src/server/event-store.ts` (`createChat`, ~line 982)

**Step 1: Implementation**

Replace the existing `createChat(projectId: string)` signature with:

```ts
async createChat(
  projectId: string,
  options?: { stackId?: string; stackBindings?: StackBinding[] },
): Promise<ChatRecord> {
  const project = this.state.projectsById.get(projectId)
  if (!project || project.deletedAt) {
    throw new Error("Project not found")
  }

  if (options?.stackId !== undefined || options?.stackBindings !== undefined) {
    if (options.stackId === undefined || options.stackBindings === undefined) {
      throw new Error("stackId and stackBindings must be provided together")
    }
    const stack = this.state.stacksById.get(options.stackId)
    if (!stack || stack.deletedAt) throw new Error("Stack not found")
    if (options.stackBindings.length === 0) throw new Error("stackBindings cannot be empty")
    const primaries = options.stackBindings.filter((b) => b.role === "primary")
    if (primaries.length !== 1) throw new Error("Exactly one primary binding required")
    const seenProjects = new Set<string>()
    for (const binding of options.stackBindings) {
      if (seenProjects.has(binding.projectId)) {
        throw new Error("Duplicate projectId in stackBindings")
      }
      seenProjects.add(binding.projectId)
      if (!stack.projectIds.includes(binding.projectId)) {
        throw new Error(`Binding projectId not a member of stack: ${binding.projectId}`)
      }
      const peerProject = this.state.projectsById.get(binding.projectId)
      if (!peerProject || peerProject.deletedAt) {
        throw new Error(`Project not found: ${binding.projectId}`)
      }
      if (typeof binding.worktreePath !== "string" || binding.worktreePath.trim() === "") {
        throw new Error("worktreePath must be a non-empty string")
      }
    }
    if (primaries[0].projectId !== projectId) {
      throw new Error("Primary binding projectId must match createChat projectId")
    }
  }

  const chatId = crypto.randomUUID()
  const event: ChatEvent = {
    v: STORE_VERSION,
    type: "chat_created",
    timestamp: Date.now(),
    chatId,
    projectId,
    title: "New Chat",
    ...(options?.stackId !== undefined ? { stackId: options.stackId } : {}),
    ...(options?.stackBindings !== undefined ? { stackBindings: options.stackBindings.map((b) => ({ ...b })) } : {}),
  }
  await this.append(this.chatsLogPath, event)
  return this.state.chatsById.get(chatId)!
}
```

Import `StackBinding` and `ChatRecord`:

```ts
import type { /* existing */ ChatRecord, StackBinding } from "../shared/types"
```

Note: `forkChat` (~line 1000) calls into `chat_created` separately. Do NOT pass stack options through forks in Phase 2; forks reset to a solo chat. Phase 3 may add fork-with-bindings later.

**Step 2: Run the failing tests from Task 3**

```bash
bun test src/server/event-store.stack-methods.test.ts -t "with stack fields"
```

Expected: PASS (both tests).

**Step 3: Add validation tests**

Append to `event-store.stack-methods.test.ts`:

```ts
test("createChat rejects only one of stackId/stackBindings", async () => {
  const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
  const stack = await store.createStack("X", [p1, p2])
  await expect(store.createChat(p1, { stackId: stack.id })).rejects.toThrow(/together/u)
})

test("createChat rejects bindings with no primary", async () => {
  const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
  const stack = await store.createStack("X", [p1, p2])
  await expect(store.createChat(p1, {
    stackId: stack.id,
    stackBindings: [
      { projectId: p1, worktreePath: "/tmp/p1", role: "additional" },
      { projectId: p2, worktreePath: "/tmp/p2", role: "additional" },
    ],
  })).rejects.toThrow(/primary/u)
})

test("createChat rejects two primaries", async () => {
  const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
  const stack = await store.createStack("X", [p1, p2])
  await expect(store.createChat(p1, {
    stackId: stack.id,
    stackBindings: [
      { projectId: p1, worktreePath: "/tmp/p1", role: "primary" },
      { projectId: p2, worktreePath: "/tmp/p2", role: "primary" },
    ],
  })).rejects.toThrow(/Exactly one primary/u)
})

test("createChat rejects binding projectId outside the stack", async () => {
  const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2", "/tmp/p3"])
  const stack = await store.createStack("X", [p1, p2])
  await expect(store.createChat(p1, {
    stackId: stack.id,
    stackBindings: [
      { projectId: p1, worktreePath: "/tmp/p1", role: "primary" },
      { projectId: store.listProjects()[2].id, worktreePath: "/tmp/p3", role: "additional" },
    ],
  })).rejects.toThrow(/not a member of stack/u)
})

test("createChat rejects primary projectId not equal to top-level projectId arg", async () => {
  const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
  const stack = await store.createStack("X", [p1, p2])
  await expect(store.createChat(p1, {
    stackId: stack.id,
    stackBindings: [
      { projectId: p2, worktreePath: "/tmp/p2", role: "primary" },
      { projectId: p1, worktreePath: "/tmp/p1", role: "additional" },
    ],
  })).rejects.toThrow(/Primary binding projectId/u)
})

test("createChat rejects empty worktreePath", async () => {
  const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
  const stack = await store.createStack("X", [p1, p2])
  await expect(store.createChat(p1, {
    stackId: stack.id,
    stackBindings: [
      { projectId: p1, worktreePath: "", role: "primary" },
      { projectId: p2, worktreePath: "/tmp/p2", role: "additional" },
    ],
  })).rejects.toThrow(/worktreePath/u)
})
```

**Step 4: Run all stack-method tests**

```bash
bun test src/server/event-store.stack-methods.test.ts
```

Expected: all green. Existing replay determinism test still passes.

**Step 5: Replay test for chat with stack bindings**

Add one more test:

```ts
test("Replay preserves chat stackId and stackBindings", async () => {
  const dir = await createTempDataDir()
  const store1 = new EventStore(dir)
  await store1.initialize()
  const pa = await store1.openProject("/tmp/a", "A")
  const pb = await store1.openProject("/tmp/b", "B")
  const stack = await store1.createStack("X", [pa.id, pb.id])
  const chat = await store1.createChat(pa.id, {
    stackId: stack.id,
    stackBindings: [
      { projectId: pa.id, worktreePath: "/tmp/a", role: "primary" },
      { projectId: pb.id, worktreePath: "/tmp/b", role: "additional" },
    ],
  })

  const store2 = new EventStore(dir)
  await store2.initialize()
  const replayed = store2.getChat(chat.id)
  expect(replayed?.stackId).toBe(stack.id)
  expect(replayed?.stackBindings).toEqual(chat.stackBindings)
})
```

If `EventStore` does not expose `getChat`, look at the existing test patterns for how chats are read back (search: `grep -n "getChat\|listChats" src/server/event-store.ts`). Use whichever public reader exists; if none, add a tiny `getChat(chatId: string): ChatRecord | null` reader as part of this commit.

**Step 6: Run**

```bash
bun test src/server/event-store.stack-methods.test.ts
```

Expected: green.

**Step 7: Commit (covers Tasks 3 + 4)**

```bash
git add src/server/event-store.ts src/server/event-store.stack-methods.test.ts
git commit -m "feat(stacks): bind chat creation to a stack with worktreePath bindings"
```

---

## Task 5: Extend `chat.create` WS command (TDD)

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/server/ws-router.ts`
- Modify: `src/server/ws-router.stack.test.ts`

**Step 1: Protocol**

Find `chat.create` in `ClientCommand` union (~line 113 of `protocol.ts`). Replace:

```ts
| { type: "chat.create"; projectId: string }
```

with:

```ts
| {
    type: "chat.create"
    projectId: string
    stackId?: string
    stackBindings?: Array<{ projectId: string; worktreePath: string; role: "primary" | "additional" }>
  }
```

**Step 2: Failing test**

Append to `ws-router.stack.test.ts`:

```ts
test("chat.create with stack args persists bindings on the chat", async () => {
  // build EventStore + 2 projects + stack
  // send chat.create with stackId + bindings
  // assert ack returns chatId and store.getChat(chatId).stackBindings matches
})

test("chat.create rejects bindings violating invariants (e.g. no primary)", async () => {
  // expect error ack
})
```

Use the same EventStore-backed `createWsRouter` harness as the existing `ws-router.stack.test.ts`.

**Step 3: Wire the handler**

In `ws-router.ts`, find the existing `case "chat.create"` (~line 1366). Change:

```ts
case "chat.create": {
  const chat = await store.createChat(command.projectId)
  ...
}
```

to:

```ts
case "chat.create": {
  const chat = await store.createChat(command.projectId, {
    stackId: command.stackId,
    stackBindings: command.stackBindings,
  })
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { chatId: chat.id } })
  resolvedAnalytics.track("chat_created")
  await broadcastChatAndSidebar(chat.id)
  return
}
```

The `createChat` validation does the heavy lifting; the router only forwards.

**Step 4: Run**

```bash
bun test src/server/ws-router.stack.test.ts src/server/ws-router.test.ts
```

Expected: all green. Existing `chat.create` callers without stack args still work because both fields are optional.

**Step 5: Commit**

```bash
git add src/shared/protocol.ts src/server/ws-router.ts src/server/ws-router.stack.test.ts
git commit -m "feat(stacks): accept stack args on chat.create WS command"
```

---

## Task 6: Agent spawn — Claude `additionalDirectories`

**Files:**
- Modify: `src/server/agent.ts`

**Step 1: Locate the Claude spawn site**

The SDK `query(...)` call lives at `agent.ts:659–684`. The current `cwd: args.localPath` line is at 662.

Trace `args.localPath`. The `startClaudeSession` signature lives at `agent.ts:121–130`. It passes `localPath: string` (the project root). For stack chats, the primary's `worktreePath` should be used as `cwd`, and peer paths should be passed as `additionalDirectories`.

**Step 2: Extend the spawn args**

Update the `startClaudeSession` arg interface (around line 121):

```ts
startClaudeSession?: (args: {
  projectId: string
  localPath: string
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  additionalDirectories?: string[]                // NEW
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
}) => Promise<ClaudeSessionHandle>
```

Update the `query({ options: { ... } })` block (lines 661–684) to thread through `additionalDirectories` when present:

```ts
options: {
  cwd: args.localPath,
  ...(args.additionalDirectories && args.additionalDirectories.length > 0
    ? { additionalDirectories: args.additionalDirectories }
    : {}),
  // existing fields...
}
```

Verify the option name against the Claude Agent SDK docs (verified in design doc — `additionalDirectories: string[]`, default `[]`).

**Step 3: Map chat bindings → spawn args**

Find every call site that builds the `startClaudeSession` args (search: `grep -n "startClaudeSession\b" src/server/agent.ts`). At each call, when `chat.stackBindings` is present:

1. Find the binding with `role === "primary"` — use its `worktreePath` as `localPath` (the SDK `cwd`).
2. Map all `role === "additional"` bindings to `additionalDirectories`.

If `chat.stackBindings` is absent, behavior is unchanged: `localPath = project.localPath`, no `additionalDirectories`.

**Step 4: Map for Codex**

Codex App Server protocol has no `additionalDirectories`. For Codex stack chats:

- Set `cwd` to the primary's `worktreePath` (same as Claude).
- Do NOT pass anything for peer paths. Cross-root writes will trigger the existing `grantRoot` approval surface per file.

The Codex spawn site is at `agent.ts:1190` (`this.codexManager.startSession({ cwd: project.localPath, ... })`). Replace `project.localPath` with the resolved primary path (same helper used above).

**Step 5: Helper extraction**

The primary-resolution logic is needed in both Claude and Codex sites. Extract:

```ts
function resolveSpawnPaths(chat: ChatRecord, fallbackLocalPath: string): { cwd: string; additionalDirectories: string[] } {
  if (!chat.stackBindings || chat.stackBindings.length === 0) {
    return { cwd: fallbackLocalPath, additionalDirectories: [] }
  }
  const primary = chat.stackBindings.find((b) => b.role === "primary")
  if (!primary) {
    throw new Error(`Chat ${chat.id} has stackBindings but no primary`)
  }
  const additionalDirectories = chat.stackBindings
    .filter((b) => b.role === "additional")
    .map((b) => b.worktreePath)
  return { cwd: primary.worktreePath, additionalDirectories }
}
```

Place near the top of `agent.ts` after the imports. Use it at both spawn sites.

**Step 6: Tests**

Add `src/server/agent.stack-spawn.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { resolveSpawnPaths } from "./agent"          // export the helper

describe("resolveSpawnPaths", () => {
  test("solo chat returns fallback cwd, no additionalDirectories", () => {
    const result = resolveSpawnPaths({ id: "c1", stackBindings: undefined } as any, "/proj")
    expect(result).toEqual({ cwd: "/proj", additionalDirectories: [] })
  })

  test("stack chat returns primary path as cwd and peer paths as additionalDirectories", () => {
    const result = resolveSpawnPaths(
      { id: "c1", stackBindings: [
        { projectId: "p1", worktreePath: "/be", role: "primary" },
        { projectId: "p2", worktreePath: "/fe", role: "additional" },
      ] } as any,
      "/fallback",
    )
    expect(result).toEqual({ cwd: "/be", additionalDirectories: ["/fe"] })
  })

  test("missing primary throws", () => {
    expect(() => resolveSpawnPaths(
      { id: "c1", stackBindings: [
        { projectId: "p1", worktreePath: "/be", role: "additional" },
      ] } as any,
      "/fallback",
    )).toThrow(/no primary/u)
  })
})
```

If integration-level tests of `agent.ts` already exist (search: `ls src/server/agent.test.ts`), add one end-to-end test that constructs an `AgentCoordinator` with a `startClaudeSession` stub and asserts the stub is called with the expected `additionalDirectories`. Stub shape: `vi.fn() / mock()` per Bun test conventions.

**Step 7: Run**

```bash
bun test src/server/agent.stack-spawn.test.ts src/server/agent.test.ts
```

Expected: green. No new tsc errors.

**Step 8: Commit**

```bash
git add src/server/agent.ts src/server/agent.stack-spawn.test.ts
git commit -m "feat(stacks): map stack bindings to spawn cwd + additionalDirectories"
```

---

## Task 7: Read-model `resolvedBindings` on chat snapshot

**Files:**
- Modify: `src/shared/types.ts` (extend `ChatSnapshot`)
- Modify: `src/server/read-models.ts` (`deriveChatSnapshot`, ~line 246)
- Modify: `src/server/read-models.test.ts`

**Step 1: Extend `ChatSnapshot`**

Find `ChatSnapshot` in `src/shared/types.ts` (~line 1207). Add:

```ts
export interface ChatSnapshot {
  // existing fields...
  resolvedBindings?: Array<{
    projectId: string
    projectTitle: string
    worktreePath: string
    role: "primary" | "additional"
    projectStatus: "active" | "missing"
  }>
}
```

`projectStatus` is `"missing"` when the bound `projectId` has been removed; this is the Phase 1 design's orphan signal. Worktree branch and dirty status are deferred to Phase 3 (UI fetches via `worktree-store` on demand).

**Step 2: Failing test**

Add to `read-models.test.ts`:

```ts
test("chat snapshot includes resolvedBindings when chat has stackBindings", () => {
  const state = createEmptyState()
  state.projectsById.set("p1", { id: "p1", localPath: "/p1", title: "Backend", createdAt: 1, updatedAt: 1 })
  state.projectsById.set("p2", { id: "p2", localPath: "/p2", title: "Frontend", createdAt: 1, updatedAt: 1 })
  state.chatsById.set("c1", {
    id: "c1",
    projectId: "p1",
    title: "Integration",
    createdAt: 1,
    updatedAt: 1,
    unread: false,
    provider: "claude",
    planMode: false,
    sessionToken: null,
    sourceHash: null,
    lastTurnOutcome: null,
    stackId: "s1",
    stackBindings: [
      { projectId: "p1", worktreePath: "/p1", role: "primary" },
      { projectId: "p2", worktreePath: "/p2", role: "additional" },
    ],
  })
  const snapshot = deriveChatSnapshot(state, "c1", /* other args matching existing signature */)
  expect(snapshot?.resolvedBindings).toEqual([
    { projectId: "p1", projectTitle: "Backend", worktreePath: "/p1", role: "primary", projectStatus: "active" },
    { projectId: "p2", projectTitle: "Frontend", worktreePath: "/p2", role: "additional", projectStatus: "active" },
  ])
})

test("chat snapshot marks missing projects as projectStatus: missing", () => {
  // same setup but p2 has deletedAt set
  // expect that binding's projectStatus === "missing", projectTitle still surfaces the original title
})

test("chat snapshot omits resolvedBindings when stackBindings is undefined", () => {
  // pure solo chat — assert snapshot.resolvedBindings is undefined
})
```

Match the existing `deriveChatSnapshot` signature exactly — its current arg list is wider than just `state` and `chatId`. Read its definition first: `sed -n '246,290p' src/server/read-models.ts`.

**Step 3: Run**

```bash
bun test src/server/read-models.test.ts -t resolvedBindings
```

Expected: FAIL.

**Step 4: Implement in `deriveChatSnapshot`**

Inside the function, after the existing snapshot object is built and before it is returned, add:

```ts
if (chat.stackBindings && chat.stackBindings.length > 0) {
  snapshot.resolvedBindings = chat.stackBindings.map((binding) => {
    const project = state.projectsById.get(binding.projectId)
    const projectStatus: "active" | "missing" = project && !project.deletedAt ? "active" : "missing"
    return {
      projectId: binding.projectId,
      projectTitle: project?.title ?? "(missing)",
      worktreePath: binding.worktreePath,
      role: binding.role,
      projectStatus,
    }
  })
}
```

Adjust to the actual variable name `deriveChatSnapshot` uses for the snapshot under construction.

**Step 5: Run**

```bash
bun test src/server/read-models.test.ts
```

Expected: all green.

**Step 6: Commit**

```bash
git add src/shared/types.ts src/server/read-models.ts src/server/read-models.test.ts
git commit -m "feat(stacks): expose resolvedBindings on chat snapshot"
```

---

## Task 8: Update parent design doc

**Files:**
- Modify: `docs/plans/2026-05-11-stack-multi-repo-design.md`

Replace `worktreeId` with `worktreePath` in the StackBinding shape and adjacent text. Note in a small "Phase 2 amendments" section near the bottom:

> Phase 2 bound stacks by `worktreePath` rather than `worktreeId` because worktree state is not yet in the event store. When the `feat/worktree-events` work lands, a follow-up migration can resolve paths to ids.

Single edit, no code. Commit:

```bash
git add docs/plans/2026-05-11-stack-multi-repo-design.md
git commit -m "docs(stacks): bind by worktreePath in Phase 2 (worktree-events deferred)"
```

---

## Task 9: Full-suite verification

```bash
bun test --timeout 30000
bun x tsc --noEmit 2>&1 | grep -v sonner | head
```

Expected:
- `bun test --timeout 30000`: 1207 (Phase 1 baseline) + N new tests from Tasks 3–7 all green; zero fail.
- `bun x tsc --noEmit`: only the 3 pre-existing `sonner` errors. Any other error blocks the PR — stop and ask.

If `bun test` is flaky on uploads/diff-store (known timeout flakes from Phase 1), the `--timeout 30000` flag matches CI and should resolve them.

---

## Task 10: Push + PR

```bash
git push -u origin feat/stack-phase2
gh pr create --repo cuongtranba/kanna --base feat/stack-phase1 --head feat/stack-phase2 \
  --title "feat(stacks): Phase 2 — chat bindings + agent spawn wiring" \
  --body "$(cat <<'EOF'
## Summary
- Extends \`chat_created\` event and \`ChatRecord\` with optional \`stackId\` and \`stackBindings\` (\`{ projectId, worktreePath, role }[]\`).
- \`createChat(projectId, { stackId, stackBindings })\` validates invariants (one primary, member-of-stack, primary projectId matches, non-empty paths).
- \`chat.create\` WS command accepts stack args symmetrically.
- Agent spawn maps the primary binding to SDK \`cwd\` and peer bindings to Claude SDK \`additionalDirectories\`. Codex falls back to single \`cwd\` + per-write \`grantRoot\` approvals (protocol has no peer-roots field).
- \`deriveChatSnapshot\` emits \`resolvedBindings\` with project title and active/missing status. Worktree branch + dirty status deferred to Phase 3 (UI fetches via worktree-store).

## Binding key
Bindings reference worktrees by absolute \`worktreePath\` rather than a \`worktreeId\` because worktree state is not yet in the event store. The \`feat/worktree-events\` branch (currently plan-only) would add it; once shipped, a follow-up migration can swap paths for ids.

## Test plan
- [x] \`bun test --timeout 30000\` green.
- [x] \`bun x tsc --noEmit\` only the 3 pre-existing sonner errors.
- [x] New tests: createChat validation, chat_created replay with bindings, resolveSpawnPaths helper, chat snapshot resolvedBindings, ws-router chat.create with stack args.
- [ ] Manual: send a chat.create over WS with bindings, confirm Claude session receives \`additionalDirectories\`.

## Out of scope (Phase 3)
- All client UI (StacksSection, inline creation panel, peer strip).
- Keybindings.
- Re-binding peers on live chat.
EOF
)"
```

**Base branch is `feat/stack-phase1`**, not `main`, because Phase 2 depends on Phase 1 code. Once Phase 1 (#48) merges into main, rebase or change the base to main.

---

## Done-when checklist

- [ ] All 8 commits landed in order.
- [ ] `bun test --timeout 30000` green.
- [ ] PR open against `feat/stack-phase1` (or `main` once Phase 1 merges).
- [ ] Design doc updated to say `worktreePath`.
- [ ] Phase 3 plan not yet written — separate session.

---

## Notes for the executor

- **One commit per task** (Tasks 3+4 share a commit by design — the apply-side and the create-side are co-dependent).
- **Strong typing** (from global CLAUDE.md): no `any`, no `unknown` without narrowing. Test fixtures may use `as any` to short-circuit `ChatRecord` construction; that is acceptable in tests only.
- **Subprocess hygiene** (from project CLAUDE.md): no new git spawns in Phase 2. If a test does spawn, set `stdin: "ignore"`, `GIT_TERMINAL_PROMPT=0`, explicit `30_000` timeout.
- **Pre-existing failures**: `uploads`, `diff-store` tests fail under concurrent load at the Bun 5s default. Use `--timeout 30000` to match CI. If a new failure appears in stack tests, stop and ask.
- **Codex semantics**: do not invent a peer-root field for Codex App Server. The protocol does not have one. Document this in the PR body so reviewers see the design choice.
- **agent.ts is the riskiest file in the diff.** Read the existing spawn flow end-to-end before editing. The `additionalDirectories` thread-through should be the smallest possible change.
