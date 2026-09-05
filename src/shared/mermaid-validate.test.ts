import { describe, expect, test } from "bun:test"
import type { MermaidParsePort } from "./mermaid-validation"
import { validateMermaid, validateMermaidFences } from "./mermaid-validate"

const fakeParse: MermaidParsePort = (source) =>
  Promise.resolve(
    source.includes("BAD")
      ? { ok: false, raw: "Lexical error on line 2. Unrecognized text.\n...B[/x\n------^" }
      : { ok: true },
  )

describe("validateMermaid", () => {
  test("accepts a source the parser accepts", async () => {
    expect(await validateMermaid(fakeParse, "flowchart TD\n  A --> B")).toEqual({ ok: true })
  })

  test("structures the rejection into line, summary, excerpt and hint", async () => {
    const result = await validateMermaid(fakeParse, "flowchart TD\n  BAD --> B[/opt/x sym]")
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")

    expect(result.defect.line).toBe(2)
    expect(result.defect.summary).toContain("Unrecognized text")
    expect(result.defect.excerpt).toContain("^")
    expect(result.defect.hint).toContain("parallelogram")
  })

  test("carries a null hint rather than inventing one", async () => {
    const parse: MermaidParsePort = () => Promise.resolve({ ok: false, raw: "something opaque" })
    const result = await validateMermaid(parse, "flowchart TD")
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")

    expect(result.defect.hint).toBeNull()
    expect(result.defect.summary).toBe("something opaque")
  })
})

describe("validateMermaidFences", () => {
  test("returns one entry per mermaid fence, in document order", async () => {
    const markdown = [
      "intro",
      "```mermaid",
      "flowchart TD",
      "  A --> B",
      "```",
      "```ts",
      "BAD",
      "```",
      "```mermaid",
      "flowchart TD",
      "  BAD --> C",
      "```",
    ].join("\n")

    const results = await validateMermaidFences(fakeParse, markdown)

    expect(results.map((entry) => [entry.fence.startLine, entry.result.ok])).toEqual([
      [2, true],
      [9, false],
    ])
  })

  test("returns nothing for text with no mermaid fence", async () => {
    expect(await validateMermaidFences(fakeParse, "prose\n```ts\nBAD\n```")).toEqual([])
  })
})
