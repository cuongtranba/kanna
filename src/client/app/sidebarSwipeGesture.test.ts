import { describe, expect, test } from "bun:test"
import {
  evaluateSidebarSwipe,
  shouldPreventNativeBack,
  SIDEBAR_SWIPE_HORIZONTAL_RATIO,
  SIDEBAR_SWIPE_MAX_DURATION_MS,
  SIDEBAR_SWIPE_MIN_HORIZONTAL_PX,
  SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX,
  SIDEBAR_SWIPE_OPEN_START_MAX_X,
  SIDEBAR_SWIPE_PREVENT_MIN_DX,
  type SwipeGestureContext,
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
