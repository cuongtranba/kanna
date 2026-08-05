import { describe, expect, test } from "bun:test"
import { parseMermaidError } from "./mermaidError"

// Verbatim mermaid 11.15 output for an erDiagram block whose last attribute
// has a type but no name — the parser blames the closing brace, not the line
// that is actually wrong, which is exactly why the line number must survive
// into the UI.
const JISON_PARSE_ERROR = [
  "Parse error on line 35:",
  "... jsonb quotas  }  TENANT_SECRETS {",
  "--------------------^",
  "Expecting 'ATTRIBUTE_WORD', got 'BLOCK_STOP'",
].join("\n")

describe("parseMermaidError", () => {
  test("splits a jison parse error into line, summary and caret excerpt", () => {
    const detail = parseMermaidError(JISON_PARSE_ERROR)
    expect(detail.line).toBe(35)
    expect(detail.summary).toBe("Expecting 'ATTRIBUTE_WORD', got 'BLOCK_STOP'")
    expect(detail.excerpt).toBe(
      "... jsonb quotas  }  TENANT_SECRETS {\n--------------------^"
    )
  })

  test("keeps the excerpt's caret alignment byte-for-byte", () => {
    const excerpt = parseMermaidError(JISON_PARSE_ERROR).excerpt ?? ""
    const [context, ruler] = excerpt.split("\n")
    expect(ruler).toBeDefined()
    expect(ruler?.indexOf("^")).toBe(20)
    expect(context?.length).toBeGreaterThan(ruler?.indexOf("^") ?? 0)
  })

  test("reads the trailing text of a lexical error header", () => {
    const detail = parseMermaidError(
      ["Lexical error on line 3. Unrecognized text.", "A--@-->B", "----^"].join("\n")
    )
    expect(detail.line).toBe(3)
    expect(detail.summary).toBe("Unrecognized text.")
    expect(detail.excerpt).toBe("A--@-->B\n----^")
  })

  test("falls back to a collapsed message when no line is reported", () => {
    const detail = parseMermaidError(
      "No diagram type detected matching given configuration for text:\n  graph??"
    )
    expect(detail.line).toBeNull()
    expect(detail.excerpt).toBeNull()
    expect(detail.summary).toBe(
      "No diagram type detected matching given configuration for text: graph??"
    )
  })

  test("keeps the header as the summary when nothing follows the caret", () => {
    const detail = parseMermaidError("Parse error on line 7:\nA-->\n---^")
    expect(detail.line).toBe(7)
    expect(detail.summary).toBe("Parse error on line 7")
    expect(detail.excerpt).toBe("A-->\n---^")
  })

  test("reports an unknown error for an empty message", () => {
    expect(parseMermaidError("   ")).toEqual({
      line: null,
      summary: "Unknown error",
      excerpt: null,
    })
  })
})
