import { describe, expect, test } from "bun:test"
import { hintForMermaidError } from "./mermaid-hints"
import { parseMermaidError } from "./mermaidError"

const hint = (source: string, raw: string) => hintForMermaidError(source, parseMermaidError(raw))

describe("hintForMermaidError", () => {
  test("names the parallelogram trap when a `[/` label never closes", () => {
    const source = ["flowchart TD", "  A --> B[/opt/app/current symlink]"].join("\n")
    const advice = hint(source, "Lexical error on line 2. Unrecognized text.\n...\n------^")

    expect(advice).toContain("[/")
    expect(advice).toContain("parallelogram")
    expect(advice).toContain('B["/opt/app/current symlink"]')
  })

  test("says nothing about parallelograms when the `[/` label does close", () => {
    const source = ["flowchart TD", "  A --> B[/opt/app/releases/]"].join("\n")

    expect(hint(source, "Lexical error on line 2. Unrecognized text.")).toBeNull()
  })

  test.each([
    ["PS", "(", 'A --> B[fetch (no header)]'],
    ["STR", '"', 'A --> B[say "hi"]'],
    ["PIPE", "|", "A --> B[left | right]"],
  ])("names the character mermaid choked on when the parser reports %s", (token, char, line) => {
    const source = `flowchart TD\n  ${line}`
    const advice = hint(source, `Parse error on line 2:\n...\n---^\nExpecting 'SQE', got '${token}'`)

    expect(advice).toContain(`\`${char}\``)
    expect(advice).toContain("double quotes")
    expect(advice).toContain("#quot;")
  })

  test("tells the model to name a diagram type when none was detected", () => {
    const advice = hint("a --> b", "No diagram type detected matching given configuration for text: a --> b")

    expect(advice).toContain("first line")
    expect(advice).toContain("flowchart TD")
  })

  test("offers nothing rather than a guess for an unfamiliar error", () => {
    expect(hint("flowchart TD\n  A --> B", "Parse error on line 2:\nExpecting 'NEWLINE', got 'EOF'")).toBeNull()
  })

  test("offers nothing when the error names no line to look at", () => {
    expect(hint("flowchart TD\n  A --> B[/x]", "something went wrong")).toBeNull()
  })

  test("offers nothing when the reported line is past the end of the source", () => {
    expect(hint("flowchart TD", "Lexical error on line 9. Unrecognized text.")).toBeNull()
  })
})
