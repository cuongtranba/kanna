import { describe, expect, test } from "vite-plus/test"
import { prefixedSelectValue } from "./selectValue"

describe("prefixedSelectValue", () => {
  const card = prefixedSelectValue("c")

  test("decodes what it encoded", () => {
    expect(card.decode(card.encode("abc-123"))).toBe("abc-123")
  })

  test("an id that looks like a sentinel survives the round trip", () => {
    expect(card.decode(card.encode("add"))).toBe("add")
    expect(card.decode(card.encode("c"))).toBe("c")
  })

  test("a sentinel value that was never encoded decodes to null", () => {
    expect(card.decode("add")).toBeNull()
    expect(card.decode("c")).toBeNull()
  })

  test("a value from another prefix is not decoded", () => {
    expect(card.decode(prefixedSelectValue("o").encode("x"))).toBeNull()
  })
})
