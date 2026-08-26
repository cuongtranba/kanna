import { describe, expect, test } from "bun:test"
import path from "node:path"
import { measureModules, measurePatterns } from "./budget-scan.adapter"
import {
  checkModuleBudget,
  coveredBy,
  checkPatternBudget,
  formatBreach,
  MODULE_ALLOWANCES,
  MODULE_LINE_THRESHOLD,
  PATTERN_BUDGETS,
  SELF_EXCLUDED_PATHS,
  type ModuleMeasurement,
  type PatternMeasurement,
} from "./budget"

const measuredModules = (entries: Record<string, number>): ModuleMeasurement[] =>
  Object.entries(entries).map(([path, lines]) => ({ path, lines }))

const measuredPatterns = (entries: Record<string, number>): PatternMeasurement[] =>
  Object.entries(entries).map(([id, count]) => ({ id, count, sites: [], filesScanned: 1 }))

describe("checkModuleBudget", () => {
  const allowances = { "src/a.ts": 1000, "src/b.ts": 800 }

  test("accepts a listed module at its allowance", () => {
    expect(checkModuleBudget(measuredModules({ "src/a.ts": 1000, "src/b.ts": 800 }), allowances)).toEqual([])
  })

  test("accepts a listed module below its allowance but still over threshold", () => {
    expect(checkModuleBudget(measuredModules({ "src/a.ts": 750, "src/b.ts": 800 }), allowances)).toEqual([])
  })

  test("rejects a listed module that grew past its allowance", () => {
    const breaches = checkModuleBudget(measuredModules({ "src/a.ts": 1001, "src/b.ts": 800 }), allowances)
    expect(breaches).toEqual([{ kind: "module_grew", path: "src/a.ts", allowance: 1000, actual: 1001 }])
  })

  test("rejects a module that crossed the threshold without an allowance", () => {
    const breaches = checkModuleBudget(
      measuredModules({ "src/a.ts": 1000, "src/b.ts": 800, "src/new.ts": 701 }),
      allowances,
    )
    expect(breaches).toEqual([
      { kind: "module_unlisted", path: "src/new.ts", threshold: MODULE_LINE_THRESHOLD, actual: 701 },
    ])
  })

  test("rejects an allowance whose module dropped under the threshold", () => {
    const breaches = checkModuleBudget(measuredModules({ "src/a.ts": 1000 }), allowances)
    expect(breaches).toEqual([{ kind: "module_delistable", path: "src/b.ts", threshold: MODULE_LINE_THRESHOLD }])
  })

  test("reports every breach rather than stopping at the first", () => {
    const breaches = checkModuleBudget(measuredModules({ "src/a.ts": 1400, "src/new.ts": 900 }), allowances)
    expect(breaches.map((b) => b.kind).sort()).toEqual(["module_delistable", "module_grew", "module_unlisted"])
  })
})

describe("checkPatternBudget", () => {
  const budgets = [
    { id: "alpha", include: ["src/**"], pattern: "a", max: 10, issue: 1, rationale: "r" },
    { id: "beta", include: ["src/**"], pattern: "b", max: 0, issue: 2, rationale: "r" },
  ]

  test("accepts a population sitting exactly at its pin", () => {
    expect(checkPatternBudget(measuredPatterns({ alpha: 10, beta: 0 }), budgets)).toEqual([])
  })

  test("rejects a population that grew", () => {
    const breaches = checkPatternBudget(measuredPatterns({ alpha: 11, beta: 0 }), budgets)
    expect(breaches).toEqual([{ kind: "pattern_grew", id: "alpha", max: 10, actual: 11, issue: 1 }])
  })

  test("rejects a population that shrank without the pin being lowered", () => {
    const breaches = checkPatternBudget(measuredPatterns({ alpha: 4, beta: 0 }), budgets)
    expect(breaches).toEqual([{ kind: "pattern_shrank", id: "alpha", max: 10, actual: 4, issue: 1 }])
  })

  test("rejects a measurement with no matching budget", () => {
    const breaches = checkPatternBudget(measuredPatterns({ alpha: 10, beta: 0, gamma: 3 }), budgets)
    expect(breaches).toEqual([{ kind: "pattern_unknown", id: "gamma" }])
  })

  test("rejects a budget nothing measured", () => {
    const breaches = checkPatternBudget(measuredPatterns({ alpha: 10 }), budgets)
    expect(breaches).toEqual([{ kind: "pattern_unmeasured", id: "beta" }])
  })

  test("a gate that scanned no files reports as inert, never as a population that shrank", () => {
    const stale: PatternMeasurement[] = [
      { id: "alpha", count: 0, sites: [], filesScanned: 0 },
      { id: "beta", count: 0, sites: [], filesScanned: 1 },
    ]
    expect(checkPatternBudget(stale, budgets)).toEqual([{ kind: "pattern_unmeasured", id: "alpha" }])
  })

  test("the inert-gate message refuses the pin-it-at-zero shortcut", () => {
    const message = formatBreach({ kind: "pattern_unmeasured", id: "alpha" })
    expect(message).toContain("inert")
    expect(message).toContain("Do NOT pin it at 0")
  })
})

