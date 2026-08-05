import type { SplitPosition } from "../../lib/paneTree"

/**
 * Where a dragged tab would land, from pointer position alone.
 *
 * Pure and structurally typed (a plain rect, not a `ClientRect`) so it can be
 * unit-tested with literals — the same shape the sidebar's reorder geometry
 * uses.
 *
 * Two zones:
 *
 *   - the middle 40% of both axes MERGES the tab into that pane's strip;
 *   - everything else SPLITS, toward whichever edge is proportionally nearest.
 *
 * The outer frame and the ring between it and the merge zone therefore give the
 * same answer — that is the "nearest-edge fallthrough": no part of a pane is
 * dead during a drag, so a drop always does something predictable.
 *
 * Distance is measured proportionally, not in pixels: a wide, short pane would
 * otherwise answer "top" or "bottom" almost everywhere.
 */

/** Fraction of each axis, centred, that merges rather than splits. */
export const MERGE_ZONE_RATIO = 0.4

export type PaneDropIntent = { kind: "merge" } | { kind: "split"; position: SplitPosition }

export interface DropRect {
  left: number
  top: number
  width: number
  height: number
}

export function resolvePaneDropIntent({
  pointer,
  rect,
  mergeRatio = MERGE_ZONE_RATIO,
}: {
  pointer: { x: number; y: number }
  rect: DropRect
  mergeRatio?: number
}): PaneDropIntent {
  // A pane with no area has no meaningful edges; merging is the safe answer.
  if (rect.width <= 0 || rect.height <= 0) return { kind: "merge" }

  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const nx = clamp((pointer.x - rect.left) / rect.width)
  const ny = clamp((pointer.y - rect.top) / rect.height)

  const half = mergeRatio / 2
  if (Math.abs(nx - 0.5) <= half && Math.abs(ny - 0.5) <= half) {
    return { kind: "merge" }
  }

  // Proportional distance to each edge; the smallest wins.
  const distances: ReadonlyArray<readonly [SplitPosition, number]> = [
    ["left", nx],
    ["right", 1 - nx],
    ["top", ny],
    ["bottom", 1 - ny],
  ]

  let best = distances[0]
  for (const candidate of distances) {
    if (candidate[1] < best[1]) best = candidate
  }

  return { kind: "split", position: best[0] }
}

/**
 * Which slot in a tab strip a pointer sits over.
 *
 * Returns an insertion index in `[0, tabCount]` — the position the dragged tab
 * should take, using each tab's midpoint as the pivot.
 */
export function resolveTabInsertionIndex({
  pointerX,
  strip,
  tabCount,
  tabWidth,
}: {
  pointerX: number
  strip: { left: number; width: number }
  tabCount: number
  tabWidth: number
}): number {
  if (tabCount <= 0) return 0
  // Without a measured tab width there is nothing to pivot on; append.
  if (tabWidth <= 0) return tabCount

  const offset = pointerX - strip.left
  const index = Math.floor(offset / tabWidth + 0.5)

  return Math.min(tabCount, Math.max(0, index))
}
