import { describe, expect, test } from "bun:test"
import type { PluginSurfaceComponent, PluginSurfaceProps } from "../client/plugins/contributionRegistry"
import type { PluginService } from "./plugins/plugin-service"
import { join } from "node:path"

const FIXTURES = join(import.meta.dir, "__fixtures__", "plugins")
const HELLO = join(FIXTURES, "hello")
const LEAKY = join(FIXTURES, "leaky")
const THROWING = join(FIXTURES, "throwing")

const LEAKED_MARKER = "LEAKY_SERVER_SECRET_MUST_NOT_REACH_BROWSER"
const HELLO_SERVER_MARKER = "HELLO_SERVER_ONLY_MARKER"


describe("P0 — manifest, paths, settings collection", () => {
  test("a valid fixture manifest parses and a reserved id is refused", async () => {
    const { parseKannaPluginManifest } = await import("../shared/plugins/manifest")
    const raw = await Bun.file(join(HELLO, "kanna-plugin.json")).text()
    expect(parseKannaPluginManifest(raw)).toMatchObject({ ok: true, manifest: { id: "hello" } })
    expect(
      parseKannaPluginManifest(JSON.stringify({ id: "kanna", name: "x", version: "1", kannaPluginApi: 1 })),
    ).toMatchObject({ ok: false, code: "reserved_id" })
  })

  test("the runtime socket path stays inside the platform sun_path cap", async () => {
    const { pluginSocketPathFits, PLUGIN_SOCKET_PATH_MAX_BYTES } = await import("../shared/plugins/paths")
    expect(PLUGIN_SOCKET_PATH_MAX_BYTES).toBe(104)
    const homeRooted = `/Users/cuongtran/.kanna/plugins/${"a".repeat(64)}/run/host.sock`
    expect(pluginSocketPathFits(homeRooted)).toBe(false)
  })

  test("plugins are globally OFF by default", async () => {
    const { buildInitialAppSettingsSnapshot } = await import("./ws-router-defaults")
    const snapshot = buildInitialAppSettingsSnapshot()
    expect(snapshot.plugins.enabled).toBe(false)
    expect(snapshot.installedPlugins).toEqual([])
  })

  test("an installed plugin round-trips through the settings collection", async () => {
    const { applyAppSettingsPatchForTest } = await import("./plugins/plugin-settings")
    const created = applyAppSettingsPatchForTest([], {
      create: { sourceDir: HELLO, id: "hello" },
    })
    expect(created).toMatchObject([{ id: "hello", sourceDir: HELLO, enabled: false }])

    const enabled = applyAppSettingsPatchForTest(created, { update: { id: "hello", patch: { enabled: true } } })
    expect(enabled[0].enabled).toBe(true)

    expect(applyAppSettingsPatchForTest(enabled, { delete: { id: "hello" } })).toEqual([])
  })
})


describe("P1 — compile pipeline", () => {
  test("the fixture builds a browser bundle with NO bare imports left", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const result = await buildPluginBundles({ sourceDir: HELLO, entry: "index.ts" })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.client).not.toMatch(/from\s*["'](react|zod|@kanna\/plugin)["']/)
    expect(result.client).toContain("__KANNA_PLUGIN_HOST__")
    expect(result.server.length).toBeGreaterThan(0)
  }, 60_000)

  test("SECURITY: a *.server import is refused by the client build and never leaks", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const result = await buildPluginBundles({ sourceDir: LEAKY, entry: "index.ts" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join("\n")).toMatch(/server/i)
  }, 60_000)

  test("SECURITY: no server-only marker appears in any client bundle", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const result = await buildPluginBundles({ sourceDir: HELLO, entry: "index.ts" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.client).not.toContain(HELLO_SERVER_MARKER)
    expect(result.client).not.toContain(LEAKED_MARKER)
  }, 60_000)

  test("an off-allowlist module is refused with the documented message", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const dir = join(FIXTURES, ".tmp-unlisted")
    await Bun.write(join(dir, "kanna-plugin.json"), '{"id":"un","name":"U","version":"1","kannaPluginApi":1}')
    await Bun.write(join(dir, "index.ts"), 'import _ from "lodash"\nexport default () => { void _; return () => {} }\n')
    const result = await buildPluginBundles({ sourceDir: dir, entry: "index.ts" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join("\n")).toContain("is not available in plugin client code")
  }, 60_000)

  test("a bundler plugin that throws is reported, not surfaced as an unhandled rejection", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const result = await buildPluginBundles({ sourceDir: join(FIXTURES, "does-not-exist"), entry: "index.ts" })
    expect(result.ok).toBe(false)
  }, 60_000)
})


