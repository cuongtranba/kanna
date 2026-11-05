import { describe, expect, test } from "vite-plus/test"
import { SECTION_KEYS, diffChatMeta } from "./chat-ops-diff"
import type { ChatRuntime, ChatSnapshot, SubagentRunSummary, TranscriptEntry } from "../shared/types"

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
    schedules: {},
    liveScheduleId: null,
    tunnels: {},
    liveTunnelId: null,
    subagentRuns: {},
    loopProgress: { chatId: "chat-1", armed: false, rows: [], rateLimit: null, completed: 0, total: 0 },
    cronJobs: [],
    ...overrides,
  }
}

function makeRun(overrides: Partial<SubagentRunSummary> = {}): SubagentRunSummary {
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

function runsMeta(...runs: SubagentRunSummary[]): ChatSnapshot {
  return makeMeta({ subagentRuns: Object.fromEntries(runs.map((run) => [run.runId, run])) })
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

  test("subagent runs are not a sections.set key", () => {
    const keys: readonly string[] = SECTION_KEYS
    expect(keys).not.toContain("subagentRuns")
  })

  test("unchanged subagent runs emit zero ops", () => {
    const meta = runsMeta(makeRun({ finalText: "abc" }))
    const first = diffChatMeta(undefined, meta)
    expect(diffChatMeta(first.next, runsMeta(makeRun({ finalText: "abc" }))).ops).toEqual([])
  })

  test("a new run emits an upsert without text, then a replace once it has text", () => {
    const first = diffChatMeta(undefined, makeMeta())
    const quiet = diffChatMeta(first.next, runsMeta(makeRun()))
    expect(quiet.ops.map((op) => op.kind)).toEqual(["subagentRun.upsert"])
    const loud = diffChatMeta(first.next, runsMeta(makeRun({ finalText: "hi" })))
    expect(loud.ops).toEqual([
      { kind: "subagentRun.upsert", run: expect.objectContaining({ runId: "run-1" }) },
      { kind: "subagentRun.text", runId: "run-1", text: "hi", mode: "replace" },
    ])
  })

  test("a streaming run sends only the new text suffix and leaves its siblings alone", () => {
    const sibling = makeRun({ runId: "run-2", finalText: "x".repeat(5000) })
    const first = diffChatMeta(undefined, runsMeta(makeRun({ finalText: "hel" }), sibling))
    const { ops } = diffChatMeta(first.next, runsMeta(makeRun({ finalText: "hello" }), sibling))
    expect(ops).toEqual([{ kind: "subagentRun.text", runId: "run-1", text: "lo", mode: "append" }])
  })

  test("a changed entry tail or count upserts the run with its real recent entries", () => {
    const entry: TranscriptEntry = { _id: "e1", createdAt: 1, kind: "assistant_text", text: "t" }
    const first = diffChatMeta(undefined, runsMeta(makeRun({ finalText: "abc" })))
    const { ops } = diffChatMeta(first.next, runsMeta(makeRun({ finalText: "abc", entryCount: 1, recentEntries: [entry] })))
    expect(ops).toEqual([{ kind: "subagentRun.upsert", run: expect.objectContaining({ entryCount: 1, recentEntries: [entry] }) }])
  })

  test("completion overwrites the streamed text with the final content", () => {
    const first = diffChatMeta(undefined, runsMeta(makeRun({ finalText: "draft" })))
    const done = makeRun({ status: "completed", finishedAt: 9, finalText: "FINAL" })
    const { ops } = diffChatMeta(first.next, runsMeta(done))
    expect(ops.map((op) => op.kind)).toEqual(["subagentRun.upsert", "subagentRun.text"])
    expect(ops[1]).toEqual({ kind: "subagentRun.text", runId: "run-1", text: "FINAL", mode: "replace" })
  })

  test("a status change re-sends the text in full so a settled run never trusts an append", () => {
    const first = diffChatMeta(undefined, runsMeta(makeRun({ finalText: "draft" })))
    const failed = makeRun({ status: "failed", finishedAt: 9, finalText: "draft", error: { code: "TIMEOUT", message: "late" } })
    const { ops } = diffChatMeta(first.next, runsMeta(failed))
    expect(ops.map((op) => op.kind)).toEqual(["subagentRun.upsert", "subagentRun.text"])
  })

  test("an evicted run emits a remove", () => {
    const first = diffChatMeta(undefined, runsMeta(makeRun(), makeRun({ runId: "run-2" })))
    const { ops } = diffChatMeta(first.next, runsMeta(makeRun({ runId: "run-2" })))
    expect(ops).toEqual([{ kind: "subagentRun.remove", runId: "run-1" }])
  })
})
