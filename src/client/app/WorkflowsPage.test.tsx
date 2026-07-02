import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { WorkflowsPageView } from "./WorkflowsPage"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import type { WorkflowRun, WorkflowRunSummary } from "../../shared/workflow-types"
import type { TranscriptEntry } from "../../shared/types"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function summary(over: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    runId: "run-1",
    workflowName: "lock-investigation",
    status: "completed",
    startTime: 1000,
    durationMs: 60_000,
    agentCount: 1,
    totalTokens: 1000,
    totalToolCalls: 4,
    phases: [{ title: "Model" }],
    agents: [],
    ...over,
  }
}

function fullRun(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: "run-1",
    workflowName: "lock-investigation",
    status: "completed",
    startTime: 1000,
    durationMs: 60_000,
    agentCount: 1,
    totalTokens: 1000,
    totalToolCalls: 4,
    phases: [{ title: "Model" }],
    agents: [{ index: 1, label: "model:lock", state: "completed", agentId: "agent-1", phaseIndex: 1, promptPreview: "read the lock code" }],
    summary: "investigate the lock",
    result: null,
    error: null,
    ...over,
  }
}

async function mount(props: {
  runs: WorkflowRunSummary[]
  getRunDetail: (runId: string) => Promise<WorkflowRun | null>
  getAgentTranscript?: (runId: string, agentId: string) => Promise<TranscriptEntry[]>
}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const getAgentTranscript = props.getAgentTranscript ?? (async () => [])
  await act(async () => {
    createRoot(container).render(
      <WorkflowsPageView runs={props.runs} getRunDetail={props.getRunDetail} getAgentTranscript={getAgentTranscript} />,
    )
  })
  return { container, cleanup: () => container.remove() }
}

