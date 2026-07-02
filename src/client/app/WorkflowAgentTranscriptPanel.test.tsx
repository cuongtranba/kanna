import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { WorkflowAgentTranscriptPanel } from "./WorkflowAgentTranscriptPanel"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import type { TranscriptEntry } from "../../shared/types"

function assistantText(text: string): TranscriptEntry {
  return {
    _id: crypto.randomUUID(),
    createdAt: 1,
    kind: "assistant_text",
    text,
  } as unknown as TranscriptEntry
}

async function mount(props: Partial<Parameters<typeof WorkflowAgentTranscriptPanel>[0]> & {
  getTranscript: (runId: string, agentId: string) => Promise<TranscriptEntry[]>
}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const onClose = props.onClose ?? mock(() => undefined)
  await act(async () => {
    createRoot(container).render(
      <WorkflowAgentTranscriptPanel
        runId={props.runId ?? "wf_1"}
        agentId={props.agentId ?? "a1"}
        agentLabel={props.agentLabel ?? "model:x"}
        promptPreview={props.promptPreview}
        agentIsRunning={props.agentIsRunning}
        onClose={onClose}
        getTranscript={props.getTranscript}
      />,
    )
  })
  // let the fetch promise resolve + re-render
  await act(async () => {})
  return { container, onClose, cleanup: () => container.remove() }
}

describe("WorkflowAgentTranscriptPanel", () => {
  test("calls getTranscript with runId + agentId and renders the agent label", async () => {
    const getTranscript = mock(async (_runId: string, _agentId: string): Promise<TranscriptEntry[]> => [])
    const { container, cleanup } = await mount({ runId: "wf_9", agentId: "agent-7", agentLabel: "verify:lock", getTranscript })
    expect(getTranscript).toHaveBeenCalledWith("wf_9", "agent-7")
    expect(container.textContent).toContain("verify:lock")
    cleanup()
  })

  test("renders the empty state when no entries come back", async () => {
    const getTranscript = mock(async (): Promise<TranscriptEntry[]> => [])
    const { container, cleanup } = await mount({ getTranscript })
    expect(container.textContent).toContain("No transcript recorded yet.")
    cleanup()
  })

  test("renders transcript entries after they resolve", async () => {
    const getTranscript = mock(async (): Promise<TranscriptEntry[]> => [assistantText("the root cause is a deadlock")])
    const { container, cleanup } = await mount({ getTranscript })
    expect(container.textContent).toContain("the root cause is a deadlock")
    cleanup()
  })

  test("renders an error state when the fetch rejects", async () => {
    const getTranscript = mock(async (): Promise<TranscriptEntry[]> => { throw new Error("boom") })
    const { container, cleanup } = await mount({ getTranscript })
    expect(container.textContent).toContain("boom")
    cleanup()
  })

  test("renders the prompt preview when provided", async () => {
    const getTranscript = mock(async (): Promise<TranscriptEntry[]> => [])
    const { container, cleanup } = await mount({ getTranscript, promptPreview: "SYSTEM: investigate the lock" })
    expect(container.textContent).toContain("SYSTEM: investigate the lock")
    cleanup()
  })

  test("clicking back calls onClose", async () => {
    const getTranscript = mock(async (): Promise<TranscriptEntry[]> => [])
    const onClose = mock(() => undefined)
    const { container, cleanup } = await mount({ getTranscript, onClose })
    const back = container.querySelector<HTMLButtonElement>("[aria-label='Back to run']")
    expect(back).not.toBeNull()
    await act(async () => { back!.click() })
    expect(onClose).toHaveBeenCalled()
    cleanup()
  })

  test("refresh button re-invokes getTranscript", async () => {
    const getTranscript = mock(async (): Promise<TranscriptEntry[]> => [])
    const { container, cleanup } = await mount({ getTranscript })
    expect(getTranscript).toHaveBeenCalledTimes(1)
    const refresh = container.querySelector<HTMLButtonElement>("[aria-label='Refresh transcript']")
    expect(refresh).not.toBeNull()
    await act(async () => { refresh!.click() })
    await act(async () => {})
    expect(getTranscript).toHaveBeenCalledTimes(2)
    cleanup()
  })

  test("shows the 'still running' hint when agentIsRunning", async () => {
    const getTranscript = mock(async (): Promise<TranscriptEntry[]> => [])
    const { container, cleanup } = await mount({ getTranscript, agentIsRunning: true })
    expect(container.textContent).toContain("still running")
    cleanup()
  })

  test("a fetch resolving after unmount neither throws nor updates (stale-abort)", async () => {
    let resolve!: (v: TranscriptEntry[]) => void
    const promise = new Promise<TranscriptEntry[]>((r) => { resolve = r })
    const getTranscript = mock(() => promise)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <WorkflowAgentTranscriptPanel runId="wf" agentId="a" agentLabel="x" onClose={() => undefined} getTranscript={getTranscript} />,
      )
    })
    await act(async () => { root.unmount() })
    await act(async () => { resolve([assistantText("late entry")]) })
    expect(container.textContent).not.toContain("late entry")
    container.remove()
  })

  test("mounts without a render-loop warning", async () => {
    const getTranscript = mock(async (): Promise<TranscriptEntry[]> => [assistantText("hi")])
    const result = await renderForLoopCheck(
      <WorkflowAgentTranscriptPanel
        runId="wf_1"
        agentId="a1"
        agentLabel="x"
        onClose={() => undefined}
        getTranscript={getTranscript}
      />,
    )
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })
})