describe("P2 — server runtime, RPC, logs", () => {
  test("the log ring honours all three Paseo bounds", async () => {
    const { createPluginLogRing, PLUGIN_LOG_MAX_ENTRIES, PLUGIN_LOG_MAX_LINE_BYTES } = await import(
      "../shared/plugins/log-ring"
    )
    expect(PLUGIN_LOG_MAX_ENTRIES).toBe(500)
    expect(PLUGIN_LOG_MAX_LINE_BYTES).toBe(16 * 1024)

    const ring = createPluginLogRing()
    for (let i = 0; i < 600; i++) ring.append({ stream: "out", text: `line ${i}`, at: i })
    const entries = ring.tail()
    expect(entries.length).toBeLessThanOrEqual(PLUGIN_LOG_MAX_ENTRIES)
    expect(entries[entries.length - 1].text).toBe("line 599")
    expect(entries[0].text).not.toBe("line 0")

    ring.append({ stream: "err", text: "x".repeat(40_000), at: 1 })
    const long = ring.tail().at(-1)
    expect(new TextEncoder().encode(long?.text ?? "").length).toBeLessThanOrEqual(PLUGIN_LOG_MAX_LINE_BYTES)
  })

  test("a real subprocess answers a typed RPC and its stdout is captured", async () => {
    const { createPluginService } = await import("./plugins/plugin-service")
    const service = createPluginService()
    await service.install({ sourceDir: HELLO })
    await service.setEnabled("hello", true)
    await service.start("hello")
    try {
      expect(service.status("hello")?.state).toBe("running")
      const reply = await service.call("hello", "greeting.create", { name: "Ada" })
      expect(reply).toEqual({ ok: true, output: { message: "Hello, Ada" } })
    } finally {
      await service.stop("hello")
    }
  }, 120_000)

  test("a rejected output schema fails the call rather than returning bad data", async () => {
    const { createPluginService } = await import("./plugins/plugin-service")
    const service = createPluginService()
    await service.install({ sourceDir: HELLO })
    await service.setEnabled("hello", true)
    await service.start("hello")
    try {
      const reply = await service.call("hello", "greeting.create", { name: 42 })
      expect(reply.ok).toBe(false)
    } finally {
      await service.stop("hello")
    }
  }, 120_000)
})


