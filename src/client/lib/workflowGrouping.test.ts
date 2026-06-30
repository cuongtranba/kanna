import { describe, expect, test } from "bun:test"
import { groupWorkflowAgentsByPhase } from "./workflowGrouping"
import type { WorkflowAgentProgress, WorkflowPhase } from "../../shared/workflow-types"

function agent(partial: Partial<WorkflowAgentProgress> & { index: number }): WorkflowAgentProgress {
  return { label: `a${partial.index}`, state: "done", ...partial }
}

const PHASES: WorkflowPhase[] = [
  { title: "Model", detail: "read code" },
  { title: "Verify", detail: "refute" },
]

describe("groupWorkflowAgentsByPhase", () => {
  test("returns [] when there are no agents", () => {
    expect(groupWorkflowAgentsByPhase(PHASES, [])).toEqual([])
  })

  test("flat 'Agents' box when no agent carries a phase", () => {
    const groups = groupWorkflowAgentsByPhase([], [agent({ index: 1 }), agent({ index: 2 })])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ phaseIndex: null, title: "Agents" })
    expect(groups[0].agents).toHaveLength(2)
  })

  test("groups phased agents under declared phases in order", () => {
    const groups = groupWorkflowAgentsByPhase(PHASES, [
      agent({ index: 1, phaseIndex: 1 }),
      agent({ index: 2, phaseIndex: 2 }),
      agent({ index: 3, phaseIndex: 1 }),
    ])
    expect(groups.map((g) => g.title)).toEqual(["Model", "Verify"])
    expect(groups[0].agents.map((a) => a.index)).toEqual([1, 3])
    expect(groups[1].agents.map((a) => a.index)).toEqual([2])
    expect(groups[0].detail).toBe("read code")
  })

  test("keeps declared phases that have no agents (upcoming phase boxes)", () => {
    const groups = groupWorkflowAgentsByPhase(PHASES, [agent({ index: 1, phaseIndex: 1 })])
    expect(groups.map((g) => g.title)).toEqual(["Model", "Verify"])
    expect(groups[1].agents).toEqual([])
  })

  test("trailing 'Agents' box for phased run with some unphased stragglers", () => {
    const groups = groupWorkflowAgentsByPhase(PHASES, [
      agent({ index: 1, phaseIndex: 1 }),
      agent({ index: 2 }),
    ])
    const last = groups[groups.length - 1]
    expect(last).toMatchObject({ phaseIndex: null, title: "Agents" })
    expect(last.agents.map((a) => a.index)).toEqual([2])
  })

  test("surfaces a phase index an agent references but the run never declared", () => {
    const groups = groupWorkflowAgentsByPhase([], [agent({ index: 1, phaseIndex: 3, phaseTitle: "Synthesize" })])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ phaseIndex: 3, title: "Synthesize" })
  })
})
