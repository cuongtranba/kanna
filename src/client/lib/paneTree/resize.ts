/**
 * Which divider a keyboard nudge moves.
 *
 * The model is "the divider travels the way the arrow points" — the sign of the
 * nudge depends only on the direction pressed, never on where the focused pane
 * sits in its group. That is what makes the same divider behave identically
 * from either side of it, and it is what the resize library's own separator
 * keys do, so nudging from a pane and nudging from a focused divider agree.
 */

import type { PaneDirection } from "./navigation"
import { findPanePath, getNodeAtPath } from "./tree"
import { type PaneNode, type SplitDirection, isGroup } from "./types"

/** One nudge, as a fraction of the group's own extent. Half `MIN_PANE_FRACTION`. */
export const KEYBOARD_RESIZE_STEP = 0.05

export interface PaneResizeBoundary {
  groupId: string
  /** The boundary between `children[index]` and `children[index + 1]`. */
  index: number
  deltaRatio: number
}

const AXIS: Record<PaneDirection, SplitDirection> = {
  left: "horizontal",
  right: "horizontal",
  up: "vertical",
  down: "vertical",
}

/** Positive grows `children[index]`, i.e. slides the boundary right or down. */
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

  // Outward from the pane, so the nearest divider on the pressed axis wins. The
  // index is the BRANCH holding the pane, not the pane — resizing an outer
  // group scales everything inside that branch together, which is exactly what
  // the divider adjacent to the pane does.
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
