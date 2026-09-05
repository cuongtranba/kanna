import { beforeEach, describe, expect, test } from "bun:test"
import { useViewportStore } from "./viewportStore"

function resetStore() {
  useViewportStore.setState({ width: 0, height: 0 })
}

describe("viewportStore", () => {
  beforeEach(resetStore)

  test("starts unmeasured so hydration does not flash the mobile layout", () => {
    const { width, height } = useViewportStore.getState()
    expect(width).toBe(0)
    expect(height).toBe(0)
  })

  test("syncViewport records the measured size", () => {
    useViewportStore.getState().syncViewport(1440, 900)
    expect(useViewportStore.getState().width).toBe(1440)
    expect(useViewportStore.getState().height).toBe(900)
  })

  test("syncViewport is a no-op when the size is unchanged", () => {
    useViewportStore.getState().syncViewport(1440, 900)
    const before = useViewportStore.getState()
    before.syncViewport(1440, 900)
    expect(useViewportStore.getState()).toBe(before)
  })

  test("syncViewport produces new state when only one axis changes", () => {
    useViewportStore.getState().syncViewport(1440, 900)
    const before = useViewportStore.getState()
    before.syncViewport(1440, 901)
    expect(useViewportStore.getState()).not.toBe(before)
    expect(useViewportStore.getState().height).toBe(901)
  })

  test("ignores non-finite measurements rather than poisoning the store", () => {
    useViewportStore.getState().syncViewport(1440, 900)
    useViewportStore.getState().syncViewport(Number.NaN, 900)
    expect(useViewportStore.getState().width).toBe(1440)
  })
})
