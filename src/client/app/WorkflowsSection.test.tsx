import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { formatWorkflowResult, WorkflowRunDetail, WorkflowsSection, WorkflowsSectionWithDetail } from "./WorkflowsSection"
import type { WorkflowRun, WorkflowRunSummary } from "../../shared/workflow-types"
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

// ── WorkflowsSectionWithDetail — drill-in ─────────────────────────────────────

function makeFullRun(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: "run-full",
    workflowName: "deploy",
    status: "completed",
    startTime: 1000,
    durationMs: 60_000,
    agentCount: 2,
    totalTokens: 2000,
    totalToolCalls: 8,
    phases: [{ title: "Compile" }, { title: "Deploy" }],
    agents: [
      {
        index: 0,
        label: "compiler",
        state: "completed",
        model: "claude-sonnet-4-6",
        lastToolName: "bash",
        lastToolSummary: "fixed 1 · stale 2 · tests ✓",
        tokens: 1000,
        toolCalls: 5,
      },
    ],
    summary: "Build succeeded.",
    error: null,
    result: null,
    ...over,
  }
}

// ── WorkflowRunDetail — phase tree, previews, transcript drill-in ─────────────

async function mountDetail(run: WorkflowRun, onSelectAgent?: (agentId: string) => void) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(<WorkflowRunDetail run={run} onSelectAgent={onSelectAgent} />)
  })
  return { container, cleanup: () => container.remove() }
}

describe("WorkflowRunDetail — parity rendering", () => {
  test("groups agents under their phase titles (progress tree)", async () => {
    const run = makeFullRun({
      phases: [{ title: "Compile", detail: "build it" }, { title: "Deploy" }],
      agents: [
        { index: 1, label: "compiler", state: "completed", phaseIndex: 1 },
        { index: 2, label: "shipper", state: "running", phaseIndex: 2 },
      ],
    })
    const { container, cleanup } = await mountDetail(run)
    const tree = container.querySelector("[data-testid='workflow-progress-tree']")
    expect(tree).not.toBeNull()
    expect(tree!.textContent).toContain("Compile")
    expect(tree!.textContent).toContain("build it")
    expect(tree!.textContent).toContain("Deploy")
    expect(tree!.textContent).toContain("compiler")
    expect(tree!.textContent).toContain("shipper")
    cleanup()
  })

  test("renders per-agent prompt and result previews", async () => {
    const run = makeFullRun({
      agents: [{ index: 1, label: "modeler", state: "completed", promptPreview: "SYSTEM: read the code", resultPreview: "the cause is X" }],
    })
    const { container, cleanup } = await mountDetail(run)
    expect(container.textContent).toContain("SYSTEM: read the code")
    expect(container.textContent).toContain("the cause is X")
    cleanup()
  })

  test("renders the overall result and the script", async () => {
    const run = makeFullRun({
      result: JSON.stringify({ rootCause: "deadlock" }),
      script: "export const meta = { name: 'x' }",
    })
    const { container, cleanup } = await mountDetail(run)
    expect(container.textContent).toContain("rootCause")
    expect(container.textContent).toContain("export const meta")
    cleanup()
  })

  test("shows a Transcript button only when onSelectAgent + agentId are present; click fires it", async () => {
    const run = makeFullRun({
      agents: [{ index: 1, label: "modeler", state: "completed", agentId: "agent-xyz" }],
    })
    const onSelectAgent = mock((_id: string) => undefined)
    const { container, cleanup } = await mountDetail(run, onSelectAgent)
    const btn = container.querySelector<HTMLButtonElement>("[data-testid='workflow-agent-transcript:agent-xyz']")
    expect(btn).not.toBeNull()
    await act(async () => { btn!.click() })
    expect(onSelectAgent).toHaveBeenCalledWith("agent-xyz")
    cleanup()
  })

  test("no Transcript button when onSelectAgent is absent", async () => {
    const run = makeFullRun({ agents: [{ index: 1, label: "modeler", state: "completed", agentId: "agent-xyz" }] })
    const { container, cleanup } = await mountDetail(run)
    expect(container.querySelector("[data-testid='workflow-agent-transcript:agent-xyz']")).toBeNull()
    cleanup()
  })

  test("no Transcript button when the agent has no agentId", async () => {
    const run = makeFullRun({ agents: [{ index: 1, label: "modeler", state: "completed" }] })
    const onSelectAgent = mock((_id: string) => undefined)
    const { container, cleanup } = await mountDetail(run, onSelectAgent)
    expect(container.querySelector("[data-testid^='workflow-agent-transcript:']")).toBeNull()
    cleanup()
  })

  test("renders per-agent duration when present", async () => {
    const run = makeFullRun({ agents: [{ index: 1, label: "modeler", state: "completed", durationMs: 42_000 }] })
    const { container, cleanup } = await mountDetail(run)
    expect(container.textContent).toContain("42s")
    cleanup()
  })

  test("renders the error section for a failed run and suppresses it when completed", async () => {
    const failed = await mountDetail(makeFullRun({ status: "failed", error: "agent crashed" }))
    expect(failed.container.textContent).toContain("agent crashed")
    failed.cleanup()

    const completed = await mountDetail(makeFullRun({ status: "completed", error: "leftover stderr" }))
    expect(completed.container.textContent).not.toContain("leftover stderr")
    completed.cleanup()
  })
})

