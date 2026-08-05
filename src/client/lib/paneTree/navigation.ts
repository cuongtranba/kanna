import { type PaneNode, isPane } from "./types"

/**
 * Directional pane focus, resolved geometrically rather than by walking the tree.
 *
 * A tree walk gives wrong answers across nested splits — moving "up" from a
 * bottom-left pane would surface its uncle in the right-hand column simply
 * because that is the nearest ancestor sibling. Laying the panes out as rects
 * and asking which one is actually in that direction matches what the user sees.
 */

export type PaneDirection = "left" | "right" | "up" | "down"

export interface PaneRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface PaneBounds {
  paneId: string
  rect: PaneRect
}

const TOLERANCE = 1e-6

const WHOLE: PaneRect = { left: 0, top: 0, right: 1, bottom: 1 }

/** Normalized rect per pane, from accumulating group sizes down the tree. */
export function collectPaneBounds(node: PaneNode, rect: PaneRect = WHOLE): PaneBounds[] {
  if (isPane(node)) return [{ paneId: node.id, rect }]

  const horizontal = node.direction === "horizontal"
  const span = horizontal ? rect.right - rect.left : rect.bottom - rect.top

  const bounds: PaneBounds[] = []
  let offset = horizontal ? rect.left : rect.top

  for (const [index, child] of node.children.entries()) {
    const size = (node.sizes[index] ?? 0) * span
    const childRect: PaneRect = horizontal
      ? { ...rect, left: offset, right: offset + size }
      : { ...rect, top: offset, bottom: offset + size }
    bounds.push(...collectPaneBounds(child, childRect))
    offset += size
  }

  return bounds
}

/** Gap between two 1-D intervals; 0 when they overlap. */
function gap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (aEnd <= bStart) return bStart - aEnd
  if (bEnd <= aStart) return aStart - bEnd
  return 0
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

/** Signed distance to the candidate along the direction of travel. */
function primaryDistance(direction: PaneDirection, from: PaneRect, rect: PaneRect): number {
  switch (direction) {
    case "left":
      return from.left - rect.right
    case "right":
      return rect.left - from.right
    case "up":
      return from.top - rect.bottom
    case "down":
      return rect.top - from.bottom
  }
}

export function findAdjacentPane(
  root: PaneNode,
  paneId: string,
  direction: PaneDirection,
): string | null {
  const bounds = collectPaneBounds(root)
  const origin = bounds.find((entry) => entry.paneId === paneId)
  if (!origin) return null

  const scored = bounds
    .filter((entry) => entry.paneId !== paneId)
    .map((entry) => {
      const { rect } = entry
      const from = origin.rect

      // How far the candidate sits in the requested direction. Negative means
      // it is not on that side at all.
      const primary = primaryDistance(direction, from, rect)

      // Perpendicular axis: for a left/right move the panes are compared by
      // their vertical extents, and vice versa.
      const acrossHorizontally = direction === "left" || direction === "right"
      const fromStart = acrossHorizontally ? from.top : from.left
      const fromEnd = acrossHorizontally ? from.bottom : from.right
      const rectStart = acrossHorizontally ? rect.top : rect.left
      const rectEnd = acrossHorizontally ? rect.bottom : rect.right

      const perpendicular = gap(fromStart, fromEnd, rectStart, rectEnd)
      const shared = overlap(fromStart, fromEnd, rectStart, rectEnd)
      const centreDistance = Math.abs(
        (fromStart + fromEnd) / 2 - (rectStart + rectEnd) / 2,
      )

      return { paneId: entry.paneId, primary, perpendicular, shared, centreDistance }
    })
    .filter((entry) => entry.primary >= -TOLERANCE)

  if (scored.length === 0) return null

  scored.sort(
    (a, b) =>
      a.primary - b.primary ||
      a.perpendicular - b.perpendicular ||
      b.shared - a.shared ||
      a.centreDistance - b.centreDistance ||
      // Deterministic last resort, so a perfect tie is still testable.
      a.paneId.localeCompare(b.paneId),
  )

  return scored[0]?.paneId ?? null
}
