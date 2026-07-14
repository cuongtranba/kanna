import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { OrchestrationSection, StageChip, stageTone } from "./OrchestrationSection"
import type { OrchRunSummary } from "../../shared/orchestration-types"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"

function makeRun(over: Partial<OrchRunSummary> = {}): OrchRunSummary {
  return {
    runId: "run-1",
    title: "Run: 2 tasks",
    status: "running",
    counts: { total: 2, queued: 0, running: 1, committed: 1, failed: 0 },
    createdAt: 1,
    updatedAt: 2,
    ...over,
  }
}

async function mount(runs: OrchRunSummary[]): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(<OrchestrationSection runs={runs} onSelectRun={() => undefined} />)
  })
  return { container, cleanup: () => { container.remove() } }
}

describe("OrchestrationSection", () => {
  test("renders the empty state with no runs", async () => {
    const { container, cleanup } = await mount([])
    expect(container.querySelector('[data-testid="orch-empty"]')).not.toBeNull()
    cleanup()
  })

  test("renders a row per run with the title + counts", async () => {
    const { container, cleanup } = await mount([makeRun(), makeRun({ runId: "run-2", title: "Run: 1 task" })])
    expect(container.querySelector('[data-testid="orch-row:run-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="orch-row:run-2"]')).not.toBeNull()
    expect(container.textContent).toContain("Run: 2 tasks")
    expect(container.textContent).toContain("1 done")
    cleanup()
  })

  test("no render loop when mounted with effects", async () => {
    const result = await renderForLoopCheck(<OrchestrationSection runs={[makeRun()]} onSelectRun={() => undefined} />)
    expect(result.loopWarnings).toEqual([])
    result.cleanup()
  })
})

describe("stageTone", () => {
  test("maps stages to DESIGN.md semantic tones", () => {
    expect(stageTone("committed")).toBe("success")
    expect(stageTone("failed")).toBe("destructive")
    expect(stageTone("verify")).toBe("info")
    expect(stageTone("queued")).toBe("muted")
    expect(stageTone("implement")).toBe("running")
  })

  test("StageChip renders the label", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<StageChip stage="review" />) })
    expect(container.textContent).toContain("Review")
    container.remove()
  })
})
