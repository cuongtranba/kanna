import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { WorkflowMessage } from "./WorkflowMessage"

describe("WorkflowMessage", () => {
  test("renders name + live status pill, no render loop", async () => {
    const r = await renderForLoopCheck(
      <WorkflowMessage
        name="sonar-fix"
        description="fix sonar"
        run={{ runId: "wf_a", taskId: "t1", status: "running", phases: [], agents: [], agentCount: 3 }}
      />,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      const text = document.body.textContent ?? ""
      expect(text).toContain("sonar-fix")
      expect(text.toLowerCase()).toContain("running")
    } finally {
      await r.cleanup()
    }
  })

  test("renders without a run (started state)", async () => {
    const r = await renderForLoopCheck(<WorkflowMessage name="x" />)
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      const text = document.body.textContent ?? ""
      expect(text).toContain("x")
    } finally {
      await r.cleanup()
    }
  })

  test("renders fallback name 'Workflow' when no name given", async () => {
    const r = await renderForLoopCheck(<WorkflowMessage />)
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      const text = document.body.textContent ?? ""
      expect(text).toContain("Workflow")
    } finally {
      await r.cleanup()
    }
  })

  test("renders agent count when run has agentCount", async () => {
    const r = await renderForLoopCheck(
      <WorkflowMessage
        name="multi-agent"
        run={{ runId: "wf_b", taskId: "t2", status: "running", phases: [], agents: [], agentCount: 5 }}
      />,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      const text = document.body.textContent ?? ""
      expect(text).toContain("5")
    } finally {
      await r.cleanup()
    }
  })
})
