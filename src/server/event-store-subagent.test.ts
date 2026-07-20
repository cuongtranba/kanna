import { describe, expect, test } from "bun:test"
import type { SubagentRunSnapshot } from "../shared/types"
import type { SubagentRunEvent } from "./events"
import {
  applySubagentEvent,
  getSubagentRuns,
  runningSubagentRuns,
  type SubagentRunMap,
} from "./event-store-subagent"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TS = 1_700_000_000_000

function makeRunsByChatId(
  chatId: string,
  initial: SubagentRunSnapshot[] = [],
): Map<string, SubagentRunMap> {
  const inner: SubagentRunMap = new Map()
  for (const run of initial) inner.set(run.runId, run)
  return new Map([[chatId, inner]])
}

function baseRun(overrides: Partial<SubagentRunSnapshot> = {}): SubagentRunSnapshot {
  return {
    runId: "run-1",
    chatId: "chat-1",
    subagentId: "agent-1",
    subagentName: "Test Agent",
    label: null,
    provider: "claude",
    model: "claude-opus-4-5",
    status: "running",
    parentUserMessageId: "msg-1",
    parentRunId: null,
    depth: 0,
    startedAt: TS,
    finishedAt: null,
    finalText: null,
    error: null,
    usage: null,
    entries: [],
    pendingTool: null,
    ...overrides,
  }
}

function startedEvent(
  overrides: Partial<Extract<SubagentRunEvent, { type: "subagent_run_started" }>> = {},
): Extract<SubagentRunEvent, { type: "subagent_run_started" }> {
  return {
    v: 3,
    type: "subagent_run_started",
    timestamp: TS,
    chatId: "chat-1",
    runId: "run-1",
    subagentId: "agent-1",
    subagentName: "Test Agent",
    label: "My label",
    provider: "claude",
    model: "claude-opus-4-5",
    parentUserMessageId: "msg-1",
    parentRunId: null,
    depth: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// applySubagentEvent — subagent_run_started
// ---------------------------------------------------------------------------

describe("applySubagentEvent / subagent_run_started", () => {
  test("creates a new run snapshot in the inner map", () => {
    const map = new Map<string, SubagentRunMap>([["chat-1", new Map()]])
    applySubagentEvent(map, startedEvent())
    const run = map.get("chat-1")?.get("run-1")
    expect(run).toBeDefined()
    expect(run?.status).toBe("running")
    expect(run?.subagentId).toBe("agent-1")
    expect(run?.label).toBe("My label")
    expect(run?.entries).toEqual([])
    expect(run?.pendingTool).toBeNull()
  })

  test("defaults label to null when event.label is absent", () => {
    const event = startedEvent()
    const { label: _removed, ...rest } = event
    const map = new Map<string, SubagentRunMap>([["chat-1", new Map()]])
    applySubagentEvent(map, rest as typeof event)
    expect(map.get("chat-1")?.get("run-1")?.label).toBeNull()
  })

  test("no-ops when chatId not in outer map", () => {
    const map = new Map<string, SubagentRunMap>()
    applySubagentEvent(map, startedEvent())
    expect(map.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// applySubagentEvent — subagent_message_delta
// ---------------------------------------------------------------------------

describe("applySubagentEvent / subagent_message_delta", () => {
  test("appends content to finalText", () => {
    const run = baseRun({ finalText: "hello " })
    const outer = makeRunsByChatId("chat-1", [run])
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_message_delta",
      timestamp: TS,
      chatId: "chat-1",
      runId: "run-1",
      content: "world",
    })
    expect(outer.get("chat-1")?.get("run-1")?.finalText).toBe("hello world")
  })

  test("initialises finalText from null", () => {
    const run = baseRun({ finalText: null })
    const outer = makeRunsByChatId("chat-1", [run])
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_message_delta",
      timestamp: TS,
      chatId: "chat-1",
      runId: "run-1",
      content: "first",
    })
    expect(outer.get("chat-1")?.get("run-1")?.finalText).toBe("first")
  })

  test("no-ops for unknown runId", () => {
    const run = baseRun()
    const outer = makeRunsByChatId("chat-1", [run])
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_message_delta",
      timestamp: TS,
      chatId: "chat-1",
      runId: "run-UNKNOWN",
      content: "x",
    })
    expect(outer.get("chat-1")?.get("run-1")?.finalText).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// applySubagentEvent — subagent_entry_appended
// ---------------------------------------------------------------------------

describe("applySubagentEvent / subagent_entry_appended", () => {
  test("pushes a non-result entry without touching usage", () => {
    const run = baseRun()
    const outer = makeRunsByChatId("chat-1", [run])
    const entry = {
      kind: "assistant_text" as const,
      _id: "at-1",
      createdAt: TS,
      text: "hello",
    }
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_entry_appended",
      timestamp: TS,
      chatId: "chat-1",
      runId: "run-1",
      entry,
    })
    const updated = outer.get("chat-1")?.get("run-1")
    expect(updated?.entries).toHaveLength(1)
    expect(updated?.entries[0]).toEqual(entry)
    expect(updated?.usage).toBeNull()
  })

  test("mirrors usage from a result entry", () => {
    const run = baseRun()
    const outer = makeRunsByChatId("chat-1", [run])
    const resultEntry = {
      kind: "result" as const,
      _id: "res-1",
      createdAt: TS,
      subtype: "success" as const,
      isError: false,
      durationMs: 100,
      result: "done",
      costUsd: 0.05,
      usage: { inputTokens: 10, outputTokens: 20 },
    }
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_entry_appended",
      timestamp: TS,
      chatId: "chat-1",
      runId: "run-1",
      entry: resultEntry,
    })
    const updated = outer.get("chat-1")?.get("run-1")
    expect(updated?.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cachedInputTokens: undefined,
      costUsd: 0.05,
    })
  })
})

