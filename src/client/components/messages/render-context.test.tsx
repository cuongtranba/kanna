import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { TranscriptRenderOptionsProvider, useTranscriptRenderOptions } from "./render-context"

const STABLE_OPTIONS = { askUserQuestionSurface: "footer" } as const

function Probe({ seen }: { seen: unknown[] }) {
  const options = useTranscriptRenderOptions()
  seen.push(options)
  return <span>{options.askUserQuestionSurface}</span>
}

describe("TranscriptRenderOptionsProvider", () => {
  test("defaults askUserQuestionSurface to inline", async () => {
    const seen: unknown[] = []
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(<Probe seen={seen} />)
    })

    expect(container.textContent).toBe("inline")
    container.remove()
  })

  test("publishes a referentially stable value when `value` is stable", async () => {
    const seen: unknown[] = []
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    const tree = () => (
      <TranscriptRenderOptionsProvider value={STABLE_OPTIONS}>
        <Probe seen={seen} />
      </TranscriptRenderOptionsProvider>
    )

    await act(async () => { root.render(tree()) })
    await act(async () => { root.render(tree()) })

    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen[seen.length - 1]).toBe(seen[0])
    container.remove()
  })

  test("mounts without triggering a render loop", async () => {
    const result = await renderForLoopCheck(
      <TranscriptRenderOptionsProvider value={STABLE_OPTIONS}>
        <Probe seen={[]} />
      </TranscriptRenderOptionsProvider>,
    )
    try {
      expect(result.loopWarnings).toHaveLength(0)
      expect(result.thrown).toBeNull()
    } finally {
      await result.cleanup()
    }
  })
})
