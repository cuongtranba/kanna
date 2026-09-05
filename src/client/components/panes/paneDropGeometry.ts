import type { SplitPosition } from "../../lib/paneTree"


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
  if (rect.width <= 0 || rect.height <= 0) return { kind: "merge" }

  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const nx = clamp((pointer.x - rect.left) / rect.width)
  const ny = clamp((pointer.y - rect.top) / rect.height)

  const half = mergeRatio / 2
  if (Math.abs(nx - 0.5) <= half && Math.abs(ny - 0.5) <= half) {
    return { kind: "merge" }
  }

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
  if (tabWidth <= 0) return tabCount

  const offset = pointerX - strip.left
  const index = Math.floor(offset / tabWidth + 0.5)

  return Math.min(tabCount, Math.max(0, index))
}
