import { useCallback, useRef } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"

export interface PointerPosition {
  readonly x: number
  readonly y: number
}

/**
 * Whether `next` is a pointer the USER moved, rather than content that moved
 * underneath a pointer at rest.
 *
 * The first observed position is never a displacement — it only establishes the
 * origin. That is what keeps a menu which opens (or scrolls) beneath a still
 * cursor from claiming a highlight the keyboard owns.
 */
export function isPointerDisplacement(
  last: PointerPosition | null,
  next: PointerPosition,
): boolean {
  if (last === null) return false
  return last.x !== next.x || last.y !== next.y
}

export type HoverHighlightHandler = (
  event: ReactMouseEvent<HTMLElement>,
  index: number,
  setHighlightedIndex: (index: number) => void,
) => void

/**
 * Hover-to-highlight for a typeahead menu that the arrow keys can scroll.
 *
 * Bound to `mouseenter`, hover fights the keyboard: every ArrowDown scrolls the
 * menu (Lexical's `scrollIntoViewIfNeeded`), the browser re-hit-tests under a
 * cursor that never moved, and the resulting hover event snapped the highlight
 * back onto whichever row had slid beneath it. Measured in Chrome against the
 * real composer with the pointer resting on the list, twelve ArrowDown presses
 * advanced the selection three rows — so every command past the first visible
 * page was unreachable by keyboard (#1019).
 *
 * Hover is therefore keyed on pointer DISPLACEMENT rather than on hit-test
 * membership. `mousemove` is the event to listen on because a scroll-driven
 * re-dispatch also produces one; the coordinate comparison, not the event name,
 * is what separates the two.
 */
export function useTypeaheadHoverHighlight(): HoverHighlightHandler {
  const lastPointerRef = useRef<PointerPosition | null>(null)

  return useCallback<HoverHighlightHandler>((event, index, setHighlightedIndex) => {
    const next: PointerPosition = { x: event.clientX, y: event.clientY }
    const moved = isPointerDisplacement(lastPointerRef.current, next)
    lastPointerRef.current = next
    if (moved) setHighlightedIndex(index)
  }, [])
}
