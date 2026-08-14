import { describe, expect, test } from "bun:test"
import { safeJsonParse } from "./safe-json"

describe("safeJsonParse", () => {
  test("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 })
    expect(safeJsonParse("[1,2]")).toEqual([1, 2])
    expect(safeJsonParse('"str"')).toBe("str")
  })
  test("returns null on invalid JSON", () => {
    expect(safeJsonParse("{truncated")).toBeNull()
    expect(safeJsonParse("")).toBeNull()
  })
})
