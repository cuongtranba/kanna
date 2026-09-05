import { describe, expect, test } from "bun:test"
import { repairMermaidSource } from "./mermaidRepair"

describe("repairMermaidSource", () => {
  test("leaves a diagram with no known defect byte-identical", () => {
    const source = "flowchart LR\n  A[a] -.->|t| B[b]\n  B -.-x C[c]\n"
    const result = repairMermaidSource(source)
    expect(result.repairs).toEqual([])
    expect(result.source).toBe(source)
  })

  test("rewrites the dotted cross link `-.x` to `-.-x`", () => {
    const result = repairMermaidSource("flowchart LR\n  B -.x|discarded| N[nothing]")
    expect(result.source).toBe("flowchart LR\n  B -.-x|discarded| N[nothing]")
    expect(result.repairs).toEqual([{ line: 2, from: "-.x", to: "-.-x" }])
  })

  test("rewrites the dotted circle link `-.o` to `-.-o`", () => {
    const result = repairMermaidSource("flowchart LR\n  B -.o N[nothing]")
    expect(result.source).toBe("flowchart LR\n  B -.-o N[nothing]")
    expect(result.repairs).toEqual([{ line: 2, from: "-.o", to: "-.-o" }])
  })

  test("repairs every occurrence and reports each with its own line", () => {
    const source = ["flowchart LR", "  B -.x|discarded| N[n]", "  F -.x|no log| N2[n2]"].join("\n")
    const result = repairMermaidSource(source)
    expect(result.repairs.map((r) => r.line)).toEqual([2, 3])
    expect(result.source).toContain("B -.-x|discarded|")
    expect(result.source).toContain("F -.-x|no log|")
  })

  test("repairs a link written without surrounding spaces", () => {
    const result = repairMermaidSource("flowchart LR\n  A-.xB")
    expect(result.source).toBe("flowchart LR\n  A-.-xB")
  })

  test("does not touch `-.x` inside a bracket label", () => {
    const source = 'flowchart LR\n  A[uses -.x here] --> B[b]'
    expect(repairMermaidSource(source)).toEqual({ source, repairs: [] })
  })

  test("does not touch `-.x` inside a quoted label", () => {
    const source = 'flowchart LR\n  A["uses -.x here"] --> B[b]'
    expect(repairMermaidSource(source)).toEqual({ source, repairs: [] })
  })

  test("does not touch `-.x` inside a round or curly node shape", () => {
    const round = "flowchart LR\n  A(uses -.x) --> B[b]"
    const curly = "flowchart LR\n  A{uses -.x} --> B[b]"
    expect(repairMermaidSource(round).repairs).toEqual([])
    expect(repairMermaidSource(curly).repairs).toEqual([])
  })

  test("does not touch `-.x` inside a pipe edge label", () => {
    const source = "flowchart LR\n  A -->|means -.x| B[b]"
    expect(repairMermaidSource(source)).toEqual({ source, repairs: [] })
  })

  test("does not touch `-.x` inside a %% comment", () => {
    const source = "flowchart LR\n  %% note about -.x\n  A --> B"
    expect(repairMermaidSource(source)).toEqual({ source, repairs: [] })
  })

  test("repairs a real link on a line that also mentions the defect in a label", () => {
    const result = repairMermaidSource('flowchart LR\n  A["about -.x"] -.x B[b]')
    expect(result.source).toBe('flowchart LR\n  A["about -.x"] -.-x B[b]')
    expect(result.repairs).toEqual([{ line: 2, from: "-.x", to: "-.-x" }])
  })

  test("leaves the valid links that merely look similar alone", () => {
    const source = "flowchart LR\n  A -.-x B\n  B -.-o C\n  C -.-> D\n  D -..-> E\n"
    expect(repairMermaidSource(source)).toEqual({ source, repairs: [] })
  })

  test("handles an empty source", () => {
    expect(repairMermaidSource("")).toEqual({ source: "", repairs: [] })
  })
})
