import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { DomPort } from "../ports/domPort"
import { makeFakeDomPort } from "../lib/testing/fakePorts"
import type { DrawerVisual } from "./drawerVisual"
import { useSidebarSwipeGesture } from "./sidebarSwipeGesture"

/**
 * Drives the REAL hook through synthetic touch events.
 *
 * The release ordering is the part of this feature that is easy to get subtly
 * wrong and impossible to notice in review: the class that holds a CLOSED
 * drawer on screen is released when the settle finishes, so opening must hand
 * over to React BEFORE that (or the drawer blinks out mid-settle) and closing
 * must settle BEFORE React hides it (or the settle plays against an element
 * that is already `display: none`). Asserting a hand-rolled recorder would
 * prove nothing about the hook, so this dispatches through it.
 */

const VIEWPORT_WIDTH = 390

type TouchHandlers = Partial<Record<string, (event: TouchEvent) => void>>

interface Harness {
  calls: string[]
  touch(points: Array<{ x: number; t: number }>): void
  /** Drag, then let the OS take the gesture instead of releasing it. */
  cancelAfter(points: Array<{ x: number; t: number }>): void
  finishSettle(): Promise<void>
  cleanup(): Promise<void>
}

function mountGesture(sidebarOpen: boolean): Harness {
  const calls: string[] = []
  const handlers: TouchHandlers = {}
  let resolveSettle: (() => void) | null = null

  const dom: DomPort = {
    ...makeFakeDomPort(),
    getInnerWidth: () => VIEWPORT_WIDTH,
    addWindowListenerWithOptions: (type, handler) => {
      handlers[type] = handler as (event: TouchEvent) => void
      return () => { delete handlers[type] }
    },
  }

  const visual: DrawerVisual = {
    track: (progress) => { calls.push(`track:${progress.toFixed(2)}`) },
    settle: (target) => {
      calls.push(`settle:${target}`)
      return new Promise<void>((resolve) => { resolveSettle = resolve })
    },
    release: () => { calls.push("release") },
  }

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)

  function Probe() {
    useSidebarSwipeGesture({
      sidebarOpen,
      onOpen: () => { calls.push("onOpen") },
      onClose: () => { calls.push("onClose") },
      visual,
      ports: { dom },
    })
    return null
  }

  act(() => { root.render(<Probe />) })

  const fire = (type: string, x: number, t: number, changed = false) => {
    const point = { clientX: x, clientY: 0 }
    const event = {
      timeStamp: t,
      cancelable: true,
      preventDefault: () => { /* claimed from native back-swipe */ },
      target: null,
      touches: changed ? [] : [point],
      changedTouches: [point],
    }
    act(() => { handlers[type]?.(event as unknown as TouchEvent) })
  }

  return {
    calls,
    touch(points) {
      const [first, ...rest] = points
      fire("touchstart", first.x, first.t)
      for (const point of rest.slice(0, -1)) fire("touchmove", point.x, point.t)
      const last = rest.at(-1) ?? first
      if (rest.length > 0) fire("touchmove", last.x, last.t)
      fire("touchend", last.x, last.t, true)
    },
    cancelAfter(points) {
      const [first, ...rest] = points
      fire("touchstart", first.x, first.t)
      for (const point of rest) fire("touchmove", point.x, point.t)
      fire("touchcancel", rest.at(-1)?.x ?? first.x, rest.at(-1)?.t ?? first.t, true)
    },
    async finishSettle() {
      resolveSettle?.()
      await Promise.resolve()
      await Promise.resolve()
    },
    async cleanup() {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

describe("the drawer under a finger", () => {
  test("a committed open hands over to React BEFORE the settle releases the class", async () => {
    const harness = mountGesture(false)
    // Starts inside the 60px edge band and travels past the 60px threshold.
    harness.touch([{ x: 10, t: 0 }, { x: 120, t: 60 }, { x: 200, t: 120 }])

    expect(harness.calls).toContain("track:0.49")
    const openIndex = harness.calls.indexOf("onOpen")
    const settleIndex = harness.calls.indexOf("settle:1")
    expect(openIndex).toBeGreaterThanOrEqual(0)
    expect(settleIndex).toBeGreaterThan(openIndex)
    await harness.cleanup()
  })

  test("a committed close settles BEFORE React hides the drawer", async () => {
    const harness = mountGesture(true)
    harness.touch([{ x: 300, t: 0 }, { x: 200, t: 60 }, { x: 100, t: 120 }])

    // The settle is in flight and nothing has closed yet.
    expect(harness.calls).toContain("settle:0")
    expect(harness.calls).not.toContain("onClose")

    await harness.finishSettle()
    expect(harness.calls.at(-1)).toBe("onClose")
    await harness.cleanup()
  })

  test("a drag too short to commit springs back to where it was", async () => {
    const harness = mountGesture(false)
    // 40px: drawn, but under SIDEBAR_SWIPE_MIN_HORIZONTAL_PX (60).
    harness.touch([{ x: 10, t: 0 }, { x: 50, t: 80 }])

    expect(harness.calls).toContain("track:0.10")
    expect(harness.calls).toContain("settle:0")
    expect(harness.calls).not.toContain("onOpen")
    await harness.cleanup()
  })

  test("a cancelled gesture releases the visual and opens nothing", async () => {
    // touchcancel fires when the OS takes the gesture (a call arriving, a
    // system edge swipe winning). Without the release the class stays on and a
    // closed drawer is left covering the whole viewport with nothing to
    // dismiss it.
    const harness = mountGesture(false)
    harness.cancelAfter([{ x: 10, t: 0 }, { x: 200, t: 60 }])

    expect(harness.calls).toContain("release")
    expect(harness.calls).not.toContain("onOpen")
    expect(harness.calls.some((call) => call.startsWith("settle"))).toBe(false)
    await harness.cleanup()
  })
})
