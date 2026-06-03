import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { WorkflowsSection } from "./WorkflowsSection"
import type { WorkflowRunSummary } from "../../shared/workflow-types"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"

function makeRun(over: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    runId: "run-1",
    workflowName: "build-and-test",
    status: "completed",
    startTime: 1000,
    durationMs: 42_000,
    agentCount: 3,
    totalTokens: 1500,
    totalToolCalls: 12,
    phases: [{ title: "Build" }, { title: "Test" }],
    agents: [],
    ...over,
  }
}

async function mountWorkflowsSection(props: {
  runs: WorkflowRunSummary[]
  onSelectRun?: (runId: string) => void
}): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(
      <WorkflowsSection
        runs={props.runs}
        onSelectRun={props.onSelectRun ?? (() => undefined)}
      />,
    )
  })
  return { container, cleanup: () => container.remove() }
}

describe("WorkflowsSection — empty state", () => {
  test("renders empty state when runs is empty", async () => {
    const { container, cleanup } = await mountWorkflowsSection({ runs: [] })
    expect(container.textContent).toContain("No workflow runs")
    cleanup()
  })
})

describe("WorkflowsSection — list rendering", () => {
  test("renders one row per run with workflowName visible", async () => {
    const { container, cleanup } = await mountWorkflowsSection({
      runs: [
        makeRun({ runId: "run-1", workflowName: "build-and-test" }),
        makeRun({ runId: "run-2", workflowName: "deploy" }),
      ],
    })
    expect(container.textContent).toContain("build-and-test")
    expect(container.textContent).toContain("deploy")
    cleanup()
  })

  test("falls back to runId when workflowName is absent", async () => {
    const { container, cleanup } = await mountWorkflowsSection({
      runs: [makeRun({ runId: "run-abc", workflowName: undefined })],
    })
    expect(container.textContent).toContain("run-abc")
    cleanup()
  })

  test("renders status text for each run", async () => {
    const { container, cleanup } = await mountWorkflowsSection({
      runs: [
        makeRun({ runId: "run-1", status: "completed" }),
        makeRun({ runId: "run-2", status: "running" }),
        makeRun({ runId: "run-3", status: "failed" }),
      ],
    })
    expect(container.textContent).toContain("Completed")
    expect(container.textContent).toContain("Running")
    expect(container.textContent).toContain("Failed")
    cleanup()
  })

  test("renders agentCount", async () => {
    const { container, cleanup } = await mountWorkflowsSection({
      runs: [makeRun({ runId: "run-1", agentCount: 7 })],
    })
    expect(container.textContent).toContain("7")
    cleanup()
  })

  test("clicking a row calls onSelectRun with the run's id", async () => {
    const onSelectRun = mock((_id: string) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <WorkflowsSection
          runs={[makeRun({ runId: "run-42" })]}
          onSelectRun={onSelectRun}
        />,
      )
    })
    const row = container.querySelector<HTMLButtonElement>("[data-testid='workflow-row:run-42']")
    expect(row).toBeDefined()
    await act(async () => { row!.click() })
    expect(onSelectRun).toHaveBeenCalledWith("run-42")
    container.remove()
  })
})

describe("WorkflowsSection — render-loop safety", () => {
  test("mounts without render-loop warning", async () => {
    const result = await renderForLoopCheck(
      <WorkflowsSection
        runs={[makeRun()]}
        onSelectRun={() => undefined}
      />,
    )
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })

  test("mounts with empty runs without render-loop warning", async () => {
    const result = await renderForLoopCheck(
      <WorkflowsSection
        runs={[]}
        onSelectRun={() => undefined}
      />,
    )
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })
})
