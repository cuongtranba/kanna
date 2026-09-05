import { z } from "zod"
import { errorMessage, isRecord } from "../shared/errors"
import type { JsonValue } from "../shared/json"
import type { PluginLogEntry } from "../shared/plugins/log-ring"
import {
  isValidPluginId,
  KANNA_PLUGIN_MANIFEST_FILENAME,
  parseKannaPluginManifest,
  resolvePluginEntry,
} from "../shared/plugins/manifest"
import { buildPluginBundles } from "./plugins/plugin-build.adapter"
import { buildPluginScaffoldFiles } from "./plugins/plugin-scaffold"
import { pluginDirHasManifest, writePluginScaffold } from "./plugins/plugin-scaffold.adapter"
import { readPluginManifestText } from "./plugins/plugin-service-io.adapter"
import type { PluginService, PluginSummary } from "./plugins/plugin-service"
import { fail, ok, type ToolArgs, type ToolResult } from "./kanna-mcp-tool"

const PLUGIN_LIST_DESCRIPTION = "List installed Kanna plugins and their runtime state."

const PLUGIN_VALIDATE_DESCRIPTION =
  "Validate a plugin source directory's manifest and entry points without installing it."

const PLUGIN_LOGS_DESCRIPTION = "Read the recent log lines for one installed plugin."

const PLUGIN_SCAFFOLD_DESCRIPTION = "Scaffold a new Kanna plugin project at a directory."

const PLUGIN_INSTALL_DESCRIPTION = "Compile a plugin source directory and install it."

const PLUGIN_RELOAD_DESCRIPTION = "Stop and restart a running plugin, picking up a rebuilt bundle."

const DEFAULT_LOG_TAIL = 100

const SERVICE_UNAVAILABLE = "The plugin runtime is not available in this session."

export type PluginToolFactory<TTool> = (
  name: string,
  description: string,
  schema: Record<string, z.ZodType<JsonValue | undefined>>,
  handler: (input: ToolArgs) => Promise<ToolResult>,
) => TTool

type PluginToolService = Pick<PluginService, "install" | "list" | "logs" | "reload">

const REQUIRED_SERVICE_METHODS: readonly string[] = ["install", "list", "logs", "reload"]

function isPluginToolService(value: object): value is PluginToolService {
  if (!isRecord(value)) return false
  return REQUIRED_SERVICE_METHODS.every((method) => typeof value[method] === "function")
}

