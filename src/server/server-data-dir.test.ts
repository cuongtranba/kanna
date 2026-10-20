import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startKannaServer } from "./server"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test("a server started with a dataDir writes store events there, never to the real home store", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-data-dir-project-"))
  const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-data-dir-"))
  tempDirs.push(projectDir, dataDir)
  const server = await startKannaServer({ port: 0, strictPort: false, dataDir, discoverProjects: () => [] })
  try {
    await server.store.openProject(projectDir, "t")

    expect(server.store.dataDir).toBe(dataDir)
    expect(await readFile(path.join(dataDir, "projects.jsonl"), "utf8")).toContain(projectDir)
  } finally {
    await server.stop()
  }
}, 30_000)
