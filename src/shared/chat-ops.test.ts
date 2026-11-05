import { describe, expect, test } from "vite-plus/test"
import { applyChatOps } from "./chat-ops"
import type { ChatOp } from "./chat-ops"
import type { ChatRuntime, ChatSnapshot, SubagentRunSummary, TranscriptEntry } from "./types"

function makeRuntime(overrides?: Partial<ChatRuntime>): ChatRuntime {
  return {
    chatId: "chat-1",
    projectId: "project-1",
    localPath: "/tmp/p",
    title: "Chat",
    status: "idle",
    isDraining: false,
    provider: "claude",
    planMode: false,
    sessionTokensByProvider: {},
    timings: {
      activeSessionStartedAt: 0,
      chatCreatedAt: 0,
      stateEnteredAt: 0,
      lastTurnDurationMs: null,
      derivedAtMs: 0,
      cumulativeMs: { idle: 0, starting: 0, running: 0, waiting_for_user: 0, failed: 0 },
    },
    policyOverride: null,
    sessionState: "cold",
    backgroundTasks: [],
    ...overrides,
  }
}

function textEntry(id: string): TranscriptEntry {
  return { _id: id, createdAt: 1, kind: "assistant_text", text: `text ${id}` }
}

function cwuEntry(id: string, usedTokens: number): TranscriptEntry {
  return { _id: id, createdAt: 1, kind: "context_window_updated", usage: { usedTokens, compactsAutomatically: false } }
}

function pendingEntry(id: string): TranscriptEntry {
  return {
    _id: id,
    createdAt: 1,
    kind: "pending_tool_request",
    toolRequestId: id,
    toolName: "AskUserQuestion",
    arguments: {},
  }
}

function makeSnapshot(messages: TranscriptEntry[]): ChatSnapshot {
  return {
    runtime: makeRuntime(),
    queuedMessages: [],
    messages,
    history: { hasOlder: false, olderCursor: null, recentLimit: 200 },
    availableProviders: [],
    schedules: {},
    liveScheduleId: null,
    tunnels: {},
    liveTunnelId: null,
    subagentRuns: {},
    loopProgress: { chatId: "chat-1", armed: false, rows: [], rateLimit: null, completed: 0, total: 0 },
    cronJobs: [],
    seq: 1,
  }
}

function makeRunSummary(overrides: Partial<SubagentRunSummary> = {}): SubagentRunSummary {
  return {
    runId: "run-1",
    chatId: "chat-1",
    subagentId: "sa-1",
    subagentName: "alpha",
    label: null,
    provider: "claude",
    model: "claude-opus-4-7",
    status: "running",
    parentUserMessageId: "u1",
    parentRunId: null,
    depth: 0,
    startedAt: 1000,
    finishedAt: null,
    finalText: null,
    error: null,
    usage: null,
    entryCount: 0,
    recentEntries: [],
    pendingTool: null,
    ...overrides,
  }
}

