// src/server/orchestration-diff.test.ts
import { describe, expect, test } from "bun:test"
import { boundDiff, MAX_DIFF_CHARS } from "./orchestration-diff"

function fileSegment(file: string, bodyLines: number, lineText = "+x"): string {
  const body = Array.from({ length: bodyLines }, () => lineText).join("\n")
  return `diff --git a/${file} b/${file}\nindex 000..111 100644\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${bodyLines} @@\n${body}\n`
}

describe("boundDiff", () => {
  test("returns the diff verbatim when under budget", () => {
    const diff = fileSegment("src/a.ts", 3)
    expect(boundDiff(diff, 10_000)).toBe(diff)
  })

  test("default budget is MAX_DIFF_CHARS", () => {
    const diff = fileSegment("src/a.ts", 5)
    expect(diff.length).toBeLessThan(MAX_DIFF_CHARS)
    expect(boundDiff(diff)).toBe(diff)
  })

  test("over budget: banner lists every file with +/- counts and omitted markers", () => {
    const small = fileSegment("src/a.ts", 5)
    const big = fileSegment("bun.lock", 2000)
    const out = boundDiff(small + big, small.length + 1000)
    expect(out).toContain("DIFF TRUNCATED")
    expect(out).toContain("src/a.ts (+5/-0)")
    expect(out).toContain("bun.lock (+2000/-0) [omitted]")
    expect(out).toContain("git diff <base>")
  })

  test("a giant early file cannot starve later source files (order-preserving skip)", () => {
    const lockfile = fileSegment("bun.lock", 3000)
    const source = fileSegment("src/real-change.ts", 10)
    const out = boundDiff(lockfile + source, source.length + 600)
    // the lockfile is skipped, the later source segment is included whole
    expect(out).toContain("diff --git a/src/real-change.ts")
    expect(out).not.toContain("@@ -0,0 +1,3000 @@")
    expect(out).toContain("bun.lock (+3000/-0) [omitted]")
  })

  test("single oversized segment is included truncated with a marker", () => {
    const only = fileSegment("src/huge.ts", 5000)
    const out = boundDiff(only, 2000)
    expect(out).toContain("DIFF TRUNCATED")
    expect(out).toContain("diff --git a/src/huge.ts")
    expect(out).toContain("[... segment truncated ...]")
    expect(out.length).toBeLessThan(only.length)
  })

  test("bounded output stays near the budget", () => {
    const diff = Array.from({ length: 20 }, (_, i) => fileSegment(`src/f${i}.ts`, 500)).join("")
    const out = boundDiff(diff, 10_000)
    expect(out.length).toBeLessThanOrEqual(10_000 + 2_000) // banner slack only
  })

  test("deletions counted separately from the --- header line", () => {
    const seg = `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,1 @@\n-gone\n-also gone\n+kept\n`
    const other = fileSegment("bulk.ts", 3000)
    const out = boundDiff(seg + other, seg.length + 500)
    expect(out).toContain("x.ts (+1/-2)")
  })
})