describe("formatWorkflowResult", () => {
  test("re-indents valid JSON", () => {
    expect(formatWorkflowResult('{"a":1}')).toBe('{\n  "a": 1\n}')
  })

  test("passes a plain (non-JSON) string through unchanged", () => {
    expect(formatWorkflowResult("just a sentence")).toBe("just a sentence")
  })

  test("passes a malformed JSON-looking string through unchanged", () => {
    expect(formatWorkflowResult("{not valid json")).toBe("{not valid json")
  })
})

describe("WorkflowsSectionWithDetail — drill-in", () => {
  test("clicking a row calls getRunDetail with the run id and shows detail", async () => {
    const fullRun = makeFullRun()
    const getRunDetail = mock(async (_runId: string): Promise<WorkflowRun | null> => fullRun)

    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <WorkflowsSectionWithDetail
          runs={[makeRun({ runId: "run-full", workflowName: "deploy" })]}
          getRunDetail={getRunDetail}
        />,
      )
    })

    const row = container.querySelector<HTMLButtonElement>("[data-testid='workflow-row:run-full']")
    expect(row).toBeDefined()

    await act(async () => { row!.click() })
    // getRunDetail should have been invoked with the run id
    expect(getRunDetail).toHaveBeenCalledWith("run-full")

    // After the async detail resolves, the agent tree should appear in the dialog
    // Radix Dialog renders into a portal (document.body), not the container
    await act(async () => {})
    expect(document.body.textContent).toContain("compiler")
    expect(document.body.textContent).toContain("Build succeeded.")
    // Per-agent outcome summary (fixed/stale/tests) surfaces in the drill-in.
    expect(document.body.textContent).toContain("fixed 1 · stale 2 · tests ✓")

    container.remove()
  })
})

async function mountWithDetail(props: {
  runs: WorkflowRunSummary[]
  getRunDetail: (runId: string) => Promise<WorkflowRun | null>
}): Promise<{ container: HTMLDivElement; rerender: (next: WorkflowRunSummary[]) => Promise<void>; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<WorkflowsSectionWithDetail runs={props.runs} getRunDetail={props.getRunDetail} />)
  })
  const rerender = async (next: WorkflowRunSummary[]) => {
    await act(async () => {
      root.render(<WorkflowsSectionWithDetail runs={next} getRunDetail={props.getRunDetail} />)
    })
  }
  return { container, rerender, cleanup: () => container.remove() }
}

function makeFullRunForPush(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: "run-1",
    workflowName: "wf",
    status: "running",
    startTime: 1,
    phases: [],
    agents: [],
    ...over,
  }
}

describe("WorkflowsSectionWithDetail re-fetch on snapshot push", () => {
  test("running row: snapshot push triggers a re-fetch and swaps detail without flashing 'loading'", async () => {
    const runRow = makeRun({ runId: "run-1", status: "running" })
    const detailV1 = makeFullRunForPush({
      agentCount: 2,
      agents: [{ index: 1, label: "pkg-alpha", agentId: "a1", state: "running" }],
    })
    const detailV2 = makeFullRunForPush({
      agentCount: 3,
      agents: [
        { index: 1, label: "pkg-alpha", agentId: "a1", state: "completed" },
        { index: 2, label: "pkg-bravo", agentId: "a2", state: "running" },
        { index: 3, label: "pkg-charlie", agentId: "a3", state: "running" },
      ],
    })
    const calls: string[] = []
    let n = 0
    const getRunDetail = mock(async (runId: string) => {
      calls.push(runId)
      return n++ === 0 ? detailV1 : detailV2
    })

    const { container, rerender, cleanup } = await mountWithDetail({ runs: [runRow], getRunDetail })

    const btn = container.querySelector<HTMLButtonElement>(`[data-testid="workflow-row:run-1"]`)
    expect(btn).not.toBeNull()
    await act(async () => { btn!.click() })
    expect(calls).toEqual(["run-1"])
    // v1 must be visible (alpha agent label rendered) but NOT bravo yet
    expect(document.body.textContent ?? "").toContain("pkg-alpha")
    expect(document.body.textContent ?? "").not.toContain("pkg-bravo")

    // snapshot push — same row, new prop reference (running unchanged)
    await rerender([{ ...runRow }])
    expect(calls).toEqual(["run-1", "run-1"])
    expect(document.body.textContent ?? "").toContain("pkg-charlie")

    cleanup()
  })

  test("terminal sidecar arriving stops further fetches", async () => {
    const runRow = makeRun({ runId: "run-1", status: "running" })
    const detail = makeFullRunForPush({
      agentCount: 1,
      agents: [{ index: 1, label: "a", agentId: "a1", state: "running" }],
    })
    const calls: string[] = []
    const getRunDetail = mock(async (runId: string) => { calls.push(runId); return detail })

    const { container, rerender, cleanup } = await mountWithDetail({ runs: [runRow], getRunDetail })
    const btn = container.querySelector<HTMLButtonElement>(`[data-testid="workflow-row:run-1"]`)!
    await act(async () => { btn.click() })
    expect(calls).toHaveLength(1)

    await rerender([{ ...runRow, status: "completed" }])
    expect(calls).toHaveLength(1)
    await rerender([{ ...runRow, status: "completed" }])
    expect(calls).toHaveLength(1)

    cleanup()
  })

  test("no React error #185 across many pushes (renderForLoopCheck)", async () => {
    const runRow = makeRun({ runId: "run-1", status: "running" })
    const detail = makeFullRunForPush({ agents: [] })
    const getRunDetail = mock(async () => detail)
    const result = await renderForLoopCheck(<WorkflowsSectionWithDetail runs={[runRow]} getRunDetail={getRunDetail} />)
    expect(result.loopWarnings).toEqual([])
  })
})
