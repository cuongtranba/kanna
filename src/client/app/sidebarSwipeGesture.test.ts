import { describe, expect, test } from "bun:test"
import {
  evaluateSidebarSwipe,
  shouldPreventNativeBack,
  sidebarDragProgress,
  SIDEBAR_SWIPE_HORIZONTAL_RATIO,
  SIDEBAR_SWIPE_MAX_DURATION_MS,
  SIDEBAR_SWIPE_MIN_HORIZONTAL_PX,
  SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX,
  SIDEBAR_SWIPE_OPEN_START_MAX_X,
  SIDEBAR_SWIPE_PREVENT_MIN_DX,
  type SwipeGestureContext,
  type SwipePoint,
} from "./sidebarSwipeGesture"

const MOBILE_CTX_CLOSED: SwipeGestureContext = {
  sidebarOpen: false,
  viewportWidth: SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX - 1,
}
const MOBILE_CTX_OPEN: SwipeGestureContext = {
  sidebarOpen: true,
  viewportWidth: SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX - 1,
}
const DESKTOP_CTX_CLOSED: SwipeGestureContext = {
  sidebarOpen: false,
  viewportWidth: SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX,
}

describe("evaluateSidebarSwipe", () => {
  test("opens on right swipe starting in safe band", () => {
    const result = evaluateSidebarSwipe(
      { x: 30, y: 200, t: 0 },
      { x: 30 + SIDEBAR_SWIPE_MIN_HORIZONTAL_PX + 5, y: 210, t: 200 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBe("open")
  })

  test("opens on right swipe starting at the very left edge", () => {
    const result = evaluateSidebarSwipe(
      { x: 1, y: 200, t: 0 },
      { x: 1 + SIDEBAR_SWIPE_MIN_HORIZONTAL_PX + 5, y: 205, t: 200 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBe("open")
  })

  test("ignores right swipe starting past safe band", () => {
    const result = evaluateSidebarSwipe(
      { x: SIDEBAR_SWIPE_OPEN_START_MAX_X + 1, y: 200, t: 0 },
      { x: 200, y: 205, t: 200 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBeNull()
  })

  test("ignores swipe shorter than min horizontal threshold", () => {
    const result = evaluateSidebarSwipe(
      { x: 30, y: 200, t: 0 },
      { x: 30 + SIDEBAR_SWIPE_MIN_HORIZONTAL_PX - 1, y: 200, t: 200 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBeNull()
  })

  test("ignores swipe dominated by vertical motion", () => {
    const dx = SIDEBAR_SWIPE_MIN_HORIZONTAL_PX + 10
    const dy = dx * SIDEBAR_SWIPE_HORIZONTAL_RATIO + 1
    const result = evaluateSidebarSwipe(
      { x: 30, y: 200, t: 0 },
      { x: 30 + dx, y: 200 + dy, t: 200 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBeNull()
  })

  test("ignores swipe slower than max duration", () => {
    const result = evaluateSidebarSwipe(
      { x: 30, y: 200, t: 0 },
      { x: 200, y: 205, t: SIDEBAR_SWIPE_MAX_DURATION_MS + 1 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBeNull()
  })

  test("closes on left swipe when sidebar open", () => {
    const result = evaluateSidebarSwipe(
      { x: 300, y: 200, t: 0 },
      { x: 300 - SIDEBAR_SWIPE_MIN_HORIZONTAL_PX - 5, y: 210, t: 200 },
      MOBILE_CTX_OPEN
    )
    expect(result).toBe("close")
  })

  test("ignores left swipe when sidebar closed", () => {
    const result = evaluateSidebarSwipe(
      { x: 300, y: 200, t: 0 },
      { x: 100, y: 210, t: 200 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBeNull()
  })

  test("ignores right swipe when sidebar already open", () => {
    const result = evaluateSidebarSwipe(
      { x: 30, y: 200, t: 0 },
      { x: 200, y: 205, t: 200 },
      MOBILE_CTX_OPEN
    )
    expect(result).toBeNull()
  })

  test("ignores any swipe on desktop viewport", () => {
    const result = evaluateSidebarSwipe(
      { x: 30, y: 200, t: 0 },
      { x: 200, y: 205, t: 200 },
      DESKTOP_CTX_CLOSED
    )
    expect(result).toBeNull()
  })
})

// The pane tab strip scrolls horizontally and sits under the left-edge band, so
// swiping it back toward its first tab would otherwise fling the sidebar open.
describe("swipes that start inside a horizontal scroller", () => {
  const IN_SCROLLER: SwipeGestureContext = {
    ...MOBILE_CTX_CLOSED,
    startedInHorizontalScroller: true,
  }

  test("does not open the sidebar", () => {
    const result = evaluateSidebarSwipe(
      { x: 10, y: 40, t: 0 },
      { x: 10 + SIDEBAR_SWIPE_MIN_HORIZONTAL_PX + 5, y: 42, t: 200 },
      IN_SCROLLER
    )
    expect(result).toBeNull()
  })

  test("does not close the sidebar either", () => {
    const result = evaluateSidebarSwipe(
      { x: 300, y: 40, t: 0 },
      { x: 300 - SIDEBAR_SWIPE_MIN_HORIZONTAL_PX - 5, y: 42, t: 200 },
      { ...MOBILE_CTX_OPEN, startedInHorizontalScroller: true }
    )
    expect(result).toBeNull()
  })

  test("leaves the scroll to the browser instead of claiming it", () => {
    const result = shouldPreventNativeBack(
      { x: 2, y: 40, t: 0 },
      { x: 2 + SIDEBAR_SWIPE_PREVENT_MIN_DX + 1, y: 42, t: 80 },
      IN_SCROLLER
    )
    expect(result).toBe(false)
  })

  test("still opens the sidebar from the same point outside a scroller", () => {
    const result = evaluateSidebarSwipe(
      { x: 10, y: 40, t: 0 },
      { x: 10 + SIDEBAR_SWIPE_MIN_HORIZONTAL_PX + 5, y: 42, t: 200 },
      { ...MOBILE_CTX_CLOSED, startedInHorizontalScroller: false }
    )
    expect(result).toBe("open")
  })
})

describe("shouldPreventNativeBack", () => {
  test("blocks native back during a rightward edge swipe (opening)", () => {
    const result = shouldPreventNativeBack(
      { x: 2, y: 200, t: 0 },
      { x: 2 + SIDEBAR_SWIPE_PREVENT_MIN_DX + 1, y: 202, t: 80 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBe(true)
  })

  test("does not block before horizontal intent is clear", () => {
    const result = shouldPreventNativeBack(
      { x: 2, y: 200, t: 0 },
      { x: 2 + SIDEBAR_SWIPE_PREVENT_MIN_DX - 1, y: 202, t: 40 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBe(false)
  })

  test("does not block a vertical-dominant move (preserves scroll)", () => {
    const result = shouldPreventNativeBack(
      { x: 2, y: 200, t: 0 },
      { x: 2 + SIDEBAR_SWIPE_PREVENT_MIN_DX + 1, y: 260, t: 80 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBe(false)
  })

  test("does not block a rightward swipe starting past the open band", () => {
    const result = shouldPreventNativeBack(
      { x: SIDEBAR_SWIPE_OPEN_START_MAX_X + 1, y: 200, t: 0 },
      { x: SIDEBAR_SWIPE_OPEN_START_MAX_X + 1 + SIDEBAR_SWIPE_PREVENT_MIN_DX + 1, y: 202, t: 80 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBe(false)
  })

  test("does not block a leftward swipe while sidebar is closed", () => {
    const result = shouldPreventNativeBack(
      { x: 200, y: 200, t: 0 },
      { x: 200 - SIDEBAR_SWIPE_PREVENT_MIN_DX - 1, y: 202, t: 80 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBe(false)
  })

  test("blocks native nav during a leftward swipe while sidebar is open (closing)", () => {
    const result = shouldPreventNativeBack(
      { x: 200, y: 200, t: 0 },
      { x: 200 - SIDEBAR_SWIPE_PREVENT_MIN_DX - 1, y: 202, t: 80 },
      MOBILE_CTX_OPEN
    )
    expect(result).toBe(true)
  })

  test("ignores moves on desktop viewport", () => {
    const result = shouldPreventNativeBack(
      { x: 2, y: 200, t: 0 },
      { x: 2 + SIDEBAR_SWIPE_PREVENT_MIN_DX + 1, y: 202, t: 80 },
      DESKTOP_CTX_CLOSED
    )
    expect(result).toBe(false)
  })
})

describe("sidebarDragProgress", () => {
  const mobile = { sidebarOpen: false, viewportWidth: 390 }
  const open = { sidebarOpen: true, viewportWidth: 390 }
  const at = (x: number, t = 0): SwipePoint => ({ x, y: 0, t })

  test("opening tracks the finger 1:1 across the drawer's width", () => {
    expect(sidebarDragProgress(at(0), at(0), 300, mobile)).toBe(0)
    expect(sidebarDragProgress(at(0), at(150), 300, mobile)).toBe(0.5)
    expect(sidebarDragProgress(at(0), at(300), 300, mobile)).toBe(1)
  })

  test("closing starts from fully open and pushes back toward zero", () => {
    expect(sidebarDragProgress(at(300), at(300), 300, open)).toBe(1)
    expect(sidebarDragProgress(at(300), at(150), 300, open)).toBe(0.5)
    expect(sidebarDragProgress(at(300), at(0), 300, open)).toBe(0)
  })

  test("it never reports past either end, however far the finger travels", () => {
    expect(sidebarDragProgress(at(0), at(900), 300, mobile)).toBe(1)
    expect(sidebarDragProgress(at(300), at(-900), 300, open)).toBe(0)
  })

  test("a drag in the exhausted direction is not the drawer's to draw", () => {
    // Pulling right on an already-open drawer, or left on a closed one.
    expect(sidebarDragProgress(at(300), at(360), 300, open)).toBeNull()
    expect(sidebarDragProgress(at(0), at(-60), 300, mobile)).toBeNull()
  })

  test("it stands down where the gesture itself stands down", () => {
    expect(sidebarDragProgress(at(0), at(150), 300, { sidebarOpen: false, viewportWidth: 1200 })).toBeNull()
    expect(
      sidebarDragProgress(at(0), at(150), 300, { ...mobile, startedInHorizontalScroller: true }),
    ).toBeNull()
  })

  test("an unmeasured drawer reports nothing rather than dividing by zero", () => {
    expect(sidebarDragProgress(at(0), at(150), 0, mobile)).toBeNull()
  })

  test("tracking does not change what a release MEANS", () => {
    // The thresholds are the gesture users already learned. Progress is a
    // separate question, and a drag that draws must still be judged by
    // evaluateSidebarSwipe alone — here, 40px is drawn but does not open.
    const start = at(10, 0)
    const end = at(50, 100)
    expect(sidebarDragProgress(start, end, 300, mobile)).toBeCloseTo(40 / 300)
    expect(evaluateSidebarSwipe(start, end, mobile)).toBeNull()
  })
})
