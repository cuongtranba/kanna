import { describe, expect, test } from "bun:test"
import { applyChatOps } from "./chat-ops"
import type { ChatOp } from "./chat-ops"
import type { ChatRuntime, ChatSnapshot, TranscriptEntry } from "./types"

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
    slashCommands: [],
    slashCommandsLoading: false,
    schedules: {},
    liveScheduleId: null,
    tunnels: {},
    liveTunnelId: null,
    subagentRuns: {},
    loopProgress: { chatId: "chat-1", armed: false, rows: [], rateLimit: null },
    seq: 1,
  }
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
      { kind: "sections.set", sections: { slashCommandsLoading: true } },
    ], 2)
    expect(result.slashCommandsLoading).toBe(true)
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
})
