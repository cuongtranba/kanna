import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFileMcpSourceCursorStore } from "./mcp-source-cursor-store.adapter"

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanna-mcp-cursors-"))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test("cursors and the dedupe ring survive a reload", async () => {
  const dir = await tempDir()
  const saved = { zalo: { cursor: { since: 42 }, recentKeys: ["a", "b"] }, feed: { cursor: null, recentKeys: [] } }
  await createFileMcpSourceCursorStore(dir).save(saved)
  expect(await createFileMcpSourceCursorStore(dir).load()).toEqual(saved)
})

test("a missing or corrupt file loads as empty and malformed entries are skipped", async () => {
  const dir = await tempDir()
  expect(await createFileMcpSourceCursorStore(dir).load()).toEqual({})
  await writeFile(join(dir, "mcp-source-cursors.json"), JSON.stringify({ ok: { cursor: 1, recentKeys: ["k", 5] }, bad: 3 }))
  expect(await createFileMcpSourceCursorStore(dir).load()).toEqual({ ok: { cursor: 1, recentKeys: ["k"] } })
  await writeFile(join(dir, "mcp-source-cursors.json"), "{oops")
  expect(await createFileMcpSourceCursorStore(dir).load()).toEqual({})
})

test("saving replaces the file without leaving a temp file behind", async () => {
  const dir = await tempDir()
  const store = createFileMcpSourceCursorStore(dir)
  await store.save({ a: { cursor: 1, recentKeys: [] } })
  await store.save({ a: { cursor: 2, recentKeys: [] } })
  expect(JSON.parse(await readFile(join(dir, "mcp-source-cursors.json"), "utf8"))).toEqual({ a: { cursor: 2, recentKeys: [] } })
  await expect(readFile(join(dir, "mcp-source-cursors.json.tmp"), "utf8")).rejects.toThrow()
})
