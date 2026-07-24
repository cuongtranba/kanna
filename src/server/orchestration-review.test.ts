// src/server/orchestration-review.test.ts
import { describe, expect, test } from "bun:test"
import type { OrchReviewFinding } from "../shared/orchestration-types"
import { combineReviewOutputs, dedupeFindings, parseReviewFindings, renderFindings } from "./orchestration-review"

function finding(partial: Partial<OrchReviewFinding>): OrchReviewFinding {
  return { file: "src/a.ts", line: 1, problem: "bug", suggestedFix: null, severity: null, ...partial }
}

describe("parseReviewFindings", () => {
  test("parses a fenced json block", () => {
    const text = 'Here you go:\n```json\n[{"file":"src/a.ts","line":42,"problem":"off-by-one","suggestedFix":"use <","severity":"major"}]\n```'
    const parsed = parseReviewFindings(text)
    expect(parsed).toEqual({
      kind: "findings",
      findings: [{ file: "src/a.ts", line: 42, problem: "off-by-one", suggestedFix: "use <", severity: "major" }],
    })
  })

  test("parses a bare json array", () => {
    const parsed = parseReviewFindings('[{"file":"b.ts","line":null,"problem":"leak","suggestedFix":null,"severity":"critical"}]')
    expect(parsed.kind).toBe("findings")
  })

  test("NO_FINDINGS → none", () => {
    expect(parseReviewFindings("NO_FINDINGS")).toEqual({ kind: "none" })
    expect(parseReviewFindings("I checked everything. NO_FINDINGS.")).toEqual({ kind: "none" })
  })

  test("empty fenced array → none", () => {
    expect(parseReviewFindings("```json\n[]\n```")).toEqual({ kind: "none" })
  })

  test("free prose without markers → unparsed", () => {
    expect(parseReviewFindings("There is a bug in a.ts line 3")).toEqual({ kind: "unparsed" })
    expect(parseReviewFindings("")).toEqual({ kind: "unparsed" })
  })

  test("invalid elements dropped; all-garbage non-empty array → unparsed", () => {
    const mixed = '```json\n[{"file":"a.ts","line":1,"problem":"real"},{"nope":true}]\n```'
    const parsed = parseReviewFindings(mixed)
    expect(parsed.kind).toBe("findings")
    if (parsed.kind === "findings") expect(parsed.findings).toHaveLength(1)
    expect(parseReviewFindings('```json\n[{"nope":true}]\n```')).toEqual({ kind: "unparsed" })
  })

  test("tolerates missing optional fields and coerces fractional lines", () => {
    const parsed = parseReviewFindings('```json\n[{"file":"a.ts","line":3.7,"problem":"p"}]\n```')
    expect(parsed).toEqual({
      kind: "findings",
      findings: [{ file: "a.ts", line: 3, problem: "p", suggestedFix: null, severity: null }],
    })
  })
})

describe("dedupeFindings", () => {
  test("same file+line collapse; higher severity survives", () => {
    const out = dedupeFindings([
      finding({ line: 10, severity: "minor", problem: "worded one way" }),
      finding({ line: 10, severity: "critical", problem: "worded another way" }),
      finding({ line: 20 }),
    ])
    expect(out).toHaveLength(2)
    expect(out[0]!.severity).toBe("critical") // sorted critical-first too
  })

  test("null-line findings dedupe by normalized problem text", () => {
    const out = dedupeFindings([
      finding({ line: null, problem: "Missing null-check!" }),
      finding({ line: null, problem: "missing   null check" }),
      finding({ line: null, problem: "an entirely different issue" }),
    ])
    expect(out).toHaveLength(2)
  })

  test("equal severity: the one carrying a suggested fix survives", () => {
    const out = dedupeFindings([
      finding({ line: 5, suggestedFix: null }),
      finding({ line: 5, suggestedFix: "guard against empty input" }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.suggestedFix).toBe("guard against empty input")
  })
})

describe("renderFindings / combineReviewOutputs", () => {
  test("renders a compact numbered list with severity, location, and fix", () => {
    const text = renderFindings(
      [finding({ line: 42, severity: "critical", problem: "off-by-one", suggestedFix: "use <" })],
      2,
    )
    expect(text).toContain("Review findings (2 reviewers, deduped):")
    expect(text).toContain("1. [critical] src/a.ts:42 — off-by-one")
    expect(text).toContain("Fix: use <")
  })

  test("no findings renders NO_FINDINGS", () => {
    expect(renderFindings([], 2)).toBe("NO_FINDINGS")
  })

  test("combine: overlapping findings from two reviewers dedupe into one block", () => {
    const a = '```json\n[{"file":"a.ts","line":7,"problem":"race on init","severity":"major"}]\n```'
    const b = '```json\n[{"file":"a.ts","line":7,"problem":"initialization race","severity":"critical"},{"file":"b.ts","line":null,"problem":"typo"}]\n```'
    const out = combineReviewOutputs([a, b])
    expect(out).toContain("Review findings (2 reviewers, deduped):")
    expect(out).toContain("[critical] a.ts:7")
    expect(out).toContain("b.ts — typo")
    expect(out.match(/a\.ts:7/gu)).toHaveLength(1)
  })

  test("combine: both reviewers clean → NO_FINDINGS", () => {
    expect(combineReviewOutputs(["NO_FINDINGS", "All good. NO_FINDINGS"])).toBe("NO_FINDINGS")
  })

  test("combine: any unparsed reply falls back to the raw join (no signal lost)", () => {
    const structured = '```json\n[{"file":"a.ts","line":1,"problem":"p"}]\n```'
    const prose = "I think there is a subtle bug in the retry loop."
    const out = combineReviewOutputs([structured, prose])
    expect(out).toContain(prose)
    expect(out).toContain(structured.slice(3, 20)) // raw text preserved
    expect(out).toContain("\n\n---\n\n")
  })
})
