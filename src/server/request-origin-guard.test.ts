import { afterEach, describe, expect, test } from "vite-plus/test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { connect } from "node:net"
import { startKannaServer, type StartKannaServerOptions } from "./server"
import { unprotectedExposureWarning } from "./request-origin-guard"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function withServer(
  options: Pick<StartKannaServerOptions, "password" | "host" | "trustProxy">,
  run: (origin: string, port: number) => Promise<void>,
) {
  const distDir = await mkdtemp(path.join(tmpdir(), "kanna-guard-dist-"))
  const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-guard-data-"))
  tempDirs.push(distDir, dataDir)
  await writeFile(path.join(distDir, "index.html"), "<!DOCTYPE html><html><body></body></html>", "utf8")
  const server = await startKannaServer({ dataDir, distDir, port: 0, discoverProjects: () => [], ...options })
  try {
    await run(`http://127.0.0.1:${server.port}`, server.port)
  } finally {
    await server.stop()
  }
}

const EVIL = "http://evil.example"
const TUS_PATH = "/api/projects/project-1/uploads/tus"
const postTus = (origin: string, headers: Record<string, string>) =>
  fetch(`${origin}${TUS_PATH}`, {
    method: "POST",
    headers: { "Tus-Resumable": "1.0.0", "Upload-Length": "10", ...headers },
  })

function upgradeStatus(port: number, requestPath: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const lines = [
      `GET ${requestPath} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      "",
      "",
    ]
    const socket = connect(port, "127.0.0.1", () => socket.write(lines.join("\r\n")))
    socket.once("data", (chunk) => {
      socket.destroy()
      resolve(Number(chunk.toString("latin1").split(" ")[1]))
    })
    socket.once("error", reject)
  })
}

async function signIn(origin: string): Promise<string> {
  const response = await fetch(`${origin}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ password: "secret" }),
  })
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ")
}

describe("with no password on the loopback bind", () => {
  test("a web page on another origin cannot open the /ws command socket", async () => {
    await withServer({}, async (origin, port) => {
      expect(await upgradeStatus(port, "/ws", { Origin: EVIL })).toBe(403)
      expect(await upgradeStatus(port, "/ws", { Origin: "null" })).toBe(403)
      expect(await upgradeStatus(port, "/ws", { Origin: origin })).toBe(101)
      expect(await upgradeStatus(port, "/ws", {})).toBe(101)
    })
  })

  test("a DNS-rebound hostname is refused while every loopback name is served", async () => {
    await withServer({}, async (origin, port) => {
      expect((await fetch(`${origin}/health`, { headers: { Host: `evil.example:${port}` } })).status).toBe(403)
      expect((await fetch(`${origin}/health`, { headers: { Host: `localhost:${port}` } })).status).toBe(200)
      expect((await fetch(`${origin}/health`, { headers: { Host: `[::1]:${port}` } })).status).toBe(200)
      expect((await fetch(`${origin}/health`)).status).toBe(200)
    })
  })

  test("an /api write from another origin or site is refused and a same-origin write is not", async () => {
    await withServer({}, async (origin) => {
      expect((await postTus(origin, { Origin: EVIL })).status).toBe(403)
      expect((await postTus(origin, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403)
      expect((await postTus(origin, { "Sec-Fetch-Site": "same-site", Origin: origin })).status).toBe(403)
      expect((await postTus(origin, { Origin: origin })).status).not.toBe(403)
      expect((await postTus(origin, { "Sec-Fetch-Site": "same-origin", Origin: origin })).status).not.toBe(403)
      expect((await postTus(origin, {})).status).not.toBe(403)
    })
  })

  test("a read-only /api request from another origin is not refused", async () => {
    await withServer({}, async (origin) => {
      const response = await fetch(`${origin}/api/share/unknown-token`, { headers: { Origin: EVIL, "Sec-Fetch-Site": "cross-site" } })
      expect(response.status).not.toBe(403)
    })
  })

  test("the webhook route stays callable from any origin and host", async () => {
    await withServer({}, async (origin) => {
      const response = await fetch(`${origin}/hooks/abcdefgh12345678`, {
        method: "POST",
        headers: { Origin: EVIL, Host: "tunnel.example", "Sec-Fetch-Site": "cross-site" },
        body: "{}",
      })
      expect(response.status).toBe(404)
    })
  })
})

describe("with a password", () => {
  test("a session cookie cannot drive an /api write from another origin, without origin data, or over /ws", async () => {
    await withServer({ password: "secret" }, async (origin, port) => {
      const cookie = await signIn(origin)
      expect(cookie).not.toBe("")
      expect((await postTus(origin, { Cookie: cookie, Origin: EVIL })).status).toBe(403)
      expect((await postTus(origin, { Cookie: cookie })).status).toBe(403)
      expect((await postTus(origin, { Cookie: cookie, Origin: origin })).status).not.toBe(403)
      expect((await postTus(origin, { Cookie: cookie, "Sec-Fetch-Site": "same-origin" })).status).not.toBe(403)
      expect(await upgradeStatus(port, "/ws", { Origin: EVIL, Cookie: cookie })).toBe(403)
      expect(await upgradeStatus(port, "/ws", { Origin: origin, Cookie: cookie })).toBe(101)
      expect(await upgradeStatus(port, "/ws", { Origin: origin })).toBe(401)
    })
  })

  test("a request without a session is still answered 401 from the same origin", async () => {
    await withServer({ password: "secret" }, async (origin) => {
      expect((await postTus(origin, { Origin: origin })).status).toBe(401)
    })
  })

  test("a request carrying any Host is served, since the password is the protection", async () => {
    await withServer({ password: "secret" }, async (origin) => {
      expect((await fetch(`${origin}/health`, { headers: { Host: "kanna.example.com" } })).status).toBe(200)
    })
  })

  test("a beacon with no Origin header can open /beacon and a browser page on another origin cannot", async () => {
    await withServer({ password: "secret" }, async (_origin, port) => {
      expect(await upgradeStatus(port, "/beacon", {})).toBe(101)
      expect(await upgradeStatus(port, "/beacon", { Origin: EVIL })).toBe(403)
    })
  })

  test("the remote MCP route is reached with a bearer and no Origin", async () => {
    await withServer({ password: "secret" }, async (origin) => {
      const response = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: { Authorization: "Bearer not-a-real-token", "content-type": "application/json" },
        body: "{}",
      })
      expect(response.status).toBe(401)
    })
  })
})

