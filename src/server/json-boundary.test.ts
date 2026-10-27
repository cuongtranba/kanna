import { describe, expect, test } from "vite-plus/test"
import { toJsonValue } from "./json-boundary"

class ApiFailure extends Error {
  readonly status = 401
}

describe("toJsonValue", () => {
  test("keeps an Error's non-enumerable message alongside its own fields", () => {
    const encoded = toJsonValue(new ApiFailure("invalid api key"))
    expect(encoded).toMatchObject({ message: "invalid api key", status: 401 })
  })

  test("drops undefined fields and functions and maps non-finite numbers to null", () => {
    expect(toJsonValue({ a: 1, b: undefined, c: () => 1, d: Number.NaN, e: [undefined] })).toEqual({ a: 1, d: null, e: [null] })
  })
})
