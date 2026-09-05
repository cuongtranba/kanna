import { useCallback, useRef } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"

export interface PointerPosition {
  readonly x: number
  readonly y: number
}

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

export function useTypeaheadHoverHighlight(): HoverHighlightHandler {
  const lastPointerRef = useRef<PointerPosition | null>(null)

  return useCallback<HoverHighlightHandler>((event, index, setHighlightedIndex) => {
    const next: PointerPosition = { x: event.clientX, y: event.clientY }
    const moved = isPointerDisplacement(lastPointerRef.current, next)
    lastPointerRef.current = next
    if (moved) setHighlightedIndex(index)
  }, [])
}
