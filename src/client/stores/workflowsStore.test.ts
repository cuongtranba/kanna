import { describe, expect, test } from "bun:test"
import { useWorkflowsStore, selectRuns } from "./workflowsStore"
import type { WorkflowRunSummary } from "../../shared/workflow-types"

const run = (runId: string): WorkflowRunSummary => ({ runId, status: "running", phases: [], agents: [] })

describe("workflowsStore", () => {
  test("setRuns stores per chat; selectRuns returns them", () => {
    useWorkflowsStore.getState().setRuns("c1", [run("wf_a")])
    expect(selectRuns("c1")(useWorkflowsStore.getState()).map((r) => r.runId)).toEqual(["wf_a"])
  })
  test("selectRuns returns a STABLE empty ref for unknown chat (no render loop)", () => {
    const a = selectRuns("nope")(useWorkflowsStore.getState())
    const b = selectRuns("nope")(useWorkflowsStore.getState())
    expect(a).toBe(b)
    expect(a).toEqual([])
  })
})
