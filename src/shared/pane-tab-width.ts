
export const MIN_TAB_WIDTH = 60
export const MAX_TAB_WIDTH = 200

export const DEFAULT_TAB_MIN_WIDTH = MIN_TAB_WIDTH

export function clampTabMinWidth<T>(value: T): number {
  const width = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(width)) return DEFAULT_TAB_MIN_WIDTH
  return Math.min(MAX_TAB_WIDTH, Math.max(MIN_TAB_WIDTH, Math.round(width)))
}
