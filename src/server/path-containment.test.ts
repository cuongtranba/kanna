import { describe, expect, test } from "bun:test"
import path from "node:path"
import { isInsideAny, isPathInside } from "./path-containment"

const ROOT = path.resolve("/workspace/project")

describe("isPathInside", () => {
  test("accepts the root itself and its descendants", () => {
    expect(isPathInside(ROOT, ROOT)).toBe(true)
    expect(isPathInside(ROOT, path.join(ROOT, "src", "a.ts"))).toBe(true)
  })

  test("rejects the parent, a sibling, and a sibling sharing the root as a prefix", () => {
    expect(isPathInside(ROOT, path.dirname(ROOT))).toBe(false)
    expect(isPathInside(ROOT, path.resolve("/workspace/other"))).toBe(false)
    expect(isPathInside(ROOT, `${ROOT}-copy`)).toBe(false)
  })

  test("a child whose name starts with two dots is inside the root", () => {
    expect(isPathInside(ROOT, path.join(ROOT, "..cache"))).toBe(true)
    expect(isPathInside(ROOT, path.join(ROOT, "..cache", "entry.json"))).toBe(true)
  })
})

describe("isInsideAny", () => {
  test("is true when any root contains the candidate", () => {
    const other = path.resolve("/elsewhere")
    expect(isInsideAny([other, ROOT], path.join(ROOT, "x"))).toBe(true)
    expect(isInsideAny([other], path.join(ROOT, "x"))).toBe(false)
    expect(isInsideAny([], ROOT)).toBe(false)
  })
})