// ---------------------------------------------------------------------------
// applySubagentEvent — subagent_run_completed
// ---------------------------------------------------------------------------

describe("applySubagentEvent / subagent_run_completed", () => {
  test("sets status completed, finishedAt, finalText", () => {
    const run = baseRun()
    const outer = makeRunsByChatId("chat-1", [run])
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_run_completed",
      timestamp: TS + 1000,
      chatId: "chat-1",
      runId: "run-1",
      finalContent: "result text",
      usage: { inputTokens: 5, outputTokens: 8 },
    })
    const updated = outer.get("chat-1")?.get("run-1")
    expect(updated?.status).toBe("completed")
    expect(updated?.finishedAt).toBe(TS + 1000)
    expect(updated?.finalText).toBe("result text")
    expect(updated?.usage?.inputTokens).toBe(5)
  })

  test("preserves existing mirrored usage when event omits it", () => {
    const run = baseRun({ usage: { inputTokens: 99 } })
    const outer = makeRunsByChatId("chat-1", [run])
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_run_completed",
      timestamp: TS + 1000,
      chatId: "chat-1",
      runId: "run-1",
      finalContent: "done",
      // no usage field
    })
    expect(outer.get("chat-1")?.get("run-1")?.usage?.inputTokens).toBe(99)
  })
})

// ---------------------------------------------------------------------------
// applySubagentEvent — subagent_run_failed
// ---------------------------------------------------------------------------

