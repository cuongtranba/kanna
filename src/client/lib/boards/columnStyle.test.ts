import { describe, expect, test } from "bun:test"
import { COLUMN_DOT_CLASS, isOverWipLimit } from "./columnStyle"
import { COLUMN_COLOR_TOKENS } from "../../../shared/boards/types"

describe("COLUMN_DOT_CLASS", () => {
  test("covers every colour token in the closed set", () => {
    for (const token of COLUMN_COLOR_TOKENS) {
      expect(COLUMN_DOT_CLASS[token]).toBe(`bg-${token}`)
    }
    expect(Object.keys(COLUMN_DOT_CLASS).sort()).toEqual([...COLUMN_COLOR_TOKENS].sort())
  })
})

describe("isOverWipLimit", () => {
  test("a column with no limit is never over it", () => {
    expect(isOverWipLimit(999, null)).toBe(false)
  })

  test("over means strictly more, so hitting the limit is not over it", () => {
    expect(isOverWipLimit(3, 3)).toBe(false)
    expect(isOverWipLimit(4, 3)).toBe(true)
  })
})
