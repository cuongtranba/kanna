import { describe, expect, test } from "bun:test"
import process from "node:process"
import {
  collectTreePids,
  parsePsOutput,
  sampleProcessTreeRssBytes,
  sumTreeRssBytes,
  type PsProcessRow,
} from "./pty-memory-sampler.adapter"

describe("parsePsOutput", () => {
  test("parses normal ps output (BSD/macOS style)", () => {
    const out = [
      "    1     0    1024",
      "  100     1    2048",
      "  101   100    4096",
      "",
      "  102   100    8192",
    ].join("\n")
    expect(parsePsOutput(out)).toEqual([
      { pid: 1, ppid: 0, rssKb: 1024 },
      { pid: 100, ppid: 1, rssKb: 2048 },
      { pid: 101, ppid: 100, rssKb: 4096 },
      { pid: 102, ppid: 100, rssKb: 8192 },
    ])
  })

  test("skips malformed rows without throwing", () => {
    const out = [
      "100 1 1024",
      "garbage line here",
      "abc def ghi",
      "200 1 2048",
      " ",
      "300 1",
    ].join("\n")
    expect(parsePsOutput(out)).toEqual([
      { pid: 100, ppid: 1, rssKb: 1024 },
      { pid: 200, ppid: 1, rssKb: 2048 },
    ])
  })

  test("returns empty array for empty input", () => {
    expect(parsePsOutput("")).toEqual([])
    expect(parsePsOutput("\n\n\n")).toEqual([])
  })
})

describe("collectTreePids", () => {
  const rows: PsProcessRow[] = [
    { pid: 1, ppid: 0, rssKb: 0 },
    { pid: 100, ppid: 1, rssKb: 0 },
    { pid: 101, ppid: 100, rssKb: 0 },
    { pid: 102, ppid: 100, rssKb: 0 },
    { pid: 103, ppid: 101, rssKb: 0 },
    { pid: 200, ppid: 1, rssKb: 0 },
  ]

  test("collects root + descendants transitively", () => {
    const tree = collectTreePids(rows, 100)
    expect(tree).toEqual(new Set([100, 101, 102, 103]))
  })

  test("returns only root when no children", () => {
    const tree = collectTreePids(rows, 200)
    expect(tree).toEqual(new Set([200]))
  })

  test("returns only root when root absent from rows", () => {
    const tree = collectTreePids(rows, 999)
    expect(tree).toEqual(new Set([999]))
  })
})

describe("sumTreeRssBytes", () => {
  const rows: PsProcessRow[] = [
    { pid: 1, ppid: 0, rssKb: 100 },
    { pid: 100, ppid: 1, rssKb: 200 },
    { pid: 101, ppid: 100, rssKb: 300 },
  ]

  test("sums rss for pids in tree, converts kb -> bytes", () => {
    const tree = new Set<number>([100, 101])
    expect(sumTreeRssBytes(rows, tree)).toBe((200 + 300) * 1024)
  })

  test("returns 0 for empty tree", () => {
    expect(sumTreeRssBytes(rows, new Set())).toBe(0)
  })
})

describe("sampleProcessTreeRssBytes", () => {
  test("returns positive bytes for current process", async () => {
    const bytes = await sampleProcessTreeRssBytes(process.pid)
    expect(bytes).not.toBeNull()
    expect(bytes as number).toBeGreaterThan(0)
  }, 5_000)

  test("returns null for pid that does not exist", async () => {
    const bytes = await sampleProcessTreeRssBytes(2_147_483_646)
    expect(bytes).toBeNull()
  }, 5_000)
})
