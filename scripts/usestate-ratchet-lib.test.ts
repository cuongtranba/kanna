import { describe, expect, test } from "bun:test"
import { countByFile, evaluateRatchet, renderMarkdownReport } from "./usestate-ratchet-lib"

describe("countByFile", () => {
  test("aggregates match files into counts", () => {
    expect(countByFile(["a.tsx", "b.tsx", "a.tsx"])).toEqual({ "a.tsx": 2, "b.tsx": 1 })
  })
  test("empty input produces empty record", () => {
    expect(countByFile([])).toEqual({})
  })
})

describe("evaluateRatchet", () => {
  test("ratchet mode passes at or below baseline", () => {
    expect(evaluateRatchet(10, 10, "ratchet").ok).toBe(true)
    expect(evaluateRatchet(9, 10, "ratchet").ok).toBe(true)
  })
  test("ratchet mode fails above baseline", () => {
    const result = evaluateRatchet(11, 10, "ratchet")
    expect(result.ok).toBe(false)
    expect(result.message).toContain("11")
    expect(result.message).toContain("10")
  })
  test("zero mode fails on any violation", () => {
    expect(evaluateRatchet(1, 10, "zero").ok).toBe(false)
    expect(evaluateRatchet(0, 10, "zero").ok).toBe(true)
  })
})

describe("renderMarkdownReport", () => {
  test("renders sorted table with total", () => {
    const md = renderMarkdownReport({ "b.tsx": 1, "a.tsx": 3 }, "2026-07-12")
    expect(md).toContain("| a.tsx | 3 |")
    expect(md.indexOf("a.tsx")).toBeLessThan(md.indexOf("b.tsx"))
    expect(md).toContain("Total: 4")
  })
})
