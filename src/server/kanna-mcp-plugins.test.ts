import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ZodTypeAny } from "zod"
import type { JsonObject } from "../shared/json"
import { KANNA_PLUGIN_MANIFEST_FILENAME } from "../shared/plugins/manifest"
import { buildPluginToolList, type PluginToolFactory } from "./kanna-mcp-plugins"
import type { ToolResult } from "./kanna-mcp-tool"
import { buildPluginScaffoldFiles } from "./plugins/plugin-scaffold"
import type { PluginSummary } from "./plugins/plugin-service"

// ------------------------------------------------------------------ harness

interface CapturedTool {
  readonly name: string
  readonly schema: Record<string, ZodTypeAny>
  run(input: JsonObject): Promise<ToolResult>
}

const capture: PluginToolFactory<CapturedTool> = (name, _description, schema, handler) => ({
  name,
  schema,
  run: handler,
})

function textOf(result: ToolResult): string {
  return result.content.map((block) => block.text).join("\n")
}

interface FakeCalls {
  readonly installed: string[]
  readonly reloaded: string[]
}

/** Only the four methods the tools reach; `isPluginToolService` narrows on exactly these. */
function fakeService(plugins: PluginSummary[], logs: Record<string, { stream: "out" | "err"; text: string; at: number }[]> = {}) {
  const calls: FakeCalls = { installed: [], reloaded: [] }
  const service = {
    install: async ({ sourceDir }: { readonly sourceDir: string }) => {
      calls.installed.push(sourceDir)
      plugins.push({ id: "installed-one", sourceDir, enabled: false, state: "stopped" })
    },
    list: () => plugins,
    logs: (id: string) => logs[id] ?? [],
    reload: async (id: string) => {
      calls.reloaded.push(id)
    },
  }
  return { service, calls }
}

function toolsAt(depth: number, service: object): Map<string, CapturedTool> {
  return new Map(buildPluginToolList(service, "chat-1", depth, capture).map((entry) => [entry.name, entry]))
}

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanna-plugin-mcp-"))
  tempDirs.push(dir)
  return dir
}

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

// ------------------------------------------------------------------ list shape

describe("buildPluginToolList — shape", () => {
  test("the family is absent without a service or a chatId", () => {
    expect(buildPluginToolList(null, "chat-1", 0, capture)).toEqual([])
    expect(buildPluginToolList({}, null, 0, capture)).toEqual([])
  })

  test("depth 0 exposes all six tools", () => {
    expect([...toolsAt(0, {}).keys()]).toEqual([
      "plugin_list",
      "plugin_validate",
      "plugin_logs",
      "plugin_scaffold",
      "plugin_install",
      "plugin_reload",
    ])
  })

  test("depth > 0 withholds the three mutating tools", () => {
    const names = [...toolsAt(1, {}).keys()]
    expect(names).toEqual(["plugin_list", "plugin_validate", "plugin_logs"])
    for (const mutating of ["plugin_scaffold", "plugin_install", "plugin_reload"]) {
      expect(names).not.toContain(mutating)
    }
  })

  test("a value that is not a plugin service still builds the list, and every handler refuses", async () => {
    const tools = toolsAt(0, {})
    const result = await tools.get("plugin_list")?.run({})
    expect(result?.isError).toBe(true)
    expect(textOf(result ?? { content: [] })).toContain("not available")
  })
})

// ------------------------------------------------------------------ read-only tools

describe("plugin_list", () => {
  test("reports id, state, enabled flag and source dir", async () => {
    const { service } = fakeService([
      { id: "hello", sourceDir: "/src/hello", enabled: true, state: "running" },
      { id: "quiet", sourceDir: "/src/quiet", enabled: false, state: "stopped" },
    ])
    const result = await toolsAt(0, service).get("plugin_list")?.run({})
    expect(result?.isError).toBeUndefined()
    expect(textOf(result ?? { content: [] })).toBe(
      "hello  running  enabled  /src/hello\nquiet  stopped  disabled  /src/quiet",
    )
  })

  test("says so when nothing is installed", async () => {
    const { service } = fakeService([])
    const result = await toolsAt(0, service).get("plugin_list")?.run({})
    expect(textOf(result ?? { content: [] })).toBe("No plugins are installed.")
  })
})

