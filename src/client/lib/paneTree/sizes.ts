/**
 * Size arithmetic for the pane tree.
 *
 * A group's `sizes` are fractions of its own extent, positionally aligned with
 * `children` and summing to 1. Keeping them as fractions rather than percentages
 * or pixels means a subtree can be moved or nested without rescaling.
 */

/** No pane may be squeezed below a tenth of its parent group. */
export const MIN_PANE_FRACTION = 0.1

function isUsable(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function uniform(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count)
}

/**
 * Coerce any input into exactly `count` positive fractions summing to 1.
 *
 * Applied on every group construction, so a group can never hold a size array
 * that disagrees with its child count — including when the input came from
 * persisted (and therefore untrusted) state.
 */
export function normalizeSizes(sizes: readonly number[] | undefined, count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [1]

  const cleaned = Array.from({ length: count }, (_, index) => {
    const value = sizes?.[index]
    return isUsable(value) ? value : 1
  })

  const total = cleaned.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return uniform(count)

  return cleaned.map((value) => value / total)
}

/**
 * Lift every child to at least `MIN_PANE_FRACTION`, paying for it proportionally
 * from the children that have room.
 *
 * Water-filling: repeatedly pin the children that would fall under the floor,
 * then redistribute what is left among the rest, until nothing more needs
 * pinning. Used for structural changes (add/remove a child), not for dragging —
 * a drag should only ever disturb the pair it sits between.
 */
export function redistributeToMinimum(sizes: readonly number[]): number[] {
  const count = sizes.length
  if (count === 0) return []
  if (count === 1) return [1]

  // Past ten children the floor cannot be honoured for everyone; an even split
  // is the least surprising answer available.
  if (count * MIN_PANE_FRACTION > 1) return uniform(count)

  const normalized = normalizeSizes(sizes, count)
  const result = new Array<number>(count).fill(0)
  const unlocked = new Set(normalized.map((_, index) => index))
  let remaining = 1

  while (unlocked.size > 0) {
    let unlockedWeight = 0
    for (const index of unlocked) unlockedWeight += normalized[index] ?? 0

    if (unlockedWeight <= 0) {
      const share = remaining / unlocked.size
      for (const index of unlocked) result[index] = share
      break
    }

    const starved: number[] = []
    for (const index of unlocked) {
      const share = ((normalized[index] ?? 0) / unlockedWeight) * remaining
      if (share < MIN_PANE_FRACTION) starved.push(index)
    }

    if (starved.length === 0) {
      for (const index of unlocked) {
        result[index] = ((normalized[index] ?? 0) / unlockedWeight) * remaining
      }
      break
    }

    for (const index of starved) {
      result[index] = MIN_PANE_FRACTION
      unlocked.delete(index)
      remaining -= MIN_PANE_FRACTION
    }
  }

  return normalizeSizes(result, count)
}

/**
 * Move the boundary between children `index` and `index + 1` by `deltaRatio`.
 *
 * Only that pair changes, and their combined share is preserved exactly — so if
 * the array summed to 1 before, it still does, with no global renormalization
 * and therefore no visible drift in the panes the user is not dragging.
 */
export function clampPairSizes(
  sizes: readonly number[],
  index: number,
  deltaRatio: number,
): number[] {
  const left = sizes[index]
  const right = sizes[index + 1]
  if (left === undefined || right === undefined) return [...sizes]
  if (!Number.isFinite(deltaRatio)) return [...sizes]

  const pair = left + right
  if (pair <= 0) return [...sizes]

  // When the pair is already tighter than two floors, a fixed floor would be
  // unsatisfiable and the handle would lock up; splitting the pair evenly keeps
  // it draggable.
  const floor = Math.min(MIN_PANE_FRACTION, pair / 2)
  const nextLeft = Math.min(pair - floor, Math.max(floor, left + deltaRatio))

  const result = [...sizes]
  result[index] = nextLeft
  result[index + 1] = pair - nextLeft
  return result
}
