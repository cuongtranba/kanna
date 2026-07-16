import { describe, expect, test } from "bun:test"
import type { SubagentPendingTool, SubagentRunSnapshot } from "../../../shared/types"
import { collectPendingQuestionRuns } from "./ChatTranscriptViewport"

function makeRun(over: Partial<SubagentRunSnapshot> = {}): SubagentRunSnapshot {
  return {
    runId: "r1",
    chatId: "c1",
    subagentId: "sa-1",
    subagentName: "alpha",
    label: null,
    provider: "claude",
    model: "claude-opus-4-7",
    status: "running",
    parentUserMessageId: "u1",
    parentRunId: null,
    depth: 0,
    startedAt: 1,
    finishedAt: null,
    finalText: null,
    error: null,
    usage: null,
    entries: [],
    pendingTool: null,
    ...over,
  }
}

function pending(requestedAt: number): SubagentPendingTool {
  return {
    toolUseId: `t-${requestedAt}`,
    toolKind: "ask_user_question",
    input: { questions: [] },
    requestedAt,
  }
}

describe("collectPendingQuestionRuns", () => {
  test("returns empty when no run is awaiting input", () => {
    const runs = { r1: makeRun(), r2: makeRun({ runId: "r2", status: "completed" }) }
    expect(collectPendingQuestionRuns(runs)).toEqual([])
  })

  test("handles undefined map without throwing", () => {
    expect(collectPendingQuestionRuns(undefined)).toEqual([])
  })

  test("selects only runs with a pendingTool, oldest request first", () => {
    const runs: Record<string, SubagentRunSnapshot> = {
      r1: makeRun({ runId: "r1", pendingTool: pending(300) }),
      r2: makeRun({ runId: "r2", pendingTool: null }),
      r3: makeRun({ runId: "r3", pendingTool: pending(100) }),
      r4: makeRun({ runId: "r4", pendingTool: pending(200) }),
    }
    const result = collectPendingQuestionRuns(runs)
    expect(result.map((r) => r.runId)).toEqual(["r3", "r4", "r1"])
  })

  test("ties on requestedAt break deterministically by runId", () => {
    const runs: Record<string, SubagentRunSnapshot> = {
      rb: makeRun({ runId: "rb", pendingTool: pending(100) }),
      ra: makeRun({ runId: "ra", pendingTool: pending(100) }),
    }
    expect(collectPendingQuestionRuns(runs).map((r) => r.runId)).toEqual(["ra", "rb"])
  })

  test("narrows pendingTool to non-null for the caller", () => {
    const runs = { r1: makeRun({ pendingTool: pending(100) }) }
    const [run] = collectPendingQuestionRuns(runs)
    expect(run.pendingTool.requestedAt).toBe(100)
  })
})
