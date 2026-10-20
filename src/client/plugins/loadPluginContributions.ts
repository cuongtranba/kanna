import { toError } from "../../shared/errors"
import { isJsonArray, isJsonObject, type JsonValue } from "../../shared/json"
import { HTTP_ROUTES, buildRoutePath } from "../../shared/http-routes"
import type { CommandPort } from "../ports/commandPort"
import type { PluginFooterPanel } from "../app/PluginsFooterSection"
import {
  createPluginContext,
  createPluginContributionRegistry,
  type PluginCommandCenterItem,
  type PluginSidebarItem,
} from "./contributionRegistry"
import { evaluatePluginModuleFromUrl, type PluginModule } from "./evaluatePlugin"
import { createPluginHostRegistry } from "./hostModuleRegistry"

export interface PluginListEntry {
  readonly id: string
  readonly enabled: boolean
}

export interface PluginLoadFailure {
  readonly pluginId: string
  readonly message: string
}

export interface LoadedPluginContributions {
  readonly sidebarItems: readonly PluginSidebarItem[]
  readonly panels: readonly PluginFooterPanel[]
  readonly commandCenterItems: readonly PluginCommandCenterItem[]
  readonly failures: readonly PluginLoadFailure[]
}

const NO_CONTRIBUTIONS: LoadedPluginContributions = {
  sidebarItems: [],
  panels: [],
  commandCenterItems: [],
  failures: [],
}

export type ListPluginsFn = () => Promise<readonly PluginListEntry[]>
export type ImportPluginModuleFn = (pluginId: string) => Promise<PluginModule>

export async function loadPluginContributions(
  listPlugins: ListPluginsFn,
  importPluginModule: ImportPluginModuleFn,
): Promise<LoadedPluginContributions> {
  const entries = await listPlugins()
  const enabled = entries.filter((entry) => entry.enabled)
  if (enabled.length === 0) return NO_CONTRIBUTIONS

  const contributions = createPluginContributionRegistry()
  const failures: PluginLoadFailure[] = []

  for (const entry of enabled) {
    try {
      const mod = await importPluginModule(entry.id)
      mod.default(createPluginContext(entry.id, contributions))
    } catch (error) {
      failures.push({ pluginId: entry.id, message: toError(error).message })
    }
  }

  const panels: PluginFooterPanel[] = contributions
    .getSurfaceEntries()
    .map((surface) => ({
      pluginId: surface.pluginId,
      surfaceId: surface.surfaceId,
      Component: surface.Component,
    }))

  return {
    sidebarItems: contributions.getSidebarItems(),
    panels,
    commandCenterItems: contributions.getCommandCenterItems(),
    failures,
  }
}

function readPluginListEntry(value: JsonValue): PluginListEntry | null {
  if (!isJsonObject(value)) return null
  const { id, enabled } = value
  return typeof id === "string" && typeof enabled === "boolean" ? { id, enabled } : null
}

export function readPluginList(result: JsonValue): readonly PluginListEntry[] {
  if (!isJsonObject(result) || !isJsonArray(result.plugins)) return []
  return result.plugins.flatMap((entry) => {
    const parsed = readPluginListEntry(entry)
    return parsed ? [parsed] : []
  })
}

function listPluginsFromServer(commands: CommandPort | null): ListPluginsFn {
  return async () => (commands ? readPluginList(await commands.command({ type: "plugins.list" })) : [])
}

function importPluginModuleFromServer(cacheKey: string): ImportPluginModuleFn {
  return (pluginId) =>
    evaluatePluginModuleFromUrl({
      url: `${buildRoutePath(HTTP_ROUTES.pluginClientBundle.path, { pluginId })}?v=${cacheKey}`,
      registry: createPluginHostRegistry(),
      pluginId,
    })
}

export function loadPluginContributionsFromServer(
  cacheKey: string,
  commands: CommandPort | null,
): Promise<LoadedPluginContributions> {
  return loadPluginContributions(listPluginsFromServer(commands), importPluginModuleFromServer(cacheKey))
}