describe("P3 — HTTP surface inherits the auth gate", () => {
  function fakeService(over: Partial<PluginService> = {}): PluginService {
    const base: PluginService = {
      install: async () => {},
      list: () => [{ id: "hello", sourceDir: "/src/hello", enabled: true, state: "running" }],
      reload: async () => {},
      clientBundle: async (id) => (id === "hello" ? "export default 1" : null),
      recordClientError: () => {},
      setEnabled: async () => {},
      restore: () => {},
      start: async () => {},
      status: (id) => (id === "hello" ? { state: "running" } : undefined),
      call: async () => ({ ok: true, output: null }),
      stop: async () => {},
      logs: () => [{ stream: "out", text: "hi", at: 1 }],
    }
    return { ...base, ...over }
  }

  function request(method: string, path: string, body?: unknown) {
    const url = new URL(`http://localhost${path}`)
    const init: RequestInit = body === undefined
      ? { method }
      : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } }
    return { req: new Request(url, init), url }
  }

  async function call(method: string, path: string, opts: { enabled?: boolean; body?: unknown; service?: PluginService } = {}) {
    const { handlePluginRequest } = await import("./plugin-http-routes")
    const { req, url } = request(method, path, opts.body)
    return handlePluginRequest(req, url, {
      globallyEnabled: opts.enabled ?? true,
      service: opts.service ?? fakeService(),
    })
  }

  test("every plugin route is 404 while plugins are globally disabled", async () => {
    expect((await call("GET", "/api/plugins/hello/client.js", { enabled: false }))?.status).toBe(404)
    expect((await call("GET", "/api/plugins", { enabled: false }))?.status).toBe(404)
  })

  test("an invalid plugin id is rejected before any path join", async () => {
    const res = await call("GET", "/api/plugins/..%2F..%2Fetc/client.js")
    expect(res?.status).toBeGreaterThanOrEqual(400)
    expect(res?.status).toBeLessThan(500)
  })

  test("GET /api/plugins lists what the service reports", async () => {
    const res = await call("GET", "/api/plugins")
    expect(res?.status).toBe(200)
    expect(await res?.json()).toEqual({
      plugins: [{ id: "hello", sourceDir: "/src/hello", enabled: true, state: "running" }],
    })
  })

  test("GET :id/client.js serves the compiled bundle uncached", async () => {
    const res = await call("GET", "/api/plugins/hello/client.js")
    expect(res?.status).toBe(200)
    expect(res?.headers.get("cache-control")).toBe("no-store")
    expect(await res?.text()).toContain("export default")
  })

  test("an installed-shaped id that is not installed is 404, not 500", async () => {
    expect((await call("GET", "/api/plugins/ghost/client.js"))?.status).toBe(404)
    expect((await call("GET", "/api/plugins/ghost/logs"))?.status).toBe(404)
    expect((await call("POST", "/api/plugins/ghost/reload"))?.status).toBe(404)
  })

  test("GET :id/logs honours tail", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ stream: "out" as const, text: `l${i}`, at: i }))
    const res = await call("GET", "/api/plugins/hello/logs?tail=2", { service: fakeService({ logs: () => many }) })
    expect(res?.status).toBe(200)
    const body = await res?.json() as { logs: { text: string }[] }
    expect(body.logs.map((l) => l.text)).toEqual(["l3", "l4"])
  })

  test("POST :id/rpc returns a FAILED call as 200 with ok:false", async () => {
    const svc = fakeService({ call: async () => ({ ok: false, error: "boom" }) })
    const res = await call("POST", "/api/plugins/hello/rpc", { body: { method: "greeting.create" }, service: svc })
    expect(res?.status).toBe(200)
    expect(await res?.json()).toEqual({ ok: false, error: "boom" })
  })

  test("POST :id/rpc without a method is a 400", async () => {
    expect((await call("POST", "/api/plugins/hello/rpc", { body: {} }))?.status).toBe(400)
  })

  test("POST :id/client-error records against the plugin's log ring", async () => {
    const recorded: string[] = []
    const svc = fakeService({ recordClientError: (_id, text) => { recorded.push(text) } })
    const res = await call("POST", "/api/plugins/hello/client-error", { body: { message: "render failed" }, service: svc })
    expect(res?.status).toBe(204)
    expect(recorded).toEqual(["render failed"])
  })

  test("POST :id/reload drives the service and answers 204", async () => {
    const reloaded: string[] = []
    const svc = fakeService({ reload: async (id) => { reloaded.push(id) } })
    expect((await call("POST", "/api/plugins/hello/reload", { service: svc }))?.status).toBe(204)
    expect(reloaded).toEqual(["hello"])
  })

  test("an unknown sub-path is 404", async () => {
    expect((await call("GET", "/api/plugins/hello/nope"))?.status).toBe(404)
    expect((await call("POST", "/api/plugins"))?.status).toBe(404)
  })
})


