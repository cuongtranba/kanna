import type { TimerPort } from "../../ports/timerPort"

export const TOUCH_GESTURE_SETTLE_MS = 120
const LIST_CONTENT_SELECTOR = ":scope > .legend-list-content-container"

type ScrollByArgs = [ScrollToOptions?] | [number, number]

function verticalDelta(args: ScrollByArgs): number {
  const [first, second] = args
  if (typeof first === "number") return second ?? 0
  return first?.top ?? 0
}

function keepScrollByUnguarded(): void {}

export function installTouchScrollGuard(scrollNode: HTMLElement, timer: TimerPort, holdLimitPx: number): () => void {
  const nativeScrollBy = scrollNode.scrollBy
  if (typeof nativeScrollBy !== "function") return keepScrollByUnguarded

  let gestureActive = false
  let settleTimer: number | undefined
  let heldTop = 0
  let offsetNode: HTMLElement | null = null

  const contentNode = () => scrollNode.querySelector<HTMLElement>(LIST_CONTENT_SELECTOR)

  const paintHeldOffset = () => {
    const node = offsetNode ?? contentNode()
    if (!node) return false
    offsetNode = heldTop === 0 ? null : node
    node.style.transform = heldTop === 0 ? "" : `translateY(${-heldTop}px)`
    return true
  }

  const releaseHeldCorrection = () => {
    if (heldTop === 0) return
    const top = heldTop
    heldTop = 0
    paintHeldOffset()
    Reflect.apply(nativeScrollBy, scrollNode, [{ top, behavior: "auto" }])
  }

  const endGesture = () => {
    settleTimer = undefined
    gestureActive = false
    releaseHeldCorrection()
  }

  const armSettle = () => {
    if (settleTimer !== undefined) timer.clearTimeout(settleTimer)
    settleTimer = timer.setTimeout(endGesture, TOUCH_GESTURE_SETTLE_MS)
  }

  function guardedScrollBy(options?: ScrollToOptions): void
  function guardedScrollBy(x: number, y: number): void
  function guardedScrollBy(...args: ScrollByArgs): void {
    if (!gestureActive) {
      Reflect.apply(nativeScrollBy, scrollNode, args)
      return
    }
    const top = verticalDelta(args)
    if (top === 0) return
    heldTop += top
    if (Math.abs(heldTop) > holdLimitPx || !paintHeldOffset()) releaseHeldCorrection()
  }
  scrollNode.scrollBy = guardedScrollBy

  const onTouchStart = () => {
    if (settleTimer !== undefined) {
      timer.clearTimeout(settleTimer)
      settleTimer = undefined
    }
    gestureActive = true
  }
  const onTouchEnd = () => { armSettle() }
  const onScrollWhileGesturing = () => { if (gestureActive) armSettle() }

  scrollNode.addEventListener("touchstart", onTouchStart, { passive: true })
  scrollNode.addEventListener("touchend", onTouchEnd, { passive: true })
  scrollNode.addEventListener("touchcancel", onTouchEnd, { passive: true })
  scrollNode.addEventListener("scroll", onScrollWhileGesturing, { passive: true })

  return () => {
    if (settleTimer !== undefined) timer.clearTimeout(settleTimer)
    scrollNode.removeEventListener("touchstart", onTouchStart)
    scrollNode.removeEventListener("touchend", onTouchEnd)
    scrollNode.removeEventListener("touchcancel", onTouchEnd)
    scrollNode.removeEventListener("scroll", onScrollWhileGesturing)
    if (scrollNode.scrollBy === guardedScrollBy) Reflect.deleteProperty(scrollNode, "scrollBy")
    gestureActive = false
    releaseHeldCorrection()
  }
}
