import { describe, expect, test } from "vite-plus/test"
import { extractMermaidFences } from "./mermaid-fences"

describe("extractMermaidFences", () => {
  test("finds a single fence and reports the opener's 1-based line", () => {
    const markdown = ["Here is a diagram:", "", "```mermaid", "flowchart TD", "  A --> B", "```", "", "Done."].join(
      "\n",
    )
    expect(extractMermaidFences(markdown)).toEqual([
      { source: "flowchart TD\n  A --> B", startLine: 3 },
    ])
  })

  test("finds every fence in one document", () => {
    const markdown = ["```mermaid", "flowchart TD", "```", "text", "```mermaid", "graph LR", "```"].join("\n")
    expect(extractMermaidFences(markdown)).toEqual([
      { source: "flowchart TD", startLine: 1 },
      { source: "graph LR", startLine: 5 },
    ])
  })

  test("ignores fences in another language", () => {
    const markdown = ["```ts", "const a = 1", "```", "```mermaid", "graph LR", "```"].join("\n")
    expect(extractMermaidFences(markdown)).toEqual([{ source: "graph LR", startLine: 4 }])
  })

  test("accepts leading whitespace and any capitalisation on the opener", () => {
    const markdown = ["  \t```Mermaid  ", "graph LR", "  ```"].join("\n")
    expect(extractMermaidFences(markdown)).toEqual([{ source: "graph LR", startLine: 1 }])
  })

  test("a longer opener is only closed by a fence at least as long", () => {
    const markdown = ["````mermaid", "flowchart TD", '  A["```"] --> B', "````", "after"].join("\n")
    expect(extractMermaidFences(markdown)).toEqual([
      { source: 'flowchart TD\n  A["```"] --> B', startLine: 1 },
    ])
  })

  test("an unterminated fence runs to the end of the document", () => {
    const markdown = ["```mermaid", "flowchart TD", "  A --> B"].join("\n")
    expect(extractMermaidFences(markdown)).toEqual([
      { source: "flowchart TD\n  A --> B", startLine: 1 },
    ])
  })

  test("an empty fence yields an empty source", () => {
    expect(extractMermaidFences("```mermaid\n```")).toEqual([{ source: "", startLine: 1 }])
  })

  test("text with no fence yields nothing", () => {
    expect(extractMermaidFences("just prose\n```ts\nx\n```")).toEqual([])
  })

  test("a fence opened inside a longer mermaid body is not a second diagram", () => {
    const markdown = ["````mermaid", "flowchart TD", "```mermaid", "````"].join("\n")
    expect(extractMermaidFences(markdown)).toEqual([
      { source: "flowchart TD\n```mermaid", startLine: 1 },
    ])
  })
})
