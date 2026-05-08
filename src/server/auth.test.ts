import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { persistProjectUpload } from "./uploads"
import { startKannaServer } from "./server"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function startPasswordServer(options: {
  trustProxy?: boolean
  port?: number
  dataDir?: string
} = {}) {
  const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-auth-test-"))
  const dataDir = options.dataDir ?? await mkdtemp(path.join(tmpdir(), "kanna-auth-data-"))
  tempDirs.push(projectDir)
  if (!options.dataDir) tempDirs.push(dataDir)
  const server = await startKannaServer({
    dataDir,
    port: options.port ?? 4320,
    strictPort: true,
    password: "secret",
    trustProxy: options.trustProxy ?? false,
  })
  const project = await server.store.openProject(projectDir, "Project")
  return { server, projectDir, project, dataDir }
}

function extractCookie(response: Response) {
  const header = response.headers.get("set-cookie")
  expect(header).toBeTruthy()
  return header!.split(";", 1)[0]
}

describe("password auth", () => {
  test("serves the app shell to unauthenticated browser requests", async () => {
    // Create a minimal client bundle fixture so the static file handler can serve it.
    // In CI, `bun run build` produces dist/client/index.html before tests run.
    // Locally (no prior build) we inject a temp distDir via the test-only option.
    const distDir = await mkdtemp(path.join(tmpdir(), "kanna-dist-"))
    tempDirs.push(distDir)
    await writeFile(
      path.join(distDir, "index.html"),
      '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
      "utf8",
    )

    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-auth-test-"))
    const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-auth-data-"))
    tempDirs.push(projectDir, dataDir)
    const server = await startKannaServer({
      dataDir,
      distDir,
      port: 4320,
      strictPort: true,
      password: "secret",
      trustProxy: false,
    })
    await server.store.openProject(projectDir, "Project")

    try {
      const response = await fetch(`http://localhost:${server.port}/chat/demo`, { headers: { Accept: "text/html" } })
      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(await response.text()).toContain('id="root"')
    } finally {
      await server.stop()
    }
  })

  test("serves health checks without authentication", async () => {
    const { server } = await startPasswordServer()

    try {
      const response = await fetch(`http://localhost:${server.port}/health`, { redirect: "manual" })
      expect(response.status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  test("blocks unauthenticated api requests", async () => {
    const { server } = await startPasswordServer()

    try {
      const response = await fetch(`http://localhost:${server.port}/api/projects/project-1/uploads`, { redirect: "manual" })
      expect(response.status).toBe(401)
    } finally {
      await server.stop()
    }
  })

  test("redirects /auth/login back into the app", async () => {
    const { server } = await startPasswordServer()

    try {
      const response = await fetch(`http://localhost:${server.port}/auth/login?next=%2Fchat%2Fdemo`, { redirect: "manual" })
      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(`http://localhost:${server.port}/chat/demo`)
    } finally {
      await server.stop()
    }
  })

  test("sets a session cookie after a successful login", async () => {
    const { server } = await startPasswordServer()

    try {
      const response = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${server.port}`,
        },
      })

      expect(response.status).toBe(200)
      expect(extractCookie(response)).toContain("kanna_session=")
    } finally {
      await server.stop()
    }
  })

  test("rejects an invalid password", async () => {
    const { server } = await startPasswordServer()

    try {
      const response = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "wrong", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${server.port}`,
        },
      })

      expect(response.status).toBe(401)
      expect(response.headers.get("set-cookie")).toBeNull()
    } finally {
      await server.stop()
    }
  })

  test("rejects cross-origin login attempts", async () => {
    const { server } = await startPasswordServer()

    try {
      const response = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret" }),
        headers: {
          "Content-Type": "application/json",
          Origin: "http://evil.test",
        },
      })

      expect(response.status).toBe(403)
    } finally {
      await server.stop()
    }
  })

  test("allows authenticated access to protected routes", async () => {
    const { server, project, projectDir } = await startPasswordServer()

    try {
      const attachment = await persistProjectUpload({
        projectId: project.id,
        localPath: projectDir,
        fileName: "hello.txt",
        bytes: new TextEncoder().encode("hello from upload"),
        fallbackMimeType: "text/plain",
      })

      const loginResponse = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${server.port}`,
        },
      })
      const cookie = extractCookie(loginResponse)

      const healthResponse = await fetch(`http://localhost:${server.port}/health`, {
        headers: {
          Cookie: cookie,
        },
      })
      expect(healthResponse.status).toBe(200)

      const contentResponse = await fetch(`http://localhost:${server.port}${attachment.contentUrl}`, {
        headers: {
          Cookie: cookie,
        },
      })
      expect(contentResponse.status).toBe(200)
      expect(await contentResponse.text()).toBe("hello from upload")
    } finally {
      await server.stop()
    }
  })

  test("ignores forwarded proto when trustProxy is off", async () => {
    const { server } = await startPasswordServer({ port: 54321 })

    try {
      const response = await fetch(`http://localhost:${server.port}/auth/login?next=%2F`, {
        redirect: "manual",
        headers: {
          "X-Forwarded-Proto": "https",
        },
      })
      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(`http://localhost:${server.port}/`)

      const loginResponse = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.test",
          "X-Forwarded-Proto": "https",
        },
      })
      expect(loginResponse.status).toBe(403)

      const goodLoginResponse = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${server.port}`,
          "X-Forwarded-Proto": "https",
        },
      })
      expect(goodLoginResponse.status).toBe(200)
      const cookieHeader = goodLoginResponse.headers.get("set-cookie") ?? ""
      expect(cookieHeader).not.toContain("Secure")
    } finally {
      await server.stop()
    }
  })

  test("honors forwarded proto when trustProxy is on", async () => {
    const { server } = await startPasswordServer({ port: 54322, trustProxy: true })

    try {
      const redirect = await fetch(`http://localhost:${server.port}/auth/login?next=%2F`, {
        redirect: "manual",
        headers: {
          "X-Forwarded-Proto": "https",
        },
      })
      expect(redirect.status).toBe(302)
      expect(redirect.headers.get("location")).toBe(`https://localhost:${server.port}/`)

      const loginResponse = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `https://localhost:${server.port}`,
          "X-Forwarded-Proto": "https",
        },
      })
      expect(loginResponse.status).toBe(200)
      expect(loginResponse.headers.get("set-cookie") ?? "").toContain("Secure")

      const evilResponse = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${server.port}`,
        },
      })
      expect(evilResponse.status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  test("ignores invalid forwarded proto values", async () => {
    const { server } = await startPasswordServer({ port: 54323, trustProxy: true })

    try {
      const redirect = await fetch(`http://localhost:${server.port}/auth/login?next=%2F`, {
        redirect: "manual",
        headers: {
          "X-Forwarded-Proto": "ftp",
        },
      })
      expect(redirect.status).toBe(302)
      expect(redirect.headers.get("location")).toBe(`http://localhost:${server.port}/`)

      const loginResponse = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${server.port}`,
          "X-Forwarded-Proto": "ftp",
        },
      })
      expect(loginResponse.status).toBe(200)
      expect(loginResponse.headers.get("set-cookie") ?? "").not.toContain("Secure")
    } finally {
      await server.stop()
    }
  })

  test("issues Max-Age based on configured session lifetime", async () => {
    const { server } = await startPasswordServer({ port: 54324 })

    try {
      const response = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${server.port}`,
        },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("set-cookie") ?? "").toContain(`Max-Age=${30 * 86_400}`)
    } finally {
      await server.stop()
    }
  })

  test("respects auth.sessionMaxAgeDays from settings.json", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-auth-data-"))
    tempDirs.push(dataDir)
    await writeFile(
      path.join(dataDir, "settings.json"),
      JSON.stringify({ auth: { sessionMaxAgeDays: 7 } }),
      "utf8",
    )

    const { server } = await startPasswordServer({ port: 54325, dataDir })

    try {
      const response = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${server.port}`,
        },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("set-cookie") ?? "").toContain(`Max-Age=${7 * 86_400}`)
    } finally {
      await server.stop()
    }
  })

  test("session survives server restart", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-auth-data-"))
    tempDirs.push(dataDir)

    const first = await startPasswordServer({ port: 54326, dataDir })
    let cookie: string
    try {
      const loginResponse = await fetch(`http://localhost:${first.server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${first.server.port}`,
        },
      })
      cookie = extractCookie(loginResponse)
    } finally {
      await first.server.stop()
    }

    const second = await startPasswordServer({ port: 54327, dataDir })
    try {
      const upload = await persistProjectUpload({
        projectId: second.project.id,
        localPath: second.projectDir,
        fileName: "hello.txt",
        bytes: new TextEncoder().encode("hello"),
        fallbackMimeType: "text/plain",
      })
      const response = await fetch(`http://localhost:${second.server.port}${upload.contentUrl}`, {
        headers: { Cookie: cookie },
      })
      expect(response.status).toBe(200)
    } finally {
      await second.server.stop()
    }
  })

  test("clears the session cookie on logout", async () => {
    const { server } = await startPasswordServer()

    try {
      const loginResponse = await fetch(`http://localhost:${server.port}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ password: "secret", next: "/" }),
        headers: {
          "Content-Type": "application/json",
          Origin: `http://localhost:${server.port}`,
        },
      })
      const cookie = extractCookie(loginResponse)

      const logoutResponse = await fetch(`http://localhost:${server.port}/auth/logout`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: `http://localhost:${server.port}`,
        },
      })

      expect(logoutResponse.status).toBe(200)
      expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0")

      const healthResponse = await fetch(`http://localhost:${server.port}/health`, {
        headers: {
          Cookie: cookie,
        },
      })
      expect(healthResponse.status).toBe(200)
    } finally {
      await server.stop()
    }
  })
})
