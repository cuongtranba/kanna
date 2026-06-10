import { test, expect } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { readReplMounted, REPL_MOUNT_MARKER } from "./repl-mount-probe.adapter"

async function withTempFile(
  contents: string,
  fn: (p: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-repl-probe-"))
  const p = path.join(dir, "claude-debug.log")
  await writeFile(p, contents, "utf8")
  try {
    await fn(p)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("readReplMounted returns true when the REPL-mount marker is present", async () => {
  await withTempFile(
    "2026-06-10T04:30:00.000Z [DEBUG] something\n" +
      `2026-06-10T04:30:01.000Z [DEBUG] ${REPL_MOUNT_MARKER}, disabled=false\n` +
      "2026-06-10T04:30:02.000Z [DEBUG] more\n",
    async (p) => {
      expect(await readReplMounted(p)).toBe(true)
    },
  )
})

test("readReplMounted returns false when the marker is absent", async () => {
  await withTempFile(
    "2026-06-10T04:30:00.000Z [DEBUG] only startup noise, no repl mount\n",
    async (p) => {
      expect(await readReplMounted(p)).toBe(false)
    },
  )
})

test("readReplMounted returns false (no throw) when the file does not exist", async () => {
  const missing = path.join(tmpdir(), "kanna-repl-probe-does-not-exist-xyz.log")
  expect(await readReplMounted(missing)).toBe(false)
})
