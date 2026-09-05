
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test, expect } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const FIXTURE_PLUGIN_DIR = join(repoRoot, "src", "server", "__fixtures__", "plugins", "hello")
const PLUGIN_ID = "hello"

const CLI_TIMEOUT_MS = 60_000

const TEST_TIMEOUT_MS = 120_000

function settingsFilePath(kannaHome: string): string {
  return join(kannaHome, ".kanna", "data", "settings.json")
}

function pluginBuildDir(kannaHome: string, id: string): string {
  return join(kannaHome, ".kanna", "plugins", id, "build")
}

function runPluginCli(kannaHome: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", "start", "plugin", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: kannaHome,
        GIT_TERMINAL_PROMPT: "0",
        KANNA_DISABLE_SELF_UPDATE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()))

    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`kanna plugin ${args.join(" ")} timed out after ${String(CLI_TIMEOUT_MS)}ms\n${output}`))
    }, CLI_TIMEOUT_MS)

    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.once("exit", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error(`kanna plugin ${args.join(" ")} exited with code ${String(code)}\n${output}`))
    })
  })
}

async function enablePluginsInSettings(kannaHome: string): Promise<void> {
  const path = settingsFilePath(kannaHome)
  const raw: unknown = JSON.parse(await readFile(path, "utf8"))
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} is not a JSON object`)

  const settings = raw as Record<string, unknown>
  const installed = settings.installedPlugins
  if (!Array.isArray(installed) || installed.length === 0) {
    throw new Error(`${path} records no installedPlugins — the CLI install did not persist`)
  }

  settings.plugins = { enabled: true }
  settings.installedPlugins = installed.map((entry: unknown) => ({
    ...(entry as Record<string, unknown>),
    enabled: true,
  }))
  await writeFile(path, JSON.stringify(settings, null, 2))
}

function seedWithHelloPlugin(enabled: boolean) {
  return async (kannaHome: string): Promise<void> => {
    await runPluginCli(kannaHome, ["install", FIXTURE_PLUGIN_DIR])
    if (enabled) await enablePluginsInSettings(kannaHome)
  }
}

test.describe("plugin system — disabled (the default)", () => {
  let boot: KannaBoot | undefined

  test.beforeAll(async () => {
    boot = await bootKanna({ seed: seedWithHelloPlugin(false) })
  })

  test.afterAll(async () => {
    await boot?.stop()
  })

  test("a plugin is installed on disk, yet every /api/plugins path answers 404", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    if (!boot) throw new Error("boot was not initialized — beforeAll must have failed")

    const clientBundleOnDisk = await readFile(join(pluginBuildDir(boot.kannaHome, PLUGIN_ID), "client.js"), "utf8")
    expect(clientBundleOnDisk).toContain("hello-plugin-surface")

    expect((await page.request.get(`${boot.baseUrl}/health`)).status()).toBe(200)

    for (const path of [
      "/api/plugins",
      `/api/plugins/${PLUGIN_ID}/client.js`,
      `/api/plugins/${PLUGIN_ID}/logs`,
    ]) {
      const response = await page.request.get(`${boot.baseUrl}${path}`)
      expect(response.status(), `GET ${path}`).toBe(404)
    }

    for (const path of [`/api/plugins/${PLUGIN_ID}/rpc`, `/api/plugins/${PLUGIN_ID}/reload`]) {
      const response = await page.request.post(`${boot.baseUrl}${path}`, {
        data: { method: "greeting.create", params: { name: "e2e" } },
      })
      expect(response.status(), `POST ${path}`).toBe(404)
    }

    await page.goto(boot.baseUrl)
    await expect(page.locator("[data-sidebar]")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("plugin-sidebar-items")).toHaveCount(0)
  })
})

test.describe("plugin system — enabled with the hello plugin installed", () => {
  let boot: KannaBoot | undefined

  test.beforeAll(async () => {
    boot = await bootKanna({ seed: seedWithHelloPlugin(true) })
  })

  test.afterAll(async () => {
    await boot?.stop()
  })

  test("GET /api/plugins lists it and client.js serves the real bundle, uncacheable", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    if (!boot) throw new Error("boot was not initialized — beforeAll must have failed")

    const listResponse = await page.request.get(`${boot.baseUrl}/api/plugins`)
    expect(listResponse.status()).toBe(200)
    const listed: { plugins?: { id: string; enabled: boolean; sourceDir: string }[] } = await listResponse.json()
    expect(listed.plugins).toHaveLength(1)
    expect(listed.plugins?.[0]).toMatchObject({
      id: PLUGIN_ID,
      enabled: true,
      sourceDir: FIXTURE_PLUGIN_DIR,
    })

    const bundleResponse = await page.request.get(`${boot.baseUrl}/api/plugins/${PLUGIN_ID}/client.js`)
    expect(bundleResponse.status()).toBe(200)
    expect(bundleResponse.headers()["content-type"]).toContain("text/javascript")
    expect(bundleResponse.headers()["cache-control"]).toBe("no-store")

    const bundle = await bundleResponse.text()
    expect(bundle).toContain("hello-plugin-surface")
    expect(bundle).toContain('require("react")')
    expect(bundle).toContain('require("react/jsx-runtime")')
  })

  test("a typed RPC round-trips through the plugin subprocess", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    if (!boot) throw new Error("boot was not initialized — beforeAll must have failed")

    const reloadResponse = await page.request.post(`${boot.baseUrl}/api/plugins/${PLUGIN_ID}/reload`)
    expect(reloadResponse.status()).toBe(204)

    const rpcResponse = await page.request.post(`${boot.baseUrl}/api/plugins/${PLUGIN_ID}/rpc`, {
      data: { method: "greeting.create", params: { name: "e2e" } },
    })
    expect(rpcResponse.status()).toBe(200)
    expect(await rpcResponse.json()).toEqual({ ok: true, output: { message: "Hello, e2e" } })

    const unknownResponse = await page.request.post(`${boot.baseUrl}/api/plugins/${PLUGIN_ID}/rpc`, {
      data: { method: "greeting.nope", params: {} },
    })
    expect(unknownResponse.status()).toBe(200)
    const unknown: { ok: boolean } = await unknownResponse.json()
    expect(unknown.ok).toBe(false)
  })

  test("the browser renders the plugin's contributed sidebar item", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    if (!boot) throw new Error("boot was not initialized — beforeAll must have failed")

    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(String(error)))

    await page.goto(boot.baseUrl)
    await expect(page.locator("[data-sidebar]")).toBeVisible({ timeout: 30_000 })

    const helloItem = page.getByTestId(`plugin-sidebar-item:${PLUGIN_ID}:main`)
    await expect(helloItem).toBeVisible({ timeout: 30_000 })
    await expect(helloItem).toHaveText("Hello")

    expect(pageErrors, `page errors: ${pageErrors.join("; ")}`).toEqual([])
  })
})