describe("behind a trusted proxy or on an explicit bind", () => {
  test("a tunnel hostname and its https origin are accepted without a password", async () => {
    await withServer({ trustProxy: true }, async (origin) => {
      const tunnel = "kanna.trycloudflare.example"
      expect((await fetch(`${origin}/health`, { headers: { Host: tunnel } })).status).toBe(200)
      const sameOrigin = await postTus(origin, { Host: tunnel, Origin: `https://${tunnel}`, "X-Forwarded-Proto": "https" })
      expect(sameOrigin.status).not.toBe(403)
      const crossOrigin = await postTus(origin, { Host: tunnel, Origin: EVIL, "X-Forwarded-Proto": "https" })
      expect(crossOrigin.status).toBe(403)
    })
  })

  test("a non-loopback bind skips the Host check but still refuses a cross-origin write", async () => {
    await withServer({ host: "0.0.0.0" }, async (origin, port) => {
      expect((await fetch(`${origin}/health`, { headers: { Host: `lan-box:${port}` } })).status).toBe(200)
      expect((await postTus(origin, { Host: `lan-box:${port}`, Origin: EVIL })).status).toBe(403)
    })
  })
})

describe("the exposure warning", () => {
  test("is raised for a reachable server with no password and for nothing else", () => {
    const base = { hasPassword: false, trustProxy: false, bindHost: "127.0.0.1" }
    expect(unprotectedExposureWarning(base)).toBeNull()
    expect(unprotectedExposureWarning({ ...base, bindHost: "localhost" })).toBeNull()
    expect(unprotectedExposureWarning({ ...base, bindHost: "0.0.0.0" })).toMatch(/no password/)
    expect(unprotectedExposureWarning({ ...base, trustProxy: true })).toMatch(/no password/)
    expect(unprotectedExposureWarning({ ...base, bindHost: "0.0.0.0", hasPassword: true })).toBeNull()
  })
})
