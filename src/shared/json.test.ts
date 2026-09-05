import { describe, expect, test } from "bun:test"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "./json"

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

describe("isJsonObject", () => {
  test("accepts plain objects only", () => {
    expect(isJsonObject({ a: 1 })).toBe(true)
    expect(isJsonObject({})).toBe(true)
  })
  test("rejects null, arrays and primitives", () => {
    expect(isJsonObject(null)).toBe(false)
    expect(isJsonObject([1, 2])).toBe(false)
    expect(isJsonObject("str")).toBe(false)
    expect(isJsonObject(1)).toBe(false)
    expect(isJsonObject(true)).toBe(false)
  })
  test("narrows so indexing yields JsonValue, not unknown", () => {
    const value: JsonValue = { name: "kanna", count: 2 }
    if (!isJsonObject(value)) throw new Error("expected object")
    const name: JsonValue = value.name
    expect(typeof name === "string" ? name : null).toBe("kanna")
  })
})

describe("isJsonArray", () => {
  test("accepts arrays only", () => {
    expect(isJsonArray([])).toBe(true)
    expect(isJsonArray([1, "a"])).toBe(true)
    expect(isJsonArray({ a: 1 })).toBe(false)
    expect(isJsonArray(null)).toBe(false)
    expect(isJsonArray("str")).toBe(false)
  })
  test("narrows to an iterable of JsonValue", () => {
    const value: JsonValue = ["a", 1, null]
    if (!isJsonArray(value)) throw new Error("expected array")
    const strings: string[] = []
    for (const entry of value) {
      if (typeof entry === "string") strings.push(entry)
    }
    expect(strings).toEqual(["a"])
  })
})
