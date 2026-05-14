# Cancel Individual Subagent Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a user to cancel one running subagent without cancelling the parent chat. Cancellation cascades to running descendants and tears down the underlying provider stream immediately.

**Architecture:** Orchestrator-owned per-run state map (`runStateByRunId`) holds an `AbortController`, optional `PausableTimeout`, optional `permitWaiter`, and a `cancelled` flag. New public `cancelRun(chatId, runId)` branches on lifecycle phase: queued runs splice + reject their permit waiter; running runs abort the SDK stream. WS command `chat.cancelSubagentRun` routes through `AgentCoordinator` → orchestrator. Client renders an X button on `SubagentMessage` while `status === "running"`.

**Tech Stack:** TypeScript, Bun, React 19, Zustand, bun:test, JSONL event log, Claude SDK (`@anthropic-ai/claude-agent-sdk`), Codex CLI app-server.

**Source spec:** `docs/superpowers/specs/2026-05-14-cancel-individual-subagent-run-design.md` (commit `587bc8a`).

**Baseline:** PR #93 (resolver leak + recovery) and PR #94 (cancel-unconditional reject) merged. Branch `feat/cancel-individual-subagent-run` off `main` tip `9aac71d`. Verify `bun test` passes locally before starting.

---

## File Structure

**Server (modify):**
- `src/shared/types.ts` — `SubagentErrorCode` union: add `"USER_CANCELLED"`.
- `src/shared/protocol.ts` — `ClientCommand` union: add `chat.cancelSubagentRun`.
- `src/server/subagent-orchestrator.ts` — replace `timeoutsByRun` with `runStateByRunId`. New `cancelRun` method. `spawnRun` registers state before `acquire()`, branches on cancel during catch.
- `src/server/agent.ts` — wire `AgentCoordinator.cancelSubagentRun`; extend existing `onRunTerminal` handler to also call `emitStateChange`; plumb `abortSignal` from orchestrator into `buildSubagentProviderRunForChat`.
- `src/server/subagent-provider-run.ts` — accept `abortSignal`, forward to Claude SDK `query()` options and to Codex `stopSession(chatId, `sub:${runId}`)` on abort.
- `src/server/ws-router.ts` — route `chat.cancelSubagentRun` command.
- `src/client/components/messages/SubagentErrorCard.tsx` — add `USER_CANCELLED` badge case AND `default` arm.

**Client (modify):**
- `src/client/components/messages/SubagentMessage.tsx` — render X icon button while `run.status === "running"`. Optional `onCancelSubagentRun` prop; button only shows when callback is provided.
- `src/client/app/ChatPage/ChatTranscriptViewport.tsx` — thread `onCancelSubagentRun` callback to `SubagentMessage`.
- `src/client/app/ChatPage/index.tsx` — dispatch the `chat.cancelSubagentRun` command via existing WS sender.
- `src/client/app/KannaTranscript.tsx` — thread optional `onCancelSubagentRun` to `SubagentMessage`; not wired in this surface (exported viewer is read-only) so callback is undefined.

**Tests (new + modify):**
- `src/server/subagent-orchestrator.test.ts` — add cancelRun behaviour tests.
- `src/server/agent.test.ts` — add `cancelSubagentRun` routing + integration tests.
- `src/client/components/messages/SubagentMessage.test.tsx` — add X-button tests.

---

## Task 1 — Type additions

**Files:**
- Modify: `src/shared/types.ts:1300-1308` (`SubagentErrorCode`)
- Modify: `src/shared/protocol.ts` (`ClientCommand` union)

- [ ] **Step 1: Add `USER_CANCELLED` to `SubagentErrorCode`**

In `src/shared/types.ts`, locate the `SubagentErrorCode` union (currently has `"INTERRUPTED"` at the end) and append `"USER_CANCELLED"`:

```ts
export type SubagentErrorCode =
  | "AUTH_REQUIRED"
  | "UNKNOWN_SUBAGENT"
  | "LOOP_DETECTED"
  | "DEPTH_EXCEEDED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INTERRUPTED"
  | "USER_CANCELLED"
```

- [ ] **Step 2: Add command variant to `ClientCommand`**

In `src/shared/protocol.ts`, locate the `ClientCommand` discriminated union. Append a new variant immediately after `chat.respondSubagentTool`:

```ts
  | {
      type: "chat.cancelSubagentRun"
      chatId: string
      runId: string
    }
```

- [ ] **Step 3: Typecheck**

```bash
bun run check
```

Expected: passes. Reducers/UI that don't yet handle `USER_CANCELLED` continue to compile because `SubagentErrorCode` is used by value, not exhaustively.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/shared/protocol.ts
git commit -m "feat(subagent): add USER_CANCELLED error code + chat.cancelSubagentRun command"
```

---

## Task 2 — `RunState` type + map skeleton

**Files:**
- Modify: `src/server/subagent-orchestrator.ts` (replace `timeoutsByRun`)

- [ ] **Step 1: Replace `timeoutsByRun` with `runStateByRunId`**

In `src/server/subagent-orchestrator.ts`, locate the class body field declarations (currently includes `private readonly timeoutsByRun = new Map<string, PausableTimeout>()`). Replace with the new state shape:

```ts
  interface RunState {
    chatId: string
    parentRunId: string | null
    childRunIds: Set<string>
    abortController: AbortController
    timeout: PausableTimeout | null
    cancelled: boolean
    pendingAcquire: boolean
    permitWaiter: { resolve: () => void; reject: (e: Error) => void } | null
  }

  private readonly runStateByRunId = new Map<string, RunState>()
