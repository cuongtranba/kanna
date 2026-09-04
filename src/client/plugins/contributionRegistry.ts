/**
 * The UI-contribution registry: what a plugin module hands to the host when
 * the host calls its `default` export. This is a DIFFERENT concern from
 * `hostModuleRegistry.ts` (which answers `__KANNA_PLUGIN_HOST__.require(name)`
 * for bare-import rewrites like `react`/`zod`) — this registry is the
 * consumer of an already-evaluated plugin module (`evaluatePlugin.ts`'s
 * `evaluatePluginModule`), and is what the sidebar item list, the
 * chat-footer panel, and `PluginBoundary` all resolve contributed surfaces
 * through. It does not duplicate host-module resolution.
 *
 * `@kanna/plugin`'s `PluginContext` type (imported only as a TYPE by plugin
 * source, elided at compile time) describes the shape a plugin author codes
 * against. The host never imports that package at runtime — it constructs
 * the actual context object handed to `mod.default(...)` here, via
 * `createPluginContext`, so the plugin's `plugin.addSurface(...)` /
 * `plugin.addSidebarItem(...)` calls write into ONE shared registry per
 * evaluation.
 */
import type { ComponentType } from "react"
import { type AnyValue } from "../../shared/errors"

/** Matches the fixture plugins' `PluginSurfaceProps` shape (`{ theme }`) —
 * defined locally rather than imported from `@kanna/plugin` so the host
 * never depends on that package's types at build time. */
export interface PluginTheme {
  readonly colors: {
    readonly foreground: string
  }
}

export interface PluginSurfaceProps {
  readonly theme: PluginTheme
}

export type PluginSurfaceComponent = ComponentType<PluginSurfaceProps>

export interface PluginSidebarItemInput {
  readonly id: string
  readonly title: string
  readonly icon: string
  readonly surface: string
}

export interface PluginSidebarItem extends PluginSidebarItemInput {
  readonly pluginId: string
}

/**
 * One entry a plugin contributes to the composer's `/` picker.
 *
 * `prompt` is REQUIRED and is the whole contract: a Kanna plugin command has no
 * file on disk for the CLI to resolve, so what the picker inserts is this text,
 * not `/name`. See `src/client/lib/plugin-slash-commands.ts` for the full
 * reasoning — it is the module that performs the merge.
 */
export interface PluginCommandCenterItemInput {
  /** Bare name; the host namespaces it as `<pluginId>:<name>` before it can
   * reach the picker, so one plugin can never claim `/compact`. */
  readonly name: string
  readonly description: string
  /** Inserted into the composer verbatim when the user picks this entry. */
  readonly prompt: string
}

export interface PluginCommandCenterItem extends PluginCommandCenterItemInput {
  readonly pluginId: string
}

/** One registered surface, flattened back out of the keyed map. The host needs
 * this to mount surfaces a plugin contributed WITHOUT a sidebar item — reading
 * `getSurface` per sidebar item would silently drop those. */
export interface PluginSurfaceEntry {
  readonly pluginId: string
  readonly surfaceId: string
  readonly Component: PluginSurfaceComponent
}

export interface PluginContributionRegistry {
  getCommandCenterItems(): PluginCommandCenterItem[]
  getSidebarItems(): PluginSidebarItem[]
  getSurface(pluginId: string, surfaceId: string): PluginSurfaceComponent | undefined
  getSurfaceEntries(): PluginSurfaceEntry[]
  registerCommandCenterItem(pluginId: string, item: PluginCommandCenterItemInput): void
  registerSidebarItem(pluginId: string, item: PluginSidebarItemInput): void
  registerSurface(pluginId: string, surfaceId: string, component: PluginSurfaceComponent): void
}

function surfaceKey(pluginId: string, surfaceId: string): string {
  return `${pluginId}:${surfaceId}`
}

export function createPluginContributionRegistry(): PluginContributionRegistry {
  const sidebarItems: PluginSidebarItem[] = []
  const commandCenterItems: PluginCommandCenterItem[] = []
  const surfaces = new Map<string, PluginSurfaceComponent>()
  const surfaceEntries: PluginSurfaceEntry[] = []

  return {
    getCommandCenterItems() {
      return [...commandCenterItems]
    },
    getSidebarItems() {
      return [...sidebarItems]
    },
    getSurface(pluginId, surfaceId) {
      return surfaces.get(surfaceKey(pluginId, surfaceId))
    },
    getSurfaceEntries() {
      return [...surfaceEntries]
    },
    registerCommandCenterItem(pluginId, item) {
      commandCenterItems.push({ pluginId, ...item })
    },
    registerSidebarItem(pluginId, item) {
      sidebarItems.push({ pluginId, ...item })
    },
    registerSurface(pluginId, surfaceId, component) {
      surfaces.set(surfaceKey(pluginId, surfaceId), component)
      // Re-registering the same id replaces in place rather than appending, so
      // the flattened list can never disagree with the keyed map.
      const entry: PluginSurfaceEntry = { pluginId, surfaceId, Component: component }
      const index = surfaceEntries.findIndex(
        (existing) => existing.pluginId === pluginId && existing.surfaceId === surfaceId,
      )
      if (index >= 0) surfaceEntries[index] = entry
      else surfaceEntries.push(entry)
    },
  }
}

/** The context object passed as the sole argument to a plugin module's
 * `default` export — the runtime counterpart of `@kanna/plugin`'s
 * `PluginContext` type. */
export interface PluginContext {
  addSurface(id: string, component: PluginSurfaceComponent): void
  addSidebarItem(item: PluginSidebarItemInput): void
  /** Contribute an entry to the composer's `/` picker. The host namespaces the
   * name by plugin id and drops it if that name is already taken, so this can
   * add to the picker but never shadow what is already in it. */
  addCommandCenterItem(item: PluginCommandCenterItemInput): void
  /** RPC handler wiring is a server-side concern (`plugin-service.ts` loads
   * the plugin's SERVER bundle and calls its own `handle`). The client
   * context accepts the call as a no-op purely so `plugin.handle(...)`
   * inside shared plugin code does not throw when evaluated in the browser. */
  handle(...args: AnyValue[]): void
}

export function createPluginContext(pluginId: string, registry: PluginContributionRegistry): PluginContext {
  return {
    addSurface(id, component) {
      registry.registerSurface(pluginId, id, component)
    },
    addSidebarItem(item) {
      registry.registerSidebarItem(pluginId, item)
    },
    addCommandCenterItem(item) {
      registry.registerCommandCenterItem(pluginId, item)
    },
    handle() {},
  }
}
