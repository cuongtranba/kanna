/**
 * plugins.pw.ts — end-to-end exercise of the plugin system, from `kanna plugin
 * install` through the HTTP surface to a contribution rendered by real Chrome.
 *
 * Purpose: PLUGIN-SYSTEM-PLAN.md's Phase 3 exit criterion. Every other test in
 * this repo drives the plugin system through injected fakes — a fake
 * `PluginService` for the HTTP routes, a fake module importer for the client
 * loader — which is correct for unit scope but means nothing has ever proved
 * the real pieces join up. This spec compiles the real fixture plugin with the
 * real CLI, serves it from the real server, and lets the real browser evaluate
 * the real bundle.
 *
 * What it proves, in the plan's own order:
 *
 *   1. Plugins are OFF by default and the surface does not advertise itself.
 *      Asserted against a home where the plugin IS installed — so the 404 is
 *      demonstrably the global switch and not the absence of a plugin — and
 *      paired with a live `/health` 200 so it is demonstrably not a dead server.
 *   2. Enabled, `GET /api/plugins` lists it and `GET /api/plugins/:id/client.js`
 *      serves the real compiled bundle with `cache-control: no-store`.
 *      "Real" is checked by content, not by status code: the body must carry the
 *      fixture's own `hello-plugin-surface` string and the `require("react")`
 *      host-module shape that `Bun.build`'s `format: "cjs"` + `external` produces
 *      (PLUGIN-SYSTEM-PLAN.md's feasibility proof) — a stub or an error page
 *      passes neither.
 *   3. The browser renders the plugin's contributed SIDEBAR ITEM ("Hello").
 *      That single assertion covers the whole chain end to end: compile →
 *      persisted install record → boot-time `restore()` → `GET /api/plugins` →
 *      `client.js` fetched under a cache-busted url → evaluated through the host
 *      module registry against the host's own React → `addSidebarItem` recorded
 *      in the contribution registry → host chrome rendering it.
 *
 * It also round-trips a typed RPC (`greeting.create`), which is the server half
 * of the same story: server bundle compiled, subprocess spawned over the Unix
 * socket, handler invoked, reply back out through `POST /api/plugins/:id/rpc`.
 *
 * WHAT THIS SPEC DOES **NOT** PROVE, and exactly why:
 *
 *   The plugin's contributed SURFACE — the `hello-plugin-surface` text from
 *   `plugin.addSurface("main", HelloPanel)` — is never rendered here. Its only
 *   mount point in the host today is `PluginsFooterSlot`, which is rendered by
 *   `src/client/app/ChatPage/ChatTranscriptViewport.tsx`, i.e. it exists only
 *   inside an OPEN CHAT. This harness boots against a fresh temp KANNA_HOME with
 *   zero projects and zero chats ("No conversations yet", "Projects Indexed 0"),
 *   and the only route to a chat from there is the New-project flow — a
 *   directory-picking dialog over the host filesystem — followed by chat
 *   creation. Clicking the contributed sidebar item is not a way around it:
 *   `KannaSidebar.tsx` passes `pluginItems` but no `onSelectPluginItem`, so
 *   `PluginSidebarItems` renders the button `disabled` and it navigates nowhere.
 *
 *   Two things would unblock it, either alone: (a) wiring `onSelectPluginItem`
 *   to a pane target so a contributed surface has a mount point reachable from
 *   the app shell — which the plan already points at with `PaneTabTarget` /
 *   `paneContentRegistry.ts`; or (b) teaching `bootKanna`'s seed hook to lay
 *   down a project and a chat in the temp home's event log, so the transcript
 *   viewport (and with it the footer slot) is reachable on first paint.
 *   Asserting the surface renders is deliberately left undone rather than
 *   replaced with something weaker that would pass without proving it. Note the
 *   registry path is shared: `addSurface` and `addSidebarItem` are recorded by
 *   the same `createPluginContext` call this spec already exercises, so what is
 *   unproven is the host's MOUNT POINT, not the contribution mechanism.
 *
 * Placement: `bun run test:e2e` only. Like the rest of `e2e/`, deliberately NOT
 * wired into `.github/workflows/test.yml` — it needs a real Chrome and it
 * compiles a plugin with Bun.
 */

import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test, expect } from "@playwright/test"
import { bootKanna, type KannaBoot } from "./boot"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

/** The fixture plugin the server's own suites use: contributes a "Hello" sidebar
 * item, a surface rendering `hello-plugin-surface`, and a `greeting.create` RPC. */
const FIXTURE_PLUGIN_DIR = join(repoRoot, "src", "server", "__fixtures__", "plugins", "hello")
const PLUGIN_ID = "hello"

/** Generous relative to the ~0.3s the install actually takes; a cold Bun module
 * cache on a loaded machine is the case this covers. */
const CLI_TIMEOUT_MS = 60_000

/** Each `test()` here owns a page load against a freshly booted server, so it
 * needs headroom well past the 90s project default that also has to cover
 * `beforeAll`'s boot. */
const TEST_TIMEOUT_MS = 120_000