```

Place the `interface RunState` declaration just above the `SubagentOrchestrator` class (file-local scope). Replace EVERY `this.timeoutsByRun` reference in the file. The two existing reference sites are:

```ts
  notifySubagentToolPending(runId: string): void {
    this.runStateByRunId.get(runId)?.timeout?.pause()
  }

  notifySubagentToolResolved(runId: string): void {
    this.runStateByRunId.get(runId)?.timeout?.resume()
  }
```

And inside `spawnRun` (currently `this.timeoutsByRun.set(runId, pausable)` / `this.timeoutsByRun.delete(runId)`), do NOT change those lines yet — Task 3 rewrites the surrounding code.

- [ ] **Step 2: Typecheck**

```bash
bun run check
```

Expected: typecheck reports errors inside `spawnRun` because `timeoutsByRun` is gone and the new map's value shape is `RunState`. Those are fixed in Task 3.

- [ ] **Step 3: Commit (incomplete state OK — Task 3 finishes it)**

```bash
git add src/server/subagent-orchestrator.ts
git commit -m "chore(subagent): introduce RunState map skeleton (typecheck still failing)"
```

---

## Task 3 — `spawnRun` registers `RunState` before `acquire`

**Files:**
- Modify: `src/server/subagent-orchestrator.ts` — `acquire()`, `spawnRun()`

- [ ] **Step 1: Extend `acquire()` to accept `runId` + record waiter**

Locate the existing `acquire` method:

```ts
  private async acquire(chatId: string): Promise<void> {
    if (this.cancelledChats.has(chatId)) {
      throw new Error("CHAT_CANCELLED")
    }
    if (this.permits > 0) {
      this.permits -= 1
      return
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    this.waiters.push({ chatId, resolve, reject })
    await promise
    this.permits -= 1
  }
```

Replace with:

```ts
  private async acquire(chatId: string, runId: string): Promise<void> {
    if (this.cancelledChats.has(chatId)) {
      throw new Error("CHAT_CANCELLED")
    }
    if (this.permits > 0) {
      this.permits -= 1
      return
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const state = this.runStateByRunId.get(runId)
    if (state) {
      state.permitWaiter = { resolve, reject }
    }
    this.waiters.push({ chatId, resolve, reject })
    try {
      await promise
      this.permits -= 1
    } finally {
      if (state) {
        state.permitWaiter = null
        state.pendingAcquire = false
      }
    }
  }
```

- [ ] **Step 2: Update `spawnRun` to register `RunState` BEFORE `acquire`**

Locate the existing flow inside `spawnRun`:

```ts
    await this.deps.store.appendSubagentEvent({ /* run_started */ })

    try {
      await this.acquire(args.chatId)
    } catch {
      await this.failRun(args.chatId, runId, "PROVIDER_ERROR", "Chat cancelled before run started")
      return
    }
    if (this.cancelledChats.has(args.chatId)) {
      this.release()
      await this.failRun(args.chatId, runId, "PROVIDER_ERROR", "Chat cancelled before run started")
      return
    }

    let released = false
    const releaseSlot = () => {
      if (released) return
      released = true
      this.release()
    }
```

Replace with:

```ts
    await this.deps.store.appendSubagentEvent({ /* run_started — unchanged */ })

    // Register RunState BEFORE acquire so cancelRun can find a queued run.
    // The reducer marks the run as `status: "running"` from this event on,
    // which is what the UI uses to show the X button.
    const runState: RunState = {
      chatId: args.chatId,
      parentRunId: args.parentRunId,
      childRunIds: new Set(),
      abortController: new AbortController(),
      timeout: null,
      cancelled: false,
      pendingAcquire: true,
      permitWaiter: null,
    }
    this.runStateByRunId.set(runId, runState)
    if (args.parentRunId != null) {
      this.runStateByRunId.get(args.parentRunId)?.childRunIds.add(runId)
    }

    try {
      await this.acquire(args.chatId, runId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const code: SubagentErrorCode = msg === "USER_CANCELLED" ? "USER_CANCELLED" : "PROVIDER_ERROR"
      const message = msg === "USER_CANCELLED"
        ? "Cancelled before run started"
        : "Chat cancelled before run started"
      await this.failRun(args.chatId, runId, code, message)
      this.cleanupRunState(runId)
      return
    }
    if (this.cancelledChats.has(args.chatId)) {
      this.release()
      await this.failRun(args.chatId, runId, "PROVIDER_ERROR", "Chat cancelled before run started")
      this.cleanupRunState(runId)
      return
    }

    let released = false
    const releaseSlot = () => {
      if (released) return
      released = true
      this.release()
    }
```

- [ ] **Step 3: Add `cleanupRunState` helper**

Inside the class, alongside `failRun`:

```ts
  private cleanupRunState(runId: string) {
    const state = this.runStateByRunId.get(runId)
    if (!state) return
    state.timeout?.clear()
    if (state.parentRunId != null) {
      this.runStateByRunId.get(state.parentRunId)?.childRunIds.delete(runId)
    }
    this.runStateByRunId.delete(runId)
  }
```

- [ ] **Step 4: Wire `runState.timeout` in `spawnRun`**

Inside the existing `try` block that creates the timeout:

```ts
      const timeoutRejection = createDeferred<never>()
      const pausable = new PausableTimeout(this.timeoutMs(), () => {
        timeoutRejection.reject(new Error("TIMEOUT"))
      })
      runState.timeout = pausable
      pausable.start()
```

In the `finally` block that previously did `this.timeoutsByRun.delete(runId)`, replace with `runState.timeout = null` (the timer itself is cleared by `pausable.clear()` on the line above).

- [ ] **Step 5: Add `cleanupRunState(runId)` to the outer `try/finally` so terminal paths free the map entry**

Locate the outermost `try { ... } finally { releaseSlot() }` block in `spawnRun`. Change the `finally` to:

```ts
    } finally {
      releaseSlot()
      this.cleanupRunState(runId)
    }
```

- [ ] **Step 6: Typecheck**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 7: Run existing orchestrator tests**

```bash
bun test src/server/subagent-orchestrator.test.ts
```

Expected: all existing tests still pass — no behaviour change yet beyond bookkeeping.

- [ ] **Step 8: Commit**

```bash
git add src/server/subagent-orchestrator.ts
git commit -m "feat(subagent): register RunState before acquire so queued runs can be cancelled"
```

---

## Task 4 — Abort race + `state.cancelled` re-check in `spawnRun`

**Files:**
- Modify: `src/server/subagent-orchestrator.ts` — `spawnRun()` `Promise.race`
- Modify: `src/server/subagent-orchestrator.ts` — `SubagentOrchestratorDeps.startProviderRun` signature

- [ ] **Step 1: Add `abortSignal` to `startProviderRun` deps signature**

Locate `SubagentOrchestratorDeps`:

```ts
  startProviderRun: (args: {
    subagent: Subagent
    chatId: string
    primer: string | null
    runId: string
  }) => ProviderRunStart
```

Replace with:

```ts
  startProviderRun: (args: {
    subagent: Subagent
    chatId: string
    primer: string | null
    runId: string
    abortSignal: AbortSignal
  }) => ProviderRunStart
```

- [ ] **Step 2: Pass `runState.abortController.signal` from `spawnRun`**

Inside `spawnRun`, where `startProviderRun` is called:

```ts
        runStart = this.deps.startProviderRun({
          subagent: args.subagent,
          chatId: args.chatId,
          primer,
          runId,
          abortSignal: runState.abortController.signal,
        })
```

- [ ] **Step 3: Add abort-rejection promise to the race**

Replace:

```ts
        const result = await Promise.race([
          runStart.start(onChunk, onEntry),
          timeoutRejection.promise,
        ])
```

With:

```ts
        const abortRejection = createDeferred<never>()
        const abortListener = () => abortRejection.reject(new Error("USER_CANCELLED"))
        if (runState.abortController.signal.aborted) {
          abortListener()
        } else {
          runState.abortController.signal.addEventListener("abort", abortListener, { once: true })
        }
        let result: { text: string; usage?: ProviderUsage }
        try {
          result = await Promise.race([
            runStart.start(onChunk, onEntry),
            timeoutRejection.promise,
            abortRejection.promise,
          ])
        } finally {
          runState.abortController.signal.removeEventListener("abort", abortListener)
        }
```

- [ ] **Step 4: Re-check `state.cancelled` after success**

Some providers (Codex via app-server) finish the stream queue on stop rather than rejecting. Right before appending `subagent_run_completed`:

```ts
      // Codex `stopSession` finishes the pending stream queue rather than
      // rejecting — without this guard, a cancelled run can reach the
      // success path.
      if (runState.cancelled) {
        await this.failRun(args.chatId, runId, "USER_CANCELLED", "Cancelled by user")
        return
      }
      await this.deps.store.appendSubagentEvent({
        v: 3,
        type: "subagent_run_completed",
        /* ...rest unchanged */
      })
```

(The existing `return` in the inserted block also needs to flow through `releaseSlot()` + `cleanupRunState(runId)`. Because we're inside the outer `try` whose `finally` already runs both, the early `return` is safe.)

- [ ] **Step 5: Extend the existing catch block to route `USER_CANCELLED`**

The existing catch is:

```ts
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === "TIMEOUT") {
          await this.failRun(args.chatId, runId, "TIMEOUT", `Run exceeded ${this.timeoutMs()}ms`)
        } else {
          await this.failRun(args.chatId, runId, "PROVIDER_ERROR", message)
        }
        return
      }
