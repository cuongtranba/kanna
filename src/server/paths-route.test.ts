import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startKannaServer } from "./server"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function startServer(port: number) {
  const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-paths-route-"))
  tempDirs.push(projectDir)
  const server = await startKannaServer({ port, strictPort: true })
  return { server, projectDir }
}

describe("GET /api/projects/:id/paths", () => {
  test("returns 404 for unknown project", async () => {
    const { server } = await startServer(4330)
    try {
      const response = await fetch(`http://localhost:${server.port}/api/projects/does-not-exist/paths`)
      expect(response.status).toBe(404)
    } finally {
      await server.stop()
    }
  }, 30_000)

  test("returns top-level entries for empty query", async () => {
    const { server, projectDir } = await startServer(4331)
    try {
      await mkdir(path.join(projectDir, "src"))
      await writeFile(path.join(projectDir, "README.md"), "")

      const project = await server.store.openProject(projectDir, "t")
      const response = await fetch(`http://localhost:${server.port}/api/projects/${project.id}/paths`)
      expect(response.status).toBe(200)
      const payload = await response.json() as { paths: Array<{ path: string; kind: string }> }
      const names = payload.paths.map((p) => p.path)
      expect(names).toContain("README.md")
      expect(names).toContain("src/")
    } finally {
      await server.stop()
    }
  }, 30_000)

  test("respects ?query= and ?limit=", async () => {
    const { server, projectDir } = await startServer(4332)
    try {
      for (let i = 0; i < 5; i++) await writeFile(path.join(projectDir, `file-${i}.txt`), "")

      const project = await server.store.openProject(projectDir, "t")
      const response = await fetch(
        `http://localhost:${server.port}/api/projects/${project.id}/paths?query=file&limit=2`,
      )
      const payload = await response.json() as { paths: Array<{ path: string }> }
      expect(payload.paths.length).toBe(2)
    } finally {
      await server.stop()
    }
  }, 30_000)
})
