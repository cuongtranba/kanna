import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensureTrackingFile } from "./loop-template-io.adapter"

/** Reconcile stub that reports the input as already conformant. */
const noopReconcile = (existing: string) => ({ content: existing, changed: false, actions: [] })

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
    const result = await ensureTrackingFile({ absPath: abs, skeleton: "# hello\n", reconcile: noopReconcile })
    expect(result.created).toBe(true)
    expect(result.reconciled).toBe(false)
    expect(result.actions).toEqual([])
    expect(result.absPath).toBe(abs)
    const content = await readFile(abs, "utf8")
    expect(content).toBe("# hello\n")
  })

  test("creates missing parent directories as needed", async () => {
    const abs = path.join(tempRoot, "docs", "nested", "PROG.md")
    const result = await ensureTrackingFile({ absPath: abs, skeleton: "seed\n", reconcile: noopReconcile })
    expect(result.created).toBe(true)
    const content = await readFile(abs, "utf8")
    expect(content).toBe("seed\n")
  })

  test("leaves a conformant existing file untouched (reconcile reports no change)", async () => {
    const abs = path.join(tempRoot, "PROGRESS.md")
    await writeFile(abs, "user-authored content", "utf8")
    const result = await ensureTrackingFile({
      absPath: abs,
      skeleton: "SHOULD NOT BE WRITTEN",
      reconcile: noopReconcile,
    })
    expect(result.created).toBe(false)
    expect(result.reconciled).toBe(false)
    expect(result.actions).toEqual([])
    const content = await readFile(abs, "utf8")
    expect(content).toBe("user-authored content")
  })

  test("rewrites an existing file when reconcile reports a change, surfacing the actions", async () => {
    const abs = path.join(tempRoot, "PROGRESS.md")
    await writeFile(abs, "stale content", "utf8")
    const result = await ensureTrackingFile({
      absPath: abs,
      skeleton: "SKELETON (unused when file exists)",
      reconcile: (existing) => ({
        content: `reconciled from: ${existing}`,
        changed: true,
        actions: ['rewrote "## Goal"'],
      }),
    })
    expect(result.created).toBe(false)
    expect(result.reconciled).toBe(true)
    expect(result.actions).toEqual(['rewrote "## Goal"'])
    const content = await readFile(abs, "utf8")
    expect(content).toBe("reconciled from: stale content")
  })
})
