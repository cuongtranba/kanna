import { describe, expect, test } from "bun:test"
import type { HydratedTranscriptMessage, SubagentRunSnapshot } from "../../shared/types"
import {
  DELEGATE_SUBAGENT_TOOL_NAME,
  extractDelegateCalls,
  matchRunsToDelegateCalls,
  reportOrphanRuns,
} from "./subagent-run-placement"

function makeRun(overrides: Partial<SubagentRunSnapshot>): SubagentRunSnapshot {
  return {
    runId: "run-1",
    chatId: "chat-1",
    subagentId: "sub-a",
    subagentName: "Sub A",
    label: null,
    provider: "claude",
    model: "",
    status: "running",
    parentUserMessageId: "user-1",
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

function makeDelegateMessage(toolId: string, subagentId: string): HydratedTranscriptMessage {
  return {
    id: toolId,
    kind: "tool",
    toolKind: "mcp_generic",
    toolName: DELEGATE_SUBAGENT_TOOL_NAME,
    toolId,
    input: { server: "kanna", tool: "delegate_subagent", payload: { subagent_id: subagentId } },
    rawInput: { subagent_id: subagentId, prompt: "do it" },
    timestamp: "2026-06-01T00:00:00.000Z",
  } as unknown as HydratedTranscriptMessage
}

describe("extractDelegateCalls", () => {
  test("pulls delegate tool calls in transcript order with subagent_id", () => {
    const messages: HydratedTranscriptMessage[] = [
      makeDelegateMessage("tool-1", "sub-a"),
      makeDelegateMessage("tool-2", "sub-b"),
    ]
    expect(extractDelegateCalls(messages)).toEqual([
      { toolId: "tool-1", subagentId: "sub-a" },
      { toolId: "tool-2", subagentId: "sub-b" },
    ])
  })

  test("ignores non-delegate tool calls and non-tool messages", () => {
    const bash = {
      id: "bash-1",
      kind: "tool",
      toolKind: "bash",
      toolName: "Bash",
      toolId: "bash-1",
      input: {},
      rawInput: {},
      timestamp: "2026-06-01T00:00:00.000Z",
    } as unknown as HydratedTranscriptMessage
    const text = { id: "t-1", kind: "assistant_text" } as unknown as HydratedTranscriptMessage
    const messages: HydratedTranscriptMessage[] = [bash, text, makeDelegateMessage("tool-1", "sub-a")]
    expect(extractDelegateCalls(messages)).toEqual([{ toolId: "tool-1", subagentId: "sub-a" }])
  })
})

describe("matchRunsToDelegateCalls", () => {
  test("matches one delegate call to one run", () => {
    const delegateCalls = [{ toolId: "tool-1", subagentId: "sub-a" }]
    const run = makeRun({ runId: "run-1", subagentId: "sub-a" })
    const { matched, orphans } = matchRunsToDelegateCalls(delegateCalls, [run])
    expect(matched.get("tool-1")).toBe(run)
    expect(orphans).toEqual([])
  })

  test("matches multiple delegates to same subagent by sequence", () => {
    const delegateCalls = [
      { toolId: "tool-1", subagentId: "sub-a" },
      { toolId: "tool-2", subagentId: "sub-a" },
    ]
    const r1 = makeRun({ runId: "run-1", subagentId: "sub-a", startedAt: 1000 })
    const r2 = makeRun({ runId: "run-2", subagentId: "sub-a", startedAt: 2000 })
    // pass out of order to prove startedAt ordering, not array order
    const { matched, orphans } = matchRunsToDelegateCalls(delegateCalls, [r2, r1])
    expect(matched.get("tool-1")).toBe(r1)
    expect(matched.get("tool-2")).toBe(r2)
    expect(orphans).toEqual([])
  })

  test("matches different subagents independently", () => {
    const delegateCalls = [
      { toolId: "tool-1", subagentId: "sub-a" },
      { toolId: "tool-2", subagentId: "sub-b" },
    ]
    const ra = makeRun({ runId: "run-a", subagentId: "sub-a" })
    const rb = makeRun({ runId: "run-b", subagentId: "sub-b" })
    const { matched, orphans } = matchRunsToDelegateCalls(delegateCalls, [ra, rb])
    expect(matched.get("tool-1")).toBe(ra)
    expect(matched.get("tool-2")).toBe(rb)
    expect(orphans).toEqual([])
  })

  test("a delegate call with no run yet produces no match and no orphan", () => {
    const delegateCalls = [{ toolId: "tool-1", subagentId: "sub-a" }]
    const { matched, orphans } = matchRunsToDelegateCalls(delegateCalls, [])
    expect(matched.size).toBe(0)
    expect(orphans).toEqual([])
  })

  test("a run with no delegate call is an orphan", () => {
    const orphan = makeRun({ runId: "run-x", subagentId: "sub-z" })
    const { matched, orphans } = matchRunsToDelegateCalls([], [orphan])
    expect(matched.size).toBe(0)
    expect(orphans).toEqual([orphan])
  })

  test("extra run beyond delegate count for same subagent is an orphan", () => {
    const delegateCalls = [{ toolId: "tool-1", subagentId: "sub-a" }]
    const r1 = makeRun({ runId: "run-1", subagentId: "sub-a", startedAt: 1000 })
    const r2 = makeRun({ runId: "run-2", subagentId: "sub-a", startedAt: 2000 })
    const { matched, orphans } = matchRunsToDelegateCalls(delegateCalls, [r1, r2])
    expect(matched.get("tool-1")).toBe(r1)
    expect(orphans).toEqual([r2])
  })
})

describe("reportOrphanRuns", () => {
  test("throws in dev when orphans exist", () => {
    const orphan = makeRun({ runId: "run-x", subagentId: "sub-z" })
    expect(() => reportOrphanRuns([orphan], true)).toThrow(/orphan/i)
  })

  test("does not throw in prod; logs instead", () => {
    const orphan = makeRun({ runId: "run-x", subagentId: "sub-z" })
    expect(() => reportOrphanRuns([orphan], false)).not.toThrow()
  })

  test("no-op when no orphans", () => {
    expect(() => reportOrphanRuns([], true)).not.toThrow()
  })
})
