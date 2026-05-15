import { describe, expect, test } from "bun:test"
import { computeBinarySha256 } from "./binary-fingerprint"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

describe("computeBinarySha256", () => {
  test("returns 64-char hex sha256 of file contents", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-binsha-"))
    try {
      const f = path.join(dir, "fake-claude")
      await writeFile(f, "hello", "utf8")
      const sha = await computeBinarySha256(f)
      expect(sha).toMatch(/^[0-9a-f]{64}$/)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test("identical content → identical sha", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-binsha-"))
    try {
      const a = path.join(dir, "a")
      const b = path.join(dir, "b")
      await writeFile(a, "x", "utf8")
      await writeFile(b, "x", "utf8")
      expect(await computeBinarySha256(a)).toBe(await computeBinarySha256(b))
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test("throws when file does not exist", async () => {
    await expect(computeBinarySha256("/nonexistent/path")).rejects.toThrow()
  })
})
