export interface NumericRange {
  readonly min: number
  readonly max: number
}

export function clampRounded<T>(value: T, range: NumericRange, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(range.max, Math.max(range.min, Math.round(numberValue)))
}