describe("formatBreach", () => {
  test("a grown pattern names the issue it regresses", () => {
    const message = formatBreach({ kind: "pattern_grew", id: "alpha", max: 10, actual: 11, issue: 42 })
    expect(message).toContain("alpha")
    expect(message).toContain("#42")
    expect(message).toContain("11")
  })

  test("a shrunk pattern states the exact manifest edit", () => {
    const message = formatBreach({ kind: "pattern_shrank", id: "alpha", max: 10, actual: 4, issue: 42 })
    expect(message).toContain("max: 4")
  })

  test("a grown module states the path and both counts", () => {
    const message = formatBreach({ kind: "module_grew", path: "src/a.ts", allowance: 1000, actual: 1400 })
    expect(message).toContain("src/a.ts")
    expect(message).toContain("1400")
  })
})

describe("the repository satisfies its architecture budget", () => {
  const root = path.resolve(import.meta.dir, "../../..")
  const modules = measureModules(root)
  const patterns = measurePatterns(root, modules)

  test("no module grew past its allowance, crossed the threshold unlisted, or is now delistable", () => {
    const breaches = checkModuleBudget(modules)
    expect(breaches.map(formatBreach).join("\n\n")).toBe("")
  })

  test("no defect population grew, and none shrank without its pin being lowered", () => {
    const breaches = checkPatternBudget(patterns)
    expect(breaches.map(formatBreach).join("\n\n")).toBe("")
  })

  test("the scan reaches real source, so a silently-empty gate cannot pass", () => {
    expect(modules.length).toBeGreaterThan(400)
    expect(modules.some((m) => m.path === "src/server/agent-coordinator.ts")).toBe(true)
    expect(modules.every((m) => !m.path.includes(".test."))).toBe(true)
  })
})

describe("the manifest itself", () => {
  test("every module allowance is at or above the threshold", () => {
    for (const [path, allowance] of Object.entries(MODULE_ALLOWANCES)) {
      expect({ path, allowance }).toMatchObject({ allowance: expect.any(Number) })
      expect(allowance).toBeGreaterThanOrEqual(MODULE_LINE_THRESHOLD)
    }
  })

  test("every pattern budget cites a rationale and a driving issue", () => {
    for (const budget of PATTERN_BUDGETS) {
      expect(budget.rationale.length).toBeGreaterThan(20)
      expect(budget.issue).toBeGreaterThan(0)
      expect(budget.include.length).toBeGreaterThan(0)
    }
  })

  test("pattern ids are unique", () => {
    const ids = PATTERN_BUDGETS.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("every pattern regex compiles", () => {
    for (const budget of PATTERN_BUDGETS) {
      expect(() => new RegExp(budget.pattern)).not.toThrow()
    }
  })

  test("no budget scans the manifest or the scanner, which quote every regex as a literal", () => {
    for (const budget of PATTERN_BUDGETS) {
      for (const selfPath of SELF_EXCLUDED_PATHS) {
        expect({ id: budget.id, selfPath, covered: coveredBy(selfPath, budget.include) })
          .toMatchObject({ covered: false })
      }
    }
  })
})