describe("plugin_logs", () => {
  const logs = {
    hello: [
      { stream: "out" as const, text: "first", at: 1 },
      { stream: "err" as const, text: "second", at: 2 },
      { stream: "out" as const, text: "third", at: 3 },
    ],
  }

  test("renders the stream and the text", async () => {
    const { service } = fakeService([], logs)
    const result = await toolsAt(0, service).get("plugin_logs")?.run({ id: "hello" })
    expect(textOf(result ?? { content: [] })).toBe("[out] first\n[err] second\n[out] third")
  })

  test("an explicit tail keeps the NEWEST lines", async () => {
    const { service } = fakeService([], logs)
    const result = await toolsAt(0, service).get("plugin_logs")?.run({ id: "hello", tail: 2 })
    expect(textOf(result ?? { content: [] })).toBe("[err] second\n[out] third")
  })

  test("an unknown plugin reports empty rather than failing", async () => {
    const { service } = fakeService([], logs)
    const result = await toolsAt(0, service).get("plugin_logs")?.run({ id: "nope" })
    expect(result?.isError).toBeUndefined()
    expect(textOf(result ?? { content: [] })).toContain('No log lines recorded for plugin "nope"')
  })

  test("a missing id fails instead of throwing out of the handler", async () => {
    const { service } = fakeService([], logs)
    const result = await toolsAt(0, service).get("plugin_logs")?.run({})
    expect(result?.isError).toBe(true)
    expect(textOf(result ?? { content: [] })).toContain("id is required")
  })
})

describe("plugin_validate", () => {
  test("accepts the hello fixture without installing it", async () => {
    const sourceDir = join(import.meta.dir, "__fixtures__", "plugins", "hello")
    const { service, calls } = fakeService([])
    const result = await toolsAt(0, service).get("plugin_validate")?.run({ source_dir: sourceDir })
    expect(result?.isError).toBeUndefined()
    expect(textOf(result ?? { content: [] })).toContain('Plugin "hello" (Hello Kanna 0.1.0) is valid')
    expect(calls.installed).toEqual([])
  }, 60_000)

  test("reports a manifest defect with its code", async () => {
    const dir = await makeTempDir()
    await Bun.write(join(dir, KANNA_PLUGIN_MANIFEST_FILENAME), '{"id":"Bad Id","name":"x","version":"1","kannaPluginApi":1}')
    const { service } = fakeService([])
    const result = await toolsAt(0, service).get("plugin_validate")?.run({ source_dir: dir })
    expect(result?.isError).toBe(true)
    expect(textOf(result ?? { content: [] })).toContain("invalid_id")
  })

  test("reports a compile failure rather than throwing", async () => {
    const dir = await makeTempDir()
    await Bun.write(join(dir, KANNA_PLUGIN_MANIFEST_FILENAME), '{"id":"broken","name":"Broken","version":"1","kannaPluginApi":1}')
    await Bun.write(join(dir, "index.ts"), 'import "node:fs"\nexport default function contribute() {}\n')
    const { service } = fakeService([])
    const result = await toolsAt(0, service).get("plugin_validate")?.run({ source_dir: dir })
    expect(result?.isError).toBe(true)
    expect(textOf(result ?? { content: [] })).toContain('Plugin "broken" does not compile')
  }, 60_000)

  test("a directory with no manifest is reported against the manifest filename", async () => {
    const dir = await makeTempDir()
    const { service } = fakeService([])
    const result = await toolsAt(0, service).get("plugin_validate")?.run({ source_dir: dir })
    expect(result?.isError).toBe(true)
    expect(textOf(result ?? { content: [] })).toContain(KANNA_PLUGIN_MANIFEST_FILENAME)
  })
})

// ------------------------------------------------------------------ mutating tools

describe("plugin_install", () => {
  test("drives the service and names the resulting plugin", async () => {
    const { service, calls } = fakeService([])
    const result = await toolsAt(0, service).get("plugin_install")?.run({ source_dir: "/src/hello" })
    expect(calls.installed).toEqual(["/src/hello"])
    expect(textOf(result ?? { content: [] })).toBe(
      'Installed plugin "installed-one" from /src/hello — stopped (disabled).',
    )
  })

  test("a failing install surfaces the service's message", async () => {
    const service = {
      install: async () => {
        throw new Error("plugin manifest is invalid")
      },
      list: () => [],
      logs: () => [],
      reload: async () => {},
    }
    const result = await toolsAt(0, service).get("plugin_install")?.run({ source_dir: "/src/bad" })
    expect(result?.isError).toBe(true)
    expect(textOf(result ?? { content: [] })).toContain("plugin manifest is invalid")
  })
})