describe("P5/P6 — client runtime renders a contributed surface", () => {
  test("a compiled plugin surface renders through the host module registry", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const built = await buildPluginBundles({ sourceDir: HELLO, entry: "index.ts" })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const { createPluginHostRegistry } = await import("../client/plugins/hostModuleRegistry")
    const { evaluatePluginModule } = await import("../client/plugins/evaluatePlugin")
    const { renderToStaticMarkup } = await import("react-dom/server")

    const registry = createPluginHostRegistry()
    const mod = await evaluatePluginModule({ code: built.client, registry, pluginId: "hello" })

    const surfaces: Array<{ id: string; Component: PluginSurfaceComponent }> = []
    mod.default({
      addSurface: (id: string, Component: PluginSurfaceComponent) => surfaces.push({ id, Component }),
      addSidebarItem: () => {},
      addCommandCenterItem: () => {},
      handle: () => {},
    })

    expect(surfaces).toHaveLength(1)
    const { Component } = surfaces[0]
    const theme: PluginSurfaceProps["theme"] = { colors: { foreground: "var(--foreground)" } }
    const html = renderToStaticMarkup(<Component theme={theme} />)
    expect(html).toContain("hello-plugin-surface")
  }, 60_000)

  test("an off-registry module request fails with the documented message", async () => {
    const { createPluginHostRegistry } = await import("../client/plugins/hostModuleRegistry")
    const registry = createPluginHostRegistry()
    expect(() => registry.require("lodash")).toThrow(/is not available in plugin client code/)
  })
})


describe("P9a — sidebar item surfaces installed plugins", () => {
  test("a contributed sidebar item renders through the plugin sidebar surface", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const built = await buildPluginBundles({ sourceDir: HELLO, entry: "index.ts" })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const { createPluginHostRegistry } = await import("../client/plugins/hostModuleRegistry")
    const { evaluatePluginModule } = await import("../client/plugins/evaluatePlugin")
    const { createPluginContributionRegistry, createPluginContext } = await import(
      "../client/plugins/contributionRegistry"
    )
    const { renderToStaticMarkup } = await import("react-dom/server")
    const { PluginSidebarItems } = await import("../client/app/PluginSidebarItems")

    const hostRegistry = createPluginHostRegistry()
    const mod = await evaluatePluginModule({ code: built.client, registry: hostRegistry, pluginId: "hello" })

    const contributions = createPluginContributionRegistry()
    mod.default(createPluginContext("hello", contributions))

    const items = contributions.getSidebarItems()
    expect(items).toEqual([{ pluginId: "hello", id: "main", title: "Hello", icon: "Blocks", surface: "main" }])

    const html = renderToStaticMarkup(<PluginSidebarItems items={items} />)
    expect(html).toContain("Hello")
  }, 60_000)
})

describe("P12 — a contributed command reaches the `/` picker as inserted prompt text", () => {
  test("the real build → evaluate → merge path produces a namespaced picker entry", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const built = await buildPluginBundles({ sourceDir: HELLO, entry: "index.ts" })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const { createPluginHostRegistry } = await import("../client/plugins/hostModuleRegistry")
    const { evaluatePluginModule } = await import("../client/plugins/evaluatePlugin")
    const { createPluginContributionRegistry, createPluginContext } = await import(
      "../client/plugins/contributionRegistry"
    )
    const { mergePluginCommands } = await import("../client/lib/plugin-slash-commands")

    const hostRegistry = createPluginHostRegistry()
    const mod = await evaluatePluginModule({ code: built.client, registry: hostRegistry, pluginId: "hello" })

    const contributions = createPluginContributionRegistry()
    mod.default(createPluginContext("hello", contributions))

    const catalog = [{ name: "compact", description: "", argumentHint: "", scope: "builtin" as const }]
    const merged = mergePluginCommands(catalog, contributions.getCommandCenterItems())

    expect(merged.commands.map((c) => c.name)).toEqual(["compact", "hello:greet"])
    expect(merged.commands[1].scope).toBe("plugin")
    expect(merged.promptByName.get("hello:greet")).toBe("Greet the user warmly.")
  }, 60_000)
})

describe("P9a — chat-footer panel mirrors the WorkflowsSection/SubagentsSection shape", () => {
  test("a contributed surface renders inside the chat-footer plugin panel", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const built = await buildPluginBundles({ sourceDir: HELLO, entry: "index.ts" })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const { createPluginHostRegistry } = await import("../client/plugins/hostModuleRegistry")
    const { evaluatePluginModule } = await import("../client/plugins/evaluatePlugin")
    const { createPluginContributionRegistry, createPluginContext } = await import(
      "../client/plugins/contributionRegistry"
    )
    const { renderToStaticMarkup } = await import("react-dom/server")
    const { PluginsFooterSection } = await import("../client/app/PluginsFooterSection")

    const hostRegistry = createPluginHostRegistry()
    const mod = await evaluatePluginModule({ code: built.client, registry: hostRegistry, pluginId: "hello" })

    const contributions = createPluginContributionRegistry()
    mod.default(createPluginContext("hello", contributions))

    const Component = contributions.getSurface("hello", "main")
    expect(Component).toBeDefined()
    if (!Component) return

    const theme: PluginSurfaceProps["theme"] = { colors: { foreground: "var(--foreground)" } }
    const html = renderToStaticMarkup(
      <PluginsFooterSection panels={[{ pluginId: "hello", surfaceId: "main", Component }]} theme={theme} />,
    )
    expect(html).toContain("hello-plugin-surface")
  }, 60_000)
})

