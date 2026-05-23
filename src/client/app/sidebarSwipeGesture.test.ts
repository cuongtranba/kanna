import { describe, expect, test } from "bun:test"
import {
  evaluateSidebarSwipe,
  SIDEBAR_SWIPE_HORIZONTAL_RATIO,
  SIDEBAR_SWIPE_MAX_DURATION_MS,
  SIDEBAR_SWIPE_MIN_HORIZONTAL_PX,
  SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX,
  SIDEBAR_SWIPE_OPEN_START_MAX_X,
  SIDEBAR_SWIPE_OPEN_START_MIN_X,
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

  test("ignores right swipe starting in browser-back hot zone", () => {
    const result = evaluateSidebarSwipe(
      { x: SIDEBAR_SWIPE_OPEN_START_MIN_X - 1, y: 200, t: 0 },
      { x: 100, y: 205, t: 200 },
      MOBILE_CTX_CLOSED
    )
    expect(result).toBeNull()
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