function requireString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`)
  }
  return value
}

function optionalPositiveInt(value: JsonValue | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fallback
  return value
}

function formatPluginList(plugins: readonly PluginSummary[]): string {
  if (plugins.length === 0) return "No plugins are installed."
  return plugins
    .map((plugin) => `${plugin.id}  ${plugin.state}  ${plugin.enabled ? "enabled" : "disabled"}  ${plugin.sourceDir}`)
    .join("\n")
}

function formatPluginLogs(id: string, entries: readonly PluginLogEntry[], tail: number): string {
  const window = entries.slice(-tail)
  if (window.length === 0) return `No log lines recorded for plugin "${id}".`
  return window.map((entry) => `[${entry.stream}] ${entry.text}`).join("\n")
}

function describePlugin(service: PluginToolService, id: string): string {
  const summary = service.list().find((plugin) => plugin.id === id)
  return summary ? `${summary.state} (${summary.enabled ? "enabled" : "disabled"})` : "not installed"
}

async function validatePluginSource(sourceDir: string): Promise<ToolResult> {
  const parsed = parseKannaPluginManifest(await readManifestOrEmpty(sourceDir))
  if (!parsed.ok) {
    return fail(`${KANNA_PLUGIN_MANIFEST_FILENAME} at "${sourceDir}" is invalid (${parsed.code}): ${parsed.message}`)
  }
  const { id, name, version, entry } = parsed.manifest
  const built = await buildPluginBundles({ sourceDir, entry: resolvePluginEntry(entry) })
  if (!built.ok) {
    return fail(`Plugin "${id}" does not compile:\n${built.errors.join("\n")}`)
  }
  return ok(`Plugin "${id}" (${name} ${version}) is valid: manifest parsed and both bundles compiled.`)
}

async function readManifestOrEmpty(sourceDir: string): Promise<string> {
  try {
    return await readPluginManifestText(sourceDir)
  } catch {
    return ""
  }
}

async function scaffoldPlugin(dir: string, id: string, name: string): Promise<ToolResult> {
  if (!isValidPluginId(id)) {
    return fail(`"${id}" is not a usable plugin id — lowercase letters, digits and hyphens, 2-64 characters, not "kanna".`)
  }
  if (await pluginDirHasManifest(dir)) {
    return fail(`"${dir}" already contains a ${KANNA_PLUGIN_MANIFEST_FILENAME}; scaffold into an empty directory instead.`)
  }
  const written = await writePluginScaffold(dir, buildPluginScaffoldFiles(id, name))
  return ok(
    [
      `Scaffolded plugin "${id}" into ${dir}:`,
      ...written,
      `Next: plugin_validate with source_dir "${dir}", then plugin_install.`,
    ].join("\n"),
  )
}

export function buildPluginToolList<TTool>(
  service: object | null,
  chatId: string | null,
  depth: number,
  tool: PluginToolFactory<TTool>,
): TTool[] {
  if (!service || !chatId) return []

  const bound = isPluginToolService(service) ? service : null

  async function withService(run: (plugins: PluginToolService) => Promise<ToolResult>): Promise<ToolResult> {
    if (!bound) return fail(SERVICE_UNAVAILABLE)
    try {
      return await run(bound)
    } catch (error) {
      return fail(errorMessage(error))
    }
  }

  const readOnly: TTool[] = [
    tool("plugin_list", PLUGIN_LIST_DESCRIPTION, {}, () =>
      withService(async (plugins) => ok(formatPluginList(plugins.list()))),
    ),

    tool(
      "plugin_validate",
      PLUGIN_VALIDATE_DESCRIPTION,
      { source_dir: z.string().describe("Absolute path to the plugin source directory to check.") },
      async (input) => {
        try {
          return await validatePluginSource(requireString(input.source_dir, "source_dir"))
        } catch (error) {
          return fail(errorMessage(error))
        }
      },
    ),

    tool(
      "plugin_logs",
      PLUGIN_LOGS_DESCRIPTION,
      {
        id: z.string().describe("Installed plugin id, from plugin_list."),
        tail: z.number().int().min(0).optional().describe(`How many trailing lines to return (default ${String(DEFAULT_LOG_TAIL)}).`),
      },
      (input) =>
        withService(async (plugins) => {
          const id = requireString(input.id, "id")
          return ok(formatPluginLogs(id, plugins.logs(id), optionalPositiveInt(input.tail, DEFAULT_LOG_TAIL)))
        }),
    ),
  ]

  if (depth > 0) return readOnly

  return [
    ...readOnly,

    tool(
      "plugin_scaffold",
      PLUGIN_SCAFFOLD_DESCRIPTION,
      {
        dir: z.string().describe("Directory to create the plugin in. Must not already hold a plugin manifest."),
        id: z.string().describe("Plugin id: lowercase letters, digits and hyphens, starting with a letter."),
        name: z.string().optional().describe("Human-readable plugin name. Defaults to the id."),
      },
      async (input) => {
        try {
          const id = requireString(input.id, "id")
          const name = typeof input.name === "string" && input.name.trim() !== "" ? input.name : id
          return await scaffoldPlugin(requireString(input.dir, "dir"), id, name)
        } catch (error) {
          return fail(errorMessage(error))
        }
      },
    ),

    tool(
      "plugin_install",
      PLUGIN_INSTALL_DESCRIPTION,
      { source_dir: z.string().describe("Absolute path to the plugin source directory to compile and install.") },
      (input) =>
        withService(async (plugins) => {
          const sourceDir = requireString(input.source_dir, "source_dir")
          await plugins.install({ sourceDir })
          const installed = plugins.list().find((plugin) => plugin.sourceDir === sourceDir)
          if (!installed) return ok(`Installed the plugin at ${sourceDir}.`)
          return ok(
            `Installed plugin "${installed.id}" from ${sourceDir} — ${installed.state} (${installed.enabled ? "enabled" : "disabled"}).`,
          )
        }),
    ),

    tool(
      "plugin_reload",
      PLUGIN_RELOAD_DESCRIPTION,
      { id: z.string().describe("Installed plugin id, from plugin_list.") },
      (input) =>
        withService(async (plugins) => {
          const id = requireString(input.id, "id")
          await plugins.reload(id)
          return ok(`Reloaded plugin "${id}" — ${describePlugin(plugins, id)}.`)
        }),
    ),
  ]
}
