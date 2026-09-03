import { describe, expect, test } from "bun:test"
import { stateMarkKind, stateMarkStrokes, type StateMarkKind } from "./stateMark"
import type { StatusTone } from "./statusLabel"

const TONES: readonly StatusTone[] = ["muted", "active", "attention", "destructive"]
const KINDS: readonly StateMarkKind[] = ["doubled", "based", "struck", "half"]

describe("stateMarkKind", () => {
  test("every tone owns a distinct mark, so shape alone separates the states", () => {
    const kinds = TONES.map(stateMarkKind)
    expect(new Set(kinds).size).toBe(TONES.length)
  })

  test("running is the doubled stroke and failure is the struck one", () => {
    expect(stateMarkKind("active")).toBe("doubled")
    expect(stateMarkKind("destructive")).toBe("struck")
  })
})

describe("stateMarkStrokes", () => {
  test("no two marks share a silhouette", () => {
    const shapes = KINDS.map((k) => JSON.stringify(stateMarkStrokes(k)))
    expect(new Set(shapes).size).toBe(KINDS.length)
  })

  test("every stroke stays inside the 9x13 field", () => {
    for (const kind of KINDS) {
      for (const s of stateMarkStrokes(kind)) {
        for (const x of [s.x1, s.x2]) expect(x).toBeGreaterThanOrEqual(0)
        for (const x of [s.x1, s.x2]) expect(x).toBeLessThanOrEqual(9)
        for (const y of [s.y1, s.y2]) expect(y).toBeGreaterThanOrEqual(0)
        for (const y of [s.y1, s.y2]) expect(y).toBeLessThanOrEqual(13)
      }
    }
  })

  test("the half mark is visibly shorter than the full-height marks", () => {
    const height = (kind: StateMarkKind) =>
      Math.max(...stateMarkStrokes(kind).map((s) => Math.abs(s.y2 - s.y1)))
    expect(height("half")).toBeLessThan(height("doubled"))
  })

  test("every mark draws something", () => {
    for (const kind of KINDS) expect(stateMarkStrokes(kind).length).toBeGreaterThan(0)
  })
})
