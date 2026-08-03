import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startKannaServer } from "./server"

// Regression suite for the stale-chunk incident: a browser tab left open across a
// deploy requests a hashed chunk the new build no longer ships. The server used to
// answer that miss with `200 index.html`, so the browser rejected HTML-as-a-module
// and surfaced "Failed to fetch dynamically imported module" instead of a clean 404.

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function startStaticServer() {
  const distDir = await mkdtemp(path.join(tmpdir(), "kanna-static-dist-"))
  const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-static-data-"))
  tempDirs.push(distDir, dataDir)

  await writeFile(
    path.join(distDir, "index.html"),
    '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
    "utf8"
  )
  await mkdir(path.join(distDir, "assets"), { recursive: true })
  await writeFile(
    path.join(distDir, "assets", "mermaid.core-BUOMLoy9.js"),
    "export const mermaid = 1\n",
    "utf8"
  )

  const server = await startKannaServer({
    dataDir,
    distDir,
    port: 4327,
    strictPort: true,
    trustProxy: false,
    discoverProjects: () => [],
  })
  return server
}

describe("static asset serving", () => {
  test("a missing hashed chunk 404s instead of serving the SPA shell", async () => {
    const server = await startStaticServer()
    try {
      const response = await fetch(
        `http://localhost:${server.port}/assets/mermaid.core-BxJivhhJ.js`
      )

      expect(response.status).toBe(404)
      // The actual defect: HTML was served for a JS module request.
      expect(response.headers.get("content-type") ?? "").not.toContain("text/html")
      expect(await response.text()).not.toContain("<!DOCTYPE html>")
    } finally {
      await server.stop()
    }
  })

  test("an existing hashed chunk is still served", async () => {
    const server = await startStaticServer()
    try {
      const response = await fetch(
        `http://localhost:${server.port}/assets/mermaid.core-BUOMLoy9.js`
      )

      expect(response.status).toBe(200)
      expect(await response.text()).toContain("export const mermaid")
    } finally {
      await server.stop()
    }
  })

  test("a missing root asset such as sw.js 404s rather than returning HTML", async () => {
    const server = await startStaticServer()
    try {
      const response = await fetch(`http://localhost:${server.port}/sw.js`)

      expect(response.status).toBe(404)
      expect(response.headers.get("content-type") ?? "").not.toContain("text/html")
    } finally {
      await server.stop()
    }
  })

  test("a missing stylesheet 404s rather than returning HTML", async () => {
    const server = await startStaticServer()
    try {
      const response = await fetch(`http://localhost:${server.port}/assets/index-DEADBEEF.css`)

      expect(response.status).toBe(404)
      expect(response.headers.get("content-type") ?? "").not.toContain("text/html")
    } finally {
      await server.stop()
    }
  })

  test("extensionless SPA routes still fall back to index.html", async () => {
    const server = await startStaticServer()
    try {
      for (const route of ["/", "/chat/demo", "/settings/general", "/workflows/abc"]) {
        const response = await fetch(`http://localhost:${server.port}${route}`, {
          headers: { Accept: "text/html" },
        })

        expect(response.status).toBe(200)
        expect(response.headers.get("content-type") ?? "").toContain("text/html")
        expect(response.headers.get("cache-control")).toBe("no-store")
        expect(await response.text()).toContain('id="root"')
      }
    } finally {
      await server.stop()
    }
  })

  test("a chat id containing a dot is still treated as a navigation route", async () => {
    const server = await startStaticServer()
    try {
      const response = await fetch(`http://localhost:${server.port}/chat/demo`, {
        headers: { Accept: "text/html" },
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('id="root"')
    } finally {
      await server.stop()
    }
  })
})
