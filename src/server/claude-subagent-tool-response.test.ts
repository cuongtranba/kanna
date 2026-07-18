import { describe, it, expect, mock } from "bun:test"
import {
  subagentPendingKey,
  rejectPendingResolvers,
  rejectPendingResolversForChat,
  rejectPendingResolversForRun,
  respondSubagentTool,
  cancelSubagentRun,
  type SubagentToolResponseDeps,
} from "./claude-subagent-tool-response"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolver() {
  let resolveFn: ((v: unknown) => void) | undefined
  let rejectFn: ((e: Error) => void) | undefined
  const promise = new Promise<unknown>((res, rej) => {
    resolveFn = res
    rejectFn = rej
  })
  // Suppress unhandled-rejection noise in tests
  promise.catch(() => undefined)
  return {
    promise,
    resolve: (v: unknown) => resolveFn!(v),
    reject: (e: Error) => rejectFn!(e),
  }
}

function makeDeps(
  overrides?: Partial<SubagentToolResponseDeps>,
): SubagentToolResponseDeps {
  return {
    subagentPendingResolvers: new Map(),
    store: {
      appendSubagentEvent: mock(() => Promise.resolve()),
    },
    subagentOrchestrator: {
      notifySubagentToolResolved: mock(() => undefined),
      cancelRun: mock(() => undefined),
    },
    emitStateChange: mock(() => undefined),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// subagentPendingKey
// ---------------------------------------------------------------------------

describe("subagentPendingKey", () => {
  it("concatenates chatId, runId, and toolUseId with ::", () => {
    expect(subagentPendingKey("chat1", "run1", "tool1")).toBe("chat1::run1::tool1")
  })

  it("handles empty segments", () => {
    expect(subagentPendingKey("", "", "")).toBe("::::")
  })
})

// ---------------------------------------------------------------------------
// rejectPendingResolvers
// ---------------------------------------------------------------------------

describe("rejectPendingResolvers", () => {
  it("rejects entries matching predicate and removes them from the map", async () => {
    const deps = makeDeps()
    const r1 = makeResolver()
    const r2 = makeResolver()
    deps.subagentPendingResolvers.set("chat1::run1::t1", r1)
    deps.subagentPendingResolvers.set("chat2::run2::t2", r2)

    rejectPendingResolvers(
      deps,
      (k) => k.startsWith("chat1::"),
      "test reason",
    )

    await expect(r1.promise).rejects.toThrow("test reason")
    expect(deps.subagentPendingResolvers.has("chat1::run1::t1")).toBe(false)
    // Non-matching entry untouched
    expect(deps.subagentPendingResolvers.has("chat2::run2::t2")).toBe(true)
  })

  it("does nothing when no entries match predicate", () => {
    const deps = makeDeps()
    const r = makeResolver()
    deps.subagentPendingResolvers.set("chat1::run1::t1", r)

    rejectPendingResolvers(deps, () => false, "ignored")

    expect(deps.subagentPendingResolvers.size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// rejectPendingResolversForChat
// ---------------------------------------------------------------------------

describe("rejectPendingResolversForChat", () => {
  it("rejects all resolvers belonging to the given chatId", async () => {
    const deps = makeDeps()
    const r1 = makeResolver()
    const r2 = makeResolver()
    const rOther = makeResolver()
    deps.subagentPendingResolvers.set("chatA::run1::t1", r1)
    deps.subagentPendingResolvers.set("chatA::run2::t2", r2)
    deps.subagentPendingResolvers.set("chatB::run1::t1", rOther)

    rejectPendingResolversForChat(deps, "chatA")

    await expect(r1.promise).rejects.toThrow("chat cancelled")
    await expect(r2.promise).rejects.toThrow("chat cancelled")
    expect(deps.subagentPendingResolvers.has("chatB::run1::t1")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// rejectPendingResolversForRun
// ---------------------------------------------------------------------------

describe("rejectPendingResolversForRun", () => {
  it("rejects all resolvers belonging to the given run", async () => {
    const deps = makeDeps()
    const rTarget = makeResolver()
    const rOtherRun = makeResolver()
    deps.subagentPendingResolvers.set("chatA::run1::t1", rTarget)
    deps.subagentPendingResolvers.set("chatA::run2::t1", rOtherRun)

    rejectPendingResolversForRun(deps, "chatA", "run1")

    await expect(rTarget.promise).rejects.toThrow("subagent run terminated")
    expect(deps.subagentPendingResolvers.has("chatA::run2::t1")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// respondSubagentTool
// ---------------------------------------------------------------------------

describe("respondSubagentTool", () => {
  it("resolves the pending resolver, appends event, notifies orchestrator, emits state", async () => {
    const deps = makeDeps()
    const resolver = makeResolver()
    deps.subagentPendingResolvers.set("chatX::runY::toolZ", resolver)

    const command = {
      type: "chat.respondSubagentTool" as const,
      chatId: "chatX",
      runId: "runY",
      toolUseId: "toolZ",
      result: { content: "ok" },
    }

    await respondSubagentTool(deps, command)

    // Resolver resolved with the result
    await expect(resolver.promise).resolves.toEqual({ content: "ok" })
    // Removed from the map
    expect(deps.subagentPendingResolvers.has("chatX::runY::toolZ")).toBe(false)
    // Event persisted
    expect(deps.store.appendSubagentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "subagent_tool_resolved",
        chatId: "chatX",
        runId: "runY",
        toolUseId: "toolZ",
        result: { content: "ok" },
        resolution: "user",
      }),
    )
    // Orchestrator notified
    expect(deps.subagentOrchestrator.notifySubagentToolResolved).toHaveBeenCalledWith("runY")
    // State emitted
    expect(deps.emitStateChange).toHaveBeenCalledWith("chatX")
  })

  it("is idempotent: does nothing when resolver is not found", async () => {
    const deps = makeDeps()

    await respondSubagentTool(deps, {
      type: "chat.respondSubagentTool",
      chatId: "chatX",
      runId: "runY",
      toolUseId: "toolZ",
      result: {},
    })

    expect(deps.store.appendSubagentEvent).not.toHaveBeenCalled()
    expect(deps.subagentOrchestrator.notifySubagentToolResolved).not.toHaveBeenCalled()
    expect(deps.emitStateChange).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// cancelSubagentRun
// ---------------------------------------------------------------------------

describe("cancelSubagentRun", () => {
  it("delegates to orchestrator.cancelRun", () => {
    const deps = makeDeps()

    cancelSubagentRun(deps, {
      type: "chat.cancelSubagentRun",
      chatId: "chatA",
      runId: "runB",
    })

    expect(deps.subagentOrchestrator.cancelRun).toHaveBeenCalledWith("chatA", "runB")
  })
})
