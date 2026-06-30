import { describe, expect, test } from "bun:test"
import { parseWorkflowRunFile, toRunSummary } from "./workflow-types"

const RAW = {
  runId: "wf_abc",
  taskId: "tsk1",
  workflowName: "sonar-fix",
  status: "running",
  startTime: 1000,
  durationMs: 5000,
  agentCount: 2,
  totalTokens: 1234,
  totalToolCalls: 9,
  phases: [{ title: "Fix", detail: "one agent per dir" }],
  workflowProgress: [
    { type: "workflow_phase", index: 1, title: "Fix" },
    {
      type: "workflow_agent", index: 1, label: "fix:a", phaseIndex: 1,
      agentId: "a1", model: "claude-sonnet-4-6", state: "progress",
      lastToolName: "Read", lastToolSummary: "/x", promptPreview: "do x",
      resultPreview: "did x", tokens: 100, toolCalls: 3,
    },
  ],
  result: null, error: null, summary: "wip", script: "export const meta…",
  scriptPath: "/p/.wf.mjs", args: "[]",
}

describe("parseWorkflowRunFile", () => {
  test("parses a well-formed run", () => {
    const run = parseWorkflowRunFile(RAW)
    expect(run).not.toBeNull()
    expect(run!.runId).toBe("wf_abc")
    expect(run!.status).toBe("running")
    expect(run!.agents).toHaveLength(1)
    expect(run!.agents[0].label).toBe("fix:a")
    expect(run!.agents[0].promptPreview).toBe("do x")
    expect(run!.agents[0].resultPreview).toBe("did x")
    expect(run!.phases[0].title).toBe("Fix")
  })

  test("returns null for non-object / missing runId", () => {
    expect(parseWorkflowRunFile(null)).toBeNull()
    expect(parseWorkflowRunFile({ taskId: "x" })).toBeNull()
  })

  test("tolerates unknown status and missing optional fields", () => {
    const run = parseWorkflowRunFile({ runId: "wf_x", status: "weird" })
    expect(run).not.toBeNull()
    expect(run!.status).toBe("unknown")
    expect(run!.agents).toEqual([])
    expect(run!.phases).toEqual([])
  })

  test("toRunSummary drops heavy fields", () => {
    const sum = toRunSummary(parseWorkflowRunFile(RAW)!)
    expect(sum.runId).toBe("wf_abc")
    expect(sum.agentCount).toBe(2)
    expect("script" in sum).toBe(false)
    expect("args" in sum).toBe(false)
    expect(sum.agents[0].state).toBe("progress")
    expect("promptPreview" in sum.agents[0]).toBe(false)
    expect("resultPreview" in sum.agents[0]).toBe(false)
    expect("lastToolSummary" in sum.agents[0]).toBe(false)
  })
})
