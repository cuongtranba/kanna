import "../../../lib/testing/setupHappyDom"
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { useRef, act } from "react"
import { createRoot } from "react-dom/client"
import { renderForLoopCheck } from "../../../lib/testing/renderForLoopCheck"
import { useViewportFetch, __clearViewportFetchCacheForTests, type ViewportFetchResult } from "./useViewportFetch"

type IOEntry = Partial<IntersectionObserverEntry> & { isIntersecting: boolean; target: Element }
let observerCallbacks: Array<(entries: IOEntry[]) => void> = []

beforeEach(() => {
  __clearViewportFetchCacheForTests()
  observerCallbacks = []
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    class FakeIO {
      callback: (entries: IOEntry[]) => void
      constructor(cb: (entries: IOEntry[]) => void) {
        this.callback = cb
        observerCallbacks.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
})

afterEach(() => {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
})

function Harness({ probe }: { probe: (state: ViewportFetchResult<string>) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useViewportFetch({
    ref,
    enabled: true,
    fetcher: async () => "hello",
    cacheKey: "k1",
  })
  probe(state)
  return <div ref={ref} />
}

describe("useViewportFetch", () => {
  test("starts idle before intersection", async () => {
    const states: Array<{ state: string }> = []
    const probe = mock((s: ViewportFetchResult<string>) => {
      states.push({ state: s.state })
    })
    const result = await renderForLoopCheck(<Harness probe={probe} />)
    expect(result.loopWarnings).toEqual([])
    expect(states[0]?.state).toBe("idle")
    await result.cleanup()
  })

  test("returns memo-stable object across renders with same state", async () => {
    const refs: ViewportFetchResult<string>[] = []
    const probe = mock((s: ViewportFetchResult<string>) => refs.push(s))
    const result = await renderForLoopCheck(<Harness probe={probe} />)
    expect(result.loopWarnings).toEqual([])
    if (refs.length >= 2) {
      expect(refs[0]).toBe(refs[1])
    }
    await result.cleanup()
  })

  test("resets state to idle when cacheKey switches to an uncached key on the same mounted root", async () => {
    function KeySwitchingHarness({ cacheKey, probe }: { cacheKey: string; probe: (s: ViewportFetchResult<string>) => void }) {
      const ref = useRef<HTMLDivElement>(null)
      const state = useViewportFetch({
        ref,
        enabled: true,
        fetcher: async () => `payload-${cacheKey}`,
        cacheKey,
      })
      probe(state)
      return <div ref={ref} />
    }

    const states: ViewportFetchResult<string>[] = []
    const probe = mock((s: ViewportFetchResult<string>) => states.push(s))

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(<KeySwitchingHarness cacheKey="k1" probe={probe} />)
      })
      const afterK1 = states[states.length - 1]
      expect(afterK1?.state).toBe("idle")

      await act(async () => {
        root.render(<KeySwitchingHarness cacheKey="k2" probe={probe} />)
      })
      const afterK2 = states[states.length - 1]
      expect(afterK2?.data).toBe(null)
      expect(afterK2?.state).toBe("idle")
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })
})
