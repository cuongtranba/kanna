import { useEffect } from "react"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"
import { BREAKPOINT_MD } from "../lib/viewport"
import type { DrawerVisual } from "./drawerVisual"

export const SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX = BREAKPOINT_MD
export const SIDEBAR_SWIPE_OPEN_START_MIN_X = 0
export const SIDEBAR_SWIPE_OPEN_START_MAX_X = 60
export const SIDEBAR_SWIPE_MIN_HORIZONTAL_PX = 60
export const SIDEBAR_SWIPE_HORIZONTAL_RATIO = 1.5
export const SIDEBAR_SWIPE_MAX_DURATION_MS = 500
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
  startedInHorizontalScroller?: boolean
}

export const HORIZONTAL_SCROLLER_SELECTOR = "[data-swipe-scroll-x]"

export function evaluateSidebarSwipe(
  start: SwipePoint,
  end: SwipePoint,
  ctx: SwipeGestureContext
): SwipeGestureOutcome {
  if (ctx.viewportWidth >= SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX) return null
  if (ctx.startedInHorizontalScroller) return null

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

export function sidebarDragProgress(
  start: SwipePoint,
  current: SwipePoint,
  drawerWidth: number,
  ctx: SwipeGestureContext,
): number | null {
  if (ctx.viewportWidth >= SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX) return null
  if (ctx.startedInHorizontalScroller) return null
  if (!(drawerWidth > 0)) return null

  const dx = current.x - start.x
  const base = ctx.sidebarOpen ? 1 : 0
  if (ctx.sidebarOpen ? dx > 0 : dx < 0) return null

  return clamp01(base + dx / drawerWidth)
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function shouldPreventNativeBack(
  start: SwipePoint,
  current: SwipePoint,
  ctx: SwipeGestureContext
): boolean {
  if (ctx.viewportWidth >= SIDEBAR_SWIPE_MOBILE_BREAKPOINT_PX) return false
  if (ctx.startedInHorizontalScroller) return false

  const dx = current.x - start.x
  const dy = current.y - start.y

  if (Math.abs(dx) < SIDEBAR_SWIPE_PREVENT_MIN_DX) return false
  if (Math.abs(dx) <= Math.abs(dy)) return false

  if (!ctx.sidebarOpen) {
    return dx > 0 && start.x <= SIDEBAR_SWIPE_OPEN_START_MAX_X
  }

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
  visual?: DrawerVisual
  ports?: SidebarSwipeGesturePorts
}

function startedInHorizontalScroller(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(HORIZONTAL_SCROLLER_SELECTOR) !== null
}

export function useSidebarSwipeGesture({ sidebarOpen, onOpen, onClose, visual, ports = DEFAULT_PORTS }: UseSidebarSwipeGestureParams) {
  const { dom } = ports

  useEffect(() => {
    let start: SwipePoint | null = null
    let inScroller = false

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        start = null
        return
      }
      const touch = event.touches[0]
      if (!touch) return
      start = { x: touch.clientX, y: touch.clientY, t: event.timeStamp }
      inScroller = startedInHorizontalScroller(event.target)
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
        { sidebarOpen, viewportWidth: dom.getInnerWidth(), startedInHorizontalScroller: inScroller }
      )
      if (prevent && event.cancelable) event.preventDefault()

      if (!visual) return
      const progress = sidebarDragProgress(
        startPoint,
        { x: touch.clientX, y: touch.clientY, t: event.timeStamp },
        dom.getInnerWidth(),
        { sidebarOpen, viewportWidth: dom.getInnerWidth(), startedInHorizontalScroller: inScroller },
      )
      if (progress !== null) visual.track(progress)
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
        { sidebarOpen, viewportWidth: dom.getInnerWidth(), startedInHorizontalScroller: inScroller }
      )
      if (!visual) {
        if (outcome === "open") onOpen()
        else if (outcome === "close") onClose()
        return
      }

      if (outcome === "open") {
        onOpen()
        void visual.settle(1)
        return
      }
      if (outcome === "close") {
        void visual.settle(0).then(onClose)
        return
      }
      void visual.settle(sidebarOpen ? 1 : 0)
    }

    function handleTouchCancel() {
      start = null
      visual?.release()
    }

    const cleanupTouchStart = dom.addWindowListenerWithOptions("touchstart", handleTouchStart, { passive: true })
    const cleanupTouchMove = dom.addWindowListenerWithOptions("touchmove", handleTouchMove, { passive: false })
    const cleanupTouchEnd = dom.addWindowListenerWithOptions("touchend", handleTouchEnd, { passive: true })
    const cleanupTouchCancel = dom.addWindowListenerWithOptions("touchcancel", handleTouchCancel, { passive: true })

    return () => {
      cleanupTouchStart()
      cleanupTouchMove()
      cleanupTouchEnd()
      cleanupTouchCancel()
    }
  }, [sidebarOpen, onOpen, onClose, visual, dom])
}
