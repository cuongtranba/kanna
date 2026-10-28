import { describe, expect, test } from "vite-plus/test"
import { sameChatSnapshotCore, sameFields } from "./equality"
import type { ChatSnapshot } from "./types"

function createMinimalChatSnapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return {
    runtime: {
      chatId: "chat-1",
      projectId: "project-1",
      localPath: "/tmp/project-1",
      title: "Chat",
      status: "idle",
      isDraining: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      timings: { activeSessionStartedAt: 0, chatCreatedAt: 0, stateEnteredAt: 0, lastTurnDurationMs: null, derivedAtMs: 0, cumulativeMs: { idle: 0, starting: 0, running: 0, waiting_for_user: 0, failed: 0 } },
      policyOverride: null,
      sessionState: "cold",
      backgroundTasks: [],
    },
    queuedMessages: [],
    messages: [],
    history: { hasOlder: false, olderCursor: null, recentLimit: 200 },
    availableProviders: [],
    schedules: {},
    liveScheduleId: null,
    tunnels: {},
    liveTunnelId: null,
    subagentRuns: {},
    loopProgress: { chatId: "c", armed: false, rows: [], rateLimit: null, completed: 0, total: 0 },
    cronJobs: [],
    ...overrides,
  }
}

describe("sameChatSnapshotCore tunnel fields", () => {
  test("returns true when both snapshots have no tunnels", () => {
    const a = createMinimalChatSnapshot()
    const b = createMinimalChatSnapshot()
    expect(sameChatSnapshotCore(a, b)).toBe(true)
  })

  test("returns false when tunnel state differs", () => {
    const a = createMinimalChatSnapshot({
      tunnels: {
        t1: {
          tunnelId: "t1",
          chatId: "chat-1",
          port: 3000,
          state: "proposed",
          url: null,
          error: null,
          proposedAt: 1000,
          activatedAt: null,
          stoppedAt: null,
        },
      },
      liveTunnelId: "t1",
    })
    const b = createMinimalChatSnapshot({
      tunnels: {
        t1: {
          tunnelId: "t1",
          chatId: "chat-1",
          port: 3000,
          state: "active",
          url: "https://example.trycloudflare.com",
          error: null,
          proposedAt: 1000,
          activatedAt: 2000,
          stoppedAt: null,
        },
      },
      liveTunnelId: "t1",
    })
    expect(sameChatSnapshotCore(a, b)).toBe(false)
  })

  test("returns true when tunnel state and all fields match", () => {
    const tunnel = {
      tunnelId: "t1",
      chatId: "chat-1",
      port: 3000,
      state: "active" as const,
      url: "https://example.trycloudflare.com",
      error: null,
      proposedAt: 1000,
      activatedAt: 2000,
      stoppedAt: null,
    }
    const a = createMinimalChatSnapshot({ tunnels: { t1: tunnel }, liveTunnelId: "t1" })
    const b = createMinimalChatSnapshot({ tunnels: { t1: { ...tunnel } }, liveTunnelId: "t1" })
    expect(sameChatSnapshotCore(a, b)).toBe(true)
  })

  test("returns false when liveTunnelId differs", () => {
    const a = createMinimalChatSnapshot({ tunnels: {}, liveTunnelId: "t1" })
    const b = createMinimalChatSnapshot({ tunnels: {}, liveTunnelId: null })
    expect(sameChatSnapshotCore(a, b)).toBe(false)
  })

  test("returns false when tunnel count differs", () => {
    const tunnel = {
      tunnelId: "t1",
      chatId: "chat-1",
      port: 3000,
      state: "stopped" as const,
      url: null,
      error: null,
      proposedAt: 1000,
      activatedAt: null,
      stoppedAt: 3000,
    }
    const a = createMinimalChatSnapshot({ tunnels: { t1: tunnel } })
    const b = createMinimalChatSnapshot({ tunnels: {} })
    expect(sameChatSnapshotCore(a, b)).toBe(false)
  })
})

function createMinimalSubagentRun(overrides: Partial<import("./types").SubagentRunSnapshot> = {}): import("./types").SubagentRunSnapshot {
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
    entries: [],
    pendingTool: null,
    ...overrides,
  }
}

