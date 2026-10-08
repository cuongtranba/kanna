import { describe, expect, test } from "bun:test"
import { OutputRing, OUTPUT_RING_DEFAULT_BYTES } from "./output-ring"

describe("OutputRing", () => {
  test("appends and returns full content under capacity", () => {
    const r = new OutputRing(100)
    r.append("hello ")
    r.append("world")
    expect(r.tail()).toBe("hello world")
  })

  test("drops oldest bytes once capacity exceeded", () => {
    const r = new OutputRing(5)
    r.append("abcdefgh")
    expect(r.tail()).toBe("defgh")
  })

  test("default capacity is 256 KB", () => {
    expect(OUTPUT_RING_DEFAULT_BYTES).toBe(256 * 1024)
  })

  test("contains(needle) returns true when present in tail", () => {
    const r = new OutputRing(100)
    r.append("Please run /login")
    expect(r.contains("/login")).toBe(true)
    expect(r.contains("foobar")).toBe(false)
  })

  test("contains works after rotation", () => {
    const r = new OutputRing(20)
    r.append("xxxxxxxxxxxxx")
    r.append("Please run /login")
    expect(r.contains("/login")).toBe(true)
  })
})
