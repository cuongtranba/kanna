// src/server/orchestration-review.ts
//
// Pure parsing / dedupe / rendering for structured adversarial-review output.
// Review workers are prompted to reply NO_FINDINGS or a fenced JSON array of
// OrchReviewFinding. Parsing is tolerant by design: any reviewer reply that
// does not conform falls back to raw text at the call site — format drift
// never fails a run, it only loses the dedupe/rendering upgrade.

import { type AnyValue, isRecord } from "../shared/errors"
import type { OrchReviewFinding, OrchReviewSeverity } from "../shared/orchestration-types"

export type ParsedReview =
  | { kind: "findings"; findings: OrchReviewFinding[] }
  | { kind: "none" }
  | { kind: "unparsed" }

function isSeverity(value: AnyValue): value is OrchReviewSeverity {
  return value === "critical" || value === "major" || value === "minor"
}

function toFinding(raw: AnyValue): OrchReviewFinding | null {
  if (!isRecord(raw)) return null
  const file = typeof raw.file === "string" ? raw.file.trim() : ""
  const problem = typeof raw.problem === "string" ? raw.problem.trim() : ""
  if (file === "" || problem === "") return null
  const line = typeof raw.line === "number" && Number.isFinite(raw.line) ? Math.trunc(raw.line) : null
  const suggestedFix = typeof raw.suggestedFix === "string" && raw.suggestedFix.trim() !== "" ? raw.suggestedFix.trim() : null
  const severity = isSeverity(raw.severity) ? raw.severity : null
  return { file, line, problem, suggestedFix, severity }
}

function tryParseArray(text: string): OrchReviewFinding[] | null {
  let parsed: AnyValue
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const findings = parsed.map(toFinding).filter((f): f is OrchReviewFinding => f !== null)
  // An array that parsed but yielded no valid element is still conformant
  // when it was empty; a non-empty array of garbage is not.
  if (parsed.length > 0 && findings.length === 0) return null
  return findings
}

/** Parse one review worker's reply. Tolerant — see module header. */
export function parseReviewFindings(text: string): ParsedReview {
  const trimmed = text.trim()
  if (trimmed === "") return { kind: "unparsed" }

  const fenced = [...trimmed.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gu)]
  for (const match of fenced) {
    const findings = tryParseArray(match[1]!.trim())
    if (findings) return findings.length === 0 ? { kind: "none" } : { kind: "findings", findings }
  }

  const bare = tryParseArray(trimmed)
  if (bare) return bare.length === 0 ? { kind: "none" } : { kind: "findings", findings: bare }

  if (/\bNO_FINDINGS\b/u.test(trimmed)) return { kind: "none" }
  return { kind: "unparsed" }
}

function severityRank(s: OrchReviewSeverity | null): number {
  if (s === "critical") return 0
  if (s === "major") return 1
  if (s === "minor") return 2
  return 3
}

function normalizeProblem(problem: string): string {
  return problem.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim().slice(0, 80)
}

/**
 * Dedupe findings across parallel reviewers. Two findings are duplicates when
 * they name the same file and the same non-null line, or — both lines null —
 * the same file and a normalized-equal problem. The survivor is the one with
 * the higher severity (then the one carrying a suggested fix).
 */
export function dedupeFindings(findings: OrchReviewFinding[]): OrchReviewFinding[] {
  const byKey = new Map<string, OrchReviewFinding>()
  for (const f of findings) {
    const key = f.line !== null ? `${f.file}:${f.line}` : `${f.file}:?:${normalizeProblem(f.problem)}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, f)
      continue
    }
    const better =
      severityRank(f.severity) < severityRank(existing.severity) ||
      (severityRank(f.severity) === severityRank(existing.severity) && existing.suggestedFix === null && f.suggestedFix !== null)
    if (better) byKey.set(key, f)
  }
  return [...byKey.values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
}

/** Render deduped findings as the compact {{PRIOR}} block the fix phase reads. */
export function renderFindings(findings: OrchReviewFinding[], reviewerCount: number): string {
  if (findings.length === 0) return "NO_FINDINGS"
  const rows = findings.map((f, i) => {
    const sev = f.severity ? `[${f.severity}] ` : ""
    const loc = f.line !== null ? `${f.file}:${f.line}` : f.file
    const fix = f.suggestedFix ? `\n   Fix: ${f.suggestedFix}` : ""
    return `${i + 1}. ${sev}${loc} — ${f.problem}${fix}`
  })
  return `Review findings (${reviewerCount} reviewer${reviewerCount === 1 ? "" : "s"}, deduped):\n${rows.join("\n")}`
}

/**
 * Combine the raw replies of one review phase's parallel workers into the
 * {{PRIOR}} string for the next phase. All replies conformant → merged,
 * deduped, rendered. Any reply unparsed → fall back to joining the raw texts
 * verbatim (never lose reviewer signal to format drift).
 */
export function combineReviewOutputs(texts: string[]): string {
  const parsed = texts.map(parseReviewFindings)
  if (parsed.some((p) => p.kind === "unparsed")) {
    return texts.filter((t) => t.trim() !== "").join("\n\n---\n\n")
  }
  const findings = parsed.flatMap((p) => (p.kind === "findings" ? p.findings : []))
  return renderFindings(dedupeFindings(findings), texts.length)
}
