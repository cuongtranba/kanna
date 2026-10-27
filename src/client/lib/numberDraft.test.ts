import { describe, expect, test } from "vite-plus/test"
import { resolveNumberCommit } from "./numberDraft"

const ROUNDING = { min: 1, max: 100 } as const
const STRICT = { min: 1, max: Number.POSITIVE_INFINITY, integer: true } as const

describe("resolveNumberCommit", () => {
  test("rejects text that is not a number or is outside the range", () => {
    expect(resolveNumberCommit("abc", 5, ROUNDING)).toEqual({ kind: "invalid" })
    expect(resolveNumberCommit("0", 5, ROUNDING)).toEqual({ kind: "invalid" })
    expect(resolveNumberCommit("101", 5, ROUNDING)).toEqual({ kind: "invalid" })
    expect(resolveNumberCommit("", 5, ROUNDING)).toEqual({ kind: "invalid" })
  })

  test("rounding mode accepts fractions and rounds them before comparing to the current value", () => {
    expect(resolveNumberCommit("5.4", 5, ROUNDING)).toEqual({ kind: "unchanged" })
    expect(resolveNumberCommit("5.6", 5, ROUNDING)).toEqual({ kind: "write", value: 6 })
  })

  test("strict mode rejects fractions", () => {
    expect(resolveNumberCommit("2.5", 1, STRICT)).toEqual({ kind: "invalid" })
    expect(resolveNumberCommit("24", 24, STRICT)).toEqual({ kind: "unchanged" })
    expect(resolveNumberCommit("48", 24, STRICT)).toEqual({ kind: "write", value: 48 })
  })
})
