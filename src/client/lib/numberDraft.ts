import { isWithinRange, type NumericRange } from "../../shared/numeric"

export type NumberCommit = { kind: "invalid" } | { kind: "unchanged" } | { kind: "write"; value: number }

export function resolveNumberCommit(text: string, current: number, range: NumericRange): NumberCommit {
  const parsed = Number(text)
  if (!isWithinRange(range, parsed)) return { kind: "invalid" }
  const value = Math.round(parsed)
  return value === current ? { kind: "unchanged" } : { kind: "write", value }
}
