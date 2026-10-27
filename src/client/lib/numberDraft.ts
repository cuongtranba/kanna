export type NumberCommit = { kind: "invalid" } | { kind: "unchanged" } | { kind: "write"; value: number }

export interface NumberDraftRule {
  min: number
  max: number
  whole: "round" | "strict"
}

export function resolveNumberCommit(text: string, current: number, rule: NumberDraftRule): NumberCommit {
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed < rule.min || parsed > rule.max) return { kind: "invalid" }
  if (rule.whole === "strict" && !Number.isInteger(parsed)) return { kind: "invalid" }
  const value = rule.whole === "round" ? Math.round(parsed) : parsed
  return value === current ? { kind: "unchanged" } : { kind: "write", value }
}
