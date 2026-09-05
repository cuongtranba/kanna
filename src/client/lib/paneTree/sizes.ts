
export const MIN_PANE_FRACTION = 0.1

function isUsable(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function uniform(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count)
}

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

export function redistributeToMinimum(sizes: readonly number[]): number[] {
  const count = sizes.length
  if (count === 0) return []
  if (count === 1) return [1]

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

  const floor = Math.min(MIN_PANE_FRACTION, pair / 2)
  const nextLeft = Math.min(pair - floor, Math.max(floor, left + deltaRatio))

  const result = [...sizes]
  result[index] = nextLeft
  result[index + 1] = pair - nextLeft
  return result
}
