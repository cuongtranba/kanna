import { describe, expect, test } from "bun:test"
import { resolveBoardPageSize } from "./ws-router-envelope"

/**
 * A board subscription's `pageSize` arrives from the client verbatim, and every
 * board broadcast rebuilds its snapshot from the stored topic — so a bad value
 * is not a one-off bad read, it is a bad read repeated on every card edit for
 * as long as that socket is open.
 */
describe("resolveBoardPageSize", () => {
  test("absent means the registry's own default", () => {
    expect(resolveBoardPageSize(undefined)).toBeUndefined()
  })

  test("a sensible request is honoured", () => {
    expect(resolveBoardPageSize(60)).toBe(60)
  })

  test("caps a request rather than refusing it", () => {
    expect(resolveBoardPageSize(10_000)).toBe(500)
  })

  test("nonsense falls back to the default instead of reaching the store", () => {
    expect(resolveBoardPageSize(0)).toBeUndefined()
    expect(resolveBoardPageSize(-5)).toBeUndefined()
    expect(resolveBoardPageSize(1.5)).toBeUndefined()
    expect(resolveBoardPageSize(Number.NaN)).toBeUndefined()
    expect(resolveBoardPageSize(Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})