describe("WorkflowsPageView", () => {
  test("shows the empty prompt before any run is selected", async () => {
    const getRunDetail = mock(async (): Promise<WorkflowRun | null> => null)
    const { container, cleanup } = await mount({ runs: [summary()], getRunDetail })
    expect(container.textContent).toContain("Select a run")
    cleanup()
  })

  test("clicking a run fetches its detail and renders the progress tree", async () => {
    const getRunDetail = mock(async (_id: string): Promise<WorkflowRun | null> => fullRun())
    const { container, cleanup } = await mount({ runs: [summary({ runId: "run-1" })], getRunDetail })

    const row = container.querySelector<HTMLButtonElement>("[data-testid='workflow-row:run-1']")
    expect(row).not.toBeNull()
    await act(async () => { row!.click() })
    await act(async () => {})

    expect(getRunDetail).toHaveBeenCalledWith("run-1")
    expect(container.textContent).toContain("model:lock")
    expect(container.textContent).toContain("investigate the lock")
    cleanup()
  })

  test("clicking an agent's Transcript button fetches + shows the agent transcript", async () => {
    const getRunDetail = mock(async (): Promise<WorkflowRun | null> => fullRun())
    const getAgentTranscript = mock(async (_runId: string, _agentId: string): Promise<TranscriptEntry[]> => [])
    const { container, cleanup } = await mount({ runs: [summary({ runId: "run-1" })], getRunDetail, getAgentTranscript })

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='workflow-row:run-1']")!.click() })
    await act(async () => {})

    const transcriptBtn = container.querySelector<HTMLButtonElement>("[data-testid='workflow-agent-transcript:agent-1']")
    expect(transcriptBtn).not.toBeNull()
    await act(async () => { transcriptBtn!.click() })
    await act(async () => {})

    expect(getAgentTranscript).toHaveBeenCalledWith("run-1", "agent-1")
    expect(container.querySelector("[data-testid='workflow-agent-transcript-panel']")).not.toBeNull()
    cleanup()
  })

  test("back from the agent panel returns to the run detail", async () => {
    const getRunDetail = mock(async (): Promise<WorkflowRun | null> => fullRun())
    const getAgentTranscript = mock(async (): Promise<TranscriptEntry[]> => [])
    const { container, cleanup } = await mount({ runs: [summary({ runId: "run-1" })], getRunDetail, getAgentTranscript })

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='workflow-row:run-1']")!.click() })
    await act(async () => {})
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='workflow-agent-transcript:agent-1']")!.click() })
    await act(async () => {})
    expect(container.querySelector("[data-testid='workflow-agent-transcript-panel']")).not.toBeNull()

    await act(async () => { container.querySelector<HTMLButtonElement>("[aria-label='Back to run']")!.click() })
    expect(container.querySelector("[data-testid='workflow-agent-transcript-panel']")).toBeNull()
    expect(container.querySelector("[data-testid='workflow-progress-tree']")).not.toBeNull()
    cleanup()
  })

  test("shows a distinct 'not found' state when the detail fetch returns null", async () => {
    const getRunDetail = mock(async (): Promise<WorkflowRun | null> => null)
    const { container, cleanup } = await mount({ runs: [summary({ runId: "run-1" })], getRunDetail })
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='workflow-row:run-1']")!.click() })
    await act(async () => {})
    expect(container.textContent).toContain("Run not found")
    cleanup()
  })

  test("out-of-order detail fetches: the last-clicked run wins", async () => {
    const dA = deferred<WorkflowRun | null>()
    const dB = deferred<WorkflowRun | null>()
    const getRunDetail = mock((id: string) => (id === "run-a" ? dA.promise : dB.promise))
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <WorkflowsPageView
          runs={[summary({ runId: "run-a" }), summary({ runId: "run-b" })]}
          getRunDetail={getRunDetail}
          getAgentTranscript={async () => []}
        />,
      )
    })
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='workflow-row:run-a']")!.click() })
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='workflow-row:run-b']")!.click() })
    // run-b (clicked last) resolves first, then the slower run-a resolves.
    await act(async () => { dB.resolve(fullRun({ runId: "run-b", agents: [{ index: 1, label: "agent-from-B", state: "completed" }] })) })
    await act(async () => { dA.resolve(fullRun({ runId: "run-a", agents: [{ index: 1, label: "agent-from-A", state: "completed" }] })) })
    expect(container.textContent).toContain("agent-from-B")
    expect(container.textContent).not.toContain("agent-from-A")
    container.remove()
  })

  test("snapshot push re-fetches the selected running run in place", async () => {
    const v1 = fullRun({ runId: "run-1", status: "running", agents: [{ index: 1, label: "pkg-alpha", state: "running", agentId: "a1" }] })
    const v2 = fullRun({ runId: "run-1", status: "running", agents: [
      { index: 1, label: "pkg-alpha", state: "completed", agentId: "a1" },
      { index: 2, label: "pkg-bravo", state: "running", agentId: "a2" },
    ] })
    let n = 0
    const getRunDetail = mock(async (): Promise<WorkflowRun | null> => (n++ === 0 ? v1 : v2))
    const runRow = summary({ runId: "run-1", status: "running" })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<WorkflowsPageView runs={[runRow]} getRunDetail={getRunDetail} getAgentTranscript={async () => []} />)
    })
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='workflow-row:run-1']")!.click() })
    await act(async () => {})
    expect(container.textContent).toContain("pkg-alpha")
    expect(container.textContent).not.toContain("pkg-bravo")

    // snapshot push: new runs reference, still running → triggers the re-fetch
    await act(async () => {
      root.render(<WorkflowsPageView runs={[{ ...runRow }]} getRunDetail={getRunDetail} getAgentTranscript={async () => []} />)
    })
    await act(async () => {})
    expect(container.textContent).toContain("pkg-bravo")
    container.remove()
  })

  test("renders a Back-to-chat button only when onBackToChat is provided, and clicking it fires the callback", async () => {
    const getRunDetail = mock(async (): Promise<WorkflowRun | null> => null)
    const { container: bare, cleanup: cleanupBare } = await mount({ runs: [summary()], getRunDetail })
    expect(bare.querySelector("[aria-label='Back to chat']")).toBeNull()
    cleanupBare()

    const onBackToChat = mock(() => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <WorkflowsPageView
          runs={[summary()]}
          getRunDetail={getRunDetail}
          getAgentTranscript={async () => []}
          onBackToChat={onBackToChat}
        />,
      )
    })
    const btn = container.querySelector<HTMLButtonElement>("[aria-label='Back to chat']")
    expect(btn).not.toBeNull()
    await act(async () => { btn!.click() })
    expect(onBackToChat).toHaveBeenCalled()
    container.remove()
  })

  test("mounts without a render-loop warning", async () => {
    const getRunDetail = mock(async (): Promise<WorkflowRun | null> => null)
    const result = await renderForLoopCheck(
      <WorkflowsPageView runs={[summary()]} getRunDetail={getRunDetail} getAgentTranscript={async () => []} />,
    )
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })
})