describe("P9a — a throwing plugin panel is isolated by PluginBoundary", () => {
  test("PluginBoundary swallows a render-time throw and the host UI keeps rendering", async () => {
    const { buildPluginBundles } = await import("./plugins/plugin-build.adapter")
    const built = await buildPluginBundles({ sourceDir: THROWING, entry: "index.ts" })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const { createPluginHostRegistry } = await import("../client/plugins/hostModuleRegistry")
    const { evaluatePluginModule } = await import("../client/plugins/evaluatePlugin")
    const { createPluginContributionRegistry, createPluginContext } = await import(
      "../client/plugins/contributionRegistry"
    )
    const { PluginBoundary } = await import("../client/plugins/PluginBoundary")
    const { renderToStaticMarkup } = await import("react-dom/server")

    const hostRegistry = createPluginHostRegistry()
    const mod = await evaluatePluginModule({ code: built.client, registry: hostRegistry, pluginId: "throwing" })

    const contributions = createPluginContributionRegistry()
    mod.default(createPluginContext("throwing", contributions))
    const Component = contributions.getSurface("throwing", "main")
    expect(Component).toBeDefined()
    if (!Component) return

    const theme: PluginSurfaceProps["theme"] = { colors: { foreground: "var(--foreground)" } }
    let html = ""
    expect(() => {
      html = renderToStaticMarkup(
        <div>
          <span>sibling content survives</span>
          <PluginBoundary pluginId="throwing">
            <Component theme={theme} />
          </PluginBoundary>
        </div>,
      )
    }).not.toThrow()

    expect(html).toContain("sibling content survives")
    expect(html).not.toContain("THROWING_PANEL_DELIBERATE_FAILURE")
    expect(html).toContain("throwing")
  }, 60_000)
})

describe("P9a — Settings → Plugins page", () => {
  test("lists installed plugins and its actions hit the documented plugin-http-routes.ts endpoints", async () => {
    const { PluginsSection, buildPluginsSectionHandlers } = await import("../client/app/PluginsSection")
    const { renderToStaticMarkup } = await import("react-dom/server")

    const calls: Array<{ url: string; method: string }> = []
    const fakePostJsonBody = async (url: string, _body: unknown) => {
      calls.push({ url, method: "POST" })
      return { ok: true }
    }

    const handlers = buildPluginsSectionHandlers(fakePostJsonBody)
    await handlers.onReload("hello")
    expect(calls).toEqual([{ url: "/api/plugins/hello/reload", method: "POST" }])

    const plugin = { id: "hello", sourceDir: HELLO, enabled: false }
    const html = renderToStaticMarkup(<PluginsSection plugins={[plugin]} handlers={handlers} />)
    expect(html).toContain("hello")
  }, 30_000)
})


describe("P8 — MCP authoring tools", () => {
  const tool = (name: string) => ({ name })

  test("the family is absent without a service or a chatId", async () => {
    const { buildPluginToolList } = await import("./kanna-mcp-plugins")
    expect(buildPluginToolList(null, "chat-1", 0, tool)).toEqual([])
    expect(buildPluginToolList({}, null, 0, tool)).toEqual([])
  })

  test("mutating tools are withheld from subagents (depth > 0)", async () => {
    const { buildPluginToolList } = await import("./kanna-mcp-plugins")
    const names = (depth: number) => buildPluginToolList({}, "chat-1", depth, tool).map((t) => t.name)

    const main = names(0)
    expect(main).toEqual(expect.arrayContaining(["plugin_list", "plugin_validate", "plugin_logs"]))
    expect(main).toEqual(expect.arrayContaining(["plugin_scaffold", "plugin_install", "plugin_reload"]))

    const sub = names(1)
    expect(sub).toEqual(expect.arrayContaining(["plugin_list"]))
    for (const mutating of ["plugin_scaffold", "plugin_install", "plugin_reload"]) {
      expect(sub).not.toContain(mutating)
    }
  })
})


