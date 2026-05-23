import { useEffect } from "react"

export const SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX = 768
export const SIDEBAR_SWIPE_OPEN_START_MIN_X = 20
export const SIDEBAR_SWIPE_OPEN_START_MAX_X = 60
export const SIDEBAR_SWIPE_MIN_HORIZONTAL_PX = 60
export const SIDEBAR_SWIPE_HORIZONTAL_RATIO = 1.5
export const SIDEBAR_SWIPE_MAX_DURATION_MS = 500

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

type UseSidebarSwipeGestureParams = {
  sidebarOpen: boolean
  onOpen: () => void
  onClose: () => void
}

export function useSidebarSwipeGesture({ sidebarOpen, onOpen, onClose }: UseSidebarSwipeGestureParams) {
  useEffect(() => {
    if (typeof window === "undefined") return

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

    function handleTouchEnd(event: TouchEvent) {
      const startPoint = start
      start = null
      if (!startPoint) return
      const touch = event.changedTouches[0]
      if (!touch) return
      const outcome = evaluateSidebarSwipe(
        startPoint,
        { x: touch.clientX, y: touch.clientY, t: event.timeStamp },
        { sidebarOpen, viewportWidth: window.innerWidth }
      )
      if (outcome === "open") onOpen()
      else if (outcome === "close") onClose()
    }

    function handleTouchCancel() {
      start = null
    }

    window.addEventListener("touchstart", handleTouchStart, { passive: true })
    window.addEventListener("touchend", handleTouchEnd, { passive: true })
    window.addEventListener("touchcancel", handleTouchCancel, { passive: true })

    return () => {
      window.removeEventListener("touchstart", handleTouchStart)
      window.removeEventListener("touchend", handleTouchEnd)
      window.removeEventListener("touchcancel", handleTouchCancel)
    }
  }, [sidebarOpen, onOpen, onClose])
}
