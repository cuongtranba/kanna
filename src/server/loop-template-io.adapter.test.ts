import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensureTrackingFile } from "./loop-template-io.adapter"

describe("ensureTrackingFile", () => {
  let tempRoot = ""

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "kanna-loop-tracking-"))
  })

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  test("creates the tracking file with the supplied skeleton when absent", async () => {
    const abs = path.join(tempRoot, "PROGRESS.md")
    const result = await ensureTrackingFile({ absPath: abs, skeleton: "# hello\n" })
    expect(result.created).toBe(true)
    expect(result.absPath).toBe(abs)
    const content = await readFile(abs, "utf8")
    expect(content).toBe("# hello\n")
  })

  test("creates missing parent directories as needed", async () => {
    const abs = path.join(tempRoot, "docs", "nested", "PROG.md")
    const result = await ensureTrackingFile({ absPath: abs, skeleton: "seed\n" })
    expect(result.created).toBe(true)
    const content = await readFile(abs, "utf8")
    expect(content).toBe("seed\n")
  })

  test("leaves an existing file untouched (never overwrites)", async () => {
    const abs = path.join(tempRoot, "PROGRESS.md")
    await writeFile(abs, "user-authored content", "utf8")
    const result = await ensureTrackingFile({
      absPath: abs,
      skeleton: "SHOULD NOT BE WRITTEN",
    })
    expect(result.created).toBe(false)
    const content = await readFile(abs, "utf8")
    expect(content).toBe("user-authored content")
  })
})
