
import type { PaneDirection } from "./navigation"
import { findPanePath, getNodeAtPath } from "./tree"
import { type PaneNode, type SplitDirection, isGroup } from "./types"

export const KEYBOARD_RESIZE_STEP = 0.05

export interface PaneResizeBoundary {
  groupId: string
  index: number
  deltaRatio: number
}

const AXIS: Record<PaneDirection, SplitDirection> = {
  left: "horizontal",
  right: "horizontal",
  up: "vertical",
  down: "vertical",
}

const SIGN: Record<PaneDirection, 1 | -1> = { left: -1, right: 1, up: -1, down: 1 }

export function findResizeBoundary(
  root: PaneNode,
  paneId: string,
  direction: PaneDirection,
  step: number = KEYBOARD_RESIZE_STEP,
): PaneResizeBoundary | null {
  const path = findPanePath(root, paneId)
  if (!path) return null

  const axis = AXIS[direction]

  for (let depth = path.length - 1; depth >= 0; depth--) {
    const group = getNodeAtPath(root, path.slice(0, depth))
    if (!group || !isGroup(group) || group.direction !== axis) continue

    const child = path[depth]!
    const index = child < group.children.length - 1 ? child : child - 1
    if (index < 0) continue

    return { groupId: group.id, index, deltaRatio: SIGN[direction] * step }
  }

  return null
}