describe("P7 — CLI", () => {
  test("parses each subcommand and rejects an unknown one", async () => {
    const { parsePluginCommand } = await import("./plugin-cli")
    expect(parsePluginCommand(["install", "/abs/dir"])).toMatchObject({
      kind: "install",
      sourceDir: "/abs/dir",
    })
    expect(parsePluginCommand(["ls"])).toMatchObject({ kind: "ls" })
    expect(parsePluginCommand(["reload", "hello"])).toMatchObject({ kind: "reload", id: "hello" })
    expect(parsePluginCommand(["logs", "hello", "--tail", "50"])).toMatchObject({ kind: "logs", id: "hello", tail: 50 })
    expect(parsePluginCommand(["frobnicate"])).toMatchObject({ kind: "error" })
    expect(parsePluginCommand(["install"])).toMatchObject({ kind: "error" })
  })
})


describe("P10 — the shared service reads every surface drives", () => {
  test("install makes the plugin listable and serves a real compiled client bundle", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { createPluginService } = await import("./plugins/plugin-service")

    const homeDir = await mkdtemp(join(tmpdir(), "kanna-plugin-acceptance-"))
    try {
      const service = createPluginService({ homeDir })
      expect(service.list()).toEqual([])

      await service.install({ sourceDir: HELLO })

      expect(service.list()).toEqual([
        { id: "hello", sourceDir: HELLO, enabled: false, state: "stopped" },
      ])

      const bundle = await service.clientBundle("hello")
      expect(bundle).toBeTruthy()
      expect(bundle).toContain("hello-plugin-surface")
      expect(await service.clientBundle("not-installed")).toBeNull()

      service.recordClientError("hello", "surface threw")
      expect(service.logs("hello").map((l) => l.text)).toContain("surface threw")

      await service.reload("hello")
      expect(service.status("hello")?.state).toBe("stopped")
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  }, 120_000)
})


describe("P11 — installs persist across a restart", () => {
  test("a second service restores what the first installed, without recompiling", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { createPluginService } = await import("./plugins/plugin-service")
    const { createInstalledPluginStore } = await import("./plugins/installed-plugin-store")

    const homeDir = await mkdtemp(join(tmpdir(), "kanna-plugin-p11-"))
    try {
      const rows: { id: string; sourceDir: string; enabled: boolean }[] = []
      const settings = {
        getSnapshot: () => ({ installedPlugins: rows }),
        writePatch: async (patch: {
          installedPlugins: { create?: { sourceDir: string; id: string }; update?: { id: string; patch: { enabled?: boolean } } }
        }) => {
          const { create, update } = patch.installedPlugins
          if (create) rows.push({ id: create.id, sourceDir: create.sourceDir, enabled: false })
          if (update) {
            const row = rows.find((r) => r.id === update.id)
            if (row && update.patch.enabled !== undefined) row.enabled = update.patch.enabled
          }
          return undefined
        },
      }
      const installed = createInstalledPluginStore(settings)

      const first = createPluginService({ homeDir, installed })
      await first.install({ sourceDir: HELLO })
      await first.setEnabled("hello", true)

      expect(rows).toEqual([{ id: "hello", sourceDir: HELLO, enabled: true }])

      const second = createPluginService({ homeDir, installed })
      expect(second.list()).toEqual([])

      second.restore()

      expect(second.list()).toEqual([
        { id: "hello", sourceDir: HELLO, enabled: true, state: "stopped" },
      ])
      expect(await second.clientBundle("hello")).toContain("hello-plugin-surface")

      second.restore()
      expect(second.list()).toHaveLength(1)
    } finally {
      await rm(homeDir, { recursive: true, force: true })
    }
  }, 120_000)
})
