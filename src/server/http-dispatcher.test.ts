import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startKannaServer } from "./server"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeDistDir() {
  const distDir = await mkdtemp(path.join(tmpdir(), "kanna-http-dist-"))
  const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-http-data-"))
  tempDirs.push(distDir, dataDir)
  await writeFile(path.join(distDir, "index.html"), '<!DOCTYPE html><html><body id="root"></body></html>', "utf8")
  return { distDir, dataDir }
}

describe("/health", () => {
  test("returns 200 with ok:true and the bound port", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(res.status).toBe(200)
      const body = await res.json() as { ok: boolean; port: number }
      expect(body.ok).toBe(true)
      expect(body.port).toBe(server.port)
    } finally {
      await server.stop()
    }
  })
})

describe("auth gating", () => {
  test("GET /api/* returns 401 json when password is set and request is unauthenticated", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({
      dataDir, distDir, port: 0, password: "secret", discoverProjects: () => [],
    })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/projects`)
      expect(res.status).toBe(401)
      expect(res.headers.get("content-type")).toContain("application/json")
    } finally {
      await server.stop()
    }
  })

  test("no auth gating on /health when password is set", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({
      dataDir, distDir, port: 0, password: "secret", discoverProjects: () => [],
    })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(res.status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  test("GET /auth/status returns enabled:true when password is set", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({
      dataDir, distDir, port: 0, password: "secret", discoverProjects: () => [],
    })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/auth/status`)
      expect(res.status).toBe(200)
      const body = await res.json() as { enabled: boolean }
      expect(body.enabled).toBe(true)
    } finally {
      await server.stop()
    }
  })

  test("GET /auth/status returns enabled:false when no password", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({
      dataDir, distDir, port: 0, discoverProjects: () => [],
    })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/auth/status`)
      expect(res.status).toBe(200)
      const body = await res.json() as { enabled: boolean; authenticated: boolean }
      expect(body.enabled).toBe(false)
      expect(body.authenticated).toBe(true)
    } finally {
      await server.stop()
    }
  })

  test("POST /auth/logout returns ok when no password set", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({
      dataDir, distDir, port: 0, discoverProjects: () => [],
    })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/auth/logout`, { method: "POST" })
      expect(res.status).toBe(200)
      const body = await res.json() as { ok: boolean }
      expect(body.ok).toBe(true)
    } finally {
      await server.stop()
    }
  })

  test("POST /auth/logout with wrong method returns 405", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({
      dataDir, distDir, port: 0, discoverProjects: () => [],
    })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/auth/logout`, { method: "GET" })
      expect(res.status).toBe(405)
    } finally {
      await server.stop()
    }
  })
})

describe("uploads endpoint", () => {
  test("POST /api/projects/:id/uploads returns 404 for unknown project", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const form = new FormData()
      form.append("files", new File(["hello"], "test.txt", { type: "text/plain" }))
      const res = await fetch(`http://127.0.0.1:${server.port}/api/projects/nonexistent/uploads`, {
        method: "POST",
        body: form,
      })
      expect(res.status).toBe(404)
    } finally {
      await server.stop()
    }
  })

  test("POST /api/projects/:id/uploads with unknown project returns 404 before file validation", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/projects/nonexistent/uploads`, {
        method: "POST",
        body: new FormData(),
      })
      expect(res.status).toBe(404)
    } finally {
      await server.stop()
    }
  })
})

describe("attachment content endpoint", () => {
  test("GET /api/projects/:id/uploads/:name/content returns 404 for unknown project", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/projects/nope/uploads/file.txt/content`)
      expect(res.status).toBe(404)
    } finally {
      await server.stop()
    }
  })

  test("PUT /api/projects/:id/uploads/:name/content returns 405", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/projects/nope/uploads/file.txt/content`, {
        method: "PUT",
      })
      expect(res.status).toBe(405)
    } finally {
      await server.stop()
    }
  })
})

describe("project file content endpoint", () => {
  test("GET /api/projects/:id/files/:path/content returns 404 for unknown project", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/projects/nope/files/readme.md/content`)
      expect(res.status).toBe(404)
    } finally {
      await server.stop()
    }
  })
})

describe("local file endpoint", () => {
  test("GET /api/local-file without path param returns 400", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/local-file`)
      expect(res.status).toBe(400)
    } finally {
      await server.stop()
    }
  })

  test("PUT /api/local-file returns 405", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/local-file`, { method: "PUT" })
      expect(res.status).toBe(405)
    } finally {
      await server.stop()
    }
  })

  test("GET /api/local-file with an existing file returns its content", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const tmpFile = path.join(dataDir, "readme.txt")
    await writeFile(tmpFile, "hello world", "utf8")
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/local-file?path=${encodeURIComponent(tmpFile)}`)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe("hello world")
    } finally {
      await server.stop()
    }
  })
})

describe("WebSocket upgrade", () => {
  test("non-upgrade request to /ws returns 400", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [] })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/ws`)
      expect(res.status).toBe(400)
    } finally {
      await server.stop()
    }
  })

  test("/ws with origin mismatch when password set returns 403", async () => {
    const { distDir, dataDir } = await makeDistDir()
    const server = await startKannaServer({
      dataDir, distDir, port: 0, password: "secret", discoverProjects: () => [],
    })
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/ws`, {
        headers: { Origin: "http://evil.example.com" },
      })
      expect(res.status).toBeOneOf([400, 403])
    } finally {
      await server.stop()
    }
  })
})