describe("applySubagentEvent / subagent_run_failed", () => {
  test("sets status failed and clears pendingTool", () => {
    const run = baseRun({
      pendingTool: { toolUseId: "t1", toolKind: "ask_user_question", input: {}, requestedAt: TS },
    })
    const outer = makeRunsByChatId("chat-1", [run])
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_run_failed",
      timestamp: TS + 500,
      chatId: "chat-1",
      runId: "run-1",
      error: { code: "TIMEOUT", message: "timed out" },
    })
    const updated = outer.get("chat-1")?.get("run-1")
    expect(updated?.status).toBe("failed")
    expect(updated?.finishedAt).toBe(TS + 500)
    expect(updated?.error?.code).toBe("TIMEOUT")
    expect(updated?.pendingTool).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// applySubagentEvent — subagent_run_cancelled
// ---------------------------------------------------------------------------

describe("applySubagentEvent / subagent_run_cancelled", () => {
  test("sets status cancelled and clears pendingTool", () => {
    const run = baseRun({
      pendingTool: { toolUseId: "t1", toolKind: "exit_plan_mode", input: {}, requestedAt: TS },
    })
    const outer = makeRunsByChatId("chat-1", [run])
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_run_cancelled",
      timestamp: TS + 200,
      chatId: "chat-1",
      runId: "run-1",
    })
    const updated = outer.get("chat-1")?.get("run-1")
    expect(updated?.status).toBe("cancelled")
    expect(updated?.pendingTool).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// applySubagentEvent — subagent_tool_pending
// ---------------------------------------------------------------------------

describe("applySubagentEvent / subagent_tool_pending", () => {
  test("sets pendingTool on the run", () => {
    const run = baseRun()
    const outer = makeRunsByChatId("chat-1", [run])
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_tool_pending",
      timestamp: TS + 100,
      chatId: "chat-1",
      runId: "run-1",
      toolUseId: "tu-42",
      toolKind: "ask_user_question",
      input: { question: "What?" },
    })
    const updated = outer.get("chat-1")?.get("run-1")
    expect(updated?.pendingTool?.toolUseId).toBe("tu-42")
    expect(updated?.pendingTool?.toolKind).toBe("ask_user_question")
    expect(updated?.pendingTool?.requestedAt).toBe(TS + 100)
  })
})

// ---------------------------------------------------------------------------
// applySubagentEvent — subagent_tool_resolved
// ---------------------------------------------------------------------------

describe("applySubagentEvent / subagent_tool_resolved", () => {
  test("clears pendingTool and appends synthetic tool_result entry", () => {
    const run = baseRun({
      pendingTool: { toolUseId: "tu-42", toolKind: "ask_user_question", input: {}, requestedAt: TS },
    })
    const outer = makeRunsByChatId("chat-1", [run])
    applySubagentEvent(outer, {
      v: 3,
      type: "subagent_tool_resolved",
      timestamp: TS + 300,
      chatId: "chat-1",
      runId: "run-1",
      toolUseId: "tu-42",
      result: "User said yes",
      resolution: "user",
    })
    const updated = outer.get("chat-1")?.get("run-1")
    expect(updated?.pendingTool).toBeNull()
    expect(updated?.entries).toHaveLength(1)
    const entry = updated?.entries[0]
    expect(entry?.kind).toBe("tool_result")
    if (entry?.kind === "tool_result") {
      expect(entry._id).toBe("run-1:tu-42:resolved")
      expect(entry.toolId).toBe("tu-42")
      expect(entry.content).toBe("User said yes")
    }
  })
})

// ---------------------------------------------------------------------------
// getSubagentRuns
// ---------------------------------------------------------------------------

describe("getSubagentRuns", () => {
  test("returns runs keyed by runId", () => {
    const run1 = baseRun({ runId: "r1" })
    const run2 = baseRun({ runId: "r2", status: "completed" })
    const outer = makeRunsByChatId("chat-1", [run1, run2])
    const result = getSubagentRuns(outer, "chat-1")
    expect(Object.keys(result).sort()).toEqual(["r1", "r2"])
    expect(result.r1?.status).toBe("running")
    expect(result.r2?.status).toBe("completed")
  })

  test("returns empty object for unknown chatId", () => {
    const outer = new Map<string, SubagentRunMap>()
    expect(getSubagentRuns(outer, "no-such-chat")).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// runningSubagentRuns
// ---------------------------------------------------------------------------

describe("runningSubagentRuns", () => {
  test("yields only running runs across all chats", () => {
    const r1 = baseRun({ runId: "r1", chatId: "c1", status: "running" })
    const r2 = baseRun({ runId: "r2", chatId: "c1", status: "completed" })
    const r3 = baseRun({ runId: "r3", chatId: "c2", status: "running" })
    const r4 = baseRun({ runId: "r4", chatId: "c2", status: "failed" })

    const outer: Map<string, SubagentRunMap> = new Map([
      ["c1", new Map([["r1", r1], ["r2", r2]])],
      ["c2", new Map([["r3", r3], ["r4", r4]])],
    ])

    const runIds = [...runningSubagentRuns(outer)].map((r) => r.runId).sort()
    expect(runIds).toEqual(["r1", "r3"])
  })

  test("returns empty iterable when nothing is running", () => {
    const run = baseRun({ status: "cancelled" })
    const outer = makeRunsByChatId("chat-1", [run])
    expect([...runningSubagentRuns(outer)]).toHaveLength(0)
  })

  test("returns empty iterable for empty map", () => {
    expect([...runningSubagentRuns(new Map())]).toHaveLength(0)
  })
})
