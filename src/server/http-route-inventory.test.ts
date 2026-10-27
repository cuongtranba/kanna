import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expandRoutePath, HTTP_ROUTES, listHttpRoutes } from "../shared/http-routes"
import { startKannaServer } from "./server"

const CLIENT_BUNDLE_MISSING = 503
const PASSWORD = "secret"

const PLACEHOLDER_PARAMS: Readonly<Record<string, string>> = {
  token: "t",
  projectId: "p",
  filePath: "a/b.txt",
  storedName: "x.txt",
  pluginId: "demo",
}

let dataDir = ""
let emptyDist = ""
let server: Awaited<ReturnType<typeof startKannaServer>>

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-route-inventory-data-"))
  emptyDist = await mkdtemp(path.join(tmpdir(), "kanna-route-inventory-dist-"))
  server = await startKannaServer({ dataDir, port: 0, strictPort: false, password: PASSWORD, discoverProjects: () => [], distDir: emptyDist })
})

afterAll(async () => {
  await server.stop()
  await rm(dataDir, { recursive: true, force: true })
  await rm(emptyDist, { recursive: true, force: true })
}, 30_000)

async function signIn(): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${server.port}${HTTP_ROUTES.authLogin.path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
    redirect: "manual",
  })
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ")
}

describe("http route inventory against the real server", () => {
  test("the server answers every route and method of the inventory itself instead of falling through to the client bundle", async () => {
    const cookie = await signIn()
    expect(cookie).not.toBe("")
    const fellThrough: string[] = []
    for (const route of listHttpRoutes()) {
      for (const method of route.methods) {
        const response = await fetch(`http://127.0.0.1:${server.port}${expandRoutePath(route.path, PLACEHOLDER_PARAMS)}`, {
          method,
          headers: { cookie, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
          ...(method === "POST" ? { body: "{}" } : {}),
        })
        if (response.status === CLIENT_BUNDLE_MISSING) fellThrough.push(`${method} ${route.path}`)
      }
    }
    expect(fellThrough).toEqual([])
  })

  test("a path that is not in the inventory does fall through, so the check above can fail", async () => {
    const cookie = await signIn()
    const response = await fetch(`http://127.0.0.1:${server.port}/api/projects/p/not-a-route`, { headers: { cookie } })
    expect(response.status).toBe(CLIENT_BUNDLE_MISSING)
  })
})
