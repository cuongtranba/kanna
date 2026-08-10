import { describe, expect, test } from "bun:test"
import { formatMermaidCorrection, formatMermaidDefect } from "./mermaid-report"
import type { MermaidDefect } from "./mermaid-validation"

const defect = (over: Partial<MermaidDefect> = {}): MermaidDefect => ({
  line: 6,
  summary: "Unrecognized text.",
  excerpt: "...Current[/opt/app/current symlink]\n----------^",
  hint: "mermaid reads `[/` as the opener of a parallelogram.",
  ...over,
})

describe("formatMermaidDefect", () => {
  test("leads with the line, then the cause, excerpt and hint", () => {
    const text = formatMermaidDefect(defect())

    expect(text).toContain("line 6")
    expect(text).toContain("Unrecognized text.")
    expect(text).toContain("----------^")
    expect(text).toContain("parallelogram")
  })

  test("keeps the caret excerpt on its own lines so the ruler still lines up", () => {
    const lines = formatMermaidDefect(defect()).split("\n")

    expect(lines).toContain("...Current[/opt/app/current symlink]")
    expect(lines).toContain("----------^")
  })

  test("omits the sections it has nothing for", () => {
    const text = formatMermaidDefect(defect({ line: null, excerpt: null, hint: null }))

    expect(text).toBe("Invalid mermaid: Unrecognized text.")
  })
})

describe("formatMermaidCorrection", () => {
  test("names the diagram by its line in the message and asks for a replacement", () => {
    const text = formatMermaidCorrection([{ startLine: 12, defect: defect() }])

    expect(text).toContain("line 12")
    expect(text).toContain("line 6")
    expect(text).toContain("parallelogram")
    expect(text).toMatch(/post the corrected diagram/i)
  })

  test("puts every failing diagram in one message", () => {
    const text = formatMermaidCorrection([
      { startLine: 3, defect: defect() },
      { startLine: 40, defect: defect({ line: 2, summary: "Parse error.", excerpt: null, hint: null }) },
    ])

    expect(text).toContain("line 3")
    expect(text).toContain("line 40")
    expect(text).toContain("2 mermaid diagrams")
  })

  test("says diagram, singular, for a single failure", () => {
    expect(formatMermaidCorrection([{ startLine: 3, defect: defect() }])).toContain("1 mermaid diagram")
  })
})
