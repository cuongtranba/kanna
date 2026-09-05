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

const FENCED = [
  "## Next chunk",
  "Run these steps:",
  "",
  "- outer item",
  "  - nested item",
  "",
  "```sh",
  "## not a heading",
  "bun run lint",
  "```",
  "",
  "## Notes",
  "keep me",
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
    expect(res.content).toContain("## Next chunk")
    expect(res.content).toContain("bun run lint")
  })

  test("bottom insert appends to the end of the section body", () => {
    const res = markdownDoc.append(DOC, {
      section: "failed approaches",
      entry: "- generic noop broke variance",
      position: "bottom",
    })
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

describe("markdownDoc.replace", () => {
  test("swaps a mid-document section body and drops the old one", () => {
    const res = markdownDoc.replace(DOC, { section: "goal", body: "typecheck passes" })
    expect(res.created).toBe(false)
    expect(res.content).toContain("## Goal")
    expect(res.content).toContain("typecheck passes")
    expect(res.content).not.toContain("eslint passes")
  })

  test("leaves content outside the target section byte-identical", () => {
    const res = markdownDoc.replace(DOC, { section: "goal", body: "typecheck passes" })
    const head = DOC.slice(0, DOC.indexOf("## Goal"))
    const tail = DOC.slice(DOC.indexOf("## Verify command"))
    expect(res.content.startsWith(head)).toBe(true)
    expect(res.content.endsWith(tail)).toBe(true)
  })

  test("replaces the last section and ends with a single trailing newline", () => {
    const res = markdownDoc.replace(DOC, { section: "next chunk", body: "chunk 5: src/bar" })
    expect(res.created).toBe(false)
    expect(res.content).toContain("chunk 5: src/bar")
    expect(res.content).not.toContain("chunk 4: src/foo")
    expect(res.content.endsWith("## Next chunk\n\nchunk 5: src/bar\n")).toBe(true)
  })

  test("an empty body clears the section, leaving just the heading", () => {
    const res = markdownDoc.replace(DOC, { section: "goal", body: "" })
    expect(res.created).toBe(false)
    expect(res.content).not.toContain("eslint passes")
    expect(res.content).toContain("## Goal\n\n## Verify command")
  })

  test("creates a missing section at EOF", () => {
    const res = markdownDoc.replace(DOC, {
      section: "failed approaches",
      body: "- generic noop broke variance",
    })
    expect(res.created).toBe(true)
    expect(res.content.startsWith(DOC)).toBe(true)
    expect(res.content).toContain("## failed approaches")
    expect(res.content).toContain("- generic noop broke variance")
  })

  test("prefix-matches the section name", () => {
    const res = markdownDoc.replace(DOC, { section: "next", body: "chunk 5: src/bar" })
    expect(res.created).toBe(false)
    expect(res.content).toContain("## Next chunk")
    expect(res.content).toContain("chunk 5: src/bar")
  })

  test("a nested list / fenced body does not eat the following heading", () => {
    const res = markdownDoc.replace(FENCED, { section: "next chunk", body: "chunk 9: src/bar" })
    expect(res.created).toBe(false)
    expect(res.content).not.toContain("nested item")
    expect(res.content).not.toContain("## not a heading")
    expect(res.content).not.toContain("```")
    expect(res.content.endsWith("## Notes\nkeep me\n")).toBe(true)
    expect(markdownDoc.sections(res.content).map((s) => s.normalized)).toEqual([
      "next chunk",
      "notes",
    ])
  })

  test("repeated replaces do not accumulate (the loop's Next chunk contract)", () => {
    const once = markdownDoc.replace(DOC, { section: "next chunk", body: "chunk 5" }).content
    const twice = markdownDoc.replace(once, { section: "next chunk", body: "chunk 6" }).content
    expect(twice).not.toContain("chunk 5")
    expect(twice).not.toContain("chunk 4: src/foo")
    const res = markdownDoc.query(twice, { sections: ["next chunk"] })
    expect(res.matched).toEqual(["next chunk"])
    expect(res.content).toContain("chunk 6")
  })
})

const MULTILINE_PROGRESS = [
  "## Progress (latest first)",
  "",
  "- 2026-08-06 chunk 3 DONE",
  "  reverted the adapter split",
  "- 2026-08-05 chunk 2 DONE",
  "  - sub note a",
  "  - sub note b",
  "- 2026-08-04 chunk 1 DONE",
  "",
  "_Subagent appends one row per completed chunk here._",
  "",
  "## Next chunk",
  "chunk 4",
  "",
].join("\n")

describe("markdownDoc.listItems", () => {
  test("returns one entry per top-level item, in document order", () => {
    expect(markdownDoc.listItems(DOC, "Progress")).toEqual([
      "- 2026-07-21 chunk 3 DONE",
      "- 2026-07-20 chunk 2 DONE",
      "- 2026-07-19 chunk 1 DONE",
    ])
  })

  test("a continuation line stays part of its item and a nested list does not split its parent", () => {
    const items = markdownDoc.listItems(MULTILINE_PROGRESS, "progress")
    expect(items).toHaveLength(3)
    expect(items[0]).toBe("- 2026-08-06 chunk 3 DONE\n  reverted the adapter split")
    expect(items[1]).toContain("- sub note b")
    expect(items[2]).toBe("- 2026-08-04 chunk 1 DONE")
  })

  test("the skeleton's trailing placeholder paragraph is not an item", () => {
    expect(markdownDoc.listItems(MULTILINE_PROGRESS, "Progress").join("\n")).not.toContain(
      "Subagent appends",
    )
  })

  test("a section with no list, and a missing section, yield no items", () => {
    expect(markdownDoc.listItems(DOC, "goal")).toEqual([])
    expect(markdownDoc.listItems(DOC, "nonexistent")).toEqual([])
  })

  test("a list inside a later section is never claimed by an earlier one", () => {
    expect(markdownDoc.listItems(FENCED, "notes")).toEqual([])
    expect(markdownDoc.listItems(FENCED, "next chunk")).toEqual(["- outer item\n  - nested item"])
  })
})
