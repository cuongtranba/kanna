import "../../../lib/testing/setupHappyDom"
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { useRef } from "react"
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
})