describe("plugin_reload", () => {
  test("drives the service and reports the plugin's resulting state", async () => {
    const { service, calls } = fakeService([{ id: "hello", sourceDir: "/src/hello", enabled: true, state: "running" }])
    const result = await toolsAt(0, service).get("plugin_reload")?.run({ id: "hello" })
    expect(calls.reloaded).toEqual(["hello"])
    expect(textOf(result ?? { content: [] })).toBe('Reloaded plugin "hello" — running (enabled).')
  })
})

describe("plugin_scaffold", () => {
  test("writes a manifest, an entry and a client surface", async () => {
    const dir = join(await makeTempDir(), "fresh")
    const { service } = fakeService([])
    const result = await toolsAt(0, service).get("plugin_scaffold")?.run({ dir, id: "my-plugin", name: "My Plugin" })
    expect(result?.isError).toBeUndefined()

    const manifest = await Bun.file(join(dir, KANNA_PLUGIN_MANIFEST_FILENAME)).json()
    expect(manifest).toMatchObject({ id: "my-plugin", name: "My Plugin", kannaPluginApi: 1 })
    expect(await Bun.file(join(dir, "index.ts")).text()).toContain("export default function contribute")
    expect(await Bun.file(join(dir, "panel.client.tsx")).text()).toContain("PluginSurfaceProps")
  })

  test("the scaffolded plugin passes plugin_validate unedited", async () => {
    const dir = join(await makeTempDir(), "fresh")
    const { service } = fakeService([])
    const tools = toolsAt(0, service)
    await tools.get("plugin_scaffold")?.run({ dir, id: "scaffolded", name: "Scaffolded" })
    const result = await tools.get("plugin_validate")?.run({ source_dir: dir })
    expect(textOf(result ?? { content: [] })).toContain('Plugin "scaffolded" (Scaffolded 0.1.0) is valid')
    expect(result?.isError).toBeUndefined()
  }, 60_000)

  test("refuses a directory that already holds a manifest", async () => {
    const dir = await makeTempDir()
    await Bun.write(join(dir, KANNA_PLUGIN_MANIFEST_FILENAME), "{}")
    const { service } = fakeService([])
    const result = await toolsAt(0, service).get("plugin_scaffold")?.run({ dir, id: "my-plugin" })
    expect(result?.isError).toBe(true)
    expect(textOf(result ?? { content: [] })).toContain("already contains")
  })

  test("refuses an id the host reserves or cannot use", async () => {
    const { service } = fakeService([])
    const tools = toolsAt(0, service)
    for (const id of ["kanna", "Bad Id", "x"]) {
      const result = await tools.get("plugin_scaffold")?.run({ dir: "/tmp/never-written", id })
      expect(result?.isError).toBe(true)
      expect(textOf(result ?? { content: [] })).toContain("not a usable plugin id")
    }
  })

  test("defaults the name to the id", async () => {
    const dir = join(await makeTempDir(), "fresh")
    const { service } = fakeService([])
    await toolsAt(0, service).get("plugin_scaffold")?.run({ dir, id: "nameless" })
    expect(await Bun.file(join(dir, KANNA_PLUGIN_MANIFEST_FILENAME)).json()).toMatchObject({ name: "nameless" })
  })
})

// ------------------------------------------------------------------ pure skeleton

describe("buildPluginScaffoldFiles", () => {
  test("returns exactly the three skeleton files, all relative paths", () => {
    const files = buildPluginScaffoldFiles("demo", "Demo")
    expect(files.map((file) => file.path)).toEqual([KANNA_PLUGIN_MANIFEST_FILENAME, "index.ts", "panel.client.tsx"])
    for (const file of files) expect(file.path.startsWith("/")).toBe(false)
  })

  test("the manifest omits `entry`, so the default entry filename is the one written", () => {
    const [manifest, entry] = buildPluginScaffoldFiles("demo", "Demo")
    expect(JSON.parse(manifest?.contents ?? "{}")).toEqual({
      id: "demo",
      name: "Demo",
      version: "0.1.0",
      kannaPluginApi: 1,
    })
    expect(entry?.path).toBe("index.ts")
  })

  test("the name is JSON-escaped into the generated source, never interpolated raw", () => {
    const files = buildPluginScaffoldFiles("demo", 'He said "hi"')
    for (const file of files) expect(file.contents).not.toContain('said "hi"')
    expect(files[1]?.contents).toContain('He said \\"hi\\"')
  })
})