function withRuns(base: ChatSnapshot, runs: Record<string, SubagentRunSummary>): ChatSnapshot {
  return { ...base, subagentRuns: runs }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

describe("applyChatOps", () => {
  test("entries.append appends and preserves untouched refs", () => {
    const base = makeSnapshot([textEntry("a")])
    const ops: ChatOp[] = [{ kind: "entries.append", entries: [textEntry("b")] }]
    const result = applyChatOps(base, ops, 2)
    expect(result.messages.map((m) => m._id)).toEqual(["a", "b"])
    expect(result.messages[0]).toBe(base.messages[0]!)
    expect(result.runtime).toBe(base.runtime)
    expect(result.seq).toBe(2)
  })

  test("entries.append with existing _id replaces in place (idempotent overlap)", () => {
    const base = makeSnapshot([textEntry("a"), textEntry("b")])
    const replacement: TranscriptEntry = { _id: "b", createdAt: 1, kind: "assistant_text", text: "updated" }
    const result = applyChatOps(base, [{ kind: "entries.append", entries: [replacement] }], 2)
    expect(result.messages.map((m) => m._id)).toEqual(["a", "b"])
    expect(result.messages[1]).toBe(replacement)
  })

  test("appending context_window_updated onto a trailing one coalesces (last wins)", () => {
    const base = makeSnapshot([textEntry("a"), cwuEntry("cwu-1", 100)])
    const result = applyChatOps(base, [{ kind: "entries.append", entries: [cwuEntry("cwu-2", 200)] }], 2)
    expect(result.messages.map((m) => m._id)).toEqual(["a", "cwu-2"])
  })

  test("runtime.set replaces runtime, keeps messages identity", () => {
    const base = makeSnapshot([textEntry("a")])
    const runtime = makeRuntime({ status: "running" })
    const result = applyChatOps(base, [{ kind: "runtime.set", runtime }], 2)
    expect(result.runtime).toBe(runtime)
    expect(result.messages).toBe(base.messages)
  })

  test("sections.set replaces only named keys", () => {
    const base = makeSnapshot([textEntry("a")])
    const result = applyChatOps(base, [
      { kind: "sections.set", sections: { liveScheduleId: "sched-1" } },
    ], 2)
    expect(result.liveScheduleId).toBe("sched-1")
    expect(result.schedules).toBe(base.schedules)
    expect(result.subagentRuns).toBe(base.subagentRuns)
  })

  test("pending.set replaces all pending_tool_request rows at the end", () => {
    const base = makeSnapshot([textEntry("a"), pendingEntry("p1")])
    const result = applyChatOps(base, [{ kind: "pending.set", entries: [pendingEntry("p2")] }], 2)
    expect(result.messages.map((m) => m._id)).toEqual(["a", "p2"])
  })

  test("does not mutate input and stamps toSeq", () => {
    const base = deepFreeze(makeSnapshot([textEntry("a")]))
    const result = applyChatOps(base, [
      { kind: "entries.append", entries: [textEntry("b")] },
      { kind: "runtime.set", runtime: makeRuntime({ status: "running" }) },
    ], 7)
    expect(result.seq).toBe(7)
    expect(base.messages.length).toBe(1)
    expect(result.messages.length).toBe(2)
  })

  test("subagentRun.upsert inserts a new run with null finalText", () => {
    const base = makeSnapshot([])
    const { finalText: _finalText, ...meta } = makeRunSummary({ entryCount: 3 })
    const result = applyChatOps(base, [{ kind: "subagentRun.upsert", run: meta }], 2)
    expect(result.subagentRuns).toEqual({ "run-1": makeRunSummary({ entryCount: 3 }) })
    expect(result.runtime).toBe(base.runtime)
  })

  test("subagentRun.upsert replaces the metadata of a known run but keeps its streamed text", () => {
    const base = withRuns(makeSnapshot([]), {
      "run-1": makeRunSummary({ finalText: "partial", entryCount: 1 }),
      "run-2": makeRunSummary({ runId: "run-2" }),
    })
    const { finalText: _finalText, ...meta } = makeRunSummary({ entryCount: 2, status: "failed", finishedAt: 5 })
    const result = applyChatOps(base, [{ kind: "subagentRun.upsert", run: meta }], 2)
    expect(result.subagentRuns["run-1"]).toEqual(makeRunSummary({ entryCount: 2, status: "failed", finishedAt: 5, finalText: "partial" }))
    expect(result.subagentRuns["run-2"]).toBe(base.subagentRuns["run-2"]!)
  })

  test("subagentRun.text appends to and replaces the text of one run", () => {
    const base = withRuns(makeSnapshot([]), {
      "run-1": makeRunSummary({ finalText: "ab" }),
      "run-2": makeRunSummary({ runId: "run-2" }),
    })
    const appended = applyChatOps(base, [{ kind: "subagentRun.text", runId: "run-1", text: "cd", mode: "append" }], 2)
    expect(appended.subagentRuns["run-1"]!.finalText).toBe("abcd")
    expect(appended.subagentRuns["run-2"]).toBe(base.subagentRuns["run-2"]!)
    const fromNull = applyChatOps(base, [{ kind: "subagentRun.text", runId: "run-2", text: "x", mode: "append" }], 2)
    expect(fromNull.subagentRuns["run-2"]!.finalText).toBe("x")
    const replaced = applyChatOps(appended, [{ kind: "subagentRun.text", runId: "run-1", text: "final", mode: "replace" }], 3)
    expect(replaced.subagentRuns["run-1"]!.finalText).toBe("final")
  })

  test("subagentRun.text for a run the client never saw is ignored", () => {
    const base = makeSnapshot([])
    const result = applyChatOps(base, [{ kind: "subagentRun.text", runId: "ghost", text: "x", mode: "append" }], 2)
    expect(result.subagentRuns).toBe(base.subagentRuns)
  })

  test("subagentRun.remove drops only that run and ignores an unknown one", () => {
    const base = withRuns(makeSnapshot([]), {
      "run-1": makeRunSummary(),
      "run-2": makeRunSummary({ runId: "run-2" }),
    })
    const removed = applyChatOps(base, [{ kind: "subagentRun.remove", runId: "run-1" }], 2)
    expect(Object.keys(removed.subagentRuns)).toEqual(["run-2"])
    expect(removed.subagentRuns["run-2"]).toBe(base.subagentRuns["run-2"]!)
    const unknown = applyChatOps(base, [{ kind: "subagentRun.remove", runId: "ghost" }], 2)
    expect(unknown.subagentRuns).toBe(base.subagentRuns)
  })

  test("ops that carry no subagent change keep the subagentRuns record identity", () => {
    const base = withRuns(makeSnapshot([textEntry("a")]), { "run-1": makeRunSummary() })
    const result = applyChatOps(base, [
      { kind: "entries.append", entries: [textEntry("b")] },
      { kind: "sections.set", sections: { liveScheduleId: "s" } },
    ], 2)
    expect(result.subagentRuns).toBe(base.subagentRuns)
  })
})
