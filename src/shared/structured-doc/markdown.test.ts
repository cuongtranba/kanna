import { describe, expect, test } from "bun:test"

import { markdownDoc } from "./markdown"

const DOC = [
  "# Loop tracking file",
  "",
  "## Goal",
  "eslint passes",
  "",
  "## Verify command",
  "```",
  "bun run lint",
  "```",
  "",
  "## Progress (latest first)",
  "- 2026-07-21 chunk 3 DONE",
  "- 2026-07-20 chunk 2 DONE",
  "- 2026-07-19 chunk 1 DONE",
  "",
  "## Next chunk",
  "chunk 4: src/foo",
  "",
].join("\n")

describe("markdownDoc.sections", () => {
  test("lists every level-2 section with normalized headings", () => {
    const secs = markdownDoc.sections(DOC)
    expect(secs.map((s) => s.normalized)).toEqual([
      "goal",
      "verify command",
      "progress (latest first)",
      "next chunk",
    ])
    expect(secs.every((s) => s.depth === 2)).toBe(true)
  })

  test("empty document has no sections", () => {
    expect(markdownDoc.sections("")).toEqual([])
  })
})

describe("markdownDoc.query", () => {
  test("returns only the requested sections in document order", () => {
    const res = markdownDoc.query(DOC, { sections: ["next chunk", "goal"] })
    expect(res.matched).toEqual(["goal", "next chunk"])
    expect(res.missing).toEqual([])
    expect(res.content).toContain("## Goal")
    expect(res.content).toContain("chunk 4: src/foo")
    expect(res.content).not.toContain("## Verify command")
    expect(res.content).not.toContain("chunk 3 DONE")
  })

  test("prefix-matches a section name", () => {
    const res = markdownDoc.query(DOC, { sections: ["progress"] })
    expect(res.matched).toEqual(["progress (latest first)"])
    expect(res.content).toContain("chunk 3 DONE")
  })

  test("listLimit keeps only the first N rows and marks the elision", () => {
    const res = markdownDoc.query(DOC, { sections: ["progress"], listLimit: 2 })
    expect(res.content).toContain("chunk 3 DONE")
    expect(res.content).toContain("chunk 2 DONE")
    expect(res.content).not.toContain("chunk 1 DONE")
    expect(res.content).toContain("+1 older entries omitted")
  })

  test("listLimit above the row count is a no-op", () => {
    const res = markdownDoc.query(DOC, { sections: ["progress"], listLimit: 99 })
    expect(res.content).toContain("chunk 1 DONE")
    expect(res.content).not.toContain("omitted")
  })

  test("no sections filter returns the whole document body", () => {
    const res = markdownDoc.query(DOC, {})
    expect(res.matched.length).toBe(4)
  })

  test("reports missing requested sections", () => {
    const res = markdownDoc.query(DOC, { sections: ["nope"] })
    expect(res.matched).toEqual([])
    expect(res.missing).toEqual(["nope"])
    expect(res.content).toBe("")
  })
})

describe("markdownDoc.append", () => {
  test("top insert adds a newest-first row directly under the heading", () => {
    const res = markdownDoc.append(DOC, {
      section: "progress",
      entry: "- 2026-07-22 chunk 4 DONE",
      position: "top",
    })
    expect(res.created).toBe(false)
    const idxNew = res.content.indexOf("chunk 4 DONE")
    const idxOld = res.content.indexOf("chunk 3 DONE")
    expect(idxNew).toBeGreaterThan(-1)
    expect(idxNew).toBeLessThan(idxOld)
    // untouched sections survive verbatim
    expect(res.content).toContain("## Next chunk")
    expect(res.content).toContain("bun run lint")
  })

  test("bottom insert appends to the end of the section body", () => {
    const res = markdownDoc.append(DOC, {
      section: "failed approaches",
      entry: "- generic noop broke variance",
      position: "bottom",
    })
    // section absent → created at EOF
    expect(res.created).toBe(true)
    expect(res.content).toContain("## failed approaches")
    expect(res.content).toContain("generic noop broke variance")
  })

  test("bottom insert into an existing section keeps prior rows", () => {
    const res = markdownDoc.append(DOC, {
      section: "progress",
      entry: "- 2026-07-22 chunk 4 DONE",
      position: "bottom",
    })
    expect(res.created).toBe(false)
    expect(res.content).toContain("chunk 1 DONE")
    expect(res.content).toContain("chunk 4 DONE")
    // Next chunk section still intact after the Progress section
    expect(res.content).toContain("## Next chunk")
  })

  test("appended content re-queries cleanly (round-trip through the parser)", () => {
    const appended = markdownDoc.append(DOC, {
      section: "progress",
      entry: "- 2026-07-22 chunk 4 DONE",
      position: "top",
    }).content
    const res = markdownDoc.query(appended, { sections: ["progress"], listLimit: 1 })
    expect(res.content).toContain("chunk 4 DONE")
    expect(res.content).toContain("+3 older entries omitted")
  })
})