describe("sameChatSnapshotCore subagent fields", () => {
  test("returns true when both snapshots have no subagent runs", () => {
    const a = createMinimalChatSnapshot({ subagentRuns: {} })
    const b = createMinimalChatSnapshot({ subagentRuns: {} })
    expect(sameChatSnapshotCore(a, b)).toBe(true)
  })

  test("returns false when subagent entries grew between snapshots", () => {
    const runA = createMinimalSubagentRun({ entries: [] })
    const runB = createMinimalSubagentRun({
      entries: [
        { _id: "e1", createdAt: 1, kind: "assistant_text", text: "hi", messageId: "m1" } as unknown as import("./types").TranscriptEntry,
      ],
    })
    const a = createMinimalChatSnapshot({ subagentRuns: { "run-1": runA } })
    const b = createMinimalChatSnapshot({ subagentRuns: { "run-1": runB } })
    expect(sameChatSnapshotCore(a, b)).toBe(false)
  })

  test("returns false when run status transitions to completed", () => {
    const a = createMinimalChatSnapshot({
      subagentRuns: { "run-1": createMinimalSubagentRun({ status: "running" }) },
    })
    const b = createMinimalChatSnapshot({
      subagentRuns: { "run-1": createMinimalSubagentRun({ status: "completed", finishedAt: 2000 }) },
    })
    expect(sameChatSnapshotCore(a, b)).toBe(false)
  })

  test("returns false when run count differs (new run added mid-turn)", () => {
    const a = createMinimalChatSnapshot({ subagentRuns: {} })
    const b = createMinimalChatSnapshot({
      subagentRuns: { "run-1": createMinimalSubagentRun() },
    })
    expect(sameChatSnapshotCore(a, b)).toBe(false)
  })

  test("returns false when finalText length changes (streaming text)", () => {
    const a = createMinimalChatSnapshot({
      subagentRuns: { "run-1": createMinimalSubagentRun({ finalText: "Hello" }) },
    })
    const b = createMinimalChatSnapshot({
      subagentRuns: { "run-1": createMinimalSubagentRun({ finalText: "Hello world" }) },
    })
    expect(sameChatSnapshotCore(a, b)).toBe(false)
  })

  test("returns false when pendingTool toolUseId changes", () => {
    const a = createMinimalChatSnapshot({
      subagentRuns: { "run-1": createMinimalSubagentRun({ pendingTool: null }) },
    })
    const b = createMinimalChatSnapshot({
      subagentRuns: {
        "run-1": createMinimalSubagentRun({
          pendingTool: { toolUseId: "tu-1", toolKind: "ask_user_question", input: { questions: [] }, askedAt: 100 } as unknown as import("./types").SubagentRunSnapshot["pendingTool"],
        }),
      },
    })
    expect(sameChatSnapshotCore(a, b)).toBe(false)
  })

  test("returns true when terminal run is structurally identical", () => {
    const run = createMinimalSubagentRun({ status: "completed", finishedAt: 2000, finalText: "done" })
    const a = createMinimalChatSnapshot({ subagentRuns: { "run-1": run } })
    const b = createMinimalChatSnapshot({ subagentRuns: { "run-1": { ...run } } })
    expect(sameChatSnapshotCore(a, b)).toBe(true)
  })
})

describe("sameChatSnapshotCore loop progress rows", () => {
  function progress(rows: import("./types").LoopRow[]) {
    return createMinimalChatSnapshot({
      loopProgress: { chatId: "c", armed: true, rows, rateLimit: null, completed: 0, total: 0 },
    })
  }

  const doneRow = { runId: "progress:0", label: "chunk one", status: "done" as const, startedAt: 0, finishedAt: null }

  test("identical plan rows dedup", () => {
    expect(sameChatSnapshotCore(progress([doneRow]), progress([doneRow]))).toBe(true)
  })

  test("a reworded plan row is not mistaken for the same row", () => {
    const reworded = { ...doneRow, label: "chunk one (reverted)" }
    expect(sameChatSnapshotCore(progress([doneRow]), progress([reworded]))).toBe(false)
  })

  test("the current step turning from pending to running re-renders", () => {
    const pending = { runId: "next", label: "chunk two", status: "pending" as const, startedAt: 0, finishedAt: null }
    const running = { runId: "r1", label: "chunk two", status: "running" as const, startedAt: 5, finishedAt: null }
    expect(sameChatSnapshotCore(progress([doneRow, pending]), progress([doneRow, running]))).toBe(false)
  })
})

describe("sameFields", () => {
  test("compares nested arrays and records structurally", () => {
    const left = { id: "a", tools: ["x", "y"], attachment: { name: "n", size: 1 } }
    const right = { id: "a", tools: ["x", "y"], attachment: { name: "n", size: 1 } }
    expect(sameFields(left, right)).toBe(true)
  })

  test("detects a changed nested value", () => {
    const left = { items: [{ name: "a" }] }
    const right = { items: [{ name: "b" }] }
    expect(sameFields(left, right)).toBe(false)
  })

  test("treats a key present on one side only as a difference", () => {
    const left: { id: string; note?: string } = { id: "a" }
    const right: { id: string; note?: string } = { id: "a", note: "x" }
    expect(sameFields(left, right)).toBe(false)
    expect(sameFields(right, left)).toBe(false)
  })

  test("ignores the listed keys on both sides", () => {
    const left: { id: string; timestamp?: string } = { id: "a", timestamp: "1" }
    const right: { id: string; timestamp?: string } = { id: "a" }
    expect(sameFields(left, right, ["timestamp"])).toBe(true)
  })
})
