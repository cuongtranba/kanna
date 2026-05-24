import { describe, expect, test } from "bun:test"
import process from "node:process"
import {
  collectTreePids,
  parsePsOutput,
  sampleProcessTreeUsage,
  sumTreeUsage,
  type PsProcessRow,
} from "./pty-memory-sampler.adapter"

describe("parsePsOutput", () => {
  test("parses normal ps output with pid/ppid/rss/pcpu", () => {
    const out = [
      "    1     0    1024   0.0",
      "  100     1    2048   5.2",
      "  101   100    4096  12.5",
      "",
      "  102   100    8192  99.9",
    ].join("\n")
    expect(parsePsOutput(out)).toEqual([
      { pid: 1, ppid: 0, rssKb: 1024, cpuPercent: 0.0 },
      { pid: 100, ppid: 1, rssKb: 2048, cpuPercent: 5.2 },
      { pid: 101, ppid: 100, rssKb: 4096, cpuPercent: 12.5 },
      { pid: 102, ppid: 100, rssKb: 8192, cpuPercent: 99.9 },
    ])
  })

  test("skips malformed rows without throwing", () => {
    const out = [
      "100 1 1024 3.0",
      "garbage line here",
      "abc def ghi jkl",
      "200 1 2048 7.5",
      " ",
      "300 1 100",
    ].join("\n")
    expect(parsePsOutput(out)).toEqual([
      { pid: 100, ppid: 1, rssKb: 1024, cpuPercent: 3.0 },
      { pid: 200, ppid: 1, rssKb: 2048, cpuPercent: 7.5 },
    ])
  })

  test("returns empty array for empty input", () => {
    expect(parsePsOutput("")).toEqual([])
    expect(parsePsOutput("\n\n\n")).toEqual([])
  })
})

describe("collectTreePids", () => {
  const rows: PsProcessRow[] = [
    { pid: 1, ppid: 0, rssKb: 0, cpuPercent: 0 },
    { pid: 100, ppid: 1, rssKb: 0, cpuPercent: 0 },
    { pid: 101, ppid: 100, rssKb: 0, cpuPercent: 0 },
    { pid: 102, ppid: 100, rssKb: 0, cpuPercent: 0 },
    { pid: 103, ppid: 101, rssKb: 0, cpuPercent: 0 },
    { pid: 200, ppid: 1, rssKb: 0, cpuPercent: 0 },
  ]

  test("collects root + descendants transitively", () => {
    expect(collectTreePids(rows, 100)).toEqual(new Set([100, 101, 102, 103]))
  })

  test("returns only root when no children", () => {
    expect(collectTreePids(rows, 200)).toEqual(new Set([200]))
  })

  test("returns only root when root absent from rows", () => {
    expect(collectTreePids(rows, 999)).toEqual(new Set([999]))
  })
})

describe("sumTreeUsage", () => {
  const rows: PsProcessRow[] = [
    { pid: 1, ppid: 0, rssKb: 100, cpuPercent: 1.0 },
    { pid: 100, ppid: 1, rssKb: 200, cpuPercent: 25.0 },
    { pid: 101, ppid: 100, rssKb: 300, cpuPercent: 50.5 },
  ]

  test("sums rss (kb->bytes) + cpu for pids in tree", () => {
    const tree = new Set<number>([100, 101])
    expect(sumTreeUsage(rows, tree)).toEqual({
      rssBytes: (200 + 300) * 1024,
      cpuPercent: 25.0 + 50.5,
    })
  })

  test("returns zeros for empty tree", () => {
    expect(sumTreeUsage(rows, new Set())).toEqual({ rssBytes: 0, cpuPercent: 0 })
  })
})

describe("sampleProcessTreeUsage", () => {
  test("returns positive rss + finite cpu for current process", async () => {
    const sample = await sampleProcessTreeUsage(process.pid)
    expect(sample).not.toBeNull()
    expect(sample?.rssBytes).toBeGreaterThan(0)
    expect(Number.isFinite(sample?.cpuPercent ?? Number.NaN)).toBe(true)
  }, 5_000)

  test("returns null for pid that does not exist", async () => {
    expect(await sampleProcessTreeUsage(2_147_483_646)).toBeNull()
  }, 5_000)
})