/** Mirrors `getSettingsFilePath` (src/shared/branding.ts) for the prod runtime profile. */
function settingsFilePath(kannaHome: string): string {
  return join(kannaHome, ".kanna", "data", "settings.json")
}

/** Mirrors `getPluginBuildDir` (src/shared/plugins/paths.ts). */
function pluginBuildDir(kannaHome: string, id: string): string {
  return join(kannaHome, ".kanna", "plugins", id, "build")
}

/**
 * Runs `kanna plugin <args>` as its own process against `kannaHome`, exactly as
 * a user would — this is the CLI's real dispatch (`cli-runtime.ts` →
 * `runPluginCli`), not a direct `PluginService` call.
 *
 * `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0` per CLAUDE.md § Tests: a
 * subprocess that stops for a prompt would otherwise burn the whole test
 * timeout. A non-zero exit rejects with the captured output, so a compile
 * failure is reported as itself instead of as a downstream 404.
 */
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

/**
 * Flips the two switches the Settings UI flips — the global `plugins.enabled`
 * and the per-plugin `enabled` row — by editing `settings.json` directly.
 *
 * Direct file editing rather than the UI because it has to happen BEFORE the
 * server boots: `AppSettingsManager` reads the file once at startup and does not
 * watch it, and `http-dispatcher.ts` reads `plugins.enabled` off that in-memory
 * snapshot. The written shape is exactly what `normalizePluginState`
 * (`src/server/plugins/plugin-settings.ts`) parses back, so this is the same
 * record the UI would have produced, not a special test-only shape.
 */
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

/** Seed: install the fixture plugin, and optionally turn the system on. */
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

    // The install really happened — `kanna plugin install` compiled both bundles
    // into this home. Without this the 404s below would also be satisfied by an
    // install that silently failed, which is the wrong reason to be green.
    const clientBundleOnDisk = await readFile(join(pluginBuildDir(boot.kannaHome, PLUGIN_ID), "client.js"), "utf8")
    expect(clientBundleOnDisk).toContain("hello-plugin-surface")

    // Control: the server is up and answering. A 404 from a dead server proves
    // nothing, and this is the one assertion that separates the two cases.
    expect((await page.request.get(`${boot.baseUrl}/health`)).status()).toBe(200)

    // 404 and never 403 — `plugin-http-routes.ts`'s rule 1: a disabled surface
    // must not advertise that it exists.
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

    // …and the UI stays dark: an install with the switch off contributes nothing.
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

    // The record survived the CLI process: `configurePluginService` →
    // `restore()` re-registered it at boot from `settings.installedPlugins`.
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
    // Load-bearing: the bundle is rebuilt in place under the SAME url, so a
    // cached copy silently defeats `plugin reload`.
    expect(bundleResponse.headers()["cache-control"]).toBe("no-store")

    const bundle = await bundleResponse.text()
    // Content, not just status: this is the fixture's own component text, so an
    // error page or a placeholder cannot satisfy it.
    expect(bundle).toContain("hello-plugin-surface")
    // The `format: "cjs"` + `external` shape the whole client architecture rests
    // on — each host module is a literal `require(...)` the host registry
    // resolves, which is what shares the host's React instance by identity.
    expect(bundle).toContain('require("react")')
    expect(bundle).toContain('require("react/jsx-runtime")')
  })

  test("a typed RPC round-trips through the plugin subprocess", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT_MS)
    if (!boot) throw new Error("boot was not initialized — beforeAll must have failed")

    // `restore()` re-registers but deliberately does not start; `reload` is the
    // documented "stop then start" that brings an enabled plugin up.
    const reloadResponse = await page.request.post(`${boot.baseUrl}/api/plugins/${PLUGIN_ID}/reload`)
    expect(reloadResponse.status()).toBe(204)

    const rpcResponse = await page.request.post(`${boot.baseUrl}/api/plugins/${PLUGIN_ID}/rpc`, {
      data: { method: "greeting.create", params: { name: "e2e" } },
    })
    expect(rpcResponse.status()).toBe(200)
    // The answer comes from `createGreeting` in the fixture's own
    // `greeting.server.ts`, running in a spawned child over the Unix socket.
    expect(await rpcResponse.json()).toEqual({ ok: true, output: { message: "Hello, e2e" } })

    // An unknown method is a transport SUCCESS carrying the plugin's refusal —
    // `{ok:false}` at HTTP 200, per `plugin-http-routes.ts`'s handleRpc note.
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

    // The contribution load is an async effect behind the settings snapshot
    // arriving over the WebSocket, so this is a wait, not an instant read.
    const helloItem = page.getByTestId(`plugin-sidebar-item:${PLUGIN_ID}:main`)
    await expect(helloItem).toBeVisible({ timeout: 30_000 })
    // The title comes from the plugin's own `addSidebarItem({title: "Hello"})`,
    // so matching it proves the host read the CONTRIBUTION rather than merely
    // rendering a row per installed id.
    await expect(helloItem).toHaveText("Hello")

    // Evaluating a plugin bundle inside the host must not throw into the app.
    expect(pageErrors, `page errors: ${pageErrors.join("; ")}`).toEqual([])
  })
})
