import { useEffect } from "react"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

export const SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX = 768
// Open gesture may start at the very left edge (x = 0): we suppress the
// browser/PWA native back gesture in this band via shouldPreventNativeBack,
// so the edge swipe opens the panel instead of navigating back.
export const SIDEBAR_SWIPE_OPEN_START_MIN_X = 0
export const SIDEBAR_SWIPE_OPEN_START_MAX_X = 60
export const SIDEBAR_SWIPE_MIN_HORIZONTAL_PX = 60
export const SIDEBAR_SWIPE_HORIZONTAL_RATIO = 1.5
export const SIDEBAR_SWIPE_MAX_DURATION_MS = 500
// Horizontal travel (px) at which an in-progress move is committed enough to
// claim the gesture from the native back/forward swipe via preventDefault().
export const SIDEBAR_SWIPE_PREVENT_MIN_DX = 8

export type SwipePoint = {
  x: number
  y: number
  t: number
}

export type SwipeGestureOutcome = "open" | "close" | null

export type SwipeGestureContext = {
  sidebarOpen: boolean
  viewportWidth: number
}

export function evaluateSidebarSwipe(
  start: SwipePoint,
  end: SwipePoint,
  ctx: SwipeGestureContext
): SwipeGestureOutcome {
  if (ctx.viewportWidth >= SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX) return null

  const dx = end.x - start.x
  const dy = end.y - start.y
  const dt = end.t - start.t

  if (dt > SIDEBAR_SWIPE_MAX_DURATION_MS) return null
  if (Math.abs(dx) < SIDEBAR_SWIPE_MIN_HORIZONTAL_PX) return null
  if (Math.abs(dx) < Math.abs(dy) * SIDEBAR_SWIPE_HORIZONTAL_RATIO) return null

  if (!ctx.sidebarOpen && dx > 0) {
    if (start.x < SIDEBAR_SWIPE_OPEN_START_MIN_X) return null
    if (start.x > SIDEBAR_SWIPE_OPEN_START_MAX_X) return null
    return "open"
  }

  if (ctx.sidebarOpen && dx < 0) {
    return "close"
  }

  return null
}

/**
 * Decide, mid-gesture, whether to call preventDefault() on the touchmove so the
 * browser/PWA native edge swipe-back (or swipe-forward) does not steal the
 * gesture. Returns true only for the same horizontal motions evaluateSidebarSwipe
 * would later resolve to "open" / "close", so vertical scrolling and unrelated
 * swipes keep their default behaviour.
 */
export function shouldPreventNativeBack(
  start: SwipePoint,
  current: SwipePoint,
  ctx: SwipeGestureContext
): boolean {
  if (ctx.viewportWidth >= SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX) return false

  const dx = current.x - start.x
  const dy = current.y - start.y

  if (Math.abs(dx) < SIDEBAR_SWIPE_PREVENT_MIN_DX) return false
  if (Math.abs(dx) <= Math.abs(dy)) return false

  // Opening: rightward swipe from the left-edge band claims the native back.
  if (!ctx.sidebarOpen) {
    return dx > 0 && start.x <= SIDEBAR_SWIPE_OPEN_START_MAX_X
  }

  // Closing: leftward swipe while the sidebar is open claims native forward/back.
  return dx < 0
}

interface SidebarSwipeGesturePorts {
  dom: DomPort
}

const DEFAULT_PORTS: SidebarSwipeGesturePorts = {
  dom: domAdapter,
}

type UseSidebarSwipeGestureParams = {
  sidebarOpen: boolean
  onOpen: () => void
  onClose: () => void
  ports?: SidebarSwipeGesturePorts
}

export function useSidebarSwipeGesture({ sidebarOpen, onOpen, onClose, ports = DEFAULT_PORTS }: UseSidebarSwipeGestureParams) {
  const { dom } = ports

  useEffect(() => {
    let start: SwipePoint | null = null

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        start = null
        return
      }
      const touch = event.touches[0]
      if (!touch) return
      start = { x: touch.clientX, y: touch.clientY, t: event.timeStamp }
    }

    function handleTouchMove(event: TouchEvent) {
      const startPoint = start
      if (!startPoint) return
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      if (!touch) return
      const prevent = shouldPreventNativeBack(
        startPoint,
        { x: touch.clientX, y: touch.clientY, t: event.timeStamp },
        { sidebarOpen, viewportWidth: dom.getInnerWidth() }
      )
      // Claim the gesture from the native edge swipe-back so the move resolves
      // to opening/closing the sidebar instead of navigating history.
      if (prevent && event.cancelable) event.preventDefault()
    }

    function handleTouchEnd(event: TouchEvent) {
      const startPoint = start
      start = null
      if (!startPoint) return
      const touch = event.changedTouches[0]
      if (!touch) return
      const outcome = evaluateSidebarSwipe(
        startPoint,
        { x: touch.clientX, y: touch.clientY, t: event.timeStamp },
        { sidebarOpen, viewportWidth: dom.getInnerWidth() }
      )
      if (outcome === "open") onOpen()
      else if (outcome === "close") onClose()
    }

    function handleTouchCancel() {
      start = null
    }

    const cleanupTouchStart = dom.addWindowListenerWithOptions("touchstart", handleTouchStart, { passive: true })
    // Non-passive so preventDefault() can suppress the native edge swipe-back.
    const cleanupTouchMove = dom.addWindowListenerWithOptions("touchmove", handleTouchMove, { passive: false })
    const cleanupTouchEnd = dom.addWindowListenerWithOptions("touchend", handleTouchEnd, { passive: true })
    const cleanupTouchCancel = dom.addWindowListenerWithOptions("touchcancel", handleTouchCancel, { passive: true })

    return () => {
      cleanupTouchStart()
      cleanupTouchMove()
      cleanupTouchEnd()
      cleanupTouchCancel()
    }
  }, [sidebarOpen, onOpen, onClose, dom])
}