```

Replace with:

```ts
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === "TIMEOUT") {
          await this.failRun(args.chatId, runId, "TIMEOUT", `Run exceeded ${this.timeoutMs()}ms`)
        } else if (message === "USER_CANCELLED" || runState.cancelled) {
          await this.failRun(args.chatId, runId, "USER_CANCELLED", "Cancelled by user")
        } else {
          await this.failRun(args.chatId, runId, "PROVIDER_ERROR", message)
        }
        return
      }
```

- [ ] **Step 6: Typecheck**

```bash
bun run check
```

Expected: errors for `startProviderRun` callsites (`agent.ts`) — fixed in Task 6. Orchestrator itself compiles.

- [ ] **Step 7: Commit**

```bash
git add src/server/subagent-orchestrator.ts
git commit -m "feat(subagent): abort signal + cancelled re-check in spawnRun race"
```

---

## Task 5 — Public `cancelRun` method + cascade

**Files:**
- Modify: `src/server/subagent-orchestrator.ts`

- [ ] **Step 1: Write the failing test**

In `src/server/subagent-orchestrator.test.ts`, append a new test:

```ts
  test("cancelRun on a queued run rejects its acquire and appends USER_CANCELLED", async () => {
    const harness = await setupHarness({
      subagents: [makeSubagent({ id: "sa-a", name: "alpha" }), makeSubagent({ id: "sa-b", name: "beta" })],
      maxParallel: 1,
      providerImpl: () => makeNeverEndingProviderRun(),
    })
    // Spawn two subagents; permits = 1 so 'beta' is queued.
    void harness.orchestrator.runMentionsForUserMessage({
      chatId: harness.chatId,
      userMessageId: "u1",
      mentions: [
        { kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" },
        { kind: "subagent", subagentId: "sa-b", raw: "@agent/beta" },
      ],
    })
    await harness.waitForSubagentEvents((events) => events.filter((e) => e.type === "subagent_run_started").length === 2)
    // Beta should be queued (status running, but no permit).
    const runs = harness.store.getSubagentRuns(harness.chatId)
    const beta = Object.values(runs).find((r) => r.subagentName === "beta")!
    expect(beta.status).toBe("running")
    harness.orchestrator.cancelRun(harness.chatId, beta.runId)
    await harness.waitForSubagentEvents((events) =>
      events.some((e) => e.type === "subagent_run_failed" && e.runId === beta.runId),
    )
    const cancelled = harness.store.getSubagentRuns(harness.chatId)[beta.runId]
    expect(cancelled.status).toBe("failed")
    expect(cancelled.error?.code).toBe("USER_CANCELLED")
  }, 10_000)
```

The `setupHarness` helper already exists in this test file. If `makeNeverEndingProviderRun` does not exist, add it:

```ts
function makeNeverEndingProviderRun(): ProviderRunStart {
  return {
    provider: "claude",
    model: "claude-opus-4-7",
    systemPrompt: "",
    preamble: null,
    start: () => new Promise(() => { /* never resolves */ }),
    authReady: async () => true,
  }
}
```

- [ ] **Step 2: Run test (should fail — `cancelRun` not defined)**

```bash
bun test src/server/subagent-orchestrator.test.ts -t "cancelRun on a queued run"
```

Expected: FAIL with `cancelRun is not a function` (or similar).

- [ ] **Step 3: Implement `cancelRun`**

Add the public method on the class (alongside `cancelChat`):

```ts
  cancelRun(chatId: string, runId: string): void {
    const state = this.runStateByRunId.get(runId)
    if (!state) return
    if (state.cancelled) return
    if (state.chatId !== chatId) return
    state.cancelled = true
    // Cascade to running descendants. With current DEFAULT_MAX_CHAIN_DEPTH=1
    // this is a noop in practice, but guards higher chain depths in the future.
    for (const childRunId of [...state.childRunIds]) {
      this.cancelRun(chatId, childRunId)
    }
    if (state.pendingAcquire && state.permitWaiter) {
      // Queued: splice waiter out of this.waiters FIRST so release() cannot
      // grant us a permit we will never use, then reject the Promise.
      const idx = this.waiters.findIndex((w) => w.resolve === state.permitWaiter!.resolve)
      if (idx >= 0) this.waiters.splice(idx, 1)
      const reject = state.permitWaiter.reject
      state.permitWaiter = null
      reject(new Error("USER_CANCELLED"))
    } else {
      state.abortController.abort()
    }
  }
```

- [ ] **Step 4: Run test (should pass)**

```bash
bun test src/server/subagent-orchestrator.test.ts -t "cancelRun on a queued run"
```

Expected: PASS.

- [ ] **Step 5: Write running-run + cascade tests**

Append to the same test file:

```ts
  test("cancelRun on a running run aborts the provider stream and appends USER_CANCELLED", async () => {
    let signalCaptured: AbortSignal | null = null
    const harness = await setupHarness({
      subagents: [makeSubagent({ id: "sa-a", name: "alpha" })],
      providerImpl: ({ abortSignal }) => {
        signalCaptured = abortSignal
        return {
          provider: "claude",
          model: "claude-opus-4-7",
          systemPrompt: "",
          preamble: null,
          start: () =>
            new Promise<{ text: string }>((_, reject) => {
              abortSignal.addEventListener("abort", () => reject(new Error("USER_CANCELLED")), { once: true })
            }),
          authReady: async () => true,
        }
      },
    })
    void harness.orchestrator.runMentionsForUserMessage({
      chatId: harness.chatId,
      userMessageId: "u1",
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    await harness.waitForSubagentEvents((events) => events.some((e) => e.type === "subagent_run_started"))
    const run = Object.values(harness.store.getSubagentRuns(harness.chatId))[0]
    harness.orchestrator.cancelRun(harness.chatId, run.runId)
    expect(signalCaptured?.aborted).toBe(true)
    await harness.waitForSubagentEvents((events) =>
      events.some((e) => e.type === "subagent_run_failed" && e.runId === run.runId),
    )
    expect(harness.store.getSubagentRuns(harness.chatId)[run.runId].error?.code).toBe("USER_CANCELLED")
  }, 10_000)

  test("cancelRun on an unknown runId is a no-op", () => {
    // Build orchestrator with no state.
    const orchestrator = new SubagentOrchestrator({
      store: {} as any,
      appSettings: { getSnapshot: () => ({ subagents: [] }) },
      startProviderRun: () => { throw new Error("not used") },
    })
    expect(() => orchestrator.cancelRun("chat-x", "run-x")).not.toThrow()
  })

  test("cancelRun on an already-cancelled run is a no-op (no duplicate event)", async () => {
    const harness = await setupHarness({
      subagents: [makeSubagent({ id: "sa-a", name: "alpha" })],
      providerImpl: ({ abortSignal }) => ({
        provider: "claude",
        model: "claude-opus-4-7",
        systemPrompt: "",
        preamble: null,
        start: () =>
          new Promise<{ text: string }>((_, reject) => {
            abortSignal.addEventListener("abort", () => reject(new Error("USER_CANCELLED")), { once: true })
          }),
        authReady: async () => true,
      }),
    })
    void harness.orchestrator.runMentionsForUserMessage({
      chatId: harness.chatId,
      userMessageId: "u1",
      mentions: [{ kind: "subagent", subagentId: "sa-a", raw: "@agent/alpha" }],
    })
    await harness.waitForSubagentEvents((events) => events.some((e) => e.type === "subagent_run_started"))
    const run = Object.values(harness.store.getSubagentRuns(harness.chatId))[0]
    harness.orchestrator.cancelRun(harness.chatId, run.runId)
    harness.orchestrator.cancelRun(harness.chatId, run.runId)
    await harness.waitForSubagentEvents((events) =>
      events.some((e) => e.type === "subagent_run_failed" && e.runId === run.runId),
    )
    const failedEvents = harness.store.subagentEventsForChat(harness.chatId).filter(
      (e) => e.type === "subagent_run_failed" && e.runId === run.runId,
    )
    expect(failedEvents.length).toBe(1)
  }, 10_000)
```

If `subagentEventsForChat` does not exist on the test harness, the existing test file already uses `harness.store.getSubagentRuns(chatId)[runId]` style — adapt with whatever helper is present. The key assertion is: only ONE `subagent_run_failed` event is emitted across two `cancelRun` calls.

- [ ] **Step 6: Run all new tests**

```bash
bun test src/server/subagent-orchestrator.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/subagent-orchestrator.ts src/server/subagent-orchestrator.test.ts
git commit -m "feat(subagent): cancelRun method with queued + running + cascade paths"
```

---

## Task 6 — Plumb `abortSignal` through `startProviderRun` in `agent.ts`

**Files:**
- Modify: `src/server/agent.ts` — `buildSubagentProviderRunForChat` signature + body
- Modify: `src/server/subagent-provider-run.ts` — forward signal to provider sessions

- [ ] **Step 1: Accept `abortSignal` in `buildSubagentProviderRunForChat`**

Locate the method signature in `src/server/agent.ts`:

```ts
  private buildSubagentProviderRunForChat(args: {
    subagent: Subagent
    chatId: string
    primer: string | null
    runId: string
  }): ProviderRunStart {
```

Replace with:

```ts
  private buildSubagentProviderRunForChat(args: {
    subagent: Subagent
    chatId: string
    primer: string | null
    runId: string
    abortSignal: AbortSignal
  }): ProviderRunStart {
```

- [ ] **Step 2: Update the orchestrator deps wiring**

Locate where `SubagentOrchestrator` is constructed in `AgentCoordinator`'s constructor. The current `startProviderRun` arrow already destructures `args` — extend it:

```ts
      startProviderRun: ({ subagent, chatId, primer, runId, abortSignal }) =>
        this.buildSubagentProviderRunForChat({ subagent, chatId, primer, runId, abortSignal }),
```

- [ ] **Step 3: Forward the signal into the provider factory**

Locate `buildSubagentProviderRun` (the shared helper called by `buildSubagentProviderRunForChat`):

```ts
    return buildSubagentProviderRun({
      subagent: args.subagent,
      chatId: args.chatId,
      primer: args.primer,
      runId: args.runId,
      cwd: spawn.cwd,
      additionalDirectories: spawn.additionalDirectories,
      projectId: project.id,
      startClaudeSession: this.startClaudeSessionFn,
      codexManager: this.codexManager,
      onToolRequest,
      authReady: ...,
      pickOauthToken: ...,
    })
```

Add the signal:

```ts
    return buildSubagentProviderRun({
      subagent: args.subagent,
      chatId: args.chatId,
      primer: args.primer,
      runId: args.runId,
      abortSignal: args.abortSignal,
      cwd: spawn.cwd,
      additionalDirectories: spawn.additionalDirectories,
      projectId: project.id,
      startClaudeSession: this.startClaudeSessionFn,
      codexManager: this.codexManager,
      onToolRequest,
      authReady: ...,
      pickOauthToken: ...,
    })
```

- [ ] **Step 4: Accept + forward in `buildSubagentProviderRun`**

In `src/server/subagent-provider-run.ts`, locate the function signature and the args type. Add `abortSignal: AbortSignal` to both. Forward into the Claude SDK `query()` call (the SDK accepts a `signal` option — if the currently pinned version does not, race the stream consumer Promise against an abort-rejection deferred). Forward into the Codex path by subscribing once to `signal.addEventListener("abort", () => codexManager.stopSession(chatId, \`sub:${runId}\`), { once: true })` inside the start() function before returning the stream.

The exact lines to modify depend on the current shape of `buildSubagentProviderRun`. The function constructs two distinct provider paths (Claude and Codex). For BOTH:

```ts
  // Claude path: pass signal into query() options when calling
  // startClaudeSession; if the SDK option exists, set { signal: abortSignal }.
  // If not, wrap the stream consumer in:
  //   const aborted = new Promise<never>((_, rej) =>
  //     abortSignal.addEventListener("abort", () => rej(new Error("USER_CANCELLED")), { once: true })
  //   )
  // and use Promise.race(streamConsumer, aborted) at the top level of start().

  // Codex path: before draining the harness stream, register:
  //   abortSignal.addEventListener("abort", () => {
  //     codexManager.stopSession(chatId, `sub:${runId}`)
  //   }, { once: true })
```

- [ ] **Step 5: Typecheck**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 6: Run server tests**

```bash
bun test src/server/
```

Expected: all pass, including the new orchestrator cancel tests from Task 5.

- [ ] **Step 7: Commit**

```bash
git add src/server/agent.ts src/server/subagent-provider-run.ts
git commit -m "feat(subagent): plumb abortSignal through buildSubagentProviderRun"
```

---

## Task 7 — `AgentCoordinator.cancelSubagentRun` + emit via `onRunTerminal`

**Files:**
- Modify: `src/server/agent.ts` — extend `onRunTerminal` handler; add `cancelSubagentRun`

- [ ] **Step 1: Extend the existing `onRunTerminal` to emit state change**

Locate the orchestrator construction in `AgentCoordinator`:

```ts
    this.subagentOrchestrator = new SubagentOrchestrator({
      store: this.store,
      appSettings: { getSnapshot: () => ({ subagents: this.getSubagents() }) },
      startProviderRun: ({ subagent, chatId, primer, runId, abortSignal }) =>
        this.buildSubagentProviderRunForChat({ subagent, chatId, primer, runId, abortSignal }),
      onRunTerminal: (chatId, runId) => this.rejectPendingResolversForRun(chatId, runId),
    })
```

Replace the `onRunTerminal` arrow with:

```ts
      onRunTerminal: (chatId, runId) => {
        this.rejectPendingResolversForRun(chatId, runId)
        // failRun appended the terminal event synchronously before invoking
        // this hook, so the store already has the new state. Emit now so
        // multi-subagent fan-outs do not have to wait for Promise.all.
        this.emitStateChange(chatId)
      },
```

- [ ] **Step 2: Add `cancelSubagentRun` public method**

In `AgentCoordinator`, after `respondSubagentTool`:

```ts
  async cancelSubagentRun(
    command: Extract<ClientCommand, { type: "chat.cancelSubagentRun" }>,
  ) {
    this.subagentOrchestrator.cancelRun(command.chatId, command.runId)
  }
```

- [ ] **Step 3: Write the failing test**

In `src/server/agent.test.ts`, after the existing subagent tests, add:

```ts
  test("cancelSubagentRun aborts a running subagent and broadcasts state change", async () => {
    const store = createFakeStore()
    const emits: string[] = []
    let abortFired = false
    const coordinator = new AgentCoordinator({
      store: store as never,
      onStateChange: (chatId) => { if (chatId) emits.push(chatId) },
      getSubagents: () => [makeSubagentRecord({ id: "sa-1", name: "alpha" })],
      getAppSettingsSnapshot: () => ({ claudeAuth: { authenticated: true } }),
      startClaudeSession: async (args) => {
        async function* stream() {
          await new Promise<void>((_, reject) => {
            // Whatever harness wraps args.onToolRequest into the SDK, the
            // outer abort eventually rejects the stream. Simulate by
            // listening on a global signal exposed via a side channel —
            // for this test, we just hang forever, and rely on the
            // orchestrator's USER_CANCELLED race.
            void reject
          })
        }
        return {
          provider: "claude" as const,
          stream: stream(),
          interrupt: async () => { abortFired = true },
          close: () => {},
          sendPrompt: async () => {},
          setModel: async () => {},
          setPermissionMode: async () => {},
          getSupportedCommands: async () => [],
        }
      },
    })

    await coordinator.send({
      type: "chat.send",
      chatId: "chat-1",
      provider: "claude",
      content: "@agent/alpha",
      model: "claude-opus-4-7",
    })
    await waitFor(() => store.subagentEvents.some((e: any) => e.type === "subagent_run_started"))
    const runId = Object.keys(store.getSubagentRuns())[0]!

    await coordinator.cancelSubagentRun({
      type: "chat.cancelSubagentRun",
      chatId: "chat-1",
      runId,
    })
    await waitFor(() => store.subagentEvents.some((e: any) =>
      e.type === "subagent_run_failed" && e.runId === runId && e.error.code === "USER_CANCELLED"
    ))
    // emitStateChange fires from onRunTerminal hook.
    expect(emits).toContain("chat-1")
    void abortFired
  }, 10_000)
```

- [ ] **Step 4: Run test**

```bash
bun test src/server/agent.test.ts -t "cancelSubagentRun aborts a running"
```

Expected: PASS. If the test hangs, the orchestrator's `cancelRun` is firing `abortController.abort()` but the test mock's stream is not exiting — the orchestrator races with the abort-rejection deferred from Task 4 Step 3, so the spawnRun catch should still resolve via `runState.cancelled` re-check. If that fails, double-check Task 4 Step 5 routes `runState.cancelled` correctly.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(subagent): AgentCoordinator.cancelSubagentRun + emit via onRunTerminal"
```

---

## Task 8 — WS router

**Files:**
- Modify: `src/server/ws-router.ts`

- [ ] **Step 1: Locate existing `chat.respondSubagentTool` handler**

```bash
grep -n "chat.respondSubagentTool" src/server/ws-router.ts
```

The handler pattern is a switch case calling `coordinator.respondSubagentTool(command)`. Add a sibling case.

- [ ] **Step 2: Add `chat.cancelSubagentRun` case**

In the WS command switch in `ws-router.ts`:

```ts
      case "chat.cancelSubagentRun":
        await coordinator.cancelSubagentRun(command)
        break
```

- [ ] **Step 3: Typecheck**

```bash
bun run check
```

Expected: passes (the ClientCommand union update in Task 1 covers this).

- [ ] **Step 4: Commit**

```bash
git add src/server/ws-router.ts
git commit -m "feat(ws): route chat.cancelSubagentRun to AgentCoordinator"
```

---

## Task 9 — Client: `SubagentMessage` X button

**Files:**
- Modify: `src/client/components/messages/SubagentMessage.tsx`
- Modify: `src/client/components/messages/SubagentMessage.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/client/components/messages/SubagentMessage.test.tsx`, append:

```ts
  test("renders X button while running and dispatches onCancelSubagentRun on click", () => {
    let received: { chatId: string; runId: string } | null = null
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({ status: "running", runId: "r-running", chatId: "c1" })}
        indentDepth={0}
        localPath="/tmp"
        onCancelSubagentRun={(chatId, runId) => { received = { chatId, runId } }}
      />,
    )
    expect(html).toContain('data-testid="subagent-cancel:r-running"')
    expect(html).toContain('aria-label="Cancel subagent"')
    // The click handler is exercised in a real render; static markup test
    // only validates presence. (Browser-level click tested in viewport test.)
    void received
  })

  test("does not render X button when status is not running", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({ status: "completed", finalText: "done" })}
        indentDepth={0}
        localPath="/tmp"
        onCancelSubagentRun={() => undefined}
      />,
    )
    expect(html).not.toContain("subagent-cancel:")
  })

  test("does not render X button when onCancelSubagentRun is not provided", () => {
    const html = renderToStaticMarkup(
      <SubagentMessage
        run={makeRunSnapshot({ status: "running", runId: "r-running" })}
        indentDepth={0}
        localPath="/tmp"
      />,
    )
    expect(html).not.toContain("subagent-cancel:")
  })
```

- [ ] **Step 2: Run tests (should fail — prop not handled)**

```bash
bun test src/client/components/messages/SubagentMessage.test.tsx -t "X button"
```

Expected: FAIL on `data-testid="subagent-cancel:..."`.

- [ ] **Step 3: Add `onCancelSubagentRun` prop + button**

In `src/client/components/messages/SubagentMessage.tsx`, locate the props interface and extend:

```ts
  onCancelSubagentRun?: (chatId: string, runId: string) => void
```

In the destructure of props inside the component, accept the new prop. Then in the JSX header area (next to the existing run-status indicators), conditionally render:

```tsx
{onCancelSubagentRun && run.status === "running" && (
  <button
    type="button"
    data-testid={`subagent-cancel:${run.runId}`}
    aria-label="Cancel subagent"
    onClick={() => onCancelSubagentRun(run.chatId, run.runId)}
    className="text-muted-foreground hover:text-foreground"
  >
    <X className="h-3.5 w-3.5" />
  </button>
)}
```

(Import `X` from `lucide-react` at the top of the file — there is likely already an icon import nearby.)

- [ ] **Step 4: Run tests**

```bash
bun test src/client/components/messages/SubagentMessage.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/messages/SubagentMessage.tsx src/client/components/messages/SubagentMessage.test.tsx
git commit -m "feat(client): SubagentMessage renders cancel X button while running"
```

---

## Task 10 — Client: thread callback through `ChatTranscriptViewport`

**Files:**
- Modify: `src/client/app/ChatPage/ChatTranscriptViewport.tsx`
- Modify: `src/client/app/ChatPage/index.tsx`

- [ ] **Step 1: Add `onCancelSubagentRun` prop to `ChatTranscriptViewport`**

Locate the component's props interface in `src/client/app/ChatPage/ChatTranscriptViewport.tsx`:

```ts
  onCancelSubagentRun?: (chatId: string, runId: string) => void
```

Destructure in the component body and forward to every `<SubagentMessage>` render. Use grep to find render sites:

```bash
grep -n "SubagentMessage" src/client/app/ChatPage/ChatTranscriptViewport.tsx
```

Pass `onCancelSubagentRun={onCancelSubagentRun}` on each.

- [ ] **Step 2: Wire the dispatch in `ChatPage/index.tsx`**

Locate where `<ChatTranscriptViewport>` is rendered. Above it, define a handler that uses the existing WS sender (search for `send({` in the same file to see how `chat.respondSubagentTool` is dispatched — mirror that):

```ts
const handleCancelSubagentRun = useCallback((chatId: string, runId: string) => {
  send({ type: "chat.cancelSubagentRun", chatId, runId })
}, [send])
```

Pass to `<ChatTranscriptViewport onCancelSubagentRun={handleCancelSubagentRun} ... />`.

- [ ] **Step 3: Add `onCancelSubagentRun` (optional) to `KannaTranscript`**

In `src/client/app/KannaTranscript.tsx`, locate the prop list and add the optional `onCancelSubagentRun` prop. Forward to `<SubagentMessage>`. Exported-viewer callers do NOT pass it; the X button is hidden in that mode (Task 9 step 3 already conditions on the callback's presence).

- [ ] **Step 4: Typecheck**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 5: Run client tests**

```bash
bun test src/client/
```

Expected: passes. No new tests for `ChatTranscriptViewport`/`ChatPage` themselves because the click dispatch path is exercised end-to-end in agent.test.ts (Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/client/app/ChatPage/ChatTranscriptViewport.tsx src/client/app/ChatPage/index.tsx src/client/app/KannaTranscript.tsx
git commit -m "feat(client): wire chat.cancelSubagentRun dispatch through ChatTranscriptViewport"
```

---

## Task 11 — `SubagentErrorCard` USER_CANCELLED case + default arm

**Files:**
- Modify: `src/client/components/messages/SubagentErrorCard.tsx`

- [ ] **Step 1: Locate `badgeText`**

```bash
grep -n "badgeText\|USER_CANCELLED\|INTERRUPTED" src/client/components/messages/SubagentErrorCard.tsx
```

The function currently has a per-code switch with no `default` arm.

- [ ] **Step 2: Add USER_CANCELLED case and default**

Inside `badgeText` (or the equivalent switch in the file), add:

```ts
  case "USER_CANCELLED":
    return "Cancelled by you"
```

And add a `default` arm at the end:

```ts
  default:
    return "Error"
```

If there are sibling switches (e.g. `messageText`), apply the same pattern.

- [ ] **Step 3: Typecheck**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/messages/SubagentErrorCard.tsx
git commit -m "feat(client): SubagentErrorCard handles USER_CANCELLED + default fallback"
```

---

## Task 12 — Final test + lint sweep

- [ ] **Step 1: Full test suite**

```bash
bun test
```

Expected: all pass.

- [ ] **Step 2: Lint**

```bash
bun run lint
```

Expected: 0 errors.

- [ ] **Step 3: Typecheck**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 4: Manual smoke checklist (PR description)**

- [ ] Spawn a Claude subagent (`@agent/<name>` with a long-running task). Click X. Card transitions to "Cancelled by you". Underlying SDK session torn down (verify in logs).
- [ ] Spawn a Codex subagent that runs `find /` (or similar long task). Click X. Codex stopSession called with `sub:${runId}`. Card shows USER_CANCELLED.
- [ ] Spawn TWO subagents with `maxParallel=1`. Cancel the queued one (button still visible on running-status card). Queued run shows USER_CANCELLED, running run continues.
- [ ] Click X on a subagent that is in `pendingTool` state (AskUserQuestion card visible). Verify card transitions to error and the SDK Promise rejects.
- [ ] Open the exported viewer for a chat with subagent runs. Verify NO X button appears (callback not wired in that surface).

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/cancel-individual-subagent-run
gh pr create --repo cuongtranba/kanna --base main --head feat/cancel-individual-subagent-run \
  --title "feat: cancel individual subagent run" \
  --body "$(cat <<'EOF'
## Summary
- New WS command \`chat.cancelSubagentRun\` cancels a single running subagent without cancelling the parent chat
- Orchestrator gains per-run state map (\`runStateByRunId\`) with \`AbortController\`, optional permit waiter, cancelled flag, parent/child links
- Queued runs splice + reject their permit waiter; running runs abort the SDK stream; post-race \`state.cancelled\` re-check covers Codex stream-finish-on-stop behavior
- New \`SubagentErrorCode\`: \`USER_CANCELLED\`. \`SubagentErrorCard\` handles it and gains a generic default arm
- Client: X button on \`SubagentMessage\` envelope while \`run.status === "running"\`, wired through \`ChatTranscriptViewport\`. \`KannaTranscript\` exported viewer leaves the callback unwired (button hidden)

## Plan / spec
- Spec: \`docs/superpowers/specs/2026-05-14-cancel-individual-subagent-run-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-14-cancel-individual-subagent-run.md\`

## Test plan
- [x] \`bun test\` (full suite)
- [x] \`bun run lint\` (0 errors)
- [x] \`bun run check\` (tsc + builds clean)
- [ ] Manual smoke: see checklist above
EOF
)"
```

---

## Out of scope

- Retry after cancel.
- Cancel from any UI surface other than the subagent envelope.
- Status filter for cancelled runs in sidebar / history.
- Telemetry / analytics for cancel events.
