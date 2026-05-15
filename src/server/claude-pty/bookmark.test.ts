import { describe, expect, test } from "bun:test"
import { computeCompositeVersion } from "./bookmark"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

describe("computeCompositeVersion", () => {
  test("returns inode + ctimeNs + sha256 for an existing file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-bookmark-"))
    try {
      const filePath = path.join(dir, "x.jsonl")
      await writeFile(filePath, "line1\nline2\n", "utf8")
      const version = await computeCompositeVersion(filePath, 0)
      expect(version).not.toBeNull()
      if (!version) throw new Error("version null")
      expect(version.inode).toBeGreaterThan(0)
      expect(version.ctimeNs).toBeGreaterThan(0n)
      expect(version.contentHash).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("returns null when file does not exist", async () => {
    const version = await computeCompositeVersion("/nonexistent/path.jsonl", 0)
    expect(version).toBeNull()
  })

  test("different content → different hash", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-bookmark-"))
    try {
      const a = path.join(dir, "a.jsonl")
      const b = path.join(dir, "b.jsonl")
      await writeFile(a, "alpha\n", "utf8")
      await writeFile(b, "beta\n", "utf8")
      const vA = await computeCompositeVersion(a, 0)
      const vB = await computeCompositeVersion(b, 0)
      expect(vA?.contentHash).not.toBe(vB?.contentHash)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
