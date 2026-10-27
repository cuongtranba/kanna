import { describe, expect, test } from "vite-plus/test"
import { createPluginLogRing, tailLogEntries } from "./log-ring"

function fill(count: number) {
  const ring = createPluginLogRing()
  for (let at = 0; at < count; at += 1) ring.append({ stream: "out", text: `line ${at}`, at })
  return ring
}

describe("tailLogEntries", () => {
  test("a zero or negative count selects nothing, not the whole ring", () => {
    const entries = fill(3).tail()
    expect(tailLogEntries(entries, 0)).toEqual([])
    expect(tailLogEntries(entries, -1)).toEqual([])
  })

  test("a count larger than the ring selects every entry", () => {
    expect(tailLogEntries(fill(3).tail(), 100)).toHaveLength(3)
  })

  test("a smaller count selects the newest entries", () => {
    expect(tailLogEntries(fill(5).tail(), 2).map((entry) => entry.text)).toEqual(["line 3", "line 4"])
  })
})

describe("createPluginLogRing", () => {
  test("tail with no count returns every entry", () => {
    expect(fill(4).tail()).toHaveLength(4)
  })

  test("tail with a count returns that many of the newest entries", () => {
    expect(fill(4).tail(1).map((entry) => entry.text)).toEqual(["line 3"])
  })
})
