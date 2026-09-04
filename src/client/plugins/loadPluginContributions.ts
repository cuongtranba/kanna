/**
 * Turns "what does `GET /api/plugins` say is installed" into "what does the
 * host render" — the one place the compile output, the evaluator, and the
 * contribution registry are joined.
 *
 * This module is loaded LAZILY (`usePluginContributions.ts` pulls it through
 * `createLazyLoader`) and must stay that way. It reaches `hostModuleRegistry`,
 * which holds a live reference to every host module in the plugin ABI — `zod`
 * and `@tanstack/react-query` among them — so importing it from the app shell
 * would drag the whole ABI into the entry chunk that `bun run check:bundle`
 * budgets at 350 KB gzip, for the default-OFF majority of installs.
 *
 * Both seams are injected. Production wiring lives in
 * `loadPluginContributionsFromServer` at the bottom; every test drives the core
 * with fakes, because the real one needs a server and a browser module loader.
 */
import { toError } from "../../shared/errors"
import { httpAdapter } from "../adapters/http.adapter"
import type { PluginFooterPanel } from "../app/PluginsFooterSection"
import {
  createPluginContext,
  createPluginContributionRegistry,
  type PluginCommandCenterItem,
  type PluginSidebarItem,
} from "./contributionRegistry"
import { evaluatePluginModuleFromUrl, type PluginModule } from "./evaluatePlugin"
import { createPluginHostRegistry } from "./hostModuleRegistry"

/** The row shape `GET /api/plugins` returns. Only the two fields the client
 * acts on are declared — `sourceDir`/`state` are Settings-page concerns and
 * reach the client through the settings snapshot instead. */
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

/**
 * Evaluates every ENABLED plugin and collects what each contributed.
 *
 * One plugin's failure is contained to that plugin: a bundle that will not
 * import, or a `default` export that throws while registering, is recorded in
 * `failures` and the remaining plugins still load. The alternative — one bad
 * plugin taking the whole surface down — is the failure mode `PluginBoundary`
 * exists to prevent at render time, and it would be pointless to reintroduce it
 * one step earlier.
 */
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

interface PluginListResponse {
  readonly plugins?: readonly PluginListEntry[]
}

async function listPluginsFromServer(): Promise<readonly PluginListEntry[]> {
  const response = await httpAdapter.getJson<PluginListResponse>("/api/plugins")
  if (!response.ok) return []
  return response.data?.plugins ?? []
}

function importPluginModuleFromServer(cacheKey: string): ImportPluginModuleFn {
  return (pluginId) =>
    evaluatePluginModuleFromUrl({
      // Cache-busted deliberately: the browser's ESM registry is keyed by URL
      // for the life of the tab, so reusing the bare path after a reload
      // re-runs the code the server just replaced.
      url: `/api/plugins/${encodeURIComponent(pluginId)}/client.js?v=${cacheKey}`,
      registry: createPluginHostRegistry(),
      pluginId,
    })
}

export function loadPluginContributionsFromServer(cacheKey: string): Promise<LoadedPluginContributions> {
  return loadPluginContributions(listPluginsFromServer, importPluginModuleFromServer(cacheKey))
}
