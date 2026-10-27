import { describe, expect, test } from "vite-plus/test"
import { scanFenceBody } from "./markdown-fences"

describe("scanFenceBody", () => {
  test("returns the body and the index of the closing fence line", () => {
    const lines = ["```mermaid", "graph LR", "```", "after"]
    expect(scanFenceBody(lines, 0, "```")).toEqual({ source: "graph LR", lastLineIndex: 2, closed: true })
  })

  test("stops at the end of input and reports an open fence when it never closes", () => {
    const lines = ["```mermaid", "graph LR"]
    expect(scanFenceBody(lines, 0, "```")).toEqual({ source: "graph LR", lastLineIndex: 1, closed: false })
  })

  test("a 3-backtick line does not close a 4-backtick fence", () => {
    const lines = ["````mermaid", "graph LR", "```", "````"]
    expect(scanFenceBody(lines, 0, "````")).toEqual({ source: "graph LR\n```", lastLineIndex: 3, closed: true })
  })
})
