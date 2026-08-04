import { describe, expect, test } from "bun:test"
import { SECTION_KEYS, diffChatMeta } from "./chat-ops-diff"
import type { ChatRuntime, ChatSnapshot, TranscriptEntry } from "../shared/types"

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

function makeMeta(overrides?: Partial<ChatSnapshot>): ChatSnapshot {
  return {
    runtime: makeRuntime(),
    queuedMessages: [],
    messages: [],
    history: { hasOlder: false, olderCursor: null, recentLimit: 0 },
    availableProviders: [],
    slashCommands: [],
    slashCommandsLoading: false,
    schedules: {},
    liveScheduleId: null,
    tunnels: {},
    liveTunnelId: null,
    subagentRuns: {},
    loopProgress: { chatId: "chat-1", armed: false, rows: [], rateLimit: null },
    ...overrides,
  }
}

describe("diffChatMeta", () => {
  test("first call emits no ops, only signatures", () => {
    const { ops, next } = diffChatMeta(undefined, makeMeta())
    expect(ops).toEqual([])
    expect(next.runtime.length).toBeGreaterThan(0)
    expect(Object.keys(next.sections).length).toBeGreaterThan(0)
  })

  test("no change emits zero ops", () => {
    const first = diffChatMeta(undefined, makeMeta())
    const second = diffChatMeta(first.next, makeMeta())
    expect(second.ops).toEqual([])
  })

  test("runtime status flip emits a single runtime.set", () => {
    const first = diffChatMeta(undefined, makeMeta())
    const meta = makeMeta({ runtime: makeRuntime({ status: "running" }) })
    const { ops } = diffChatMeta(first.next, meta)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.kind).toBe("runtime.set")
  })

  test("timings-only change emits zero ops", () => {
    const first = diffChatMeta(undefined, makeMeta())
    const meta = makeMeta({
      runtime: makeRuntime({
        timings: {
          activeSessionStartedAt: 0,
          chatCreatedAt: 0,
          stateEnteredAt: 99,
          lastTurnDurationMs: 123,
          derivedAtMs: 456,
          cumulativeMs: { idle: 9, starting: 0, running: 0, waiting_for_user: 0, failed: 0 },
        },
      }),
    })
    const { ops } = diffChatMeta(first.next, meta)
    expect(ops).toEqual([])
  })

  test("one section change emits sections.set with exactly that key", () => {
    const first = diffChatMeta(undefined, makeMeta())
    const meta = makeMeta({ liveScheduleId: "sched-1" })
    const { ops } = diffChatMeta(first.next, meta)
    expect(ops).toHaveLength(1)
    const op = ops[0]!
    if (op.kind !== "sections.set") throw new Error(`expected sections.set, got ${op.kind}`)
    expect(Object.keys(op.sections)).toEqual(["liveScheduleId"])
    expect(op.sections.liveScheduleId).toBe("sched-1")
  })

  // Regression guard for a whole class of bug, not just one field.
  //
  // The composer picker reads its own zustand store, which is fed only by full
  // snapshots. Any picker data that also travels as a chat.ops section is
  // therefore delivered down a path the picker never observes — which is
  // exactly how the slash-command list ended up stuck on a loading skeleton
  // that never resolved. Picker state belongs in its own project-scoped topic.
  test("picker data is never delta-only: no slash-command key is a chat.ops section", () => {
    const keys: readonly string[] = SECTION_KEYS
    expect(keys).not.toContain("slashCommands")
    expect(keys).not.toContain("slashCommandsLoading")
  })

  test("pending rows change emits pending.set", () => {
    const first = diffChatMeta(undefined, makeMeta())
    const meta = makeMeta({ messages: [pendingEntry("p1")] })
    const { ops } = diffChatMeta(first.next, meta)
    expect(ops).toHaveLength(1)
    const op = ops[0]!
    if (op.kind !== "pending.set") throw new Error(`expected pending.set, got ${op.kind}`)
    expect(op.entries.map((e) => e._id)).toEqual(["p1"])
  })
})
