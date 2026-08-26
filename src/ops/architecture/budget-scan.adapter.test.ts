import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { measureModules, measurePatterns } from "./budget-scan.adapter"
import type { PatternBudget } from "./budget"

const roots: string[] = []

const seed = (files: Record<string, string>): string => {
  const root = mkdtempSync(path.join(tmpdir(), "kanna-budget-"))
  roots.push(root)
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = path.join(root, relativePath)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const budget = (overrides: Partial<PatternBudget>): PatternBudget => ({
  id: "probe",
  include: ["src/"],
  pattern: "needle",
  max: 0,
  issue: 1,
  rationale: "a rationale long enough to satisfy the manifest invariant",
  ...overrides,
})

describe("measureModules", () => {
  test("counts newlines so a pin matches what `wc -l` reports", () => {
    const root = seed({ "src/a.ts": "one\ntwo\nthree\n" })
    expect(measureModules(root)).toEqual([{ path: "src/a.ts", lines: 3 }])
  })

  test("recurses into subdirectories", () => {
    const root = seed({ "src/a.ts": "x\n", "src/deep/nested/b.tsx": "y\n" })
    expect(measureModules(root).map((m) => m.path)).toEqual(["src/a.ts", "src/deep/nested/b.tsx"])
  })

  test("excludes tests, fixtures and test doubles from production surface", () => {
    const root = seed({
      "src/a.ts": "x\n",
      "src/a.test.ts": "x\n",
      "src/a.test.tsx": "x\n",
      "src/b.live.test.ts": "x\n",
      "src/test-helpers/h.ts": "x\n",
      "src/__fixtures__/f.ts": "x\n",
      "src/client/adapters/testing/fake.ts": "x\n",
    })
    expect(measureModules(root).map((m) => m.path)).toEqual(["src/a.ts"])
  })

  test("ignores non-TypeScript files", () => {
    const root = seed({ "src/a.ts": "x\n", "src/styles.css": "x\n", "src/notes.md": "x\n" })
    expect(measureModules(root).map((m) => m.path)).toEqual(["src/a.ts"])
  })
})

describe("measurePatterns", () => {
  test("counts matching lines, not matching occurrences", () => {
    const root = seed({ "src/a.ts": "needle needle needle\nplain\nneedle\n" })
    const [measured] = measurePatterns(root, measureModules(root), [budget({})])
    expect(measured.count).toBe(2)
  })

  test("a file-scoped include reads only that file", () => {
    const root = seed({ "src/a.ts": "needle\n", "src/b.ts": "needle\n" })
    const [measured] = measurePatterns(root, measureModules(root), [budget({ include: ["src/a.ts"] })])
    expect(measured.count).toBe(1)
  })

  test("a subtree include reads everything beneath it", () => {
    const root = seed({ "src/server/a.ts": "needle\n", "src/server/deep/b.ts": "needle\n", "src/client/c.ts": "needle\n" })
    const [measured] = measurePatterns(root, measureModules(root), [budget({ include: ["src/server/"] })])
    expect(measured.count).toBe(2)
  })

  test("test files are excluded from pattern counts too", () => {
    const root = seed({ "src/a.ts": "needle\n", "src/a.test.ts": "needle\nneedle\n" })
    const [measured] = measurePatterns(root, measureModules(root), [budget({})])
    expect(measured.count).toBe(1)
  })

  test("reports up to five sites so a breach can be located without a second grep", () => {
    const root = seed({ "src/a.ts": `${Array.from({ length: 9 }, () => "needle").join("\n")}\n` })
    const [measured] = measurePatterns(root, measureModules(root), [budget({})])
    expect(measured.count).toBe(9)
    expect(measured.sites).toEqual(["src/a.ts:1", "src/a.ts:2", "src/a.ts:3", "src/a.ts:4", "src/a.ts:5"])
  })

  test("filesScanned reports how many files the include reached", () => {
    const root = seed({ "src/server/a.ts": "x\n", "src/server/b.ts": "x\n", "src/client/c.ts": "x\n" })
    const [measured] = measurePatterns(root, measureModules(root), [budget({ include: ["src/server/"] })])
    expect(measured.filesScanned).toBe(2)
  })

  test("an anchored pattern respects line boundaries", () => {
    const root = seed({ "src/a.ts": '  case "x":\nreturn case "y"\n' })
    const [measured] = measurePatterns(root, measureModules(root), [budget({ pattern: '^\\s*case "' })])
    expect(measured.count).toBe(1)
  })

  test("a budget whose include matches nothing measures zero, which the checker reports as unmeasured", () => {
    const root = seed({ "src/a.ts": "needle\n" })
    const [measured] = measurePatterns(root, measureModules(root), [budget({ include: ["src/gone.ts"] })])
    expect(measured).toEqual({ id: "probe", count: 0, sites: [], filesScanned: 0 })
  })
})
