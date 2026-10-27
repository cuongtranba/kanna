export interface NumericRange {
  readonly min: number
  readonly max: number
  readonly integer?: boolean
}

export type NumericBound = NumericRange & { readonly path: string }

export type BoundPolicy = "clamp" | "fallback"

export function asFiniteNumber<T>(value: T): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function clampRounded<T>(value: T, range: NumericRange, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(range.max, Math.max(range.min, Math.round(numberValue)))
}

export function isWithinRange<T>(range: NumericRange, value: T): boolean {
  const finite = asFiniteNumber(value)
  if (finite === undefined) return false
  if (finite < range.min || finite > range.max) return false
  return range.integer !== true || Number.isInteger(finite)
}

function requirement(bound: NumericBound): string {
  if (!Number.isFinite(bound.max)) {
    return bound.integer ? `${bound.path} must be an integer >= ${bound.min}` : `${bound.path} must be at least ${bound.min}`
  }
  if (bound.integer) return `${bound.path} must be an integer between ${bound.min} and ${bound.max}`
  return `${bound.path} must be between ${bound.min} and ${bound.max}`
}

export function boundViolation<T>(bound: NumericBound, value: T): string | null {
  if (asFiniteNumber(value) === undefined) {
    return bound.integer ? requirement(bound) : `${bound.path} must be a number`
  }
  return isWithinRange(bound, value) ? null : requirement(bound)
}

export function assertWithinBound<T>(bound: NumericBound, value: T): void {
  const violation = boundViolation(bound, value)
  if (violation) throw new Error(violation)
}

export function normalizeBounded<T>(
  bound: NumericBound,
  raw: T,
  fallback: number,
  policy: BoundPolicy,
  warnings: string[],
): number {
  if (raw === undefined) return fallback
  const violation = boundViolation(bound, raw)
  const finite = asFiniteNumber(raw)
  if (!violation) return finite === undefined ? fallback : Math.round(finite)
  warnings.push(violation)
  if (policy === "clamp" && finite !== undefined) {
    return clampRounded(finite, bound, fallback)
  }
  return fallback
}
