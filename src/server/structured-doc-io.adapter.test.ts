import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { readDoc, writeDoc } from "./structured-doc-io.adapter"

describe("structured-doc IO adapter", () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "kanna-structured-doc-"))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test("readDoc returns null for an absent file", async () => {
    expect(await readDoc(path.join(root, "nope.md"))).toBeNull()
  })

  test("writeDoc creates nested parent dirs then readDoc round-trips", async () => {
    const abs = path.join(root, "nested", "deep", "PROGRESS.md")
    await writeDoc(abs, "# hi\n")
    expect(await readDoc(abs)).toBe("# hi\n")
    expect(await readFile(abs, "utf8")).toBe("# hi\n")
  })

  test("writeDoc overwrites existing content", async () => {
    const abs = path.join(root, "PROGRESS.md")
    await writeDoc(abs, "first")
    await writeDoc(abs, "second")
    expect(await readDoc(abs)).toBe("second")
  })
})
