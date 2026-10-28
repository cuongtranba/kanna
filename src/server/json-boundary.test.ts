import { describe, expect, test } from "vite-plus/test"
import { toJsonValue } from "./json-boundary"

class ApiFailure extends Error {
  readonly status = 401
}

describe("toJsonValue", () => {
  test("encodes an Error as its name and message only, never its stack or own fields", () => {
    const encoded = toJsonValue(new ApiFailure("invalid api key"))
    expect(encoded).toEqual({ name: "Error", message: "invalid api key" })
  })

  test("never leaks a stack when an Error is nested in a payload", () => {
    const encoded = toJsonValue({ error: new ApiFailure("boom"), list: [new TypeError("bad")] })
    expect(JSON.stringify(encoded)).not.toContain("stack")
    expect(JSON.stringify(encoded)).not.toContain(" at ")
    expect(encoded).toEqual({
      error: { name: "Error", message: "boom" },
      list: [{ name: "TypeError", message: "bad" }],
    })
  })

  test("drops undefined fields and functions and maps non-finite numbers to null", () => {
    expect(toJsonValue({ a: 1, b: undefined, c: () => 1, d: Number.NaN, e: [undefined] })).toEqual({ a: 1, d: null, e: [null] })
  })
})
